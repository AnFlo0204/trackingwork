import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedSession } from '@/lib/auth';
import { extractAndVerifyProofBinary, verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts } from '@/lib/time';

const MAX_UPLOAD_BYTES = 300 * 1024;
const ALLOWED_MIMES = new Set(['image/webp', 'image/jpeg']);

export async function POST(req: Request) {
  const authSession = await getAuthenticatedSession();
  if (!authSession) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }
  const me = authSession.profile;

  const verified = await verifySignedRequest(req, authSession);
  if (!verified.ok) return verified.response;

  try {
    const formData = verified.formData;
    if (!formData) {
      return NextResponse.json({ error: 'Dữ liệu FormData không hợp lệ.' }, { status: 400 });
    }
    const choreId = String(formData.get('choreId') || '').trim();
    const uploadToken = String(formData.get('uploadToken') || '').trim();
    const assignedChoreId = String(formData.get('assignedChoreId') || '').trim() || null;
    const requestedCycleKey = String(formData.get('cycleKey') || '').trim() || null;
    const photo = formData.get('photo');

    if (!choreId || !(photo instanceof Blob) || !uploadToken) {
      return NextResponse.json(
        { error: 'Thiếu token xác thực hoặc ảnh Trước khi làm.' },
        { status: 400 },
      );
    }

    if (photo.size === 0 || photo.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Dung lượng ảnh vượt quá 300KB.' }, { status: 400 });
    }
    if (!ALLOWED_MIMES.has(photo.type)) {
      return NextResponse.json(
        { error: 'Chỉ chấp nhận định dạng ảnh WebP hoặc JPEG.' },
        { status: 400 },
      );
    }

    const mimeType = photo.type;
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'webp';

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes, tokenRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
      supabase.from('upload_tokens').select('*').eq('id', uploadToken).maybeSingle(),
    ]);

    const tok = tokenRes.data;
    const serverNowMs = Date.parse(serverTime.isoUtc);

    if (
      !tok ||
      tok.profile_id !== me.id ||
      tok.chore_id !== choreId ||
      tok.used_at !== null ||
      Date.parse(tok.expires_at) < serverNowMs
    ) {
      return NextResponse.json(
        { error: 'Phiên tải ảnh đã hết hạn (2 phút) hoặc đã được sử dụng. Vui lòng chụp lại.' },
        { status: 403 },
      );
    }

    const { data: consumedTok } = await supabase
      .from('upload_tokens')
      .update({ used_at: serverTime.isoUtc })
      .eq('id', tok.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle();

    if (!consumedTok) {
      return NextResponse.json({ error: 'Phiên tải ảnh không hợp lệ.' }, { status: 409 });
    }

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại.' }, { status: 404 });
    }

    const minDurationMs = Math.max(0, Number(chore.min_duration_minutes || 0)) * 60_000;
    const unlockIso = new Date(serverNowMs + minDurationMs).toISOString();
    const cycleKey = assignedChoreId ? requestedCycleKey || getVnDateParts(serverNowMs).dateStr : null;

    await supabase
      .from('chore_sessions')
      .update({ status: 'cancelled' })
      .eq('profile_id', me.id)
      .eq('chore_id', chore.id)
      .eq('status', 'in_progress');

    const buffer = Buffer.from(await photo.arrayBuffer());
    const binCheck = extractAndVerifyProofBinary(buffer, mimeType, {
      userId: me.id,
      choreId,
      signingKey: authSession.signingKey,
    });
    if (!binCheck.ok) {
      await recordAuditLog({
        actorName: me.display_name,
        actionType: 'BINARY_TAMPER_ATTEMPT',
        targetSummary: `Từ chối ảnh Trước khi làm [${chore.title}]: ${binCheck.reason}`,
        refId: chore.id,
      });
      return NextResponse.json({ error: `Ảnh xác thực không hợp lệ: ${binCheck.reason}` }, { status: 403 });
    }

    const storagePath = `before/${chore.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('chore-proofs')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        cacheControl: '31536000',
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: 'Không thể tải ảnh Trước khi làm.' }, { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('chore-proofs').getPublicUrl(storagePath);

    const { data: session, error: insErr } = await supabase
      .from('chore_sessions')
      .insert({
        chore_id: chore.id,
        profile_id: me.id,
        assigned_chore_id: assignedChoreId,
        cycle_key: cycleKey,
        before_proof_url: publicUrlData.publicUrl,
        before_storage_path: storagePath,
        started_at: serverTime.isoUtc,
        unlock_at: unlockIso,
        status: 'in_progress',
      })
      .select()
      .single();

    if (insErr || !session) {
      await supabase.storage.from('chore-proofs').remove([storagePath]);
      return NextResponse.json({ error: 'Không thể khởi tạo phiên làm việc.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ session });
  } catch (err) {
    console.error('Start chore session error:', err);
    return NextResponse.json({ error: 'Lỗi bắt đầu phiên làm việc.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const authSession = await getAuthenticatedSession();
  if (!authSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const me = authSession.profile;

  const verified = await verifySignedRequest(req, authSession);
  if (!verified.ok) return verified.response;

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Thiếu sessionId' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: session } = await supabase
    .from('chore_sessions')
    .select('id, profile_id, before_storage_path')
    .eq('id', sessionId)
    .eq('profile_id', me.id)
    .eq('status', 'in_progress')
    .maybeSingle();

  if (session) {
    if (session.before_storage_path) {
      await supabase.storage.from('chore-proofs').remove([session.before_storage_path]);
    }
    await supabase.from('chore_sessions').update({ status: 'cancelled' }).eq('id', session.id);
    await bumpSyncSignal('all');
  }

  return NextResponse.json({ ok: true });
}

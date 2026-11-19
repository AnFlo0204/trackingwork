import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedSession } from '@/lib/auth';
import { extractAndVerifyProofBinary, verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts } from '@/lib/time';

const MAX_UPLOAD_BYTES = 300 * 1024;
const ALLOWED_MIMES = new Set(['image/webp', 'image/jpeg']);
const LOCK_TTL_MS = 60 * 60 * 1000; // 60-minute auto-expiration fallback

async function expireStaleLocks(serverNowIso: string) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('chore_sessions')
    .update({ status: 'cancelled' })
    .eq('status', 'in_progress')
    .lte('expires_at', serverNowIso);
}

async function findConflictLock(choreId: string, myId: string, serverNowIso: string) {
  const supabase = getSupabaseAdmin();
  const { data: conflict } = await supabase
    .from('chore_sessions')
    .select('id, profile_id, started_at, expires_at')
    .eq('chore_id', choreId)
    .eq('status', 'in_progress')
    .gt('expires_at', serverNowIso)
    .neq('profile_id', myId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conflict) return null;

  const { data: locker } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .eq('id', conflict.profile_id)
    .maybeSingle();

  return {
    sessionId: conflict.id,
    profileId: conflict.profile_id,
    name: locker?.display_name || locker?.username || 'Thành viên',
    avatarUrl: locker?.avatar_url || null,
  };
}

export async function POST(req: Request) {
  const authSession = await getAuthenticatedSession();
  if (!authSession) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }
  const me = authSession.profile;

  const verified = await verifySignedRequest(req, authSession);
  if (!verified.ok) return verified.response;

  try {
    const supabase = getSupabaseAdmin();

    // JSON mode: acquire lightweight 60-minute active lock for any chore
    if (!verified.formData) {
      const body = verified.rawText ? JSON.parse(verified.rawText) : {};
      const choreId = String(body?.choreId || '').trim();
      const assignedChoreId = String(body?.assignedChoreId || '').trim() || null;
      const requestedCycleKey = String(body?.cycleKey || '').trim() || null;

      if (!choreId) {
        return NextResponse.json({ error: 'Thiếu ID công việc.' }, { status: 400 });
      }

      const [serverTime, choreRes] = await Promise.all([
        fetchAuthoritativeServerTime(),
        supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
      ]);

      const chore = choreRes.data;
      if (!chore) {
        return NextResponse.json({ error: 'Công việc không tồn tại.' }, { status: 404 });
      }

      const serverNowMs = Date.parse(serverTime.isoUtc) || Date.now();
      const serverNowIso = new Date(serverNowMs).toISOString();
      await expireStaleLocks(serverNowIso);

      const conflict = await findConflictLock(chore.id, me.id, serverNowIso);
      if (conflict) {
        return NextResponse.json(
          {
            error: `🔒 ${conflict.name} đang làm ${chore.title}.`,
            lockedBy: conflict,
          },
          { status: 409 },
        );
      }

      // If current user already owns an active lock for this chore, reuse it
      const { data: myExisting } = await supabase
        .from('chore_sessions')
        .select('*')
        .eq('chore_id', chore.id)
        .eq('profile_id', me.id)
        .eq('status', 'in_progress')
        .gt('expires_at', serverNowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (myExisting) {
        return NextResponse.json({
          session: {
            ...myExisting,
            member_name: me.display_name,
            member_avatar_url: me.avatar_url || null,
          },
        });
      }

      const expiresIso = new Date(serverNowMs + LOCK_TTL_MS).toISOString();
      const cycleKey = assignedChoreId ? requestedCycleKey || getVnDateParts(serverNowMs).dateStr : null;

      const { data: session, error: insErr } = await supabase
        .from('chore_sessions')
        .insert({
          chore_id: chore.id,
          profile_id: me.id,
          assigned_chore_id: assignedChoreId,
          cycle_key: cycleKey,
          before_proof_url: '',
          before_storage_path: '',
          started_at: serverNowIso,
          unlock_at: serverNowIso,
          expires_at: expiresIso,
          status: 'in_progress',
        })
        .select()
        .single();

      if (insErr || !session) {
        return NextResponse.json({ error: 'Không thể khóa phiên làm việc.' }, { status: 500 });
      }

      await bumpSyncSignal('all');
      return NextResponse.json({
        session: {
          ...session,
          member_name: me.display_name,
          member_avatar_url: me.avatar_url || null,
        },
      });
    }

    // FormData mode: Before photo + 60-minute active lock
    const formData = verified.formData;
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

    const [serverTime, choreRes, tokenRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
      supabase.from('upload_tokens').select('*').eq('id', uploadToken).maybeSingle(),
    ]);

    const tok = tokenRes.data;
    const serverNowMs = Date.parse(serverTime.isoUtc);
    const serverNowIso = new Date(serverNowMs).toISOString();

    await expireStaleLocks(serverNowIso);

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại.' }, { status: 404 });
    }

    const conflict = await findConflictLock(chore.id, me.id, serverNowIso);
    if (conflict) {
      return NextResponse.json(
        {
          error: `🔒 ${conflict.name} đang làm ${chore.title}.`,
          lockedBy: conflict,
        },
        { status: 409 },
      );
    }

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

    const minDurationMs = Math.max(0, Number(chore.min_duration_minutes || 0)) * 60_000;
    const unlockIso = new Date(serverNowMs + minDurationMs).toISOString();
    const expiresIso = new Date(serverNowMs + Math.max(LOCK_TTL_MS, minDurationMs + 15 * 60_000)).toISOString();
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
        expires_at: expiresIso,
        status: 'in_progress',
      })
      .select()
      .single();

    if (insErr || !session) {
      await supabase.storage.from('chore-proofs').remove([storagePath]);
      return NextResponse.json({ error: 'Không thể khởi tạo phiên làm việc.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({
      session: {
        ...session,
        member_name: me.display_name,
        member_avatar_url: me.avatar_url || null,
      },
    });
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
  const choreId = searchParams.get('choreId');
  if (!sessionId && !choreId) {
    return NextResponse.json({ error: 'Thiếu sessionId hoặc choreId' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('chore_sessions')
    .select('id, profile_id, before_storage_path')
    .eq('status', 'in_progress');

  if (sessionId) {
    query = query.eq('id', sessionId);
  } else if (choreId) {
    query = query.eq('chore_id', choreId);
  }
  if (me.role !== 'admin') {
    query = query.eq('profile_id', me.id);
  }

  const { data: sessions } = await query;
  if (sessions && sessions.length > 0) {
    const paths = sessions.map((s) => s.before_storage_path).filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from('chore-proofs').remove(paths);
    }
    const ids = sessions.map((s) => s.id);
    await supabase.from('chore_sessions').update({ status: 'cancelled' }).in('id', ids);
    await bumpSyncSignal('all');
  }

  return NextResponse.json({ ok: true });
}

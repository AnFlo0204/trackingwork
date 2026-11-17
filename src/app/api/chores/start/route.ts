import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts } from '@/lib/time';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Phiên đăng nhập hết hạn.' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const choreId = String(formData.get('choreId') || '').trim();
    const assignedChoreId = String(formData.get('assignedChoreId') || '').trim() || null;
    const requestedCycleKey = String(formData.get('cycleKey') || '').trim() || null;
    const photo = formData.get('photo');

    if (!choreId || !(photo instanceof Blob)) {
      return NextResponse.json({ error: 'Thiếu thông tin hoặc ảnh Trước khi làm.' }, { status: 400 });
    }
    if (photo.size === 0 || photo.size > 300 * 1024) {
      return NextResponse.json({ error: 'Dung lượng ảnh không hợp lệ (<= 180KB).' }, { status: 400 });
    }

    const mimeType = ['image/webp', 'image/jpeg', 'image/png'].includes(photo.type)
      ? photo.type
      : 'image/webp';
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('*').eq('id', choreId).eq('is_active', true).maybeSingle(),
    ]);

    const chore = choreRes.data;
    if (!chore) {
      return NextResponse.json({ error: 'Công việc không tồn tại.' }, { status: 404 });
    }

    const serverNowMs = Date.parse(serverTime.isoUtc);
    const minDurationMs = Math.max(0, Number(chore.min_duration_minutes || 0)) * 60_000;
    const unlockIso = new Date(serverNowMs + minDurationMs).toISOString();
    const cycleKey = assignedChoreId ? requestedCycleKey || getVnDateParts(serverNowMs).dateStr : null;

    // Cancel any older in_progress session for same user & chore
    await supabase
      .from('chore_sessions')
      .update({ status: 'cancelled' })
      .eq('profile_id', me.id)
      .eq('chore_id', chore.id)
      .eq('status', 'in_progress');

    const buffer = Buffer.from(await photo.arrayBuffer());
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
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

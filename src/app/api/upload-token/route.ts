import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Issues a single-use short-lived (2-minute TTL) upload token alongside authoritative server time.
 */
export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const me = session.profile;

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const choreId = String(body?.choreId || '').trim();
    const phase = ['before', 'after', 'single'].includes(body?.phase) ? body.phase : 'single';

    if (!choreId) {
      return NextResponse.json({ error: 'Thiếu ID công việc.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const [serverTime, choreRes] = await Promise.all([
      fetchAuthoritativeServerTime(),
      supabase.from('chores').select('id').eq('id', choreId).eq('is_active', true).maybeSingle(),
    ]);

    if (!choreRes.data) {
      return NextResponse.json({ error: 'Công việc không tồn tại.' }, { status: 404 });
    }

    const serverNowIso = serverTime.isoUtc;
    const { data: activeLock } = await supabase
      .from('chore_sessions')
      .select('id, profile_id, expires_at')
      .eq('chore_id', choreId)
      .eq('status', 'in_progress')
      .gt('expires_at', serverNowIso)
      .neq('profile_id', me.id)
      .limit(1)
      .maybeSingle();

    if (activeLock) {
      const { data: locker } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', activeLock.profile_id)
        .maybeSingle();
      const lockerName = locker?.display_name || locker?.username || 'Thành viên';
      return NextResponse.json(
        { error: `🔒 ${lockerName} đang làm việc này.` },
        { status: 409 },
      );
    }

    const serverNowMs = Date.parse(serverNowIso) || Date.now();
    const expiresAt = new Date(serverNowMs + 2 * 60_000).toISOString(); // 2-minute TTL

    const { data: tok, error } = await supabase
      .from('upload_tokens')
      .insert({
        profile_id: me.id,
        chore_id: choreId,
        phase,
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (error || !tok) {
      return NextResponse.json({ error: 'Không thể cấp phiên tải ảnh.' }, { status: 500 });
    }

    return NextResponse.json({
      token: tok.id,
      expiresAt: tok.expires_at,
      vnFormatted: serverTime.vnFormatted,
      isoUtc: serverTime.isoUtc,
    });
  } catch (err) {
    console.error('Upload token error:', err);
    return NextResponse.json({ error: 'Lỗi cấp token tải ảnh.' }, { status: 500 });
  }
}

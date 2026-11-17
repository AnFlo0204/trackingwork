import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Issues a single-use short-lived (2-minute TTL) upload token alongside authoritative server time.
 */
export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
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

    const serverNowMs = Date.parse(serverTime.isoUtc) || Date.now();
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

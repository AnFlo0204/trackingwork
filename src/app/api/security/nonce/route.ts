import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const NONCE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const SESSION_MUTATIONS_PER_MIN = 30;

export async function GET(req: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const method = (url.searchParams.get('m') || 'POST').toUpperCase().slice(0, 12);
    const path = (url.searchParams.get('p') || '/api').slice(0, 240);

    const supabase = getSupabaseAdmin();
    const nowMs = Date.now();
    const oneMinAgoIso = new Date(nowMs - 60_000).toISOString();

    const { count } = await supabase
      .from('used_nonces')
      .select('nonce', { count: 'exact', head: true })
      .eq('profile_id', session.profile.id)
      .gte('created_at', oneMinAgoIso);

    if ((count || 0) >= SESSION_MUTATIONS_PER_MIN) {
      return NextResponse.json(
        { error: 'Thao tác quá nhanh (tối đa 30 yêu cầu/phút). Vui lòng đợi một lát.' },
        { status: 429 },
      );
    }

    // Probabilistic cleanup of expired nonces (> 15 mins old)
    if (Math.random() < 0.15) {
      const cleanupIso = new Date(nowMs - 15 * 60_000).toISOString();
      await supabase.from('used_nonces').delete().lt('expires_at', cleanupIso);
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(nowMs + NONCE_TTL_MS).toISOString();

    const { error } = await supabase.from('used_nonces').insert({
      nonce,
      profile_id: session.profile.id,
      method,
      path,
      expires_at: expiresAt,
    });

    if (error) {
      return NextResponse.json({ error: 'Không thể khởi tạo mã xác thực nonce.' }, { status: 500 });
    }

    return NextResponse.json(
      {
        nonce,
        serverNowMs: nowMs,
        expiresAt,
        signingKey: session.signingKey,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('Nonce generation error:', err);
    return NextResponse.json({ error: 'Lỗi cấp nonce bảo mật.' }, { status: 500 });
  }
}

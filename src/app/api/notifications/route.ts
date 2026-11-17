import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const supabase = getSupabaseAdmin();

    if (body?.id) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', String(body.id))
        .eq('profile_id', me.id);
    } else {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('profile_id', me.id)
        .eq('is_read', false);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật thông báo.' }, { status: 500 });
  }
}

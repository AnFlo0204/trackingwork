import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
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

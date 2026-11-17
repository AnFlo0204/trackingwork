import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const profileId = String(body?.profile_id || '').trim();
    const choreId = body?.chore_id ? String(body.chore_id).trim() : null;
    const amount = Math.max(1000, Math.floor(Number(body?.amount || 20000)));
    const reason = String(body?.reason || '').trim();

    if (!profileId || !reason) {
      return NextResponse.json({ error: 'Vui lòng chọn thành viên và nhập lý do phạt.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('penalties').insert({
      profile_id: profileId,
      chore_id: choreId,
      amount,
      reason,
      status: 'unpaid',
    });

    if (error) {
      return NextResponse.json({ error: 'Không thể ghi nhận khoản phạt.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Create penalty error:', err);
    return NextResponse.json({ error: 'Lỗi ghi nhận khoản phạt.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const id = String(body?.id || '').trim();
    const status = body?.status === 'paid' ? 'paid' : 'unpaid';

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('penalties')
      .update({
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: 'Không thể cập nhật trạng thái quỹ phạt.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Update penalty error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật quỹ phạt.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Thiếu ID' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    await supabase.from('penalties').delete().eq('id', id);
    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete penalty error:', err);
    return NextResponse.json({ error: 'Lỗi xóa khoản phạt.' }, { status: 500 });
  }
}

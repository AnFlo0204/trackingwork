import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const assignedChoreId = String(body?.assigned_chore_id || '').trim();
    const cycleKey = String(body?.cycle_key || '').trim();
    const targetId = body?.target_id ? String(body.target_id).trim() : null;
    const bountyAmount = Math.max(0, Math.floor(Number(body?.bounty_amount || 0)));
    const note = String(body?.note || '').trim().slice(0, 120);

    if (!assignedChoreId || !cycleKey) {
      return NextResponse.json({ error: 'Thiếu thông tin ca cần chuyển.' }, { status: 400 });
    }
    if (targetId && targetId === me.id) {
      return NextResponse.json({ error: 'Không thể tự nhờ chính mình làm hộ.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: assignment } = await supabase
      .from('assigned_chores')
      .select('id, chore_id, assignee_id, is_active')
      .eq('id', assignedChoreId)
      .maybeSingle();

    if (!assignment || !assignment.is_active || assignment.assignee_id !== me.id) {
      return NextResponse.json(
        { error: 'Bạn chỉ có thể chuyển ca cho nhiệm vụ đang được giao cho mình.' },
        { status: 403 },
      );
    }

    if (bountyAmount > 0 && me.current_balance < bountyAmount) {
      return NextResponse.json(
        { error: 'Số dư ví quỹ tuần hiện tại không đủ để treo thưởng mức này.' },
        { status: 400 },
      );
    }

    const { data: chore } = await supabase
      .from('chores')
      .select('title')
      .eq('id', assignment.chore_id)
      .maybeSingle();

    const { data: swap, error: insErr } = await supabase
      .from('shift_swaps')
      .insert({
        assigned_chore_id: assignedChoreId,
        cycle_key: cycleKey,
        requester_id: me.id,
        target_id: targetId,
        bounty_amount: bountyAmount,
        note,
        status: 'open',
      })
      .select()
      .single();

    if (insErr) {
      return NextResponse.json(
        { error: 'Ca này đang có yêu cầu nhờ làm hộ hoặc đã được nhận.' },
        { status: 409 },
      );
    }

    const choreTitle = chore?.title || 'Việc nhà';
    const bountyText = bountyAmount > 0 ? ` • Thưởng ${bountyAmount.toLocaleString('vi-VN')}đ` : '';

    if (targetId) {
      await supabase.from('notifications').insert({
        profile_id: targetId,
        kind: 'swap_request',
        title: `${me.display_name} nhờ làm hộ: ${choreTitle}`,
        body: `Nhận ca giúp ${me.display_name}${bountyText}${note ? ` (${note})` : ''}.`,
      });
    } else {
      const { data: others } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_active', true)
        .neq('id', me.id);
      if (others && others.length > 0) {
        await supabase.from('notifications').insert(
          others.map((o) => ({
            profile_id: o.id,
            kind: 'swap_request',
            title: `Kèo làm hộ mới: ${choreTitle}`,
            body: `${me.display_name} đăng bảng chung${bountyText}.`,
          })),
        );
      }
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ swap });
  } catch (err) {
    console.error('Create swap error:', err);
    return NextResponse.json({ error: 'Lỗi tạo yêu cầu đổi ca.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const swapId = String(body?.swapId || '').trim();
    const action = body?.action === 'cancel' ? 'cancel' : 'accept';

    const supabase = getSupabaseAdmin();
    const { data: swap } = await supabase
      .from('shift_swaps')
      .select('*')
      .eq('id', swapId)
      .maybeSingle();

    if (!swap) {
      return NextResponse.json({ error: 'Không tìm thấy yêu cầu chuyển ca.' }, { status: 404 });
    }

    if (action === 'cancel') {
      if (swap.requester_id !== me.id && me.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (swap.status !== 'open') {
        return NextResponse.json({ error: 'Chỉ có thể huỷ yêu cầu khi chưa có người nhận.' }, { status: 400 });
      }
      await supabase.from('shift_swaps').update({ status: 'cancelled' }).eq('id', swap.id);
      await bumpSyncSignal('all');
      return NextResponse.json({ ok: true });
    }

    // Accept swap
    if (swap.status !== 'open') {
      return NextResponse.json({ error: 'Kèo làm hộ này đã có người khác nhận rồi.' }, { status: 409 });
    }
    if (swap.requester_id === me.id) {
      return NextResponse.json({ error: 'Bạn không thể tự nhận lại kèo của mình.' }, { status: 400 });
    }
    if (swap.target_id && swap.target_id !== me.id) {
      return NextResponse.json({ error: 'Yêu cầu này được gửi riêng cho thành viên khác.' }, { status: 403 });
    }

    const serverTime = await fetchAuthoritativeServerTime();
    const { error: updErr } = await supabase
      .from('shift_swaps')
      .update({
        status: 'accepted',
        accepted_by: me.id,
        accepted_at: serverTime.isoUtc,
      })
      .eq('id', swap.id)
      .eq('status', 'open');

    if (updErr) {
      return NextResponse.json({ error: 'Không thể nhận ca làm hộ.' }, { status: 500 });
    }

    await supabase.from('notifications').insert({
      profile_id: swap.requester_id,
      kind: 'swap_accepted',
      title: `${me.display_name} đã nhận làm hộ ca của bạn`,
      body: `Trách nhiệm hoàn thành và rủi ro phạt trễ đã chuyển sang ${me.display_name}.`,
    });

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Swap response error:', err);
    return NextResponse.json({ error: 'Lỗi xử lý chuyển ca.' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || (me.role !== 'admin' && !me.can_assign_tasks)) {
    return NextResponse.json({ error: 'Bạn chưa được cấp quyền giao việc.' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const choreId = String(body?.chore_id || '').trim();
    const assigneeId = String(body?.assignee_id || '').trim();
    const scheduleType = ['daily', 'weekly_days', 'once'].includes(body?.schedule_type)
      ? body.schedule_type
      : 'daily';
    const daysOfWeek: number[] = Array.isArray(body?.days_of_week)
      ? body.days_of_week
          .map((d: unknown) => Number(d))
          .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    const dueDate = body?.due_date ? String(body.due_date).trim() : null;
    const dueTime = /^\d{2}:\d{2}$/.test(String(body?.due_time || ''))
      ? String(body.due_time)
      : '23:59';
    const penaltyAmount = Math.max(0, Math.floor(Number(body?.penalty_amount ?? 20000)));
    const bonusAmount = Math.max(0, Math.floor(Number(body?.bonus_amount ?? 0)));

    if (!choreId || !assigneeId) {
      return NextResponse.json({ error: 'Vui lòng chọn đầu việc và người nhận.' }, { status: 400 });
    }
    if (scheduleType === 'weekly_days' && daysOfWeek.length === 0) {
      return NextResponse.json({ error: 'Vui lòng chọn ít nhất 1 ngày trong tuần.' }, { status: 400 });
    }
    if (scheduleType === 'once' && !dueDate) {
      return NextResponse.json({ error: 'Vui lòng chọn ngày hạn hoàn thành.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (bonusAmount > 0 && me.role !== 'admin') {
      const { data: cfgRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'bonus_reward_config')
        .maybeSingle();
      const maxCap = Number(cfgRow?.value?.max_delegated_bonus ?? 100000);
      if (cfgRow?.value?.enabled === false) {
        return NextResponse.json({ error: 'Tính năng thưởng đang được Admin tắt.' }, { status: 403 });
      }
      if (bonusAmount > maxCap) {
        return NextResponse.json(
          { error: `Người giao việc chỉ được đặt mức thưởng tối đa ${maxCap.toLocaleString('vi-VN')}đ.` },
          { status: 403 },
        );
      }
    }

    const { data, error } = await supabase
      .from('assigned_chores')
      .insert({
        chore_id: choreId,
        assignee_id: assigneeId,
        assigned_by: me.id,
        schedule_type: scheduleType,
        days_of_week: scheduleType === 'weekly_days' ? daysOfWeek : [],
        due_date: scheduleType === 'once' ? dueDate : null,
        due_time: dueTime,
        penalty_amount: penaltyAmount,
        bonus_amount: bonusAmount,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Assign chore error:', error);
      return NextResponse.json({ error: 'Không thể tạo lịch giao việc.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ assignment: data });
  } catch (err) {
    console.error('POST assignments error:', err);
    return NextResponse.json({ error: 'Lỗi giao việc.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || (me.role !== 'admin' && !me.can_assign_tasks)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const id = String(body?.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID nhiệm vụ.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;
    if (typeof body.penalty_amount !== 'undefined') {
      updates.penalty_amount = Math.max(0, Math.floor(Number(body.penalty_amount)));
    }
    if (typeof body.bonus_amount !== 'undefined') {
      updates.bonus_amount = Math.max(0, Math.floor(Number(body.bonus_amount)));
    }
    if (/^\d{2}:\d{2}$/.test(String(body?.due_time || ''))) {
      updates.due_time = String(body.due_time);
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('assigned_chores').update(updates).eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể cập nhật lịch giao việc.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH assignments error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật giao việc.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || (me.role !== 'admin' && !me.can_assign_tasks)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID nhiệm vụ.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('assigned_chores').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể xóa nhiệm vụ được giao.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE assignments error:', err);
    return NextResponse.json({ error: 'Lỗi xóa nhiệm vụ.' }, { status: 500 });
  }
}

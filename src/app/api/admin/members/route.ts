import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedProfile } from '@/lib/auth';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentWeeklyPeriodKey, getVnDateParts } from '@/lib/time';

const MAX_MEMBERS = 10;

export async function POST(req: Request) {
  const me = await getAuthenticatedProfile();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const username = String(body?.username || '').trim();
    const displayName = String(body?.display_name || username).trim();
    const pin = String(body?.pin || '').trim();
    const canAssignTasks = Boolean(body?.can_assign_tasks ?? false);
    const weeklyAllowance = Math.max(0, Math.floor(Number(body?.weekly_allowance ?? 0)));

    if (!username || username.length < 2) {
      return NextResponse.json({ error: 'Tên đăng nhập phải có ít nhất 2 ký tự.' }, { status: 400 });
    }
    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'Mã PIN thành viên phải gồm đúng 6 chữ số.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existingProfiles } = await supabase
      .from('profiles')
      .select('id, username, role');

    const memberCount = (existingProfiles || []).filter((p) => p.role === 'member').length;
    if (memberCount >= MAX_MEMBERS) {
      return NextResponse.json(
        { error: `Đã đạt giới hạn tối đa ${MAX_MEMBERS} thành viên.` },
        { status: 400 },
      );
    }

    const dup = (existingProfiles || []).some(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
    if (dup) {
      return NextResponse.json({ error: 'Tên đăng nhập này đã tồn tại.' }, { status: 409 });
    }

    const passwordHash = bcrypt.hashSync(pin, 10);
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        username,
        display_name: displayName || username,
        role: 'member',
        pin: null,
        password_hash: passwordHash,
        is_active: true,
        can_assign_tasks: canAssignTasks,
        weekly_allowance: weeklyAllowance,
        current_balance: weeklyAllowance,
      })
      .select(
        'id, username, display_name, role, is_active, can_assign_tasks, weekly_allowance, current_balance, created_at',
      )
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Không thể tạo thành viên.' }, { status: 500 });
    }

    if (weeklyAllowance > 0) {
      const nowMs = Date.now();
      const parts = getVnDateParts(nowMs);
      const periodKey = getCurrentWeeklyPeriodKey(nowMs, 1, 0);
      await supabase.from('fund_transactions').insert({
        profile_id: data.id,
        tx_type: 'weekly_reset',
        category: 'weekly_reset',
        amount: weeklyAllowance,
        balance_after: weeklyAllowance,
        cycle_key: periodKey,
        description: `Cấp quỹ tuần đầu (${String(parts.dd).padStart(2, '0')}/${String(parts.mm).padStart(2, '0')})`,
        created_by: me.id,
      });
    }

    await recordAuditLog({
      actorName: me.display_name,
      actionType: 'CHANGE_ROLE',
      targetSummary: `Tạo thành viên "${data.display_name}" (@${data.username}, Quyền giao việc: ${canAssignTasks ? 'Có' : 'Không'}, Quỹ tuần: ${weeklyAllowance.toLocaleString('vi-VN')}đ)`,
      refId: data.id,
    });

    await bumpSyncSignal('all');
    return NextResponse.json({ member: data });
  } catch (err) {
    console.error('Create member error:', err);
    return NextResponse.json({ error: 'Lỗi tạo thành viên.' }, { status: 500 });
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
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID thành viên.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase
      .from('profiles')
      .select('id, role, username, display_name, is_active, can_assign_tasks, current_balance, weekly_allowance')
      .eq('id', id)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: 'Không tìm thấy thành viên.' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changeNotes: string[] = [];

    if (typeof body.weekly_allowance !== 'undefined') {
      const nextAllowance = Math.max(0, Math.floor(Number(body.weekly_allowance)));
      updates.weekly_allowance = nextAllowance;
      changeNotes.push(
        `Quỹ tuần ${Number(target.weekly_allowance || 0).toLocaleString('vi-VN')}đ -> ${nextAllowance.toLocaleString('vi-VN')}đ`,
      );
      if (Number(target.weekly_allowance || 0) === 0 && Number(target.current_balance || 0) === 0 && nextAllowance > 0) {
        updates.current_balance = nextAllowance;
        await supabase.from('fund_transactions').insert({
          profile_id: id,
          tx_type: 'adjustment',
          category: 'adjustment',
          amount: nextAllowance,
          balance_after: nextAllowance,
          description: 'Cấp quỹ tuần khởi tạo bởi Admin',
          created_by: me.id,
        });
      }
    }

    if (target.role !== 'admin') {
      if (typeof body.display_name === 'string' && body.display_name.trim()) {
        updates.display_name = body.display_name.trim();
      }
      if (typeof body.is_active === 'boolean') {
        updates.is_active = body.is_active;
        updates.failed_attempts = 0;
        updates.locked_until = null;
        changeNotes.push(body.is_active ? 'Mở khóa tài khoản' : 'Khóa tài khoản');
      }
      if (typeof body.can_assign_tasks === 'boolean') {
        updates.can_assign_tasks = body.can_assign_tasks;
        changeNotes.push(
          `Quyền giao việc: ${target.can_assign_tasks ? 'Bật' : 'Tắt'} -> ${body.can_assign_tasks ? 'Bật' : 'Tắt'}`,
        );
      }
      if (typeof body.pin === 'string' && body.pin.trim() !== '') {
        const pin = body.pin.trim();
        if (!/^\d{6}$/.test(pin)) {
          return NextResponse.json({ error: 'Mã PIN mới phải gồm đúng 6 chữ số.' }, { status: 400 });
        }
        updates.password_hash = bcrypt.hashSync(pin, 10);
        updates.failed_attempts = 0;
        updates.locked_until = null;
        changeNotes.push('Đặt lại mã PIN 6 số');
      }
    }

    if (changeNotes.length > 0) {
      await recordAuditLog({
        actorName: me.display_name,
        actionType: 'CHANGE_ROLE',
        targetSummary: `Cập nhật "${target.display_name}": ${changeNotes.join(', ')}`,
        refId: id,
      });
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể cập nhật thành viên.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Update member error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật thành viên.' }, { status: 500 });
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
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID thành viên.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: target } = await supabase
      .from('profiles')
      .select('id, role, display_name, username')
      .eq('id', id)
      .maybeSingle();
    if (!target || target.role === 'admin') {
      return NextResponse.json({ error: 'Không thể xóa tài khoản Admin.' }, { status: 400 });
    }

    await recordAuditLog({
      actorName: me.display_name,
      actionType: 'CHANGE_ROLE',
      targetSummary: `Xóa thành viên "${target.display_name}" (@${target.username})`,
      refId: id,
    });

    const { data: logs } = await supabase
      .from('chore_logs')
      .select('storage_path, before_storage_path, thumb_storage_path')
      .eq('profile_id', id);
    const paths = (logs || [])
      .flatMap((l) => [l.storage_path, l.before_storage_path, l.thumb_storage_path])
      .filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from('chore-proofs').remove(paths);
    }

    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể xóa thành viên.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete member error:', err);
    return NextResponse.json({ error: 'Lỗi xóa thành viên.' }, { status: 500 });
  }
}

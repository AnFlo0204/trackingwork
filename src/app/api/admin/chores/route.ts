import { NextResponse } from 'next/server';
import { recordAuditLog } from '@/lib/audit';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const title = String(body?.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Vui lòng nhập tên công việc.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from('chores')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;
    const frequency = ['always', 'daily', 'weekly'].includes(body?.frequency) ? body.frequency : 'daily';
    const requireBeforeAfter = Boolean(body?.require_before_after ?? false);
    const minDurationMinutes = requireBeforeAfter
      ? Math.max(0, Math.min(240, Math.floor(Number(body?.min_duration_minutes ?? 0))))
      : 0;

    const { data, error } = await supabase
      .from('chores')
      .insert({
        title,
        icon: String(body?.icon || 'sparkles'),
        points: Math.max(0, Math.min(1000, Math.floor(Number(body?.points ?? 10)))),
        cooldown_minutes: Math.max(0, Math.min(10080, Math.floor(Number(body?.cooldown_minutes ?? 30)))),
        frequency,
        penalty_amount: Math.max(0, Math.floor(Number(body?.penalty_amount ?? 20000))),
        bonus_amount: Math.max(0, Math.floor(Number(body?.bonus_amount ?? 0))),
        require_before_after: requireBeforeAfter,
        min_duration_minutes: minDurationMinutes,
        sort_order: nextOrder,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Không thể thêm công việc mới.' }, { status: 500 });
    }

    await recordAuditLog({
      actorName: me.display_name,
      actionType: 'EDIT_CHORE',
      targetSummary: `Thêm đầu việc mới "${title}" (Phạt ${Number(data.penalty_amount).toLocaleString('vi-VN')}đ)`,
      refId: data.id,
    });

    await bumpSyncSignal('all');
    return NextResponse.json({ chore: data });
  } catch (err) {
    console.error('Add chore error:', err);
    return NextResponse.json({ error: 'Lỗi thêm công việc.' }, { status: 500 });
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
      return NextResponse.json({ error: 'Thiếu ID công việc.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (body?.move === 'up' || body?.move === 'down') {
      const { data: allChores } = await supabase
        .from('chores')
        .select('id, sort_order')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (allChores && allChores.length > 1) {
        const idx = allChores.findIndex((c) => c.id === id);
        const swapIdx = body.move === 'up' ? idx - 1 : idx + 1;
        if (idx >= 0 && swapIdx >= 0 && swapIdx < allChores.length) {
          const reordered = [...allChores];
          const [moved] = reordered.splice(idx, 1);
          reordered.splice(swapIdx, 0, moved);
          await Promise.all(
            reordered.map((c, index) =>
              supabase.from('chores').update({ sort_order: index + 1 }).eq('id', c.id),
            ),
          );
          await bumpSyncSignal('all');
        }
      }
      return NextResponse.json({ ok: true });
    }

    const { data: prevChore } = await supabase.from('chores').select('*').eq('id', id).maybeSingle();
    if (!prevChore) {
      return NextResponse.json({ error: 'Không tìm thấy công việc.' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim();
    if (typeof body.icon === 'string') updates.icon = body.icon;
    if (typeof body.points !== 'undefined') {
      updates.points = Math.max(0, Math.min(1000, Math.floor(Number(body.points))));
    }
    if (typeof body.cooldown_minutes !== 'undefined') {
      updates.cooldown_minutes = Math.max(0, Math.min(10080, Math.floor(Number(body.cooldown_minutes))));
    }
    if (['always', 'daily', 'weekly'].includes(body?.frequency)) updates.frequency = body.frequency;
    if (typeof body.penalty_amount !== 'undefined') {
      updates.penalty_amount = Math.max(0, Math.floor(Number(body.penalty_amount)));
    }
    if (typeof body.bonus_amount !== 'undefined') {
      updates.bonus_amount = Math.max(0, Math.floor(Number(body.bonus_amount)));
    }
    if (typeof body.require_before_after === 'boolean') {
      updates.require_before_after = body.require_before_after;
    }
    if (typeof body.min_duration_minutes !== 'undefined') {
      updates.min_duration_minutes = Math.max(
        0,
        Math.min(240, Math.floor(Number(body.min_duration_minutes))),
      );
    }
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

    const { data: updatedChore, error } = await supabase
      .from('chores')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: 'Không thể cập nhật công việc.' }, { status: 500 });
    }

    const diffs: string[] = [];
    if (typeof updates.title === 'string' && updates.title !== prevChore.title) {
      diffs.push(`Tên "${prevChore.title}" → "${updates.title}"`);
    }
    if (typeof updates.frequency === 'string' && updates.frequency !== prevChore.frequency) {
      diffs.push(`Chu kỳ ${prevChore.frequency} → ${updates.frequency}`);
    }
    if (typeof updates.points === 'number' && updates.points !== prevChore.points) {
      diffs.push(`${prevChore.points} → ${updates.points} điểm`);
    }
    if (
      typeof updates.bonus_amount === 'number' &&
      updates.bonus_amount !== Number(prevChore.bonus_amount || 0)
    ) {
      diffs.push(
        `Thưởng ${Number(prevChore.bonus_amount || 0).toLocaleString('vi-VN')}đ → ${updates.bonus_amount.toLocaleString('vi-VN')}đ`,
      );
    }
    if (
      typeof updates.penalty_amount === 'number' &&
      updates.penalty_amount !== Number(prevChore.penalty_amount || 0)
    ) {
      diffs.push(
        `Phạt ${Number(prevChore.penalty_amount || 0).toLocaleString('vi-VN')}đ → ${updates.penalty_amount.toLocaleString('vi-VN')}đ`,
      );
    }

    const pointsConfigChanged =
      typeof updates.points === 'number' ||
      typeof updates.bonus_amount === 'number' ||
      typeof updates.penalty_amount === 'number';

    await recordAuditLog({
      actorName: me.display_name,
      actionType: pointsConfigChanged ? 'UPDATE_CHORE_POINTS' : 'EDIT_CHORE',
      targetSummary:
        diffs.length > 0
          ? `${me.display_name} sửa [${prevChore.title}]: ${diffs.join(', ')}`
          : `${me.display_name} cập nhật [${prevChore.title}]`,
      refId: id,
    });

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true, chore: updatedChore });
  } catch (err) {
    console.error('Update chore error:', err);
    return NextResponse.json({ error: 'Lỗi cập nhật công việc.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Thiếu ID công việc.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: targetChore } = await supabase.from('chores').select('title').eq('id', id).maybeSingle();

    await recordAuditLog({
      actorName: me.display_name,
      actionType: 'DELETE_CHORE',
      targetSummary: `Xóa danh mục công việc "${targetChore?.title || id}"`,
      refId: id,
    });

    const { data: logs } = await supabase
      .from('chore_logs')
      .select('storage_path, before_storage_path, thumb_storage_path')
      .eq('chore_id', id);
    const paths = (logs || [])
      .flatMap((l) => [l.storage_path, l.before_storage_path, l.thumb_storage_path])
      .filter(Boolean) as string[];
    if (paths.length > 0) {
      await supabase.storage.from('chore-proofs').remove(paths);
    }

    const { error } = await supabase.from('chores').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Không thể xóa công việc.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete chore error:', err);
    return NextResponse.json({ error: 'Lỗi xóa công việc.' }, { status: 500 });
  }
}

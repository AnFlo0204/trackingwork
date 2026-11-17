import { NextResponse } from 'next/server';
import { getAuthenticatedSession } from '@/lib/auth';
import { verifySignedRequest } from '@/lib/requestIntegrity';
import { bumpSyncSignal, getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime } from '@/lib/time';
import { DEFAULT_BONUS_REWARD_CONFIG } from '@/lib/types';

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  const me = session?.profile;
  if (!session || !me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (me.role !== 'admin' && !me.can_assign_tasks) {
    return NextResponse.json(
      { error: 'Chỉ Admin hoặc Người giao việc mới có quyền tặng thưởng.' },
      { status: 403 },
    );
  }

  const verified = await verifySignedRequest(req, session);
  if (!verified.ok) return verified.response;

  try {
    const body = verified.rawText ? JSON.parse(verified.rawText) : {};
    const logId = body?.logId ? String(body.logId).trim() : null;
    const rawRecipientId = body?.recipientId ? String(body.recipientId).trim() : null;
    const amount = Math.round(Number(body?.amount || 0));
    const note = String(body?.reason || body?.note || '').trim().slice(0, 140);

    if (!Number.isFinite(amount) || amount < 1000) {
      return NextResponse.json(
        { error: 'Số tiền thưởng tối thiểu phải từ 1.000đ.' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const [{ data: cfgRow }, serverTime] = await Promise.all([
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'bonus_reward_config')
        .maybeSingle(),
      fetchAuthoritativeServerTime(),
    ]);

    const bonusCfg = {
      enabled: Boolean(cfgRow?.value?.enabled ?? DEFAULT_BONUS_REWARD_CONFIG.enabled),
      max_delegated_bonus: Number(
        cfgRow?.value?.max_delegated_bonus ?? DEFAULT_BONUS_REWARD_CONFIG.max_delegated_bonus,
      ),
    };

    if (!bonusCfg.enabled) {
      return NextResponse.json(
        { error: 'Tính năng Tặng thưởng hiện đang được Admin tắt.' },
        { status: 403 },
      );
    }

    if (me.role !== 'admin' && amount > bonusCfg.max_delegated_bonus) {
      return NextResponse.json(
        {
          error: `Người giao việc chỉ được thưởng tối đa ${bonusCfg.max_delegated_bonus.toLocaleString('vi-VN')}đ mỗi lần.`,
        },
        { status: 403 },
      );
    }

    let recipientId = rawRecipientId;
    let choreId: string | null = null;
    let assignedChoreId: string | null = null;
    let cycleKey: string | null = null;
    let fallbackReason = 'Làm tốt việc nhà';

    if (logId) {
      const { data: logRow } = await supabase
        .from('chore_logs')
        .select('id, profile_id, chore_id, assigned_chore_id, cycle_key, chore_title_snapshot')
        .eq('id', logId)
        .maybeSingle();

      if (!logRow) {
        return NextResponse.json({ error: 'Không tìm thấy lượt hoàn thành.' }, { status: 404 });
      }
      recipientId = logRow.profile_id;
      choreId = logRow.chore_id;
      assignedChoreId = logRow.assigned_chore_id;
      cycleKey = logRow.cycle_key;
      fallbackReason = logRow.chore_title_snapshot || fallbackReason;
    }

    if (!recipientId) {
      return NextResponse.json({ error: 'Thiếu thông tin người nhận thưởng.' }, { status: 400 });
    }

    if (recipientId === me.id) {
      return NextResponse.json(
        { error: 'Bạn không thể tự tặng thưởng cho chính mình.' },
        { status: 403 },
      );
    }

    const reasonText = note || fallbackReason;

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('award_member_bonus', {
      p_recipient_id: recipientId,
      p_actor_id: me.id,
      p_actor_name: me.display_name,
      p_amount: amount,
      p_reason: reasonText,
      p_log_id: logId,
      p_assigned_chore_id: assignedChoreId,
      p_chore_id: choreId,
      p_cycle_key: cycleKey,
      p_server_ts: serverTime.isoUtc,
      p_is_auto: false,
    });

    if (rpcErr) {
      console.error('award_member_bonus RPC error:', rpcErr);
      return NextResponse.json({ error: 'Không thể ghi nhận khoản thưởng.' }, { status: 500 });
    }

    await bumpSyncSignal('all');
    return NextResponse.json({
      ok: true,
      result: rpcResult,
    });
  } catch (err) {
    console.error('Bonus reward error:', err);
    return NextResponse.json({ error: 'Lỗi xử lý tặng thưởng.' }, { status: 500 });
  }
}

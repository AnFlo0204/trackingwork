import { bumpSyncSignal, getSupabaseAdmin } from './supabaseAdmin';
import {
  addDaysToVnDateStr,
  getCurrentWeeklyPeriodKey,
  getDayOfWeekFromVnDateStr,
  getVnDateParts,
  vnDateTimeToUtcMs,
} from './time';
import {
  DEFAULT_WEEKLY_FUND_CONFIG,
  type AssignedChoreItem,
  type AssignmentCycleStatus,
  type ChoreLogItem,
  type FundTransactionItem,
  type ProfilePublic,
  type ShiftSwapItem,
  type WeeklyFundConfig,
  type WeeklySettlementRow,
} from './types';

interface RawAssignment {
  id: string;
  chore_id: string;
  assignee_id: string;
  assigned_by: string | null;
  schedule_type: 'daily' | 'weekly_days' | 'once';
  days_of_week: number[] | null;
  due_date: string | null;
  due_time: string;
  penalty_amount: number;
  bonus_amount?: number;
  is_active: boolean;
  created_at: string;
}

interface RawProfileBalance {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
  weekly_allowance: number;
  current_balance: number;
}

interface RawSwap {
  id: string;
  assigned_chore_id: string;
  cycle_key: string;
  requester_id: string;
  target_id: string | null;
  accepted_by: string | null;
  bounty_amount: number;
  note: string;
  status: 'open' | 'accepted' | 'completed' | 'cancelled';
  created_at: string;
}

function getDueCyclesInWindow(
  assignment: RawAssignment,
  startVnDateStr: string,
  endVnDateStr: string,
): Array<{ cycleKey: string; deadlineUtcMs: number }> {
  const createdMs = Date.parse(assignment.created_at);
  const dueTime = assignment.due_time || '23:59';
  const results: Array<{ cycleKey: string; deadlineUtcMs: number }> = [];

  if (assignment.schedule_type === 'once') {
    if (!assignment.due_date) return results;
    const deadlineUtcMs = vnDateTimeToUtcMs(assignment.due_date, dueTime);
    if (assignment.due_date <= endVnDateStr && deadlineUtcMs >= createdMs) {
      results.push({ cycleKey: assignment.due_date, deadlineUtcMs });
    }
    return results;
  }

  let cursor = startVnDateStr;
  for (let i = 0; i <= 15; i++) {
    if (cursor > endVnDateStr) break;
    const dow = getDayOfWeekFromVnDateStr(cursor);
    const matches =
      assignment.schedule_type === 'daily' ||
      (assignment.schedule_type === 'weekly_days' &&
        Array.isArray(assignment.days_of_week) &&
        assignment.days_of_week.includes(dow));

    if (matches) {
      const deadlineUtcMs = vnDateTimeToUtcMs(cursor, dueTime);
      if (deadlineUtcMs >= createdMs) {
        results.push({ cycleKey: cursor, deadlineUtcMs });
      }
    }
    cursor = addDaysToVnDateStr(cursor, 1);
  }
  return results;
}

export async function addToSharedPartyFund(deltaVnd: number): Promise<void> {
  if (!Number.isFinite(deltaVnd) || deltaVnd === 0) return;
  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'shared_party_fund')
    .maybeSingle();

  const curBal = Number(row?.value?.balance ?? 0);
  const showBanner = Boolean(row?.value?.show_banner ?? true);
  await supabase.from('app_settings').upsert(
    {
      key: 'shared_party_fund',
      value: { balance: Math.max(0, curBal + Math.round(deltaVnd)), show_banner: showBanner },
    },
    { onConflict: 'key' },
  );
}

/**
 * Idempotently settles:
 * 1) Weekly allowance top-up/reset on configured reset_day/reset_hour + settlement_epoch.
 * 2) Automated missed-task balance deductions (respecting accepted shift swaps) + pooling into shared_party_fund.
 * 3) Smart deadline notifications (30m & 5m before due_time).
 */
export async function runWeeklySettlementAndDeductions(serverNowMs: number): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['weekly_fund_config', 'settlement_epoch']);

  let config: WeeklyFundConfig = { ...DEFAULT_WEEKLY_FUND_CONFIG };
  let epochNonce = 0;

  for (const row of settingsRows || []) {
    if (row.key === 'weekly_fund_config' && row.value) {
      config = {
        enabled: Boolean(row.value.enabled ?? DEFAULT_WEEKLY_FUND_CONFIG.enabled),
        reset_day: Number(row.value.reset_day ?? DEFAULT_WEEKLY_FUND_CONFIG.reset_day),
        reset_hour: Number(row.value.reset_hour ?? DEFAULT_WEEKLY_FUND_CONFIG.reset_hour),
      };
    } else if (row.key === 'settlement_epoch' && typeof row.value?.nonce === 'number') {
      epochNonce = row.value.nonce;
    }
  }

  const basePeriodKey = getCurrentWeeklyPeriodKey(serverNowMs, config.reset_day, config.reset_hour);
  const periodKey = epochNonce > 0 ? `${basePeriodKey}#${epochNonce}` : basePeriodKey;

  if (!config.enabled) return periodKey;

  const serverNowIso = new Date(serverNowMs).toISOString();
  const todayParts = getVnDateParts(serverNowMs);
  const lookbackStartDate = addDaysToVnDateStr(todayParts.dateStr, -14);
  const lookbackStartIso = new Date(serverNowMs - 15 * 86_400_000).toISOString();

  const [profilesRes, resetsRes, assignmentsRes, choresRes, logsRes, penaltiesRes, swapsRes] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, display_name, role, is_active, weekly_allowance, current_balance')
        .eq('is_active', true),
      supabase
        .from('fund_transactions')
        .select('profile_id')
        .eq('tx_type', 'weekly_reset')
        .eq('cycle_key', periodKey),
      supabase.from('assigned_chores').select('*').eq('is_active', true),
      supabase.from('chores').select('id, title'),
      supabase
        .from('chore_logs')
        .select('id, chore_id, profile_id, assigned_chore_id, cycle_key, server_timestamp')
        .gte('created_at', lookbackStartIso),
      supabase
        .from('fund_transactions')
        .select('assigned_chore_id, cycle_key')
        .eq('tx_type', 'penalty')
        .gte('created_at', lookbackStartIso),
      supabase
        .from('shift_swaps')
        .select('*')
        .in('status', ['accepted', 'completed'])
        .gte('created_at', lookbackStartIso),
    ]);

  let mutated = false;
  let totalPooledPartyDelta = 0;

  const profiles = (profilesRes.data || []) as RawProfileBalance[];
  const balanceMap = new Map<string, number>();
  const activeProfileIds = new Set<string>();
  for (const p of profiles) {
    balanceMap.set(p.id, Number(p.current_balance || 0));
    activeProfileIds.add(p.id);
  }

  // 1. Weekly Allowance Reset
  const resetDoneSet = new Set((resetsRes.data || []).map((r) => r.profile_id));
  const resetDateLabel = `${basePeriodKey.slice(10, 12)}/${basePeriodKey.slice(7, 9)}`;

  for (const p of profiles) {
    const allowance = Number(p.weekly_allowance || 0);
    if (allowance <= 0 || resetDoneSet.has(p.id)) continue;

    const { error: insErr } = await supabase.from('fund_transactions').insert({
      profile_id: p.id,
      tx_type: 'weekly_reset',
      category: 'weekly_reset',
      amount: allowance,
      balance_after: allowance,
      cycle_key: periodKey,
      description: `Cấp quỹ tuần mới (${resetDateLabel})`,
      server_timestamp: serverNowIso,
    });

    if (!insErr) {
      await supabase
        .from('profiles')
        .update({ current_balance: allowance, updated_at: serverNowIso })
        .eq('id', p.id);
      balanceMap.set(p.id, allowance);
      mutated = true;
    }
  }

  // 2. Missed-Task Automated Deductions + Smart Deadline Warnings
  const choreTitleMap = new Map<string, string>();
  for (const c of choresRes.data || []) {
    choreTitleMap.set(c.id, c.title);
  }

  const penalizedSet = new Set<string>();
  for (const pen of penaltiesRes.data || []) {
    if (pen.assigned_chore_id && pen.cycle_key) {
      penalizedSet.add(`${pen.assigned_chore_id}::${pen.cycle_key}`);
    }
  }

  const acceptedSwapMap = new Map<string, RawSwap>();
  for (const sw of (swapsRes.data || []) as RawSwap[]) {
    if (sw.accepted_by) {
      acceptedSwapMap.set(`${sw.assigned_chore_id}::${sw.cycle_key}`, sw);
    }
  }

  const recentLogs = logsRes.data || [];
  const assignments = (assignmentsRes.data || []) as RawAssignment[];

  for (const a of assignments) {
    const createdVnDate = getVnDateParts(Date.parse(a.created_at)).dateStr;
    const startDate = createdVnDate > lookbackStartDate ? createdVnDate : lookbackStartDate;
    const cycles = getDueCyclesInWindow(a, startDate, todayParts.dateStr);
    const choreTitle = choreTitleMap.get(a.chore_id) || 'Việc nhà';

    for (const c of cycles) {
      const swap = acceptedSwapMap.get(`${a.id}::${c.cycleKey}`);
      const effectiveAssigneeId = swap?.accepted_by || a.assignee_id;
      if (!activeProfileIds.has(effectiveAssigneeId)) continue;

      const hasValidLog = recentLogs.some((log) => {
        if (log.assigned_chore_id === a.id && log.cycle_key === c.cycleKey) return true;
        if (log.chore_id === a.chore_id && log.profile_id === effectiveAssigneeId) {
          const logMs = Date.parse(log.server_timestamp);
          const logVnDate = getVnDateParts(logMs).dateStr;
          return logVnDate === c.cycleKey && logMs <= c.deadlineUtcMs;
        }
        return false;
      });

      if (hasValidLog) continue;

      // Smart deadline reminders (30m and 5m before deadline)
      const remainMs = c.deadlineUtcMs - serverNowMs;
      if (remainMs > 0 && remainMs <= 30 * 60_000) {
        const penaltyNote =
          a.penalty_amount > 0 ? ` (Tránh trừ ${a.penalty_amount.toLocaleString('vi-VN')}đ)` : '';
        if (remainMs <= 5 * 60_000) {
          await supabase.from('notifications').insert({
            profile_id: effectiveAssigneeId,
            kind: 'deadline_5m',
            title: `Sắp hết hạn: ${choreTitle}`,
            body: `Còn dưới 5 phút để hoàn thành ${choreTitle}${penaltyNote}.`,
            ref_key: `deadline_5m::${a.id}::${c.cycleKey}`,
          });
        } else {
          await supabase.from('notifications').insert({
            profile_id: effectiveAssigneeId,
            kind: 'deadline_30m',
            title: `Nhắc việc: ${choreTitle}`,
            body: `Còn dưới 30 phút để hoàn thành ${choreTitle}${penaltyNote}.`,
            ref_key: `deadline_30m::${a.id}::${c.cycleKey}`,
          });
        }
      }

      // Past-due deduction
      if (c.deadlineUtcMs >= serverNowMs) continue;
      const penalty = Number(a.penalty_amount || 0);
      if (penalty <= 0) continue;

      const penKey = `${a.id}::${c.cycleKey}`;
      if (penalizedSet.has(penKey)) continue;

      const prevBal = balanceMap.get(effectiveAssigneeId) ?? 0;
      const nextBal = prevBal - penalty;
      const [, mm, dd] = c.cycleKey.split('-');

      const { error: txErr } = await supabase.from('fund_transactions').insert({
        profile_id: effectiveAssigneeId,
        assigned_chore_id: a.id,
        chore_id: a.chore_id,
        tx_type: 'penalty',
        category: 'penalty',
        amount: -penalty,
        balance_after: nextBal,
        cycle_key: c.cycleKey,
        description: `Thiếu sót: ${choreTitle} (${dd}/${mm})`,
        server_timestamp: new Date(c.deadlineUtcMs).toISOString(),
      });

      if (!txErr) {
        await supabase
          .from('profiles')
          .update({ current_balance: nextBal, updated_at: serverNowIso })
          .eq('id', effectiveAssigneeId);
        await supabase.from('notifications').insert({
          profile_id: effectiveAssigneeId,
          kind: 'balance_update',
          title: `Trừ quỹ -${penalty.toLocaleString('vi-VN')}đ`,
          body: `Quá hạn việc ${choreTitle} (${dd}/${mm}). Số dư mới: ${nextBal.toLocaleString('vi-VN')}đ.`,
          ref_key: `pen_notif::${a.id}::${c.cycleKey}`,
        });
        balanceMap.set(effectiveAssigneeId, nextBal);
        penalizedSet.add(penKey);
        totalPooledPartyDelta += penalty;
        mutated = true;
      }
    }
  }

  if (totalPooledPartyDelta > 0) {
    await addToSharedPartyFund(totalPooledPartyDelta);
  }

  if (mutated) {
    await bumpSyncSignal('all');
  }

  return periodKey;
}

export function buildAssignedChoreItems(params: {
  assignments: RawAssignment[];
  logs: ChoreLogItem[];
  swaps: ShiftSwapItem[];
  choreMap: Map<string, { title: string; icon: string; points: number }>;
  profileNameMap: Map<string, string>;
  serverNowMs: number;
}): AssignedChoreItem[] {
  const { assignments, logs, swaps, choreMap, profileNameMap, serverNowMs } = params;
  const todayParts = getVnDateParts(serverNowMs);
  const todayDateStr = todayParts.dateStr;

  return assignments.map((a) => {
    const choreInfo = choreMap.get(a.chore_id) || {
      title: 'Việc nhà',
      icon: 'sparkles',
      points: 0,
    };
    const days = Array.isArray(a.days_of_week) ? a.days_of_week : [];

    let currentCycleKey: string | null = null;
    let deadlineIso: string | null = null;
    let cycleStatus: AssignmentCycleStatus = 'upcoming';

    if (a.schedule_type === 'daily') {
      currentCycleKey = todayDateStr;
    } else if (a.schedule_type === 'weekly_days') {
      if (days.includes(todayParts.dayOfWeek)) {
        currentCycleKey = todayDateStr;
      }
    } else if (a.schedule_type === 'once' && a.due_date) {
      if (a.due_date <= todayDateStr) {
        currentCycleKey = a.due_date;
      }
    }

    const activeSwap = currentCycleKey
      ? swaps.find(
          (s) =>
            s.assigned_chore_id === a.id &&
            s.cycle_key === currentCycleKey &&
            (s.status === 'open' || s.status === 'accepted'),
        ) || null
      : null;

    const effectiveAssigneeId =
      activeSwap?.status === 'accepted' && activeSwap.accepted_by
        ? activeSwap.accepted_by
        : a.assignee_id;
    const effectiveAssigneeName =
      profileNameMap.get(effectiveAssigneeId) || profileNameMap.get(a.assignee_id) || 'Thành viên';

    let matchedLog: ChoreLogItem | null = null;
    if (currentCycleKey) {
      const deadlineMs = vnDateTimeToUtcMs(currentCycleKey, a.due_time || '23:59');
      deadlineIso = new Date(deadlineMs).toISOString();

      matchedLog =
        logs.find((l) => {
          if (l.assigned_chore_id === a.id && l.cycle_key === currentCycleKey) return true;
          if (l.chore_id === a.chore_id && l.profile_id === effectiveAssigneeId) {
            const logVnDate = getVnDateParts(Date.parse(l.server_timestamp)).dateStr;
            return logVnDate === currentCycleKey;
          }
          return false;
        }) || null;

      if (matchedLog) {
        cycleStatus = 'completed';
      } else if (deadlineMs < serverNowMs) {
        cycleStatus = 'missed';
      } else {
        cycleStatus = 'pending';
      }
    } else if (a.schedule_type === 'once' && a.due_date) {
      const deadlineMs = vnDateTimeToUtcMs(a.due_date, a.due_time || '23:59');
      deadlineIso = new Date(deadlineMs).toISOString();
      matchedLog =
        logs.find((l) => l.assigned_chore_id === a.id && l.cycle_key === a.due_date) || null;
      cycleStatus = matchedLog ? 'completed' : 'upcoming';
    }

    return {
      id: a.id,
      chore_id: a.chore_id,
      assignee_id: a.assignee_id,
      effective_assignee_id: effectiveAssigneeId,
      effective_assignee_name: effectiveAssigneeName,
      assigned_by: a.assigned_by,
      schedule_type: a.schedule_type,
      days_of_week: days,
      due_date: a.due_date,
      due_time: a.due_time || '23:59',
      penalty_amount: Number(a.penalty_amount || 0),
      bonus_amount: Number(a.bonus_amount || 0),
      is_active: Boolean(a.is_active),
      created_at: a.created_at,
      chore_title: choreInfo.title,
      chore_icon: choreInfo.icon,
      chore_points: choreInfo.points,
      assignee_name: profileNameMap.get(a.assignee_id) || 'Thành viên',
      assigned_by_name: (a.assigned_by && profileNameMap.get(a.assigned_by)) || 'Quản lý',
      current_cycle_key: currentCycleKey,
      cycle_status: cycleStatus,
      deadline_iso: deadlineIso,
      completed_at_iso: matchedLog ? matchedLog.server_timestamp : null,
      completed_proof_url: matchedLog ? matchedLog.proof_url : null,
      active_swap: activeSwap,
    };
  });
}

export function buildWeeklySettlementRows(params: {
  members: ProfilePublic[];
  fundTransactions: FundTransactionItem[];
  currentPeriodKey: string;
}): WeeklySettlementRow[] {
  const { members, fundTransactions, currentPeriodKey } = params;

  // Find timestamp of latest weekly_reset for currentPeriodKey to scope transactions to this cycle
  const resetTxs = fundTransactions.filter(
    (t) => t.tx_type === 'weekly_reset' && t.cycle_key === currentPeriodKey,
  );
  const earliestResetMs =
    resetTxs.length > 0
      ? Math.min(...resetTxs.map((t) => Date.parse(t.server_timestamp)))
      : Date.now() - 7 * 86_400_000;

  return members
    .filter((m) => m.role === 'member' || m.weekly_allowance > 0 || m.current_balance !== 0)
    .map((m) => {
      const myTxs = fundTransactions.filter(
        (t) => t.profile_id === m.id && Date.parse(t.server_timestamp) >= earliestResetMs - 5000,
      );

      let totalPenalties = 0;
      let totalBountyPaid = 0;
      let totalBountyEarned = 0;
      let totalBonuses = 0;
      let totalRefunds = 0;

      for (const tx of myTxs) {
        if (tx.tx_type === 'penalty' || tx.category === 'penalty') {
          totalPenalties += Math.abs(tx.amount);
        } else if (tx.category === 'bounty_paid') {
          totalBountyPaid += Math.abs(tx.amount);
        } else if (tx.category === 'bounty_earned') {
          totalBountyEarned += Math.max(0, tx.amount);
        } else if (
          tx.tx_type === 'BONUS_REWARD' ||
          tx.tx_type === 'bonus_reward' ||
          tx.category === 'bonus_reward'
        ) {
          totalBonuses += Math.max(0, tx.amount);
        } else if (tx.tx_type === 'refund' || tx.category === 'refund') {
          totalRefunds += Math.max(0, tx.amount);
        }
      }

      return {
        profile_id: m.id,
        display_name: m.display_name,
        avatar_url: m.avatar_url || null,
        weekly_allowance: m.weekly_allowance,
        total_penalties: totalPenalties,
        total_bounty_paid: totalBountyPaid,
        total_bounty_earned: totalBountyEarned,
        total_bonuses: totalBonuses,
        total_refunds: totalRefunds,
        current_balance: m.current_balance,
      };
    });
}

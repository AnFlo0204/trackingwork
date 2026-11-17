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
  type WeeklyFundConfig,
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

/**
 * Idempotently settles:
 * 1) Weekly allowance top-up/reset on configured reset_day/reset_hour (UTC+7).
 * 2) Automated missed-task balance deductions for past-due assigned chores.
 * Protected against race conditions by unique partial indexes on `fund_transactions`.
 */
export async function runWeeklySettlementAndDeductions(serverNowMs: number): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: cfgRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'weekly_fund_config')
    .maybeSingle();

  const config: WeeklyFundConfig = {
    enabled: Boolean(cfgRow?.value?.enabled ?? DEFAULT_WEEKLY_FUND_CONFIG.enabled),
    reset_day: Number(cfgRow?.value?.reset_day ?? DEFAULT_WEEKLY_FUND_CONFIG.reset_day),
    reset_hour: Number(cfgRow?.value?.reset_hour ?? DEFAULT_WEEKLY_FUND_CONFIG.reset_hour),
  };

  if (!config.enabled) return;

  const serverNowIso = new Date(serverNowMs).toISOString();
  const todayParts = getVnDateParts(serverNowMs);
  const periodKey = getCurrentWeeklyPeriodKey(serverNowMs, config.reset_day, config.reset_hour);
  const lookbackStartDate = addDaysToVnDateStr(todayParts.dateStr, -14);
  const lookbackStartIso = new Date(serverNowMs - 15 * 86_400_000).toISOString();

  const [profilesRes, resetsRes, assignmentsRes, choresRes, logsRes, penaltiesRes] =
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
    ]);

  let mutated = false;
  const profiles = (profilesRes.data || []) as RawProfileBalance[];
  const balanceMap = new Map<string, number>();
  const activeProfileIds = new Set<string>();
  for (const p of profiles) {
    balanceMap.set(p.id, Number(p.current_balance || 0));
    activeProfileIds.add(p.id);
  }

  // 1. Weekly Allowance Reset
  const resetDoneSet = new Set((resetsRes.data || []).map((r) => r.profile_id));
  const resetDateLabel = `${periodKey.slice(10, 12)}/${periodKey.slice(7, 9)}`;

  for (const p of profiles) {
    const allowance = Number(p.weekly_allowance || 0);
    if (allowance <= 0 || resetDoneSet.has(p.id)) continue;

    const { error: insErr } = await supabase.from('fund_transactions').insert({
      profile_id: p.id,
      tx_type: 'weekly_reset',
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

  // 2. Missed-Task Automated Deductions
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

  const recentLogs = logsRes.data || [];
  const assignments = (assignmentsRes.data || []) as RawAssignment[];

  for (const a of assignments) {
    if (!activeProfileIds.has(a.assignee_id)) continue;
    const penalty = Number(a.penalty_amount || 0);
    if (penalty <= 0) continue;

    const createdVnDate = getVnDateParts(Date.parse(a.created_at)).dateStr;
    const startDate = createdVnDate > lookbackStartDate ? createdVnDate : lookbackStartDate;
    const cycles = getDueCyclesInWindow(a, startDate, todayParts.dateStr);

    for (const c of cycles) {
      // Only deduct when deadline has genuinely passed
      if (c.deadlineUtcMs >= serverNowMs) continue;

      const penKey = `${a.id}::${c.cycleKey}`;
      if (penalizedSet.has(penKey)) continue;

      // Check if verified log exists for this assignment cycle or by assignee on that VN date before deadline
      const hasValidLog = recentLogs.some((log) => {
        if (log.assigned_chore_id === a.id && log.cycle_key === c.cycleKey) return true;
        if (log.chore_id === a.chore_id && log.profile_id === a.assignee_id) {
          const logMs = Date.parse(log.server_timestamp);
          const logVnDate = getVnDateParts(logMs).dateStr;
          return logVnDate === c.cycleKey && logMs <= c.deadlineUtcMs;
        }
        return false;
      });

      if (hasValidLog) continue;

      const prevBal = balanceMap.get(a.assignee_id) ?? 0;
      const nextBal = prevBal - penalty;
      const choreTitle = choreTitleMap.get(a.chore_id) || 'Việc nhà';
      const [, mm, dd] = c.cycleKey.split('-');

      const { error: txErr } = await supabase.from('fund_transactions').insert({
        profile_id: a.assignee_id,
        assigned_chore_id: a.id,
        chore_id: a.chore_id,
        tx_type: 'penalty',
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
          .eq('id', a.assignee_id);
        balanceMap.set(a.assignee_id, nextBal);
        penalizedSet.add(penKey);
        mutated = true;
      }
    }
  }

  if (mutated) {
    await bumpSyncSignal('all');
  }
}

export function buildAssignedChoreItems(params: {
  assignments: RawAssignment[];
  logs: ChoreLogItem[];
  choreMap: Map<string, { title: string; icon: string; points: number }>;
  profileNameMap: Map<string, string>;
  serverNowMs: number;
}): AssignedChoreItem[] {
  const { assignments, logs, choreMap, profileNameMap, serverNowMs } = params;
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

    let matchedLog: ChoreLogItem | null = null;
    if (currentCycleKey) {
      const deadlineMs = vnDateTimeToUtcMs(currentCycleKey, a.due_time || '23:59');
      deadlineIso = new Date(deadlineMs).toISOString();

      matchedLog =
        logs.find((l) => {
          if (l.assigned_chore_id === a.id && l.cycle_key === currentCycleKey) return true;
          if (l.chore_id === a.chore_id && l.profile_id === a.assignee_id) {
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
      assigned_by: a.assigned_by,
      schedule_type: a.schedule_type,
      days_of_week: days,
      due_date: a.due_date,
      due_time: a.due_time || '23:59',
      penalty_amount: Number(a.penalty_amount || 0),
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
    };
  });
}

import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import {
  buildAssignedChoreItems,
  buildWeeklySettlementRows,
  runWeeklySettlementAndDeductions,
} from '@/lib/allowanceEngine';
import { runRetentionCleanup } from '@/lib/cleanup';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchAuthoritativeServerTime, getVnDateParts } from '@/lib/time';
import {
  DEFAULT_FEATURE_FLAGS,
  DEFAULT_WEEKLY_FUND_CONFIG,
  type ChoreLogItem,
  type FeatureFlags,
  type FundTransactionItem,
  type PenaltyItem,
  type ProfilePublic,
  type SharedPartyFund,
  type ShiftSwapItem,
  type WeeklyFundConfig,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getAuthenticatedProfile();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const serverTime = await fetchAuthoritativeServerTime();
    const serverNowMs = Date.parse(serverTime.isoUtc) || Date.now();

    const [, currentPeriodKey] = await Promise.all([
      runRetentionCleanup(false),
      runWeeklySettlementAndDeductions(serverNowMs),
    ]);

    const supabase = getSupabaseAdmin();
    const [
      choresRes,
      sessionsRes,
      logsRes,
      reactionsRes,
      profilesRes,
      settingsRes,
      penaltiesRes,
      assignmentsRes,
      swapsRes,
      notificationsRes,
      fundTxRes,
    ] = await Promise.all([
      supabase
        .from('chores')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('chore_sessions')
        .select('*')
        .eq('profile_id', me.id)
        .eq('status', 'in_progress')
        .order('created_at', { ascending: false }),
      supabase.from('chore_logs').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('chore_log_reactions').select('*').limit(1000),
      supabase
        .from('profiles')
        .select(
          'id, username, display_name, role, is_active, can_assign_tasks, weekly_allowance, current_balance, created_at',
        )
        .order('created_at', { ascending: true }),
      supabase.from('app_settings').select('key, value'),
      supabase.from('penalties').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('assigned_chores').select('*').order('created_at', { ascending: false }),
      supabase
        .from('shift_swaps')
        .select('*')
        .in('status', ['open', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('notifications')
        .select('*')
        .eq('profile_id', me.id)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('fund_transactions').select('*').order('created_at', { ascending: false }).limit(300),
    ]);

    let featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
    let weeklyFundConfig: WeeklyFundConfig = { ...DEFAULT_WEEKLY_FUND_CONFIG };
    let sharedPartyFund: SharedPartyFund = { balance: 0, show_banner: true };
    let retentionDays = 90;
    let lastCleanupAt: string | null = null;

    for (const row of settingsRes.data || []) {
      if (row.key === 'feature_flags' && row.value) {
        featureFlags = {
          recurring_tasks: Boolean(row.value.recurring_tasks ?? true),
          gamification: Boolean(row.value.gamification ?? true),
          analytics: Boolean(row.value.analytics ?? true),
          penalty_fund: Boolean(row.value.penalty_fund ?? false),
        };
      } else if (row.key === 'weekly_fund_config' && row.value) {
        weeklyFundConfig = {
          enabled: Boolean(row.value.enabled ?? true),
          reset_day: Number(row.value.reset_day ?? 1),
          reset_hour: Number(row.value.reset_hour ?? 0),
        };
      } else if (row.key === 'shared_party_fund' && row.value) {
        sharedPartyFund = {
          balance: Number(row.value.balance ?? 0),
          show_banner: Boolean(row.value.show_banner ?? true),
        };
      } else if (row.key === 'retention_days' && typeof row.value?.days === 'number') {
        retentionDays = row.value.days;
      } else if (row.key === 'last_cleanup_at' && row.value?.timestamp) {
        lastCleanupAt = String(row.value.timestamp);
      }
    }

    const profileMap = new Map<string, ProfilePublic>();
    const profileNameMap = new Map<string, string>();
    const members: ProfilePublic[] = (profilesRes.data || []).map((p) => {
      const role = p.role === 'admin' ? 'admin' : 'member';
      const item: ProfilePublic = {
        id: p.id,
        username: p.username,
        display_name: p.display_name || p.username,
        role,
        is_active: Boolean(p.is_active),
        can_assign_tasks: role === 'admin' ? true : Boolean(p.can_assign_tasks),
        weekly_allowance: Number(p.weekly_allowance || 0),
        current_balance: Number(p.current_balance || 0),
        created_at: p.created_at,
      };
      profileMap.set(item.id, item);
      profileNameMap.set(item.id, item.display_name);
      return item;
    });

    const freshMe = profileMap.get(me.id) || me;

    const choreMap = new Map<string, { title: string; icon: string; points: number }>();
    for (const c of choresRes.data || []) {
      choreMap.set(c.id, {
        title: c.title,
        icon: c.icon || 'sparkles',
        points: Number(c.points || 0),
      });
    }

    // Aggregate quality reactions per log
    const reactionStats = new Map<
      string,
      { ok: number; sloppy: number; mine: 'ok' | 'sloppy' | null }
    >();
    for (const r of reactionsRes.data || []) {
      const prev = reactionStats.get(r.log_id) || { ok: 0, sloppy: 0, mine: null };
      if (r.reaction === 'ok') prev.ok += 1;
      if (r.reaction === 'sloppy') prev.sloppy += 1;
      if (r.profile_id === me.id) prev.mine = r.reaction === 'sloppy' ? 'sloppy' : 'ok';
      reactionStats.set(r.log_id, prev);
    }

    const logs: ChoreLogItem[] = (logsRes.data || []).map((l) => {
      const member = profileMap.get(l.profile_id);
      const chore = choreMap.get(l.chore_id);
      const rStats = reactionStats.get(l.id) || { ok: 0, sloppy: 0, mine: null };
      return {
        id: l.id,
        chore_id: l.chore_id,
        profile_id: l.profile_id,
        assigned_chore_id: l.assigned_chore_id || null,
        cycle_key: l.cycle_key || null,
        proof_url: l.proof_url,
        storage_path: l.storage_path || '',
        before_proof_url: l.before_proof_url || null,
        before_storage_path: l.before_storage_path || null,
        started_at: l.started_at || null,
        points_awarded: Number(l.points_awarded || 0),
        chore_title_snapshot: l.chore_title_snapshot || chore?.title || 'Việc nhà',
        quality_status: l.quality_status || 'none',
        ok_count: rStats.ok,
        sloppy_count: rStats.sloppy,
        my_reaction: rStats.mine,
        server_timestamp: l.server_timestamp,
        created_at: l.created_at,
        member_name: member?.display_name || member?.username || 'Thành viên',
        member_username: member?.username || '',
        chore_title: chore?.title || l.chore_title_snapshot || 'Việc nhà',
        chore_icon: chore?.icon || 'sparkles',
      };
    });

    const rawAssignments = assignmentsRes.data || [];
    const assignById = new Map(rawAssignments.map((a) => [a.id, a]));

    const shiftSwaps: ShiftSwapItem[] = (swapsRes.data || []).map((sw) => {
      const assign = assignById.get(sw.assigned_chore_id);
      const chore = assign ? choreMap.get(assign.chore_id) : null;
      return {
        id: sw.id,
        assigned_chore_id: sw.assigned_chore_id,
        cycle_key: sw.cycle_key,
        requester_id: sw.requester_id,
        requester_name: profileNameMap.get(sw.requester_id) || 'Thành viên',
        target_id: sw.target_id || null,
        target_name: sw.target_id ? profileNameMap.get(sw.target_id) || null : null,
        accepted_by: sw.accepted_by || null,
        accepted_by_name: sw.accepted_by ? profileNameMap.get(sw.accepted_by) || null : null,
        bounty_amount: Number(sw.bounty_amount || 0),
        note: sw.note || '',
        status: sw.status,
        chore_id: assign?.chore_id || '',
        chore_title: chore?.title || 'Việc nhà',
        chore_icon: chore?.icon || 'sparkles',
        due_time: assign?.due_time || '23:59',
        penalty_amount: Number(assign?.penalty_amount || 0),
        created_at: sw.created_at,
      };
    });

    const assignedChores = buildAssignedChoreItems({
      assignments: rawAssignments,
      logs,
      swaps: shiftSwaps,
      choreMap,
      profileNameMap,
      serverNowMs,
    });

    const fundTransactions: FundTransactionItem[] = (fundTxRes.data || []).map((tx) => ({
      id: tx.id,
      profile_id: tx.profile_id,
      assigned_chore_id: tx.assigned_chore_id || null,
      chore_id: tx.chore_id || null,
      tx_type: tx.tx_type,
      category: tx.category || tx.tx_type,
      amount: Number(tx.amount || 0),
      balance_after: Number(tx.balance_after || 0),
      cycle_key: tx.cycle_key || null,
      description: tx.description,
      created_by: tx.created_by || null,
      server_timestamp: tx.server_timestamp,
      member_name: profileNameMap.get(tx.profile_id) || 'Thành viên',
    }));

    const weeklySettlement = buildWeeklySettlementRows({
      members,
      fundTransactions,
      currentPeriodKey,
    });

    const penalties: PenaltyItem[] = (penaltiesRes.data || []).map((p) => {
      const member = profileMap.get(p.profile_id);
      const chore = p.chore_id ? choreMap.get(p.chore_id) : null;
      return {
        id: p.id,
        profile_id: p.profile_id,
        chore_id: p.chore_id,
        amount: Number(p.amount || 0),
        reason: p.reason,
        status: p.status === 'paid' ? 'paid' : 'unpaid',
        created_at: p.created_at,
        paid_at: p.paid_at,
        member_name: member?.display_name || member?.username || 'Thành viên',
        chore_title: chore?.title || null,
      };
    });

    return NextResponse.json({
      me: freshMe,
      chores: choresRes.data || [],
      activeSessions: sessionsRes.data || [],
      logs,
      members,
      assignedChores,
      shiftSwaps,
      notifications: notificationsRes.data || [],
      fundTransactions,
      weeklySettlement,
      sharedPartyFund,
      weeklyFundConfig,
      penalties,
      featureFlags,
      retentionDays,
      lastCleanupAt,
      serverNowIso: serverTime.isoUtc,
      serverVnFormatted: serverTime.vnFormatted,
      currentVnDate: getVnDateParts(serverNowMs).dateStr,
      currentPeriodKey,
    });
  } catch (err) {
    console.error('Bootstrap error:', err);
    return NextResponse.json({ error: 'Không thể tải dữ liệu.' }, { status: 500 });
  }
}

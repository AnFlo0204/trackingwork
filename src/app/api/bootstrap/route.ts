import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';
import { buildAssignedChoreItems, runWeeklySettlementAndDeductions } from '@/lib/allowanceEngine';
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

    // Run throttled 90-day cleanup + idempotent weekly reset & missed-task settlement
    await Promise.all([
      runRetentionCleanup(false),
      runWeeklySettlementAndDeductions(serverNowMs),
    ]);

    const supabase = getSupabaseAdmin();
    const [
      choresRes,
      logsRes,
      profilesRes,
      settingsRes,
      penaltiesRes,
      assignmentsRes,
      fundTxRes,
    ] = await Promise.all([
      supabase.from('chores').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('chore_logs').select('*').order('created_at', { ascending: false }).limit(300),
      supabase
        .from('profiles')
        .select(
          'id, username, display_name, role, is_active, can_assign_tasks, weekly_allowance, current_balance, created_at',
        )
        .order('created_at', { ascending: true }),
      supabase.from('app_settings').select('key, value'),
      supabase.from('penalties').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('assigned_chores').select('*').order('created_at', { ascending: false }),
      supabase.from('fund_transactions').select('*').order('created_at', { ascending: false }).limit(200),
    ]);

    let featureFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
    let weeklyFundConfig: WeeklyFundConfig = { ...DEFAULT_WEEKLY_FUND_CONFIG };
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

    // Fresh `me` after any weekly balance settlement
    const freshMe = profileMap.get(me.id) || me;

    const choreMap = new Map<string, { title: string; icon: string; points: number }>();
    for (const c of choresRes.data || []) {
      choreMap.set(c.id, {
        title: c.title,
        icon: c.icon || 'sparkles',
        points: Number(c.points || 0),
      });
    }

    const logs: ChoreLogItem[] = (logsRes.data || []).map((l) => {
      const member = profileMap.get(l.profile_id);
      const chore = choreMap.get(l.chore_id);
      return {
        id: l.id,
        chore_id: l.chore_id,
        profile_id: l.profile_id,
        assigned_chore_id: l.assigned_chore_id || null,
        cycle_key: l.cycle_key || null,
        proof_url: l.proof_url,
        storage_path: l.storage_path || '',
        points_awarded: Number(l.points_awarded || 0),
        chore_title_snapshot: l.chore_title_snapshot || chore?.title || 'Việc nhà',
        server_timestamp: l.server_timestamp,
        created_at: l.created_at,
        member_name: member?.display_name || member?.username || 'Thành viên',
        member_username: member?.username || '',
        chore_title: chore?.title || l.chore_title_snapshot || 'Việc nhà',
        chore_icon: chore?.icon || 'sparkles',
      };
    });

    const assignedChores = buildAssignedChoreItems({
      assignments: assignmentsRes.data || [],
      logs,
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
      amount: Number(tx.amount || 0),
      balance_after: Number(tx.balance_after || 0),
      cycle_key: tx.cycle_key || null,
      description: tx.description,
      created_by: tx.created_by || null,
      server_timestamp: tx.server_timestamp,
      member_name: profileNameMap.get(tx.profile_id) || 'Thành viên',
    }));

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
      logs,
      members,
      assignedChores,
      fundTransactions,
      weeklyFundConfig,
      penalties,
      featureFlags,
      retentionDays,
      lastCleanupAt,
      serverNowIso: serverTime.isoUtc,
      serverVnFormatted: serverTime.vnFormatted,
      currentVnDate: getVnDateParts(serverNowMs).dateStr,
    });
  } catch (err) {
    console.error('Bootstrap error:', err);
    return NextResponse.json({ error: 'Không thể tải dữ liệu.' }, { status: 500 });
  }
}

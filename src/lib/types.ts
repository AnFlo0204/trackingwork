export type UserRole = 'admin' | 'member';

export type ChoreFrequency = 'always' | 'daily' | 'weekly';

export type AssignmentScheduleType = 'daily' | 'weekly_days' | 'once';

export type AssignmentCycleStatus = 'pending' | 'completed' | 'missed' | 'upcoming';

export interface ProfilePublic {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  can_assign_tasks: boolean;
  weekly_allowance: number;
  current_balance: number;
  created_at: string;
}

export interface Chore {
  id: string;
  title: string;
  icon: string;
  points: number;
  cooldown_minutes: number;
  sort_order: number;
  frequency: ChoreFrequency;
  penalty_amount: number;
  bonus_amount: number;
  require_before_after: boolean;
  min_duration_minutes: number;
  is_active: boolean;
  created_at: string;
}

export interface ChoreSessionItem {
  id: string;
  chore_id: string;
  profile_id: string;
  assigned_chore_id: string | null;
  cycle_key: string | null;
  before_proof_url: string;
  before_storage_path: string;
  started_at: string;
  unlock_at: string;
  status: 'in_progress' | 'completed' | 'cancelled';
}

export interface ChoreLogItem {
  id: string;
  chore_id: string;
  profile_id: string;
  assigned_chore_id: string | null;
  cycle_key: string | null;
  proof_url: string;
  thumb_url: string | null;
  storage_path: string;
  before_proof_url: string | null;
  before_storage_path: string | null;
  started_at: string | null;
  points_awarded: number;
  chore_title_snapshot: string;
  quality_status: 'none' | 'ok' | 'flagged' | 'reopened';
  ok_count: number;
  sloppy_count: number;
  my_reaction: 'ok' | 'sloppy' | null;
  bonus_awarded: number;
  bonus_by: string | null;
  bonus_note: string | null;
  server_timestamp: string;
  created_at: string;
  member_name: string;
  member_username: string;
  chore_title: string;
  chore_icon: string;
}

export interface AuditLogItem {
  id: string;
  actor_name: string;
  action_type: string;
  target_summary: string;
  created_at: string;
}

export interface AssignedChoreItem {
  id: string;
  chore_id: string;
  assignee_id: string;
  effective_assignee_id: string;
  effective_assignee_name: string;
  assigned_by: string | null;
  schedule_type: AssignmentScheduleType;
  days_of_week: number[];
  due_date: string | null;
  due_time: string;
  penalty_amount: number;
  bonus_amount: number;
  is_active: boolean;
  created_at: string;
  chore_title: string;
  chore_icon: string;
  chore_points: number;
  assignee_name: string;
  assigned_by_name: string;
  current_cycle_key: string | null;
  cycle_status: AssignmentCycleStatus;
  deadline_iso: string | null;
  completed_at_iso: string | null;
  completed_proof_url: string | null;
  active_swap: ShiftSwapItem | null;
}

export interface ShiftSwapItem {
  id: string;
  assigned_chore_id: string;
  cycle_key: string;
  requester_id: string;
  requester_name: string;
  target_id: string | null;
  target_name: string | null;
  accepted_by: string | null;
  accepted_by_name: string | null;
  bounty_amount: number;
  note: string;
  status: 'open' | 'accepted' | 'completed' | 'cancelled';
  chore_id: string;
  chore_title: string;
  chore_icon: string;
  due_time: string;
  penalty_amount: number;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  profile_id: string;
  kind: 'deadline_30m' | 'deadline_5m' | 'swap_request' | 'swap_accepted' | 'balance_update' | 'quality_alert' | 'bonus_reward';
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface FundTransactionItem {
  id: string;
  profile_id: string;
  assigned_chore_id: string | null;
  chore_id: string | null;
  tx_type: 'weekly_reset' | 'penalty' | 'adjustment' | 'refund' | 'BONUS_REWARD' | 'bonus_reward';
  category: string;
  amount: number;
  balance_after: number;
  cycle_key: string | null;
  description: string;
  created_by: string | null;
  server_timestamp: string;
  member_name: string;
}

export interface WeeklySettlementRow {
  profile_id: string;
  display_name: string;
  weekly_allowance: number;
  total_penalties: number;
  total_bounty_paid: number;
  total_bounty_earned: number;
  total_bonuses: number;
  total_refunds: number;
  current_balance: number;
}

export interface BonusRewardConfig {
  enabled: boolean;
  max_delegated_bonus: number;
}

export interface SharedPartyFund {
  balance: number;
  show_banner: boolean;
}

export interface WeeklyFundConfig {
  enabled: boolean;
  reset_day: number;
  reset_hour: number;
}

export interface PenaltyItem {
  id: string;
  profile_id: string;
  chore_id: string | null;
  amount: number;
  reason: string;
  status: 'unpaid' | 'paid';
  created_at: string;
  paid_at: string | null;
  member_name: string;
  chore_title: string | null;
}

export interface FeatureFlags {
  recurring_tasks: boolean;
  gamification: boolean;
  analytics: boolean;
  penalty_fund: boolean;
}

export interface BootstrapPayload {
  me: ProfilePublic;
  chores: Chore[];
  activeSessions: ChoreSessionItem[];
  logs: ChoreLogItem[];
  logsNextCursor: string | null;
  auditLogs: AuditLogItem[];
  auditNextCursor: string | null;
  members: ProfilePublic[];
  assignedChores: AssignedChoreItem[];
  shiftSwaps: ShiftSwapItem[];
  notifications: NotificationItem[];
  fundTransactions: FundTransactionItem[];
  weeklySettlement: WeeklySettlementRow[];
  sharedPartyFund: SharedPartyFund;
  weeklyFundConfig: WeeklyFundConfig;
  bonusRewardConfig: BonusRewardConfig;
  penalties: PenaltyItem[];
  featureFlags: FeatureFlags;
  retentionDays: number;
  lastCleanupAt: string | null;
  serverNowIso: string;
  serverNowMs?: number;
  serverVnFormatted: string;
  currentVnDate: string;
  currentPeriodKey: string;
  signingKey?: string;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  recurring_tasks: true,
  gamification: true,
  analytics: true,
  penalty_fund: false,
};

export const DEFAULT_WEEKLY_FUND_CONFIG: WeeklyFundConfig = {
  enabled: true,
  reset_day: 1,
  reset_hour: 0,
};

export const DEFAULT_BONUS_REWARD_CONFIG: BonusRewardConfig = {
  enabled: true,
  max_delegated_bonus: 100000,
};

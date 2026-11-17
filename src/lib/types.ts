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
  is_active: boolean;
  created_at: string;
}

export interface ChoreLogItem {
  id: string;
  chore_id: string;
  profile_id: string;
  assigned_chore_id: string | null;
  cycle_key: string | null;
  proof_url: string;
  storage_path: string;
  points_awarded: number;
  chore_title_snapshot: string;
  server_timestamp: string;
  created_at: string;
  member_name: string;
  member_username: string;
  chore_title: string;
  chore_icon: string;
}

export interface AssignedChoreItem {
  id: string;
  chore_id: string;
  assignee_id: string;
  assigned_by: string | null;
  schedule_type: AssignmentScheduleType;
  days_of_week: number[];
  due_date: string | null;
  due_time: string;
  penalty_amount: number;
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
}

export interface FundTransactionItem {
  id: string;
  profile_id: string;
  assigned_chore_id: string | null;
  chore_id: string | null;
  tx_type: 'weekly_reset' | 'penalty' | 'adjustment' | 'refund';
  amount: number;
  balance_after: number;
  cycle_key: string | null;
  description: string;
  created_by: string | null;
  server_timestamp: string;
  member_name: string;
}

export interface WeeklyFundConfig {
  enabled: boolean;
  reset_day: number; // 0=Sun, 1=Mon..6=Sat
  reset_hour: number; // 0..23 UTC+7
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
  logs: ChoreLogItem[];
  members: ProfilePublic[];
  assignedChores: AssignedChoreItem[];
  fundTransactions: FundTransactionItem[];
  weeklyFundConfig: WeeklyFundConfig;
  penalties: PenaltyItem[];
  featureFlags: FeatureFlags;
  retentionDays: number;
  lastCleanupAt: string | null;
  serverNowIso: string;
  serverVnFormatted: string;
  currentVnDate: string;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  recurring_tasks: true,
  gamification: true,
  analytics: true,
  penalty_fund: false,
};

export const DEFAULT_WEEKLY_FUND_CONFIG: WeeklyFundConfig = {
  enabled: true,
  reset_day: 1, // Thứ 2
  reset_hour: 0, // 00:00 UTC+7
};

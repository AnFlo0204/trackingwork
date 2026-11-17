export type UserRole = 'admin' | 'member';

export type ChoreFrequency = 'always' | 'daily' | 'weekly';

export interface ProfilePublic {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
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
  penalties: PenaltyItem[];
  featureFlags: FeatureFlags;
  retentionDays: number;
  lastCleanupAt: string | null;
  serverNowIso: string;
  serverVnFormatted: string;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  recurring_tasks: true,
  gamification: true,
  analytics: true,
  penalty_fund: false,
};

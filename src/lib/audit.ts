import { getSupabaseAdmin } from './supabaseAdmin';

export type AuditActionType =
  | 'DELETE_PHOTO'
  | 'REJECT_PROOF'
  | 'REWORK_HALF_PENALTY'
  | 'DELETE_CHORE'
  | 'EDIT_CHORE'
  | 'UPDATE_CHORE_POINTS'
  | 'UPDATE_AVATAR'
  | 'ADJUST_FUND'
  | 'CHANGE_SETTINGS'
  | 'CHANGE_ROLE'
  | 'MANUAL_CLEANUP'
  | 'CLOSE_WEEK'
  | 'RESET_PARTY_FUND'
  | 'AWARD_BONUS'
  | 'DEVTOOLS_TAMPER_ATTEMPT'
  | 'HMAC_SPOOF_ATTEMPT'
  | 'BINARY_TAMPER_ATTEMPT'
  | 'AUTH_BRUTE_FORCE_LOCK';

export async function recordAuditLog(params: {
  actorName: string;
  actionType: AuditActionType;
  targetSummary: string;
  refId?: string | null;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('audit_logs').insert({
      actor_name: params.actorName,
      action_type: params.actionType,
      target_summary: params.targetSummary,
      ref_id: params.refId ?? null,
    });
  } catch (err) {
    console.error('recordAuditLog error:', err);
  }
}

-- Bonus Reward System for Admin & Delegated Managers
ALTER TABLE public.chores
  ADD COLUMN IF NOT EXISTS bonus_amount integer NOT NULL DEFAULT 0;

ALTER TABLE public.assigned_chores
  ADD COLUMN IF NOT EXISTS bonus_amount integer NOT NULL DEFAULT 0;

ALTER TABLE public.chore_logs
  ADD COLUMN IF NOT EXISTS bonus_awarded integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_by text,
  ADD COLUMN IF NOT EXISTS bonus_note text;

ALTER TABLE public.fund_transactions
  DROP CONSTRAINT IF EXISTS fund_transactions_tx_type_check;

ALTER TABLE public.fund_transactions
  ADD CONSTRAINT fund_transactions_tx_type_check
  CHECK (tx_type = ANY (ARRAY['weekly_reset'::text, 'penalty'::text, 'adjustment'::text, 'refund'::text, 'BONUS_REWARD'::text, 'bonus_reward'::text]));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind = ANY (ARRAY['deadline_30m'::text, 'deadline_5m'::text, 'swap_request'::text, 'swap_accepted'::text, 'balance_update'::text, 'quality_alert'::text, 'bonus_reward'::text]));

INSERT INTO public.app_settings (key, value)
VALUES ('bonus_reward_config', '{"enabled": true, "max_delegated_bonus": 100000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.award_member_bonus(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_amount integer,
  p_reason text,
  p_log_id uuid DEFAULT NULL,
  p_assigned_chore_id uuid DEFAULT NULL,
  p_chore_id uuid DEFAULT NULL,
  p_cycle_key text DEFAULT NULL,
  p_server_ts timestamptz DEFAULT now(),
  p_is_auto boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_recipient record;
  v_prev_bal integer;
  v_new_bal integer;
  v_recipient_name text;
  v_desc text;
  v_clean_reason text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Bonus amount must be positive';
  END IF;

  IF NOT p_is_auto AND p_actor_id IS NOT NULL AND p_recipient_id = p_actor_id THEN
    RAISE EXCEPTION 'Cannot award bonus to oneself';
  END IF;

  SELECT id, display_name, username, current_balance
  INTO v_recipient
  FROM public.profiles
  WHERE id = p_recipient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient profile not found';
  END IF;

  v_prev_bal := COALESCE(v_recipient.current_balance, 0);
  v_new_bal := v_prev_bal + p_amount;
  v_recipient_name := COALESCE(NULLIF(trim(v_recipient.display_name), ''), v_recipient.username);
  v_clean_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Làm tốt việc nhà');
  v_desc := 'Thưởng làm tốt: ' || v_clean_reason || ' (Bởi ' || p_actor_name || ')';

  UPDATE public.profiles
  SET current_balance = v_new_bal,
      updated_at = p_server_ts
  WHERE id = p_recipient_id;

  INSERT INTO public.fund_transactions (
    profile_id,
    assigned_chore_id,
    chore_id,
    tx_type,
    category,
    amount,
    balance_after,
    cycle_key,
    description,
    created_by,
    server_timestamp
  ) VALUES (
    p_recipient_id,
    p_assigned_chore_id,
    p_chore_id,
    'BONUS_REWARD',
    'bonus_reward',
    p_amount,
    v_new_bal,
    p_cycle_key,
    v_desc,
    p_actor_id,
    p_server_ts
  );

  IF p_log_id IS NOT NULL THEN
    UPDATE public.chore_logs
    SET bonus_awarded = COALESCE(bonus_awarded, 0) + p_amount,
        bonus_by = p_actor_name,
        bonus_note = v_clean_reason
    WHERE id = p_log_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_name,
    action_type,
    target_summary,
    ref_id
  ) VALUES (
    p_actor_name,
    'AWARD_BONUS',
    format(
      'Thưởng +%sđ cho %s (%s). Số dư ví: %sđ -> %sđ',
      p_amount,
      v_recipient_name,
      v_clean_reason,
      v_prev_bal,
      v_new_bal
    ),
    COALESCE(p_log_id, p_recipient_id)
  );

  INSERT INTO public.notifications (
    profile_id,
    kind,
    title,
    body
  ) VALUES (
    p_recipient_id,
    'bonus_reward',
    format('Nhận thưởng +%sđ', p_amount),
    v_desc
  );

  RETURN jsonb_build_object(
    'prev_balance', v_prev_bal,
    'new_balance', v_new_bal,
    'recipient_name', v_recipient_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_member_bonus(uuid, uuid, text, integer, text, uuid, uuid, uuid, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_member_bonus(uuid, uuid, text, integer, text, uuid, uuid, uuid, text, timestamptz, boolean) TO service_role;

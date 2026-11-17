-- Feature Update: Assigned Chores, Delegated Manager Permissions & Weekly Allowance/Penalty System

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_assign_tasks boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_allowance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance integer NOT NULL DEFAULT 0;

UPDATE public.profiles
SET can_assign_tasks = true
WHERE role = 'admin' AND can_assign_tasks = false;

CREATE TABLE IF NOT EXISTS public.assigned_chores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chore_id uuid NOT NULL REFERENCES public.chores(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('daily', 'weekly_days', 'once')),
  days_of_week integer[] NOT NULL DEFAULT '{}',
  due_date date,
  due_time text NOT NULL DEFAULT '23:59',
  penalty_amount integer NOT NULL DEFAULT 20000,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assigned_chores_assignee ON public.assigned_chores (assignee_id, is_active);
CREATE INDEX IF NOT EXISTS idx_assigned_chores_chore ON public.assigned_chores (chore_id);
CREATE INDEX IF NOT EXISTS idx_assigned_chores_assigned_by ON public.assigned_chores (assigned_by);

ALTER TABLE public.chore_logs
  ADD COLUMN IF NOT EXISTS assigned_chore_id uuid REFERENCES public.assigned_chores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_key text;

CREATE INDEX IF NOT EXISTS idx_chore_logs_assigned_cycle ON public.chore_logs (assigned_chore_id, cycle_key);

CREATE TABLE IF NOT EXISTS public.fund_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_chore_id uuid REFERENCES public.assigned_chores(id) ON DELETE SET NULL,
  chore_id uuid REFERENCES public.chores(id) ON DELETE SET NULL,
  tx_type text NOT NULL CHECK (tx_type IN ('weekly_reset', 'penalty', 'adjustment', 'refund')),
  amount integer NOT NULL,
  balance_after integer NOT NULL DEFAULT 0,
  cycle_key text,
  description text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fund_tx_profile_created ON public.fund_transactions (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_tx_assigned_chore ON public.fund_transactions (assigned_chore_id);
CREATE INDEX IF NOT EXISTS idx_fund_tx_chore ON public.fund_transactions (chore_id);
CREATE INDEX IF NOT EXISTS idx_fund_tx_created_by ON public.fund_transactions (created_by);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fund_tx_penalty_cycle
  ON public.fund_transactions (assigned_chore_id, cycle_key)
  WHERE tx_type = 'penalty' AND assigned_chore_id IS NOT NULL AND cycle_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fund_tx_weekly_reset
  ON public.fund_transactions (profile_id, cycle_key)
  WHERE tx_type = 'weekly_reset' AND cycle_key IS NOT NULL;

ALTER TABLE public.assigned_chores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_transactions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value) VALUES
  ('weekly_fund_config', '{"enabled": true, "reset_day": 1, "reset_hour": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;

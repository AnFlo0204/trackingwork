-- Major Upgrade: PWA, Before/After Anti-Cheat, Quality Moderation, Shift Swaps, Notifications & Shared Party Fund

ALTER TABLE public.chores
  ADD COLUMN IF NOT EXISTS require_before_after boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_duration_minutes integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.chore_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chore_id uuid NOT NULL REFERENCES public.chores(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_chore_id uuid REFERENCES public.assigned_chores(id) ON DELETE SET NULL,
  cycle_key text,
  before_proof_url text NOT NULL,
  before_storage_path text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  unlock_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chore_sessions_profile_status ON public.chore_sessions (profile_id, status);
CREATE INDEX IF NOT EXISTS idx_chore_sessions_chore ON public.chore_sessions (chore_id);
CREATE INDEX IF NOT EXISTS idx_chore_sessions_assigned ON public.chore_sessions (assigned_chore_id);

ALTER TABLE public.chore_logs
  ADD COLUMN IF NOT EXISTS before_proof_url text,
  ADD COLUMN IF NOT EXISTS before_storage_path text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS flagged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flag_reason text;

CREATE INDEX IF NOT EXISTS idx_chore_logs_flagged_by ON public.chore_logs (flagged_by);

CREATE TABLE IF NOT EXISTS public.chore_log_reactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_id uuid NOT NULL REFERENCES public.chore_logs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('ok', 'sloppy')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (log_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_chore_log_reactions_log ON public.chore_log_reactions (log_id);
CREATE INDEX IF NOT EXISTS idx_chore_log_reactions_profile ON public.chore_log_reactions (profile_id);

CREATE TABLE IF NOT EXISTS public.shift_swaps (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  assigned_chore_id uuid NOT NULL REFERENCES public.assigned_chores(id) ON DELETE CASCADE,
  cycle_key text NOT NULL,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  bounty_amount integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shift_swaps_assigned ON public.shift_swaps (assigned_chore_id, cycle_key);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON public.shift_swaps (requester_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_target ON public.shift_swaps (target_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_accepted_by ON public.shift_swaps (accepted_by);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_swap_per_cycle
  ON public.shift_swaps (assigned_chore_id, cycle_key)
  WHERE status IN ('open', 'accepted');

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deadline_30m', 'deadline_5m', 'swap_request', 'swap_accepted', 'balance_update', 'quality_alert')),
  title text NOT NULL,
  body text NOT NULL,
  ref_key text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_profile_created ON public.notifications (profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notif_profile_ref
  ON public.notifications (profile_id, ref_key)
  WHERE ref_key IS NOT NULL;

ALTER TABLE public.fund_transactions
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

UPDATE public.fund_transactions
SET category = tx_type
WHERE category = 'general';

ALTER TABLE public.chore_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chore_log_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_swaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value) VALUES
  ('shared_party_fund', '{"balance": 0, "show_banner": true}'::jsonb),
  ('settlement_epoch', '{"nonce": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;

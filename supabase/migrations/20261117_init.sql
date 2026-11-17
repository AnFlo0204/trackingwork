-- Household Chore Tracker Schema & Seed Migration
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  pin text,
  password_hash text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.profiles (username, display_name, role, pin, password_hash, is_active)
VALUES ('Admin', 'Quản trị viên', 'admin', NULL, crypt('An9990204@', gen_salt('bf')), true)
ON CONFLICT (username) DO UPDATE
SET role = 'admin', password_hash = crypt('An9990204@', gen_salt('bf')), is_active = true, updated_at = now();

-- 2. Chores
CREATE TABLE IF NOT EXISTS public.chores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  icon text NOT NULL DEFAULT 'sparkles',
  points integer NOT NULL DEFAULT 10,
  cooldown_minutes integer NOT NULL DEFAULT 30,
  sort_order integer NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'always' CHECK (frequency IN ('always', 'daily', 'weekly')),
  penalty_amount integer NOT NULL DEFAULT 20000,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.chores (title, icon, points, cooldown_minutes, sort_order, frequency, penalty_amount)
SELECT title, icon, points, cooldown_minutes, sort_order, frequency, penalty_amount
FROM (VALUES
  ('Lau nhà', 'droplets', 20, 60, 1, 'daily', 20000),
  ('Rửa chén', 'utensils', 15, 30, 2, 'daily', 20000),
  ('Quét nhà', 'sparkles', 15, 45, 3, 'daily', 15000),
  ('Đổ rác', 'trash', 10, 60, 4, 'daily', 10000),
  ('Vệ sinh toilet', 'bath', 30, 120, 5, 'weekly', 30000)
) AS v(title, icon, points, cooldown_minutes, sort_order, frequency, penalty_amount)
WHERE NOT EXISTS (SELECT 1 FROM public.chores);

-- 3. Chore Logs
CREATE TABLE IF NOT EXISTS public.chore_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chore_id uuid NOT NULL REFERENCES public.chores(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proof_url text NOT NULL,
  storage_path text NOT NULL DEFAULT '',
  points_awarded integer NOT NULL DEFAULT 0,
  chore_title_snapshot text NOT NULL DEFAULT '',
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chore_logs_chore_created ON public.chore_logs (chore_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chore_logs_profile_created ON public.chore_logs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chore_logs_created ON public.chore_logs (created_at DESC);

-- 4. Penalties
CREATE TABLE IF NOT EXISTS public.penalties (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chore_id uuid REFERENCES public.chores(id) ON DELETE SET NULL,
  amount integer NOT NULL DEFAULT 20000,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_penalties_profile_created ON public.penalties (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_penalties_chore_id ON public.penalties (chore_id);

-- 5. App Settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO public.app_settings (key, value) VALUES
  ('feature_flags', '{"recurring_tasks": true, "gamification": true, "analytics": true, "penalty_fund": false}'::jsonb),
  ('retention_days', '{"days": 90}'::jsonb),
  ('last_cleanup_at', '{"timestamp": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 6. Sync Signals (Zero-PII Realtime Push)
CREATE TABLE IF NOT EXISTS public.sync_signals (
  topic text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sync_signals (topic) VALUES ('all') ON CONFLICT (topic) DO NOTHING;

-- 7. Authoritative Vietnam Server Time RPC
CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS timestamp
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT now() AT TIME ZONE 'Asia/Ho_Chi_Minh';
$$;

-- 8. RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chore_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read sync_signals"
  ON public.sync_signals FOR SELECT TO anon, authenticated USING (true);

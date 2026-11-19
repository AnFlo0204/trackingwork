-- Non-destructive migration: Chore inline points/bonus support, Leaderboard points_earned,
-- Real-time Active Chore Lock (60-min TTL), and Member Avatars storage bucket.

-- 1. Member Avatars
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. Chores inline editable columns (defensive idempotency)
ALTER TABLE public.chores
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS bonus_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_amount integer NOT NULL DEFAULT 20000;

-- 3. Chore Logs points_earned column + safe non-destructive backfill
ALTER TABLE public.chore_logs
  ADD COLUMN IF NOT EXISTS points_earned integer NOT NULL DEFAULT 0;

UPDATE public.chore_logs l
SET points_earned = CASE
  WHEN COALESCE(l.points_awarded, 0) > 0 THEN l.points_awarded
  ELSE COALESCE((SELECT c.points FROM public.chores c WHERE c.id = l.chore_id), 0)
END
WHERE COALESCE(l.points_earned, 0) = 0;

-- 4. Real-time Active Chore Lock enhancements on chore_sessions
ALTER TABLE public.chore_sessions
  ALTER COLUMN before_proof_url SET DEFAULT '',
  ALTER COLUMN before_storage_path SET DEFAULT '';

ALTER TABLE public.chore_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 minutes');

UPDATE public.chore_sessions
SET expires_at = started_at + interval '60 minutes'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chore_sessions_active_chore
  ON public.chore_sessions (chore_id, status, expires_at DESC);

-- 5. Dedicated public avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

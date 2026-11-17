-- Security, Performance & Immutable Public Audit Log Migration

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

ALTER TABLE public.chore_logs
  ADD COLUMN IF NOT EXISTS thumb_url text,
  ADD COLUMN IF NOT EXISTS thumb_storage_path text;

CREATE TABLE IF NOT EXISTS public.upload_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chore_id uuid NOT NULL REFERENCES public.chores(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('before', 'after', 'single')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_profile ON public.upload_tokens (profile_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_chore ON public.upload_tokens (chore_id);
ALTER TABLE public.upload_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_assigned_chores_assignee_active
  ON public.assigned_chores (assignee_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_name text NOT NULL,
  action_type text NOT NULL,
  target_summary text NOT NULL,
  ref_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON public.audit_logs (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ref_created ON public.audit_logs (ref_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read audit_logs"
  ON public.audit_logs FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are strictly immutable';
END;
$$;

CREATE TRIGGER trg_prevent_audit_log_modification
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_modification();

UPDATE storage.buckets
SET
  file_size_limit = 307200,
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg']
WHERE id = 'chore-proofs';

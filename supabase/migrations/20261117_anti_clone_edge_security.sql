-- Ephemeral single-use cryptographic nonces (2-minute TTL) & distributed session rate-limit index
CREATE TABLE IF NOT EXISTS public.used_nonces (
  nonce text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method text NOT NULL,
  path text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_used_nonces_profile_created
  ON public.used_nonces (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_used_nonces_expires
  ON public.used_nonces (expires_at);

ALTER TABLE public.used_nonces ENABLE ROW LEVEL SECURITY;

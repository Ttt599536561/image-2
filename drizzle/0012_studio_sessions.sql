-- Anonymous browser owners bypass Better Auth and every credit/grant hook.
CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash)=64),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_studio_sessions_expires ON studio_sessions(expires_at);
CREATE TABLE IF NOT EXISTS studio_rate_limits (
  bucket_hash text PRIMARY KEY CHECK (length(bucket_hash)=64),
  hits integer NOT NULL CHECK (hits>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_studio_rate_limits_expires ON studio_rate_limits(expires_at);

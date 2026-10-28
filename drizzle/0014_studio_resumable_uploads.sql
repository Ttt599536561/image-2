-- Fixed-lifetime, bounded anonymous upload staging; no credentials or money data.
CREATE TABLE studio_upload_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash text NOT NULL CHECK (length(ip_hash)=64),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'receiving' CHECK (status IN ('receiving','finalizing','complete')),
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index BETWEEN 0 AND 64),
  finalizing_until timestamptz,
  finalization_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ix_studio_upload_owner ON studio_upload_sessions(user_id) WHERE status<>'complete';
CREATE INDEX ix_studio_upload_ip ON studio_upload_sessions(ip_hash) WHERE status<>'complete';
CREATE INDEX ix_studio_upload_expiry ON studio_upload_sessions(expires_at);
CREATE TABLE studio_upload_chunks (
  upload_id uuid NOT NULL REFERENCES studio_upload_sessions(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 63),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 65536),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (upload_id, chunk_index)
);

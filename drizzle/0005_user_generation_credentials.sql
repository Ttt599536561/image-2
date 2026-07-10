ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS credential_mode text NOT NULL DEFAULT 'system';

DO $$ BEGIN
  ALTER TABLE generations ADD CONSTRAINT generations_credential_mode_chk
    CHECK (credential_mode IN ('system','custom'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE generations ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

UPDATE generations
SET deadline_at = created_at + interval '5 minutes'
WHERE deadline_at IS NULL;

ALTER TABLE generations ALTER COLUMN deadline_at SET DEFAULT (now() + interval '5 minutes');
ALTER TABLE generations ALTER COLUMN deadline_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS generation_credentials (
  generation_id uuid PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gen_inflight_deadline
  ON generations(deadline_at)
  WHERE status IN ('queued','claimed','running');

CREATE INDEX IF NOT EXISTS ix_generation_credentials_expires
  ON generation_credentials(expires_at);

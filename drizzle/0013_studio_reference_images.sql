-- Ordered multi-image references; legacy single-image rows remain unchanged.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS input_image_keys jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='generations_input_image_keys_chk') THEN
    ALTER TABLE generations ADD CONSTRAINT generations_input_image_keys_chk CHECK (
      input_image_keys IS NULL OR CASE WHEN jsonb_typeof(input_image_keys)='array' THEN
        jsonb_array_length(input_image_keys) BETWEEN 1 AND 4
        AND NOT jsonb_path_exists(input_image_keys, '$[*] ? (@.type() != "string" || @ == "")')
      ELSE false END
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='generations_input_image_sources_chk') THEN
    ALTER TABLE generations ADD CONSTRAINT generations_input_image_sources_chk CHECK (
      input_image_keys IS NULL OR (input_image_key IS NULL AND source_image_id IS NULL)
    );
  END IF;
END $$;

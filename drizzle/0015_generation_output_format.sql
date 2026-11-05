-- Freeze the requested output format; existing jobs keep their original PNG path.
ALTER TABLE generations ADD COLUMN IF NOT EXISTS output_format text NOT NULL DEFAULT 'png';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='generations_output_format_chk') THEN
    ALTER TABLE generations ADD CONSTRAINT generations_output_format_chk CHECK (output_format IN ('png','gif'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='generations_gif_params_chk') THEN
    ALTER TABLE generations ADD CONSTRAINT generations_gif_params_chk CHECK (
      output_format <> 'gif' OR (
        model IN ('gpt-image-2.6','gpt-image-2.6-flare')
        AND input_image_key IS NULL AND input_image_keys IS NULL AND source_image_id IS NULL
        AND (background IS NULL OR background <> 'transparent')
      )
    );
  END IF;
END $$;

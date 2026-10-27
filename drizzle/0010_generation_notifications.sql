-- Durable rows remain authoritative. PostgreSQL delivers NOTIFY only on commit.
CREATE OR REPLACE FUNCTION notify_generation_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM pg_notify('generation_changes', json_build_object(
      'generationId', NEW.id,
      'userId', NEW.user_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generations_notify_change ON generations;
CREATE TRIGGER generations_notify_change
  AFTER INSERT OR UPDATE OF status ON generations
  FOR EACH ROW EXECUTE FUNCTION notify_generation_change();

-- Oldest eligible claim scans a small ordered queue, rather than historical jobs.
CREATE INDEX IF NOT EXISTS ix_gen_queued_created_id
  ON generations(created_at, id) WHERE status = 'queued';

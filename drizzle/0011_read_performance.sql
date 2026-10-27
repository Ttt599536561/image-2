-- Default notifications lists include both read and unread rows. Keep the existing
-- partial unread index and cover the general owner/time query separately.
CREATE INDEX IF NOT EXISTS ix_notif_user_all ON notifications(user_id, created_at DESC);

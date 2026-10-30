-- Optional additive feature. Install explicitly on existing databases.
CREATE TABLE IF NOT EXISTS notification_preferences (
  member_id INTEGER PRIMARY KEY REFERENCES members(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  token TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  email TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','uncertain','skipped')),
  created_at INTEGER NOT NULL,
  next_attempt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_error TEXT,
  UNIQUE(event_id,member_id)
);
CREATE INDEX IF NOT EXISTS notification_due ON notification_outbox(state,next_attempt);

-- Append-only record of successful sign-ins. Intentionally independent of
-- member foreign keys so retiring or merging an account never erases history.
CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  member_email TEXT NOT NULL,
  remembered INTEGER NOT NULL DEFAULT 0 CHECK(remembered IN (0,1))
);
CREATE INDEX IF NOT EXISTS login_history_created ON login_history(created_at);

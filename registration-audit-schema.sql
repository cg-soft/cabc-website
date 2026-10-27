-- Append-only application history, intentionally independent of game/account
-- foreign keys so later game deletion cannot erase who acted for whom.
CREATE TABLE IF NOT EXISTS registration_audit (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_name TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('register','cancel','form-team','leave-team')),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL
);

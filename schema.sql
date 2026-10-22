CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member','admin'))
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  time TEXT NOT NULL DEFAULT '11:30',
  name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS entries (
  game_id INTEGER NOT NULL REFERENCES games(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  partner_id INTEGER REFERENCES members(id),
  PRIMARY KEY (game_id, member_id),
  CHECK (partner_id IS NULL OR partner_id <> member_id)
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;

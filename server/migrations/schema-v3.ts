// Frozen schema for the legacy version-three baseline. Add new migrations rather than editing it.
export const SCHEMA_V3_SQL = `
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), bio TEXT NOT NULL DEFAULT '', listed INTEGER NOT NULL DEFAULT 0 CHECK(listed IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS bootstrap (id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), club_name TEXT NOT NULL, about TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '', schedule_note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL CHECK(visibility IN ('public','members')));
      CREATE TABLE IF NOT EXISTS rsvps (event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(event_id, user_id));
      CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text/plain' CHECK(type='text/plain'));
      CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dance_players (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS dance_games (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dance_slots (
        game_id INTEGER NOT NULL REFERENCES dance_games(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('booked','standby','cancelled')),
        PRIMARY KEY(game_id,user_id),
        CHECK((status='booked' AND partner_id IS NOT NULL AND partner_id<>user_id AND booking_id IS NOT NULL) OR (status<>'booked' AND partner_id IS NULL AND booking_id IS NULL))
      );
      CREATE INDEX IF NOT EXISTS dance_slots_booking_idx ON dance_slots(booking_id);
      CREATE TABLE IF NOT EXISTS dance_attendance (
        game_id INTEGER NOT NULL REFERENCES dance_games(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attending INTEGER NOT NULL CHECK(attending IN (0,1)),
        PRIMARY KEY(game_id,user_id)
      );
`;

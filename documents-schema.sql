-- Private PDF bytes stay in the same encrypted-backup snapshot as permissions.
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
  filename TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'admin' CHECK(visibility IN ('admin','members')),
  content BLOB NOT NULL CHECK(typeof(content)='blob'),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760 AND size=length(content)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  uploaded_by INTEGER NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_audit (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES members(id),
  document_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('upload','edit','replace','delete')),
  old_visibility TEXT,
  new_visibility TEXT
);

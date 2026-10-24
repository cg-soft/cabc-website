-- Guards keep inactive accounts blocked even if older application code is used.
CREATE TRIGGER IF NOT EXISTS inactive_session_insert
BEFORE INSERT ON sessions WHEN (SELECT active FROM members WHERE id=NEW.member_id)=0
BEGIN SELECT RAISE(ABORT,'Inactive member cannot sign in'); END;
CREATE TRIGGER IF NOT EXISTS inactive_session_update
BEFORE UPDATE ON sessions WHEN (SELECT active FROM members WHERE id=NEW.member_id)=0
BEGIN SELECT RAISE(ABORT,'Inactive member cannot sign in'); END;
CREATE TRIGGER IF NOT EXISTS inactive_entry_insert
BEFORE INSERT ON entries WHEN
  (SELECT active FROM members WHERE id=NEW.member_id)=0 OR
  (SELECT active FROM members WHERE id=NEW.partner_id)=0
BEGIN SELECT RAISE(ABORT,'Inactive member cannot register'); END;
CREATE TRIGGER IF NOT EXISTS inactive_entry_update
BEFORE UPDATE OF member_id,partner_id ON entries WHEN
  (SELECT active FROM members WHERE id=NEW.member_id)=0 OR
  (SELECT active FROM members WHERE id=NEW.partner_id)=0
BEGIN SELECT RAISE(ABORT,'Inactive member cannot register'); END;
CREATE TRIGGER IF NOT EXISTS revoke_inactive_sessions
AFTER UPDATE OF active ON members WHEN OLD.active=1 AND NEW.active=0
BEGIN DELETE FROM sessions WHERE member_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS protect_last_active_admin_update
BEFORE UPDATE OF active,role ON members
WHEN OLD.active=1 AND OLD.role='admin' AND (NEW.active=0 OR NEW.role<>'admin')
  AND (SELECT count(*) FROM members WHERE active=1 AND role='admin')<=1
BEGIN SELECT RAISE(ABORT,'Cannot remove the last active administrator'); END;
CREATE TRIGGER IF NOT EXISTS protect_last_active_admin_delete
BEFORE DELETE ON members
WHEN OLD.active=1 AND OLD.role='admin'
  AND (SELECT count(*) FROM members WHERE active=1 AND role='admin')<=1
BEGIN SELECT RAISE(ABORT,'Cannot remove the last active administrator'); END;

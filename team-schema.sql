-- Additive team membership layer. A team contains four members of two reciprocal
-- entries pairs. The API inserts all four rows atomically after checking the pairs.
-- Unique date/member membership prevents simultaneous assignment to two teams.
CREATE TABLE IF NOT EXISTS team_members (
  game_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  team_id TEXT NOT NULL,
  PRIMARY KEY (game_id, member_id),
  FOREIGN KEY (game_id, member_id) REFERENCES entries(game_id, member_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS team_members_group ON team_members(game_id, team_id);

-- Keep old releases safe: their existing cancellation/update SQL must also
-- dissolve any team whose underlying partnership no longer exists.
CREATE TRIGGER IF NOT EXISTS dissolve_team_before_entry_delete
BEFORE DELETE ON entries
BEGIN
  DELETE FROM team_members WHERE game_id=OLD.game_id AND team_id IN
    (SELECT team_id FROM team_members WHERE game_id=OLD.game_id AND member_id=OLD.member_id);
END;
CREATE TRIGGER IF NOT EXISTS dissolve_team_before_partner_change
BEFORE UPDATE OF partner_id ON entries WHEN OLD.partner_id IS NOT NEW.partner_id
BEGIN
  DELETE FROM team_members WHERE game_id=OLD.game_id AND team_id IN
    (SELECT team_id FROM team_members WHERE game_id=OLD.game_id AND member_id=OLD.member_id);
END;

// Query profil generator dan versi terbit. Identitas akun hanya dipakai untuk audit di domain.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function list(c: Executor, available = false) {
  return c.query<RowDataPacket[]>(
    'SELECT * FROM ai_image_profiles' +
      (available ? ' WHERE enabled=TRUE AND active IS NOT NULL' : '') +
      ' ORDER BY created_at',
  );
}
export function find(c: Executor, p: SqlValue[], lock = false) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_image_profiles WHERE id=?' + (lock ? ' FOR UPDATE' : ''), p);
}
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT INTO ai_image_profiles(id,draft) VALUES (?,?)', p);
}
export function update(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_image_profiles SET draft=?,revision=revision+1 WHERE id=?', p);
}
export function publish(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_image_profiles SET active=draft,published_revision=revision WHERE id=?', p);
}
export function setEnabled(c: Executor, p: SqlValue[]) {
  return c.execute('UPDATE ai_image_profiles SET enabled=? WHERE id=?', p);
}
export function insertVersion(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT IGNORE INTO ai_image_versions(profile_id,revision,definition) VALUES (?,?,?)', p);
}
export function listVersions(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT revision,created_at FROM ai_image_versions WHERE profile_id=? ORDER BY revision DESC LIMIT 100',
    p,
  );
}
export function findVersion(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT definition FROM ai_image_versions WHERE profile_id=? AND revision=?', p);
}
export function deleteById(c: Executor, p: SqlValue[]) {
  return c.execute('DELETE FROM ai_image_profiles WHERE id=?', p);
}

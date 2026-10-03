// Query tabel instagram_api_keys: key untuk aplikasi lain. Dipanggil lewat namespace, misalnya
// `integrationKeysSql.listByAccount(db, [...])`.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO instagram_api_keys(id,account_id,name,key_hash,key_hint,scopes) VALUES (?,?,?,?,?,?)',
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,name,key_hint,scopes,last_used_at,created_at FROM instagram_api_keys WHERE account_id=? ORDER BY created_at',
    params,
  );
}
export function countByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM instagram_api_keys WHERE account_id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_api_keys WHERE account_id=? AND id=?', params);
}
// Akun yang disuspend tidak boleh lagi memakai key-nya.
export function findByHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT k.id,k.account_id,k.scopes,k.last_used_at FROM instagram_api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',
    params,
  );
}
export function touch(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE instagram_api_keys SET last_used_at=NOW() WHERE id=?', params);
}

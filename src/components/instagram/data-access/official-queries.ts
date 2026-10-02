// Query tabel instagram_official dan instagram_oauth_states: akun Instagram yang masuk lewat Instagram Login resmi.
// Dipanggil lewat namespace, misalnya `officialSql.list(db, [...])`.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function saveState(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO instagram_oauth_states(state_hash,account_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
    params,
  );
}
// Sekali pakai: baris state dihapus lebih dulu, lalu dibaca hasilnya oleh pemanggil lewat affectedRows.
export function takeState(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT account_id FROM instagram_oauth_states WHERE state_hash=? AND expires_at>NOW() FOR UPDATE',
    params,
  );
}
export function deleteState(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_oauth_states WHERE state_hash=?', params);
}
export function deleteExpiredStates(c: Executor) {
  return c.execute('DELETE FROM instagram_oauth_states WHERE expires_at<=NOW()');
}
export function findByUser(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT account_id FROM instagram_official WHERE ig_user_id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    `INSERT INTO instagram_official(account_id,ig_user_id,username,account_type,token,permissions,status,expires_at,refreshed_at)
     VALUES (?,?,?,?,?,?,'active',DATE_ADD(NOW(),INTERVAL ? SECOND),NOW())
     ON DUPLICATE KEY UPDATE username=VALUES(username),account_type=VALUES(account_type),token=VALUES(token),
       permissions=VALUES(permissions),status='active',expires_at=VALUES(expires_at),refreshed_at=NOW()`,
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT o.ig_user_id,o.username,o.account_type,o.permissions,o.status,o.expires_at,o.refreshed_at,(SELECT c.session_id FROM instagram_channels c WHERE c.provider='official' AND c.account_id=o.account_id AND c.ig_account_id=o.ig_user_id) AS session_id FROM instagram_official o WHERE o.account_id=? ORDER BY o.created_at,o.ig_user_id",
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT ig_user_id,username,token,permissions,status,expires_at FROM instagram_official WHERE account_id=? AND ig_user_id=?',
    params,
  );
}
export function updateToken(c: Executor, params: SqlValue[]) {
  return c.execute(
    `UPDATE instagram_official SET token=?,expires_at=DATE_ADD(NOW(),INTERVAL ? SECOND),refreshed_at=NOW(),status='active' WHERE account_id=? AND ig_user_id=?`,
    params,
  );
}
// Token yang akan habis dalam 15 hari, sudah berumur lebih dari sehari (syarat Meta), dan belum kedaluwarsa.
export function listRefreshable(c: Executor) {
  return c.execute<RowDataPacket[]>(
    `SELECT account_id,ig_user_id,token FROM instagram_official WHERE status='active' AND expires_at>NOW()
       AND expires_at<DATE_ADD(NOW(),INTERVAL 15 DAY) AND refreshed_at<DATE_SUB(NOW(),INTERVAL 1 DAY)`,
  );
}
export function markRevoked(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE instagram_official SET status='revoked',token='' WHERE ig_user_id=?", params);
}
export function deleteByUser(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_official WHERE ig_user_id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_official WHERE account_id=? AND ig_user_id=?', params);
}
export function findByUserWithToken(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT account_id,ig_user_id,username,token,status,expires_at FROM instagram_official WHERE ig_user_id=?',
    params,
  );
}

// Query koneksi TikTok; semua operasi milik pengguna dibatasi account_id dari server.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';

export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    `INSERT INTO tiktok_connections
      (account_id,open_id,display_name,avatar_url,access_token,refresh_token,permissions,expires_at,refresh_expires_at)
      VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? SECOND),DATE_ADD(NOW(),INTERVAL ? SECOND))`,
    params,
  );
}
export function updateOwned(c: Executor, params: SqlValue[]) {
  return c.execute(
    `UPDATE tiktok_connections SET display_name=?,avatar_url=?,access_token=?,refresh_token=?,permissions=?,
      expires_at=DATE_ADD(NOW(),INTERVAL ? SECOND),refresh_expires_at=DATE_ADD(NOW(),INTERVAL ? SECOND)
      WHERE account_id=? AND open_id=?`,
    params,
  );
}
export function list(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT open_id,display_name,permissions,expires_at,refresh_expires_at FROM tiktok_connections WHERE account_id=? ORDER BY created_at DESC,open_id DESC',
    params,
  );
}
export function findOwner(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT account_id FROM tiktok_connections WHERE open_id=?', params);
}
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM tiktok_connections WHERE account_id=? AND open_id=? FOR UPDATE',
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM tiktok_connections WHERE account_id=? AND open_id=?', params);
}

// State TikTok disimpan sebagai hash, terikat ke browser pemulai, dan dikonsumsi sekali dalam transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';

export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO tiktok_oauth_states(state_hash,browser_hash,account_id,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
    params,
  );
}
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT account_id FROM tiktok_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>NOW() FOR UPDATE',
    params,
  );
}
export function deleteByHash(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM tiktok_oauth_states WHERE state_hash=?', params);
}
export function deleteExpired(c: Executor) {
  return c.execute('DELETE FROM tiktok_oauth_states WHERE expires_at<=NOW()');
}

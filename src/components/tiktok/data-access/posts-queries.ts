// Query permintaan Direct Post TikTok; status hanya maju lewat transisi bersyarat agar klaim tidak terulang.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';

export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT request_id,open_id,payload_hash,media_type,photo_count,publish_id,status,error_code,error_message,updated_at FROM tiktok_posts WHERE account_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO tiktok_posts(account_id,request_id,open_id,payload_hash,media_type,photo_count,status) VALUES (?,?,?,?,?,?,'preparing')",
    params,
  );
}
// Diambil tepat sebelum init dipanggil: setelah ini hasilnya bisa saja sudah diterima TikTok.
export function claim(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    "UPDATE tiktok_posts SET status='publishing' WHERE account_id=? AND request_id=? AND status='preparing'",
    params,
  );
}
export function markProcessing(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE tiktok_posts SET status='processing',publish_id=? WHERE account_id=? AND request_id=? AND status='publishing'",
    params,
  );
}
export function markPublished(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE tiktok_posts SET status='published' WHERE account_id=? AND request_id=? AND status='processing'",
    params,
  );
}
export function fail(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE tiktok_posts SET status='failed',error_code=?,error_message=? WHERE account_id=? AND request_id=? AND status IN ('preparing','publishing','processing')",
    params,
  );
}
export function uncertain(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE tiktok_posts SET status='unknown',error_code=?,error_message=? WHERE account_id=? AND request_id=? AND status IN ('publishing','processing')",
    params,
  );
}

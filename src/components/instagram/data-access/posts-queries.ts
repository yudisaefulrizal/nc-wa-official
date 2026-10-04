// Permintaan posting feed disimpan per akun dan request ID agar percobaan ulang tidak menerbitkan duplikat.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';

export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT request_id,ig_user_id,file_id,payload_hash,container_id,media_id,media_type,status,updated_at FROM instagram_posts WHERE account_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO instagram_posts(account_id,request_id,ig_user_id,file_id,payload_hash,media_type,status) VALUES (?,?,?,?,?,?,'preparing')",
    params,
  );
}
export function prepared(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE instagram_posts SET container_id=?,status='processing' WHERE account_id=? AND request_id=? AND status='preparing'",
    params,
  );
}
export function claim(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    "UPDATE instagram_posts SET status='publishing' WHERE account_id=? AND request_id=? AND status='processing'",
    params,
  );
}
export function finish(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE instagram_posts SET status='published',media_id=? WHERE account_id=? AND request_id=? AND status='publishing'",
    params,
  );
}
export function fail(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE instagram_posts SET status='failed' WHERE account_id=? AND request_id=? AND status IN ('preparing','processing')",
    params,
  );
}
export function uncertain(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE instagram_posts SET status='unknown' WHERE account_id=? AND request_id=? AND status='publishing'",
    params,
  );
}

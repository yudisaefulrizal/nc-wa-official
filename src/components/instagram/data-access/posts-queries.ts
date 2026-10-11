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

export function list(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.request_id,p.ig_user_id,p.media_type,p.status,p.media_id,p.created_at,p.updated_at,p.error_code,p.error_message,p.permalink,o.username FROM instagram_posts p LEFT JOIN instagram_official o ON o.account_id=p.account_id AND o.ig_user_id=p.ig_user_id WHERE p.account_id=? ORDER BY p.created_at DESC,p.request_id LIMIT 20 OFFSET ?',
    params,
  );
}
export function count(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM instagram_posts WHERE account_id=?', params);
}
export function recordError(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE instagram_posts SET error_code=?,error_message=? WHERE account_id=? AND request_id=?',
    params,
  );
}
export function permalink(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE instagram_posts SET permalink=? WHERE account_id=? AND request_id=?', params);
}

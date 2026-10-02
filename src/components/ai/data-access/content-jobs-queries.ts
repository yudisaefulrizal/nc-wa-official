// Query antrean pekerjaan profil Konten; semua pembacaan klien wajib menyertakan akun server.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, p: SqlValue[], lock = false) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_content_jobs WHERE account_id=? AND id=?' + (lock ? ' FOR UPDATE' : ''),
    p,
  );
}
export function findRequest(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_content_jobs WHERE account_id=? AND request_key=?', p);
}
export function list(c: Executor, p: SqlValue[], page: number) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_content_jobs WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ' +
      (page - 1) * 20,
    p,
  );
}
export function count(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_content_jobs WHERE account_id=?', p);
}
export function countOpen(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ai_content_jobs WHERE account_id=? AND status IN ('queued','running')",
    p,
  );
}
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_content_jobs(id,account_id,request_key,payload_hash,profile_id,profile_revision,snapshot,input) VALUES (?,?,?,?,?,?,?,?)',
    p,
  );
}
export function lockNext(c: Executor) {
  return c.query<RowDataPacket[]>(
    "SELECT * FROM ai_content_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
}
export function markRunning(c: Executor, p: SqlValue[]) {
  return c.execute(
    "UPDATE ai_content_jobs SET status='running',stage='running' WHERE account_id=? AND id=? AND status='queued'",
    p,
  );
}
// [status, hasil JSON atau null, pesan galat atau null, akun, id]
export function settle(c: Executor, p: SqlValue[]) {
  return c.execute(
    "UPDATE ai_content_jobs SET status=?,stage='done',results=?,error=?,finished_at=UTC_TIMESTAMP(3) WHERE account_id=? AND id=? AND status='running'",
    p,
  );
}
// [pesan galat]. Dipakai saat start: pekerjaan yang belum selesai tidak dilanjutkan dan kreditnya dikembalikan.
export function interruptPending(c: Executor, p: SqlValue[]) {
  return c.execute(
    "UPDATE ai_content_jobs SET status='interrupted',stage='done',error=?,finished_at=UTC_TIMESTAMP(3) WHERE status IN ('queued','running')",
    p,
  );
}

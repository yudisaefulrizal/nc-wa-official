// Query antrean gambar; semua pembacaan klien wajib menyertakan akun server.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, p: SqlValue[], lock = false) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_image_jobs WHERE account_id=? AND id=?' + (lock ? ' FOR UPDATE' : ''),
    p,
  );
}
export function findRequest(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_image_jobs WHERE account_id=? AND request_key=?', p);
}
export function list(c: Executor, p: SqlValue[], page: number) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_image_jobs WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ' +
      (page - 1) * 20,
    p,
  );
}
export function count(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_image_jobs WHERE account_id=?', p);
}
export function countOpen(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ai_image_jobs WHERE account_id=? AND status IN ('queued','running')",
    p,
  );
}
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_image_jobs(id,account_id,request_key,payload_hash,profile_id,profile_revision,snapshot,input,connection,reserved,reserved_plan,plan_period) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    p,
  );
}
export function lockNext(c: Executor) {
  return c.query<RowDataPacket[]>(
    "SELECT * FROM ai_image_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
}
export function markRunning(c: Executor, p: SqlValue[]) {
  return c.execute(
    "UPDATE ai_image_jobs SET status='running',stage='prompt' WHERE account_id=? AND id=? AND status='queued'",
    p,
  );
}
export function updateStage(c: Executor, p: SqlValue[]) {
  return c.execute("UPDATE ai_image_jobs SET stage=? WHERE account_id=? AND id=? AND status='running'", p);
}
export function settle(c: Executor, p: SqlValue[]) {
  return c.execute(
    'UPDATE ai_image_jobs SET status=?,stage=?,charged=?,results=?,error=?,reserved=0,finished_at=UTC_TIMESTAMP(3) WHERE account_id=? AND id=?',
    p,
  );
}
export function listInterrupted(c: Executor) {
  return c.query<RowDataPacket[]>("SELECT account_id,id,results FROM ai_image_jobs WHERE status='running'");
}
export function countProfileOpen(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ai_image_jobs WHERE profile_id=? AND status IN ('queued','running')",
    p,
  );
}

export function updateResults(c: Executor, p: SqlValue[]) {
  return c.execute("UPDATE ai_image_jobs SET results=? WHERE account_id=? AND id=? AND status='running'", p);
}

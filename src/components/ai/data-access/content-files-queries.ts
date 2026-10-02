// Metadata pustaka gambar dan referensi privat, dibatasi identitas akun.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id,kind,bytes FROM ai_content_files WHERE account_id=? AND id=?', p);
}
export function insert(c: Executor, p: SqlValue[]) {
  return c.execute('INSERT INTO ai_content_files(id,account_id,kind,bytes) VALUES (?,?,?,?)', p);
}
export function sum(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(bytes),0) AS bytes,COUNT(*) AS n FROM ai_content_files WHERE account_id=?',
    p,
  );
}
export function listReferences(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id,bytes,created_at FROM ai_content_files WHERE account_id=? AND kind='reference' ORDER BY created_at DESC LIMIT 30",
    p,
  );
}

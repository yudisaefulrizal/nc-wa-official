// Identitas brand untuk generator; satu definisi privat per akun.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, p: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT definition FROM ai_image_brands WHERE account_id=?', p);
}
export function upsert(c: Executor, p: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_image_brands(account_id,definition) VALUES (?,?) ON DUPLICATE KEY UPDATE definition=VALUES(definition)',
    p,
  );
}

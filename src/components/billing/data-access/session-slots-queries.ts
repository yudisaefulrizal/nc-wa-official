// Menghitung koneksi konten yang memakai kuota sesi bersama sesi chat; dipakai pemeriksaan kapasitas billing.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../../../libraries/db.js';

export function countTikTok(c: Executor, account: string) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS used FROM tiktok_connections WHERE account_id=?', [account]);
}

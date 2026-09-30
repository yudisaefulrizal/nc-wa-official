// Query tabel ai_settings untuk komponen ai. Dipanggil lewat namespace, misalnya
// `settingsSql.shareMemoryLimit(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function shareMemoryLimit(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT memory_limit FROM ai_settings WHERE id=1 FOR SHARE');
}
export function find(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT * FROM ai_settings WHERE id=1');
}
// Membuat baris pengaturan (id=1) bila belum ada, dengan nilai bawaan kode. Baris ini baru ada setelah pemilik menyimpan
// pengaturan lama, sedangkan rute profil harus bisa diaktifkan tanpa itu.
export function ensureRow(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT IGNORE INTO ai_settings(id,endpoint,model,secret,input_rate,output_rate,memory_limit,context_memory_limit,trace_enabled,credit_price) VALUES (1,?,?,'',?,?,?,?,?,?)",
    params,
  );
}
export function enableProfileRouting(c: Executor) {
  return c.query('UPDATE ai_settings SET profile_routing_enabled=TRUE WHERE id=1');
}
// Hanya preferensi umum; endpoint, kredensial, dan model dimiliki profil provider.
export function updatePreferences(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_settings SET input_rate=?,output_rate=?,memory_limit=?,context_memory_limit=?,trace_enabled=?,credit_price=?,tidy_prompt=? WHERE id=1',
    params,
  );
}

// Skema Konten: pustaka gambar privat akun, identitas brand, dan antrean pekerjaan profil Konten.
// Semua langkah aman diulang oleh migrasi utama AI.
import { db } from '../../../libraries/db.js';

export async function migrateContent() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS ai_content_files (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,kind ENUM('reference','result') NOT NULL,bytes INT UNSIGNED NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX content_owner(account_id,kind,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_image_brands (account_id CHAR(36) PRIMARY KEY,definition JSON NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_content_jobs (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,request_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,payload_hash CHAR(64) NOT NULL,profile_id VARCHAR(32) NOT NULL,profile_revision INT UNSIGNED NOT NULL,snapshot JSON NOT NULL,input JSON NOT NULL,status ENUM('queued','running','completed','failed','interrupted') NOT NULL DEFAULT 'queued',stage VARCHAR(32) NOT NULL DEFAULT 'queued',results JSON NULL,error VARCHAR(200) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),finished_at DATETIME(3) NULL,UNIQUE KEY content_request(account_id,request_key),INDEX content_queue(status,created_at),INDEX content_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  ];
  for (const statement of tables) await db.query(statement);
  await clearLegacyGenerator();
}
// Generator Gambar lama (profil, versi, antrean) digantikan profil Konten di Editor profil. User database aplikasi tidak
// punya hak DROP, jadi isinya dikosongkan dan perintah DROP dicetak untuk dijalankan sekali oleh admin MySQL.
const legacyTables = ['ai_image_jobs', 'ai_image_versions', 'ai_image_profiles'];
async function clearLegacyGenerator() {
  const [rows] = await db.query<any[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${legacyTables.map(t => "'" + t + "'").join(',')})`,
  );
  const present = legacyTables.filter(t => rows.some(r => r.TABLE_NAME === t));
  for (const table of present) await db.query(`DELETE FROM ${table}`);
  if (present.length)
    console.log(
      'Generator Gambar lama sudah kosong. Buang sekali dengan akun admin MySQL: DROP TABLE ' +
        present.join(', ') +
        ';',
    );
}

// Skema profil generator, antrean gambar, identitas brand dan pustaka privat setiap akun.
// Semua langkah aman diulang oleh migrasi utama AI.
import { db } from '../../../libraries/db.js';

export async function migrateImages() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS ai_image_profiles (id CHAR(36) PRIMARY KEY,draft JSON NOT NULL,active JSON NULL,enabled BOOLEAN NOT NULL DEFAULT FALSE,revision INT UNSIGNED NOT NULL DEFAULT 1,published_revision INT UNSIGNED NOT NULL DEFAULT 0,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_image_versions (profile_id CHAR(36) NOT NULL,revision INT UNSIGNED NOT NULL,definition JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(profile_id,revision),FOREIGN KEY(profile_id) REFERENCES ai_image_profiles(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_content_files (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,kind ENUM('reference','result') NOT NULL,bytes INT UNSIGNED NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX content_owner(account_id,kind,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_image_brands (account_id CHAR(36) PRIMARY KEY,definition JSON NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_image_jobs (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,request_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,payload_hash CHAR(64) NOT NULL,profile_id CHAR(36) NULL,profile_revision INT UNSIGNED NOT NULL,snapshot JSON NOT NULL,input JSON NOT NULL,connection JSON NOT NULL,status ENUM('queued','running','completed','failed','interrupted') NOT NULL DEFAULT 'queued',stage VARCHAR(32) NOT NULL DEFAULT 'queued',reserved INT UNSIGNED NOT NULL,reserved_plan INT UNSIGNED NOT NULL,plan_period VARCHAR(64) NULL,charged INT UNSIGNED NOT NULL DEFAULT 0,results JSON NULL,error VARCHAR(200) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),finished_at DATETIME(3) NULL,UNIQUE KEY image_request(account_id,request_key),INDEX image_queue(status,created_at),INDEX image_account(account_id,created_at),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(profile_id) REFERENCES ai_image_profiles(id) ON DELETE SET NULL) ENGINE=InnoDB`,
  ];
  for (const statement of tables) await db.query(statement);
}

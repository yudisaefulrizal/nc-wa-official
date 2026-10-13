// Tabel koneksi TikTok, state OAuth Login Kit, dan permintaan Direct Post; dipanggil oleh migrasi utama.
import { db } from '../../../libraries/db.js';

export async function migrateTikTok() {
  await db.query(`CREATE TABLE IF NOT EXISTS tiktok_connections (
    account_id CHAR(36) NOT NULL, open_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    display_name VARCHAR(200) NOT NULL, avatar_url TEXT NOT NULL,
    access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, permissions VARCHAR(1000) NOT NULL,
    expires_at DATETIME NOT NULL, refresh_expires_at DATETIME NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY(account_id,open_id), UNIQUE KEY tiktok_user(open_id),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
    state_hash CHAR(64) PRIMARY KEY, browser_hash CHAR(64) NOT NULL,
    account_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  // Satu baris per permintaan posting; request ID dari klien mencegah posting ganda saat permintaan diulang.
  await db.query(`CREATE TABLE IF NOT EXISTS tiktok_posts (
    account_id CHAR(36) NOT NULL, request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    open_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL, payload_hash CHAR(64) NOT NULL,
    media_type ENUM('PHOTO','VIDEO') NOT NULL DEFAULT 'PHOTO',
    photo_count TINYINT UNSIGNED NOT NULL, publish_id VARCHAR(64) NULL,
    status ENUM('preparing','publishing','processing','published','failed','unknown') NOT NULL,
    error_code VARCHAR(64) NULL, error_message VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY(account_id,request_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  // Database yang dibuat sebelum posting video perlu kolom jenis media.
  const [mediaType] = await db.query<any[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tiktok_posts' AND COLUMN_NAME='media_type'",
  );
  if (!mediaType.length)
    await db.query(
      "ALTER TABLE tiktok_posts ADD COLUMN media_type ENUM('PHOTO','VIDEO') NOT NULL DEFAULT 'PHOTO' AFTER payload_hash",
    );
}

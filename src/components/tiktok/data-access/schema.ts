// Tabel koneksi TikTok dan state OAuth untuk Login Kit; dipanggil oleh migrasi utama.
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
}

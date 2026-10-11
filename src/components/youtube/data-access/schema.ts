// Tabel koneksi, state OAuth, dan antrean unggahan YouTube; dipanggil migrasi utama.
import { db } from '../../../libraries/db.js';
export async function migrateYouTube() {
  await db.query(`CREATE TABLE IF NOT EXISTS youtube_connections (
    account_id CHAR(36) NOT NULL, channel_id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL, avatar TEXT NOT NULL,
    access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, permissions VARCHAR(1000) NOT NULL,
    expires_at DATETIME NOT NULL, checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(account_id,channel_id), UNIQUE KEY(channel_id),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS youtube_oauth_states (
    state_hash CHAR(64) PRIMARY KEY, browser_hash CHAR(64) NOT NULL, verifier TEXT NOT NULL,
    account_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS youtube_posts (
    id CHAR(36) PRIMARY KEY, account_id CHAR(36) NOT NULL, channel_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(128) NOT NULL, input_hash CHAR(64) NOT NULL,
    payload JSON NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'queued',
    video_id VARCHAR(64) NULL, upload_session TEXT NULL, upload_size BIGINT NULL,
    error VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY(account_id,request_id), KEY(status,created_at),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}

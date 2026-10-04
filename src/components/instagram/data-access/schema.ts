// Tabel Instagram DM lewat Zernio: akun Zernio milik klien, akun Instagram yang terpasang sebagai sesi, dan
// nama pelanggan Instagram. Hanya CREATE IF NOT EXISTS, jadi aman dijalankan ulang oleh npm run migrate.
import { db } from '../../../libraries/db.js';
export async function migrateInstagram() {
  // Kunci API dan secret webhook disimpan terenkripsi; key_hash mencegah satu akun Zernio dipasang dua kali.
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_zernio_accounts (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,name VARCHAR(60) NOT NULL,api_key TEXT NOT NULL,key_hash CHAR(64) NOT NULL,key_hint VARCHAR(8) NOT NULL,profile_id VARCHAR(64) NOT NULL,webhook_id VARCHAR(64) NULL,webhook_secret TEXT NOT NULL,status ENUM('active','invalid') NOT NULL DEFAULT 'active',last_event_at DATETIME NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY zernio_key(key_hash),UNIQUE KEY zernio_name(account_id,name),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_channels (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,zernio_account_id CHAR(36) NOT NULL,ig_account_id VARCHAR(64) NOT NULL,username VARCHAR(100) NOT NULL,status ENUM('active','disconnected') NOT NULL DEFAULT 'active',created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,session_id),UNIQUE KEY channel_account(zernio_account_id,ig_account_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,FOREIGN KEY(zernio_account_id) REFERENCES instagram_zernio_accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Urutan daftar memakai created_at; milidetik supaya akun yang ditambah berurutan cepat tidak tertukar.
  for (const table of ['instagram_zernio_accounts', 'instagram_channels'])
    await db.query(`ALTER TABLE ${table} MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_contacts (account_id CHAR(36) NOT NULL,session_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,customer VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,username VARCHAR(100) NOT NULL DEFAULT '',name VARCHAR(100) NOT NULL DEFAULT '',updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY(account_id,session_id,customer),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
}
// Instagram Login resmi (langsung ke Meta, tanpa Zernio): satu baris per akun Instagram yang diizinkan. Token
// disimpan terenkripsi; state OAuth disimpan sebagai hash dan hanya berlaku sekali.
export async function migrateInstagramOfficial() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_posts (
      account_id CHAR(36) NOT NULL, request_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      ig_user_id VARCHAR(64) NOT NULL, file_id CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL,
      container_id VARCHAR(64) NULL, media_id VARCHAR(64) NULL,
      status ENUM('preparing','processing','publishing','published','failed','unknown') NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY(account_id,request_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
  );

  const [postType] = await db.query<any[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='instagram_posts' AND COLUMN_NAME='media_type'",
  );
  if (!postType.length)
    await db.query("ALTER TABLE instagram_posts ADD COLUMN media_type ENUM('IMAGE','REELS') NOT NULL DEFAULT 'IMAGE'");

  // Sesi Instagram resmi memakai tabel kanal yang sama dengan Zernio; bedanya provider dan tanpa akun Zernio.
  const [provider] = await db.query<any[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='instagram_channels' AND COLUMN_NAME='provider'",
  );
  if (!provider.length) {
    await db.query(
      "ALTER TABLE instagram_channels ADD COLUMN provider ENUM('zernio','official') NOT NULL DEFAULT 'zernio'",
    );
    await db.query('ALTER TABLE instagram_channels MODIFY zernio_account_id CHAR(36) NULL');
  }
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_official (account_id CHAR(36) NOT NULL,ig_user_id VARCHAR(64) NOT NULL,username VARCHAR(100) NOT NULL,account_type VARCHAR(30) NOT NULL DEFAULT '',token TEXT NOT NULL,permissions VARCHAR(500) NOT NULL DEFAULT '',status ENUM('active','revoked') NOT NULL DEFAULT 'active',expires_at DATETIME NULL,refreshed_at DATETIME NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(account_id,ig_user_id),UNIQUE KEY official_ig_user(ig_user_id),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_oauth_states (state_hash CHAR(64) PRIMARY KEY,account_id CHAR(36) NOT NULL,expires_at DATETIME NOT NULL,FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
  // Key untuk aplikasi lain yang memakai akun Instagram yang sudah terhubung; hanya hash yang disimpan.
  await db.query(
    `CREATE TABLE IF NOT EXISTS instagram_api_keys (id CHAR(36) PRIMARY KEY,account_id CHAR(36) NOT NULL,name VARCHAR(60) NOT NULL,key_hash CHAR(64) NOT NULL,key_hint VARCHAR(8) NOT NULL,scopes VARCHAR(300) NOT NULL,last_used_at DATETIME NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY instagram_api_key_hash(key_hash),FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  );
}

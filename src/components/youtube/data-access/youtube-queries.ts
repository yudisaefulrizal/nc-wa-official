// Seluruh SQL YouTube: kepemilikan akun selalu menjadi bagian query yang dipanggil dari API.
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export const list = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>(
    'SELECT channel_id,name,avatar,permissions FROM youtube_connections WHERE account_id=? ORDER BY name',
    p,
  );
export const connection = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>('SELECT * FROM youtube_connections WHERE account_id=? AND channel_id=?', p);
export const owner = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>('SELECT account_id FROM youtube_connections WHERE channel_id=?', p);
export const save = (c: Executor, p: SqlValue[]) =>
  c.execute(
    `INSERT INTO youtube_connections(account_id,channel_id,name,avatar,access_token,refresh_token,permissions,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE name=IF(account_id=VALUES(account_id),VALUES(name),name),avatar=IF(account_id=VALUES(account_id),VALUES(avatar),avatar),access_token=IF(account_id=VALUES(account_id),VALUES(access_token),access_token),refresh_token=IF(account_id=VALUES(account_id),VALUES(refresh_token),refresh_token),permissions=IF(account_id=VALUES(account_id),VALUES(permissions),permissions),expires_at=IF(account_id=VALUES(account_id),VALUES(expires_at),expires_at),checked_at=IF(account_id=VALUES(account_id),UTC_TIMESTAMP(),checked_at)`,
    p,
  );
export const token = (c: Executor, p: SqlValue[]) =>
  c.execute(
    'UPDATE youtube_connections SET access_token=?,expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND),checked_at=UTC_TIMESTAMP() WHERE account_id=? AND channel_id=?',
    p,
  );
export const profile = (c: Executor, p: SqlValue[]) =>
  c.execute(
    'UPDATE youtube_connections SET name=?,avatar=?,checked_at=UTC_TIMESTAMP() WHERE account_id=? AND channel_id=?',
    p,
  );
export const remove = (c: Executor, p: SqlValue[]) =>
  c.execute('DELETE FROM youtube_connections WHERE account_id=? AND channel_id=?', p);
export const deletePosts = (c: Executor, p: SqlValue[]) =>
  c.execute('DELETE FROM youtube_posts WHERE account_id=? AND channel_id=?', p);
export const expiredStates = (c: Executor) =>
  c.execute('DELETE FROM youtube_oauth_states WHERE expires_at<UTC_TIMESTAMP()');
export const state = (c: Executor, p: SqlValue[]) =>
  c.execute('INSERT INTO youtube_oauth_states VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE))', p);
export const lockState = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>(
    'SELECT * FROM youtube_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',
    p,
  );
export const removeState = (c: Executor, p: SqlValue[]) =>
  c.execute('DELETE FROM youtube_oauth_states WHERE state_hash=?', p);
export const post = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>('SELECT * FROM youtube_posts WHERE account_id=? AND request_id=?', p);
export const insertPost = (c: Executor, p: SqlValue[]) =>
  c.execute(
    'INSERT INTO youtube_posts(id,account_id,channel_id,request_id,input_hash,payload) VALUES (?,?,?,?,?,?)',
    p,
  );
export const posts = (c: Executor, p: SqlValue[]) =>
  c.execute<RowDataPacket[]>(
    'SELECT p.*,c.name FROM youtube_posts p LEFT JOIN youtube_connections c ON c.account_id=p.account_id AND c.channel_id=p.channel_id WHERE p.account_id=? ORDER BY p.created_at DESC LIMIT 100',
    p,
  );
export const queued = (c: Executor) =>
  c.execute<RowDataPacket[]>(
    "SELECT * FROM youtube_posts WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
export const claim = (c: Executor, p: SqlValue[]) =>
  c.execute<ResultSetHeader>(
    "UPDATE youtube_posts SET status='uploading',error=NULL WHERE id=? AND status='queued'",
    p,
  );
export const session = (c: Executor, p: SqlValue[]) =>
  c.execute('UPDATE youtube_posts SET upload_session=?,upload_size=? WHERE id=?', p);
export const finish = (c: Executor, p: SqlValue[]) =>
  c.execute('UPDATE youtube_posts SET status=?,video_id=?,error=? WHERE id=?', p);
export const interrupted = (c: Executor) =>
  c.execute(
    "UPDATE youtube_posts SET status='unknown',error='Server terhenti saat unggahan; periksa status sebelum mengirim ulang.' WHERE status='uploading'",
  );
export const allConnections = (c: Executor) =>
  c.execute<RowDataPacket[]>(
    'SELECT account_id,channel_id FROM youtube_connections WHERE checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)',
  );
export const expirePosts = (c: Executor) =>
  c.execute(
    "DELETE FROM youtube_posts WHERE updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) AND status NOT IN ('queued','uploading')",
  );

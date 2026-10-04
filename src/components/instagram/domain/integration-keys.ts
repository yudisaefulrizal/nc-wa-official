// Key untuk aplikasi lain yang memakai akun Instagram yang sudah terhubung di sini. Tiap key punya scope,
// ditampilkan sekali saat dibuat, dan hanya hash-nya yang disimpan.
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import * as integrationKeysSql from '../data-access/integration-keys-queries.js';

export const keyScopes = [
  'accounts:read',
  'messages:read',
  'messages:send',
  'comments:read',
  'comments:write',
  'posts:publish',
  'insights:read',
] as const;
export type KeyScope = (typeof keyScopes)[number];
const keyPrefix = 'ncig_';
const maxKeys = 10;

export async function createIntegrationKey(account: string, body: unknown) {
  const input = object(body),
    name = requiredString(input.name, 'Nama key', 60).trim();
  const scopes = Array.isArray(input.scopes) ? [...new Set(input.scopes)] : [];
  if (!scopes.length || scopes.some(s => !keyScopes.includes(s as KeyScope)))
    throw new ApiError(400, 'invalid_scopes', 'Pilih minimal satu izin yang valid');
  const [[count]] = await integrationKeysSql.countByAccount(db, [account]);
  if (Number(count?.n ?? 0) >= maxKeys)
    throw new ApiError(409, 'key_limit', 'Maksimal ' + maxKeys + ' key aktif per akun');
  const key = keyPrefix + randomBytes(32).toString('hex'),
    id = randomUUID();
  await integrationKeysSql.insert(db, [id, account, name, digest(key), key.slice(-4), scopes.join(',')]);
  return { id, name, key, scopes };
}
export async function listIntegrationKeys(account: string) {
  const [rows] = await integrationKeysSql.listByAccount(db, [account]);
  return rows.map(row => ({
    id: String(row.id),
    name: String(row.name),
    hint: String(row.key_hint),
    scopes: String(row.scopes).split(','),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));
}
export async function revokeIntegrationKey(account: string, id: string) {
  const [result] = await integrationKeysSql.deleteOwned(db, [account, id]);
  if (!result.affectedRows) throw new ApiError(404, 'key_not_found', 'Key tidak ditemukan');
  return { ok: true };
}
// Mengembalikan akun dan scope pemilik key, atau undefined bila key tidak dikenal.
export async function authenticateIntegrationKey(raw: string) {
  if (!raw.startsWith(keyPrefix) || raw.length > 128) return undefined;
  const [rows] = await integrationKeysSql.findByHash(db, [digest(raw)]);
  const row = rows[0];
  if (!row) return undefined;
  // Waktu terakhir dipakai cukup kasar (semenit), supaya setiap request tidak menulis ke database.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60000)
    await integrationKeysSql.touch(db, [row.id]);
  return { id: String(row.id), account: String(row.account_id), scopes: String(row.scopes).split(',') as KeyScope[] };
}

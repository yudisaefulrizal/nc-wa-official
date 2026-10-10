// Daftar, perpanjangan, dan pencabutan koneksi TikTok milik tenant yang sedang login.
import { db } from '../../../libraries/db.js';
import { basicWallet } from '../../billing/index.js';
import { decrypt, encrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import * as connectionsSql from '../data-access/connections-queries.js';
import { settings, requestTikTok, tokenRequest, validateToken, failed } from './client.js';

export async function listConnections(account: string) {
  const [rows] = await connectionsSql.list(db, [account]);
  const wallet = await basicWallet(account);
  return rows.map((row, index) => ({
    serviceActive: index < wallet.session_limit,
    id: row.open_id,
    name: row.display_name,
    scopes: row.permissions.split(','),
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    status:
      new Date(row.refresh_expires_at).getTime() <= Date.now()
        ? 'expired'
        : new Date(row.expires_at).getTime() <= Date.now()
          ? 'needs_refresh'
          : 'active',
  }));
}
// Penguncian menyerialkan refresh dan revoke karena refresh token TikTok dapat berubah setelah digunakan.
export async function refreshConnection(account: string, id: string) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await connectionsSql.lock(c, [account, id]);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'Koneksi TikTok tidak ditemukan');
    if (new Date(row.refresh_expires_at).getTime() <= Date.now())
      throw new ApiError(409, 'tiktok_expired', 'Izin TikTok berakhir; hubungkan ulang akun');
    const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token) });
    validateToken(token);
    if (token.open_id !== id) throw failed();
    await connectionsSql.updateOwned(c, [
      row.display_name,
      row.avatar_url,
      encrypt(token.access_token),
      encrypt(token.refresh_token),
      token.scope,
      token.expires_in,
      token.refresh_expires_in,
      account,
      id,
    ]);
    await c.commit();
    return { ok: true };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function disconnectConnection(account: string, id: string) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await connectionsSql.lock(c, [account, id]);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'Koneksi TikTok tidak ditemukan');
    let revoked = false;
    try {
      const { key, secret } = settings();
      await requestTikTok('/v2/oauth/revoke/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: key,
          client_secret: secret,
          token: decrypt(row.access_token),
        }).toString(),
      });
      revoked = true;
    } catch {
      // Token yang sudah tidak berlaku atau gangguan TikTok tidak boleh menghalangi penghapusan data lokal.
    }
    await connectionsSql.deleteOwned(c, [account, id]);
    await c.commit();
    return { ok: true, revoked };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

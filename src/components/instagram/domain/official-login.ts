// Instagram Login resmi (Business Login for Instagram): klien memberi izin langsung di instagram.com, NC-WA
// menukar kodenya menjadi token 60 hari, menyimpannya terenkripsi, dan memperpanjangnya sebelum habis. Pemilik akun
// dikenali dari `state` yang dibuat server saat tombol ditekan, bukan dari cookie saat callback.
// Alur mengikuti prototipe NC-IG. Referensi: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { decrypt, encrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import { digest } from '../../../libraries/security.js';
import * as officialSql from '../data-access/official-queries.js';

const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
// Alamat Meta bisa diganti lewat env hanya agar tes memakai server tiruan (seperti ZERNIO_API_URL).
const urls = () => ({
  authorize: process.env.INSTAGRAM_AUTHORIZE_URL ?? 'https://www.instagram.com/oauth/authorize',
  token: process.env.INSTAGRAM_TOKEN_URL ?? 'https://api.instagram.com/oauth/access_token',
  graph: process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com',
});
const TIMEOUT = () => AbortSignal.timeout(15000);
function settings() {
  const id = process.env.INSTAGRAM_APP_ID,
    secret = process.env.INSTAGRAM_APP_SECRET;
  if (!id || !secret)
    throw new ApiError(503, 'instagram_not_configured', 'Instagram Login belum dikonfigurasi di server');
  return { id, secret, redirect: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069') + '/auth/instagram/callback' };
}
async function graph(response: Response, what: string) {
  if (!response.ok) {
    // Isi respons Meta tidak dicatat: bisa memuat token atau data akun.
    log('instagram-official', what + ' ditolak Meta (' + response.status + ')');
    throw new ApiError(502, 'instagram_login_failed', 'Instagram menolak permintaan; coba hubungkan lagi');
  }
  return (await response.json()) as Record<string, unknown>;
}
// Membuat state sekali pakai untuk akun ini, lalu mengembalikan alamat izin di instagram.com.
export async function startLogin(account: string) {
  const { id, redirect } = settings();
  const state = randomBytes(24).toString('hex');
  await officialSql.deleteExpiredStates(db);
  await officialSql.saveState(db, [digest(state), account]);
  const url = new URL(urls().authorize);
  url.searchParams.set('client_id', id);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', state);
  return { url: url.toString() };
}
async function consumeState(state: string) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await officialSql.takeState(connection, [digest(state)]);
    if (rows[0]) await officialSql.deleteState(connection, [digest(state)]);
    await connection.commit();
    return rows[0]?.account_id as string | undefined;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
// Callback dari Instagram. `result` adalah kode untuk halaman Integrasi: connected, cancelled, in_use, atau error;
// akun dan ID Instagram diisi bila login berhasil supaya pemanggil bisa memasang sesinya.
export async function finishLogin(query: Record<string, unknown>): Promise<{
  result: string;
  account?: string;
  igUser?: string;
}> {
  const state = typeof query.state === 'string' ? query.state : '';
  const account = state ? await consumeState(state) : undefined;
  if (!account) return { result: 'error' };
  if (typeof query.error === 'string') return { result: 'cancelled' };
  if (typeof query.code !== 'string' || !query.code) return { result: 'error' };
  const { id, secret, redirect } = settings();
  const short = await graph(
    await fetch(urls().token, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'authorization_code',
        redirect_uri: redirect,
        code: query.code.replace(/#_$/, ''),
      }),
      signal: TIMEOUT(),
    }),
    'Tukar kode',
  );
  const long = await graph(
    await fetch(
      urls().graph +
        '/access_token?' +
        new URLSearchParams({
          grant_type: 'ig_exchange_token',
          client_secret: secret,
          access_token: String(short.access_token),
        }),
      { signal: TIMEOUT() },
    ),
    'Tukar token panjang',
  );
  const token = String(long.access_token),
    lifetime = Number(long.expires_in) || 5184000;
  const profile = await graph(
    await fetch(
      urls().graph + '/me?' + new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token }),
      { signal: TIMEOUT() },
    ),
    'Baca profil',
  );
  const igUser = String(profile.user_id ?? short.user_id ?? '');
  if (!/^[0-9]{3,32}$/.test(igUser))
    throw new ApiError(502, 'instagram_login_failed', 'Profil Instagram tidak terbaca');
  const [owner] = await officialSql.findByUser(db, [igUser]);
  if (owner[0] && owner[0].account_id !== account) return { result: 'in_use' };
  const permissions = Array.isArray(short.permissions) ? short.permissions.join(',') : String(short.permissions ?? '');
  await officialSql.upsert(db, [
    account,
    igUser,
    String(profile.username ?? '').slice(0, 100),
    String(profile.account_type ?? '').slice(0, 30),
    encrypt(token),
    permissions.slice(0, 500),
    lifetime,
  ]);
  return { result: 'connected', account, igUser };
}
export type OfficialStatus = 'active' | 'expiring' | 'expired' | 'revoked';
export async function listOfficial(account: string) {
  const [rows] = await officialSql.listByAccount(db, [account]);
  return rows.map(r => {
    const ms = r.expires_at ? new Date(r.expires_at).getTime() - Date.now() : 0,
      left = Math.ceil(ms / 86400000);
    const status: OfficialStatus =
      r.status === 'revoked' ? 'revoked' : ms <= 0 ? 'expired' : left <= 7 ? 'expiring' : 'active';
    return {
      id: r.ig_user_id as string,
      username: r.username as string,
      accountType: r.account_type as string,
      permissions: String(r.permissions).split(',').filter(Boolean),
      status,
      daysLeft: Math.max(left, 0),
      session: (r.session_id as string | null) ?? null,
    };
  });
}
// Perpanjang manual atau otomatis: token harus masih berlaku dan berumur lebih dari 24 jam.
async function refreshToken(token: string) {
  const data = await graph(
    await fetch(
      urls().graph +
        '/refresh_access_token?' +
        new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }),
      { signal: TIMEOUT() },
    ),
    'Perpanjang token',
  );
  return { token: String(data.access_token), lifetime: Number(data.expires_in) || 5184000 };
}
export async function refreshOfficial(account: string, igUser: string) {
  const [rows] = await officialSql.findOwned(db, [account, igUser]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ditemukan');
  if (row.status === 'revoked' || !row.token || new Date(row.expires_at).getTime() < Date.now())
    throw new ApiError(409, 'instagram_reauth', 'Izin sudah berakhir; hubungkan Instagram lagi');
  const next = await refreshToken(decrypt(row.token));
  await officialSql.updateToken(db, [encrypt(next.token), next.lifetime, account, igUser]);
  return { message: '@' + row.username + ' diperpanjang.' };
}
// Dipanggil berkala oleh server: memperpanjang token yang hampir habis. Kegagalan satu akun tidak menghentikan yang lain.
export async function refreshExpiring() {
  const [rows] = await officialSql.listRefreshable(db);
  for (const row of rows)
    try {
      const next = await refreshToken(decrypt(row.token));
      await officialSql.updateToken(db, [encrypt(next.token), next.lifetime, row.account_id, row.ig_user_id]);
    } catch {
      log('instagram-official', 'Perpanjangan token ' + row.ig_user_id + ' gagal');
    }
}
export async function disconnectOfficial(account: string, igUser: string) {
  const [result] = await officialSql.deleteOwned(db, [account, igUser]);
  if (!result.affectedRows) throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ditemukan');
  return { message: 'Instagram diputus.' };
}
// signed_request dari Meta: "<tanda tangan>.<payload>" base64url, ditandatangani HMAC-SHA256 dengan App Secret.
export function verifySignedRequest(value: unknown): { user_id: string } | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const decode = (v: string) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try {
    const expected = createHmac('sha256', settings().secret).update(parts[1]).digest(),
      given = decode(parts[0]);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(decode(parts[1]).toString('utf8'));
    return payload.algorithm === 'HMAC-SHA256' && /^[0-9]{3,32}$/.test(String(payload.user_id))
      ? { user_id: String(payload.user_id) }
      : null;
  } catch {
    return null;
  }
}
export async function deauthorized(igUser: string) {
  await officialSql.markRevoked(db, [igUser]);
}
export async function deleteData(igUser: string) {
  await officialSql.deleteByUser(db, [igUser]);
  return randomBytes(8).toString('hex');
}

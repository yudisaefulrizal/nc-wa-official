// Login YouTube memakai state sekali pakai yang terikat browser dan PKCE; koneksi dikelola per akun NC-WA.
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { encrypt, decrypt } from '../../../libraries/crypto.js';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import * as sql from '../data-access/youtube-queries.js';
import { settings, urls, scopes, tokenRequest, requestApi } from './client.js';
export async function startLogin(account: string) {
  const { id, redirect } = settings();
  encrypt('youtube-config-check');
  const state = randomBytes(32).toString('hex'),
    browser = randomBytes(32).toString('hex'),
    verifier = randomBytes(32).toString('base64url');
  await sql.expiredStates(db);
  await sql.state(db, [digest(state), digest(browser), encrypt(verifier), account]);
  const url = new URL(urls().authorize);
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), browser };
}
export async function finishLogin(query: Record<string, unknown>, browser: string) {
  if (typeof query.state !== 'string' || !/^[a-f0-9]{64}$/.test(query.state) || !/^[a-f0-9]{64}$/.test(browser))
    return 'error';
  const c = await db.getConnection();
  let state;
  try {
    await c.beginTransaction();
    const [rows] = await sql.lockState(c, [digest(query.state), digest(browser)]);
    state = rows[0];
    if (state) await sql.removeState(c, [digest(query.state)]);
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
  if (!state) return 'error';
  if (query.error) return 'cancelled';
  if (typeof query.code !== 'string' || query.code.length > 4096) return 'error';
  const token = await tokenRequest({
    code: query.code,
    code_verifier: decrypt(state.verifier),
    grant_type: 'authorization_code',
    redirect_uri: settings().redirect,
  });
  if (
    !scopes.every(scope =>
      String(token.scope ?? '')
        .split(' ')
        .includes(scope),
    )
  )
    return 'permissions';
  const channels = await requestApi('/channels?part=snippet&mine=true', token.access_token);
  const channel = channels.items?.[0];
  if (!channel || typeof channel.id !== 'string' || !/^UC[-\w]{22}$/.test(channel.id)) return 'no_channel';
  const account = String(state.account_id);
  const [owner] = await sql.owner(db, [channel.id]);
  if (owner[0] && owner[0].account_id !== account) return 'in_use';
  const [previous] = await sql.connection(db, [account, channel.id]);
  const refresh =
    typeof token.refresh_token === 'string'
      ? token.refresh_token
      : previous[0]?.refresh_token
        ? decrypt(previous[0].refresh_token)
        : null;
  if (!refresh) return 'offline';
  await sql.save(db, [
    account,
    channel.id,
    String(channel.snippet?.title ?? '').slice(0, 200),
    String(channel.snippet?.thumbnails?.default?.url ?? ''),
    encrypt(token.access_token),
    encrypt(refresh),
    String(token.scope).slice(0, 1000),
    Number(token.expires_in),
  ]);
  const [saved] = await sql.owner(db, [channel.id]);
  return saved[0]?.account_id === account ? 'connected' : 'in_use';
}
export async function listConnections(account: string) {
  const [rows] = await sql.list(db, [account]);
  return rows.map(r => ({
    id: String(r.channel_id),
    name: String(r.name),
    username: String(r.name),
    avatar: String(r.avatar),
    status: 'active',
    platform: 'youtube',
    permissions: String(r.permissions).split(' '),
  }));
}
export async function accessToken(account: string, channel: string) {
  const [rows] = await sql.connection(db, [account, channel]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'youtube_not_found', 'Channel YouTube tidak ditemukan');
  if (new Date(row.expires_at).getTime() > Date.now() + 60000) return decrypt(row.access_token);
  try {
    const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token) });
    await sql.token(db, [encrypt(next.access_token), Number(next.expires_in), account, channel]);
    return next.access_token as string;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'youtube_reauth') {
      await purge(account, channel);
    }
    throw error;
  }
}
async function purge(account: string, channel: string) {
  await sql.deletePosts(db, [account, channel]);
  await sql.remove(db, [account, channel]);
}
export async function refreshConnection(account: string, channel: string) {
  const token = await accessToken(account, channel);
  const data = await requestApi('/channels?part=snippet&mine=true', token);
  const row = data.items?.find((r: any) => r.id === channel);
  if (!row) throw new ApiError(409, 'youtube_reauth', 'Channel tujuan tidak sesuai; hubungkan ulang.');
  await sql.profile(db, [
    String(row.snippet?.title ?? '').slice(0, 200),
    String(row.snippet?.thumbnails?.default?.url ?? ''),
    account,
    channel,
  ]);
  return { message: 'Channel YouTube diperbarui.' };
}
export async function disconnect(account: string, channel: string) {
  const [rows] = await sql.connection(db, [account, channel]);
  if (!rows[0]) throw new ApiError(404, 'youtube_not_found', 'Channel tidak ditemukan');
  const response = await fetch(urls().revoke, {
    method: 'POST',
    body: new URLSearchParams({ token: decrypt(rows[0].refresh_token) }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok && response.status !== 400)
    throw new ApiError(502, 'youtube_failed', 'Pencabutan izin Google gagal; coba lagi.');
  await purge(account, channel);
  return { message: 'Akses YouTube dicabut dan data koneksi serta publikasinya dihapus.' };
}
export async function refreshConnections() {
  const [rows] = await sql.allConnections(db);
  for (const r of rows)
    try {
      await refreshConnection(r.account_id, r.channel_id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'youtube_reauth') await purge(r.account_id, r.channel_id);
      console.error('Pemeriksaan koneksi YouTube gagal.');
    }
  await sql.expirePosts(db);
}

// Login Kit TikTok: state sekali pakai dan cookie browser mencegah pemalsuan callback dan pertukaran akun.
// Token akses serta refresh token hanya disimpan terenkripsi di server.
import { randomBytes } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { encrypt } from '../../../libraries/crypto.js';
import { digest } from '../../../libraries/security.js';
import { ensureBasic, assertSessionSlot } from '../../billing/index.js';
import type { SessionManager } from '../../whatsapp/index.js';
import { ApiError } from '../../../libraries/errors.js';
import * as statesSql from '../data-access/oauth-states-queries.js';
import * as connectionsSql from '../data-access/connections-queries.js';
import { settings, authorizeUrl, requestTikTok, tokenRequest, validateToken, failed } from './client.js';

export async function startLogin(account: string) {
  const { key, redirect } = settings();
  // Memastikan kunci enkripsi tersedia sebelum pengguna diarahkan ke TikTok.
  encrypt('tiktok-configuration-check');
  const state = randomBytes(32).toString('hex'),
    browser = randomBytes(32).toString('hex');
  await statesSql.deleteExpired(db);
  await statesSql.insert(db, [digest(state), digest(browser), account]);
  const url = new URL(authorizeUrl());
  url.search = new URLSearchParams({
    client_key: key,
    response_type: 'code',
    redirect_uri: redirect,
    scope: 'user.info.basic,video.publish,video.upload',
    state,
    disable_auto_auth: '1',
  }).toString();
  return { url: url.toString(), browser };
}
async function consumeState(state: string, browser: string) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser)) return undefined;
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await statesSql.lock(c, [digest(state), digest(browser)]);
    if (rows[0]) await statesSql.deleteByHash(c, [digest(state)]);
    await c.commit();
    return rows[0]?.account_id as string | undefined;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function finishLogin(
  query: Record<string, unknown>,
  browser: string,
  managerFor: (account: string) => Promise<SessionManager>,
) {
  const account = await consumeState(typeof query.state === 'string' ? query.state : '', browser);
  if (!account) return 'error';
  if (query.error === 'access_denied') return 'cancelled';
  if (query.error || typeof query.code !== 'string' || !query.code || query.code.length > 4096) return 'error';
  const token = await tokenRequest({
    code: query.code,
    grant_type: 'authorization_code',
    redirect_uri: settings().redirect,
  });
  validateToken(token);
  const profile = await requestTikTok('/v2/user/info/?fields=open_id,display_name,avatar_url', {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });
  const user = profile.data?.user;
  if (
    !user ||
    user.open_id !== token.open_id ||
    typeof user.display_name !== 'string' ||
    user.display_name.length > 200 ||
    typeof user.avatar_url !== 'string'
  )
    throw failed();
  const values = [
    user.display_name,
    user.avatar_url,
    encrypt(token.access_token),
    encrypt(token.refresh_token),
    token.scope,
    token.expires_in,
    token.refresh_expires_in,
  ];
  // Memuat manager sebelum mengambil kunci akun: pemulihan manager juga membaca wallet.
  const manager = await managerFor(account);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await ensureBasic(c, account);
    const [owners] = await connectionsSql.findOwner(c, [token.open_id]);
    if (owners[0]) {
      if (owners[0].account_id !== account) {
        await c.rollback();
        return 'in_use';
      }
      // Reconnect memakai slot yang sama, termasuk ketika kuota sudah penuh.
      await connectionsSql.updateOwned(c, [...values, account, token.open_id]);
    } else {
      await assertSessionSlot(c, account, manager);
      await connectionsSql.insert(c, [account, token.open_id, ...values]);
    }
    await c.commit();
    return 'connected';
  } catch (error) {
    await c.rollback();
    if (error instanceof ApiError && error.code === 'session_limit') return 'no_slot';
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return 'in_use';
    throw error;
  } finally {
    c.release();
  }
}

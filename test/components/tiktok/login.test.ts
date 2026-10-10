// Tes Login Kit dengan TikTok tiruan: callback terikat browser, isolasi tenant, enkripsi, refresh, dan revoke.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { basicWallet } from '../../../src/components/billing/index.js';
import { encrypt, decrypt } from '../../../src/libraries/crypto.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import { migrateTikTok } from '../../../src/components/tiktok/index.js';

process.env.TIKTOK_CLIENT_KEY = 'test-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-secret';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069';
const accounts = [randomUUID(), randomUUID()],
  sessions = [randomUUID(), randomUUID()];
const sessionCookie = (i: number) => 'ncwa_session=' + sessions[i];
let exchanges = 0,
  refreshes = 0,
  revokes = 0,
  badRefresh = false,
  badRevoke = false;
const provider = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://tiktok.test');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const form = new URLSearchParams(raw);
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/v2/oauth/token/') {
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(form.get('client_key'), 'test-key');
    assert.equal(form.get('client_secret'), 'test-secret');
    const refresh = form.get('grant_type') === 'refresh_token';
    if (refresh) refreshes++;
    else {
      exchanges++;
      assert.equal(form.get('redirect_uri'), origin + '/auth/tiktok/callback');
    }
    const code = form.get('code') ?? 'main';
    if (code === 'provider-error') return void res.end(JSON.stringify({ error: 'invalid_grant' }));
    const id = code.startsWith('slot-') ? code : code === 'partial' ? 'partial-user' : 'main-user';
    return void res.end(
      JSON.stringify({
        open_id: refresh && badRefresh ? 'wrong-user' : id,
        access_token: refresh ? 'rotated-access' : 'access-' + id,
        refresh_token: refresh ? 'rotated-refresh' : 'refresh-secret',
        scope: code === 'partial' ? 'user.info.basic' : 'user.info.basic,video.publish,video.upload',
        expires_in: 86400,
        refresh_expires_in: 31536000,
      }),
    );
  }
  if (url.pathname === '/v2/user/info/') {
    assert.equal(url.searchParams.get('fields'), 'open_id,display_name,avatar_url');
    const id = req.headers.authorization?.replace('Bearer access-', '');
    return void res.end(
      JSON.stringify({
        data: {
          user: { open_id: id, display_name: 'Kreator <uji>', avatar_url: 'https://example.invalid/avatar.png' },
        },
        error: { code: 'ok' },
      }),
    );
  }
  if (url.pathname === '/v2/oauth/revoke/') {
    revokes++;
    assert.equal(form.get('client_secret'), 'test-secret');
    res.statusCode = badRevoke ? 503 : 200;
    return void res.end('{}');
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.TIKTOK_API_URL = 'http://127.0.0.1:' + (provider.address() as AddressInfo).port;
process.env.TIKTOK_AUTHORIZE_URL = process.env.TIKTOK_API_URL + '/authorize';
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-tiktok-test');
const app = createApp(gateway);

before(async () => {
  await migrateTikTok();
  await migrateTikTok();
  for (const [i, account] of accounts.entries()) {
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      account,
      account + '@test.invalid',
      'unused',
    ]);
    await basicWallet(account);
    await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [account]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))', [
      digest(sessions[i]),
      account,
    ]);
  }
});
after(async () => {
  for (const account of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await gateway.stop();
  await db.end();
});
async function start(i = 0) {
  const response = await request(app).post('/api/tiktok/start').set('Cookie', sessionCookie(i)).set('Origin', origin);
  assert.equal(response.status, 200);
  const url = new URL(response.body.url),
    state = url.searchParams.get('state')!;
  const setCookie = response.headers['set-cookie'][0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/auth\/tiktok\/callback/);
  assert.equal(url.searchParams.get('client_key'), 'test-key');
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
  assert.equal(url.searchParams.get('redirect_uri'), origin + '/auth/tiktok/callback');
  assert.equal(url.searchParams.has('client_secret'), false);
  const cookie = setCookie.split(';')[0];
  return { state, cookie };
}
async function finish(flow: { state: string; cookie: string }, code = 'main') {
  return request(app).get('/auth/tiktok/callback').set('Cookie', flow.cookie).query({ state: flow.state, code });
}
const endpoint = '/api/tiktok/connections/main-user';

test('API membutuhkan sesi dan Origin; kredensial kosong menolak login tanpa state baru', async () => {
  assert.equal((await request(app).get('/api/tiktok/connections')).status, 401);
  assert.equal((await request(app).post('/api/tiktok/start').set('Cookie', sessionCookie(0))).status, 403);
  const key = process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_KEY;
  try {
    const response = await request(app).post('/api/tiktok/start').set('Cookie', sessionCookie(0)).set('Origin', origin);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'tiktok_not_configured');
  } finally {
    process.env.TIKTOK_CLIENT_KEY = key;
  }
});
test('state salah, cookie browser salah, dan state kedaluwarsa tidak menukar kode', async () => {
  const flow = await start(),
    count = exchanges;
  assert.match((await finish({ ...flow, state: 'a'.repeat(64) })).headers.location, /tiktok=error$/);
  assert.match(
    (await finish({ ...flow, cookie: 'ncwa_tiktok_oauth=' + 'b'.repeat(64) })).headers.location,
    /tiktok=error$/,
  );
  assert.match(
    (await request(app).get('/auth/tiktok/callback').query({ state: flow.state, code: 'main' })).headers.location,
    /tiktok=error$/,
  );
  await db.execute('UPDATE tiktok_oauth_states SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE state_hash=?', [
    digest(flow.state),
  ]);
  assert.match((await finish(flow)).headers.location, /tiktok=error$/);
  assert.equal(exchanges, count);
});
test('pembatalan mengonsumsi state tanpa menyimpan koneksi', async () => {
  const flow = await start(),
    count = exchanges;
  const response = await request(app)
    .get('/auth/tiktok/callback')
    .set('Cookie', flow.cookie)
    .query({ state: flow.state, error: 'access_denied' });
  assert.match(response.headers.location, /tiktok=cancelled$/);
  assert.match((await finish(flow)).headers.location, /tiktok=error$/);
  assert.equal(exchanges, count);
});
test('login menyimpan token terenkripsi, state tidak bisa dipakai ulang, daftar tidak membocorkan token', async () => {
  const flow = await start();
  const response = await finish(flow);
  assert.match(response.headers.location, /tiktok=connected$/);
  assert.equal(response.headers['cache-control'], 'no-store');
  const count = exchanges;
  assert.match((await finish(flow)).headers.location, /tiktok=error$/);
  assert.equal(exchanges, count);
  const [rows] = await db.execute<any[]>(
    'SELECT access_token,refresh_token FROM tiktok_connections WHERE account_id=?',
    [accounts[0]],
  );
  assert.equal(decrypt(rows[0].access_token), 'access-main-user');
  assert.equal(decrypt(rows[0].refresh_token), 'refresh-secret');
  assert.notEqual(rows[0].access_token, 'access-main-user');
  const list = await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0));
  assert.equal(list.body[0].name, 'Kreator <uji>');
  assert.equal(list.body[0].status, 'active');
  assert.equal(/access_token|refresh_token|access-main-user|refresh-secret/.test(list.text), false);
  const stateRows = await db.execute<any[]>('SELECT * FROM tiktok_oauth_states WHERE state_hash=?', [
    digest(flow.state),
  ]);
  assert.equal(stateRows[0].length, 0);
});
test('akun NC-WA lain tidak dapat mengambil alih, melihat, refresh, atau memutus koneksi', async () => {
  assert.match((await finish(await start(1))).headers.location, /tiktok=in_use$/);
  assert.deepEqual((await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(1))).body, []);
  assert.equal(
    (
      await request(app)
        .post(endpoint + '/refresh')
        .set('Cookie', sessionCookie(1))
        .set('Origin', origin)
    ).status,
    404,
  );
  assert.equal((await request(app).delete(endpoint).set('Cookie', sessionCookie(1)).set('Origin', origin)).status, 404);
});
test('izin posting dapat ditolak pengguna tanpa salah menandai koneksi sebagai berizin posting', async () => {
  assert.match((await finish(await start(), 'partial')).headers.location, /tiktok=connected$/);
  const list = await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0));
  assert.deepEqual(list.body.find((row: { id: string }) => row.id === 'partial-user').scopes, ['user.info.basic']);
});
test('error provider diarahkan ke pesan aman dan state tidak dapat dicoba ulang', async () => {
  const flow = await start();
  assert.match((await finish(flow, 'provider-error')).headers.location, /tiktok=error$/);
  assert.match((await finish(flow)).headers.location, /tiktok=error$/);
});
test('refresh mengganti kedua token dan menolak identitas provider yang berbeda', async () => {
  const response = await request(app)
    .post(endpoint + '/refresh')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin);
  assert.equal(response.status, 200);
  assert.equal(refreshes, 1);
  const [rows] = await db.execute<any[]>(
    'SELECT access_token,refresh_token FROM tiktok_connections WHERE account_id=? AND open_id=?',
    [accounts[0], 'main-user'],
  );
  assert.equal(decrypt(rows[0].access_token), 'rotated-access');
  assert.equal(decrypt(rows[0].refresh_token), 'rotated-refresh');
  badRefresh = true;
  try {
    assert.equal(
      (
        await request(app)
          .post(endpoint + '/refresh')
          .set('Cookie', sessionCookie(0))
          .set('Origin', origin)
      ).status,
      502,
    );
  } finally {
    badRefresh = false;
  }
});
test('refresh token kedaluwarsa meminta pengguna menghubungkan ulang', async () => {
  await db.execute(
    'UPDATE tiktok_connections SET refresh_expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE account_id=? AND open_id=?',
    [accounts[0], 'main-user'],
  );
  const response = await request(app)
    .post(endpoint + '/refresh')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin);
  assert.equal(response.status, 409);
  const list = await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0));
  assert.equal(list.body.find((row: { id: string }) => row.id === 'main-user').status, 'expired');
});
test('reconnect memperbarui koneksi sendiri; putus koneksi mencabut akses dan menghapus token', async () => {
  assert.match((await finish(await start())).headers.location, /tiktok=connected$/);
  const response = await request(app).delete(endpoint).set('Cookie', sessionCookie(0)).set('Origin', origin);
  assert.equal(response.status, 200);
  assert.equal(response.body.revoked, true);
  assert.equal(revokes, 1);
  const [rows] = await db.execute<any[]>('SELECT * FROM tiktok_connections WHERE account_id=? AND open_id=?', [
    accounts[0],
    'main-user',
  ]);
  assert.equal(rows.length, 0);
});
test('gangguan revoke TikTok tetap menghapus data lokal dan mengembalikan status revoke yang jujur', async () => {
  badRevoke = true;
  try {
    const response = await request(app)
      .delete('/api/tiktok/connections/partial-user')
      .set('Cookie', sessionCookie(0))
      .set('Origin', origin);
    assert.equal(response.status, 200);
    assert.equal(response.body.revoked, false);
    assert.deepEqual((await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0))).body, []);
  } finally {
    badRevoke = false;
  }
});

test('TikTok memakai satu slot bersama WhatsApp dan Instagram; reconnect tidak menambah slot', async () => {
  await db.execute('UPDATE wallets SET session_limit=1 WHERE account_id=?', [accounts[0]]);
  assert.match((await finish(await start(), 'slot-first')).headers.location, /tiktok=connected$/);
  const wallet = await request(app).get('/api/wallet').set('Cookie', sessionCookie(0));
  assert.equal(wallet.body.chat_session_limit, 0);
  assert.match((await finish(await start(), 'slot-second')).headers.location, /tiktok=no_slot$/);
  const wa = await request(app)
    .post('/sessions')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin)
    .send({ id: 'quota-wa' });
  assert.equal(wa.status, 409);
  assert.equal(wa.body.error, 'session_limit');
  await db.execute(
    "INSERT INTO instagram_official(account_id,ig_user_id,username,token,status,expires_at) VALUES (?,?,?,?,'active',DATE_ADD(NOW(),INTERVAL 1 DAY))",
    [accounts[0], 'quota-ig', 'quota-ig', encrypt('test-ig-token')],
  );
  const ig = await request(app)
    .post('/api/instagram/official/quota-ig/session')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin);
  assert.equal(ig.status, 409);
  assert.equal(ig.body.error, 'session_limit');
  assert.match((await finish(await start(), 'slot-first')).headers.location, /tiktok=connected$/);
  const [rows] = await db.execute<any[]>('SELECT COUNT(*) AS used FROM tiktok_connections WHERE account_id=?', [
    accounts[0],
  ]);
  assert.equal(rows[0].used, 1);
  await request(app)
    .delete('/api/tiktok/connections/slot-first')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin)
    .expect(200);
  const free = await request(app).get('/api/wallet').set('Cookie', sessionCookie(0));
  assert.equal(free.body.chat_session_limit, 1);
  await request(app)
    .post('/sessions')
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin)
    .send({ id: 'quota-wa' })
    .expect(200);
  assert.match((await finish(await start(), 'slot-third')).headers.location, /tiktok=no_slot$/);
  await request(app).delete('/sessions/quota-wa').set('Cookie', sessionCookie(0)).set('Origin', origin).expect(200);
});

test('dua callback TikTok paralel tidak bisa mengambil satu slot yang sama', async () => {
  const flows = [await start(), await start()];
  const results = await Promise.all(flows.map((flow, i) => finish(flow, 'slot-race-' + i)));
  assert.deepEqual(results.map(result => result.headers.location.split('tiktok=')[1]).sort(), ['connected', 'no_slot']);
  const list = await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0));
  assert.equal(list.body.length, 1);
  await request(app)
    .delete('/api/tiktok/connections/' + list.body[0].id)
    .set('Cookie', sessionCookie(0))
    .set('Origin', origin)
    .expect(200);
});

test('callback TikTok dan pembuatan WhatsApp paralel memakai kunci kuota akun yang sama', async () => {
  const flow = await start();
  const [tikTok, wa] = await Promise.all([
    finish(flow, 'slot-mixed'),
    request(app).post('/sessions').set('Cookie', sessionCookie(0)).set('Origin', origin).send({ id: 'mixed-wa' }),
  ]);
  const connected = tikTok.headers.location.endsWith('tiktok=connected');
  assert.equal(wa.status, connected ? 409 : 200);
  if (!connected) assert.match(tikTok.headers.location, /tiktok=no_slot$/);
  const list = await request(app).get('/api/tiktok/connections').set('Cookie', sessionCookie(0));
  const sessions = await request(app).get('/sessions').set('Cookie', sessionCookie(0));
  assert.equal(
    list.body.length + sessions.body.filter((row: { serviceActive: boolean }) => row.serviceActive !== false).length,
    1,
  );
  if (connected)
    await request(app)
      .delete('/api/tiktok/connections/slot-mixed')
      .set('Cookie', sessionCookie(0))
      .set('Origin', origin)
      .expect(200);
  else
    await request(app).delete('/sessions/mixed-wa').set('Cookie', sessionCookie(0)).set('Origin', origin).expect(200);
});

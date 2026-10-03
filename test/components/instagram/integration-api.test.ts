// API Instagram untuk aplikasi lain diuji dengan Meta tiruan: pembuatan dan pencabutan key, scope, isolasi akun,
// komentar, serta percakapan dari riwayat chat. Kirim DM dan unduhan gambar posting dari alamat publik belum diuji.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { encrypt } from '../../../src/libraries/crypto.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import * as officialSql from '../../../src/components/instagram/data-access/official-queries.js';
import * as channelsSql from '../../../src/components/instagram/data-access/channels-queries.js';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const accounts = [randomUUID(), randomUUID()],
  tokens = [randomUUID(), randomUUID()];
const igUserId = '17841400000987654',
  session = 'ig-integrasi';
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-integration-test');
const app = createApp(gateway);
const metaCalls: { method: string; path: string; body: string }[] = [];
const meta = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer api-token');
  let body = '';
  for await (const chunk of req) body += chunk;
  metaCalls.push({ method: req.method!, path: req.url!, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST') return void res.end(req.url!.includes('/replies') ? '{"id":"555"}' : '{"success":true}');
  res.end('{"data":[{"id":"1","text":"mantap"}],"paging":{"cursors":{"after":"abc"},"next":"https://x"}}');
});
let keys: { full: string; read: string };
before(async () => {
  await new Promise<void>(r => meta.listen(0, '127.0.0.1', r));
  process.env.INSTAGRAM_GRAPH_URL = 'http://127.0.0.1:' + (meta.address() as AddressInfo).port;
  for (const [i, account] of accounts.entries()) {
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      account,
      account + '@integration.invalid',
      'unused',
    ]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(tokens[i]),
      account,
    ]);
  }
  await officialSql.upsert(db, [
    accounts[0],
    igUserId,
    'integrasi_fixture',
    'BUSINESS',
    encrypt('api-token'),
    'instagram_business_basic,instagram_business_manage_comments',
    5184000,
  ]);
  await channelsSql.insertOfficial(db, [accounts[0], session, igUserId, 'integrasi_fixture']);
  await db.execute(
    "INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,type,text) VALUES (?,?,?,?,'in','customer','text',?)",
    [accounts[0], session, '17841499999999', 'm1', 'halo kak'],
  );
  keys = {
    full: (await dashboard(0, 'post', '/api/instagram/keys', { name: 'Aplikasi A', scopes: scopes })).body.key,
    read: (await dashboard(0, 'post', '/api/instagram/keys', { name: 'Hanya baca', scopes: ['accounts:read'] })).body
      .key,
  };
});
after(async () => {
  for (const id of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await new Promise<void>(r => meta.close(() => r()));
  await gateway.stop();
  await db.end();
});
const scopes = ['accounts:read', 'messages:read', 'messages:send', 'comments:read', 'comments:write', 'posts:publish'];
const dashboard = (i: number, method: 'get' | 'post' | 'delete', path: string, body?: object) =>
  request(app)
    [method](path)
    .set('Cookie', 'ncwa_session=' + tokens[i])
    .set('Origin', origin)
    .send(body);
// Aplikasi lain tidak mengirim Origin maupun cookie.
const external = (method: 'get' | 'post', path: string, key?: string) => {
  const call = request(app)[method]('/api/v1/instagram' + path);
  return key ? call.set('Authorization', 'Bearer ' + key) : call;
};

test('key dibuat dengan scope, tampil sekali, dan daftar hanya memuat petunjuk empat karakter', async () => {
  const created = await dashboard(0, 'post', '/api/instagram/keys', { name: 'Uji', scopes: ['accounts:read'] });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^ncig_[a-f0-9]{64}$/);
  const list = (await dashboard(0, 'get', '/api/instagram/keys').expect(200)).body.keys;
  const listed = list.find((k: { id: string }) => k.id === created.body.id);
  assert.equal(listed.hint, created.body.key.slice(-4));
  assert.ok(!JSON.stringify(list).includes(created.body.key));
  const [rows] = await db.execute<any[]>('SELECT key_hash FROM instagram_api_keys WHERE id=?', [created.body.id]);
  assert.equal(rows[0].key_hash, digest(created.body.key));
  await dashboard(0, 'post', '/api/instagram/keys', { name: 'x', scopes: ['admin'] }).expect(400);
  await dashboard(0, 'post', '/api/instagram/keys', { name: 'x', scopes: [] }).expect(400);
  await dashboard(0, 'post', '/api/instagram/keys', { scopes: ['accounts:read'] }).expect(400);
});
test('tanpa key, key salah, atau cookie dashboard ditolak; key tidak butuh Origin', async () => {
  await external('get', '/accounts').expect(401);
  await external('get', '/accounts', 'ncig_' + 'a'.repeat(64)).expect(401);
  await request(app)
    .get('/api/v1/instagram/accounts')
    .set('Cookie', 'ncwa_session=' + tokens[0])
    .expect(401);
  const result = await external('post', '/messages', keys.read).send({}).expect(403);
  assert.equal(result.body.error, 'insufficient_scope');
  await external('get', '/tidak-ada', keys.full).expect(404);
});
test('akun hanya terlihat oleh pemilik key dan scope menentukan operasinya', async () => {
  const mine = (await external('get', '/accounts', keys.read).expect(200)).body;
  assert.deepEqual(
    mine.map((a: { id: string }) => a.id),
    [igUserId],
  );
  assert.ok(!JSON.stringify(mine).includes('api-token'));
  const other = (await dashboard(1, 'post', '/api/instagram/keys', { name: 'B', scopes })).body.key;
  assert.deepEqual((await external('get', '/accounts', other).expect(200)).body, []);
  await external('get', `/accounts/${igUserId}/conversations`, other).expect(404);
  await external('get', `/accounts/${igUserId}/media/123/comments`, other).expect(404);
  await external('post', `/accounts/${igUserId}/comments/1/replies`, other).send({ message: 'x' }).expect(404);
  await external('get', `/accounts/${igUserId}/conversations`, keys.read).expect(403);
});
test('percakapan dan pesan dibaca dari riwayat chat akun pemilik', async () => {
  const chats = (await external('get', `/accounts/${igUserId}/conversations`, keys.full).expect(200)).body;
  assert.equal(chats[0].customer, '17841499999999');
  assert.equal(chats[0].last.text, 'halo kak');
  const messages = (
    await external('get', `/accounts/${igUserId}/conversations/17841499999999/messages`, keys.full).expect(200)
  ).body;
  assert.equal(messages.messages[0].text, 'halo kak');
});
test('komentar dibaca, dibalas, dan disembunyikan lewat Meta dengan token di header', async () => {
  metaCalls.length = 0;
  const listed = (await external('get', `/accounts/${igUserId}/media/178900/comments?limit=10`, keys.full).expect(200))
    .body;
  assert.equal(listed.data[0].text, 'mantap');
  assert.equal(listed.next, 'abc');
  assert.match(metaCalls[0].path, /\/178900\/comments\?fields=.*&limit=10$/);
  const reply = await external('post', `/accounts/${igUserId}/comments/178901/replies`, keys.full)
    .send({ message: 'Terima kasih!' })
    .expect(201);
  assert.equal(reply.body.id, '555');
  assert.equal(new URLSearchParams(metaCalls.at(-1)!.body).get('message'), 'Terima kasih!');
  await external('post', `/accounts/${igUserId}/comments/178901/hide`, keys.full).send({}).expect(200);
  assert.equal(new URLSearchParams(metaCalls.at(-1)!.body).get('hide'), 'true');
  const before = metaCalls.length;
  await external('get', `/accounts/${igUserId}/media/abc/comments`, keys.full).expect(400);
  await external('post', `/accounts/${igUserId}/comments/1..2/replies`, keys.full).send({ message: 'x' }).expect(400);
  await external('post', `/accounts/${igUserId}/comments/1/replies`, keys.full).send({}).expect(400);
  assert.equal(metaCalls.length, before);
});
test('izin komentar yang belum diberikan Meta meminta hubungkan ulang tanpa memanggil Meta', async () => {
  await db.execute("UPDATE instagram_official SET permissions='instagram_business_basic' WHERE account_id=?", [
    accounts[0],
  ]);
  const before = metaCalls.length;
  const result = await external('get', `/accounts/${igUserId}/media/178900/comments`, keys.full).expect(409);
  assert.equal(result.body.error, 'instagram_permission');
  assert.equal(metaCalls.length, before);
});
test('posting lewat API wajib imageUrl publik; fileId dashboard dan alamat internal ditolak', async () => {
  const body = { requestId: randomUUID(), igUserId, caption: 'x' };
  await external('post', '/posts', keys.full)
    .send({ ...body, fileId: randomUUID() })
    .expect(400);
  await external('post', '/posts', keys.full)
    .send({ ...body, imageUrl: 'http://127.0.0.1/a.jpg' })
    .expect(409);
  await external('post', '/posts', keys.read).send(body).expect(403);
});
test('key yang dicabut langsung berhenti bekerja', async () => {
  const made = (await dashboard(0, 'post', '/api/instagram/keys', { name: 'Sementara', scopes: ['accounts:read'] }))
    .body;
  await external('get', '/accounts', made.key).expect(200);
  await dashboard(0, 'delete', '/api/instagram/keys/' + made.id).expect(200);
  await external('get', '/accounts', made.key).expect(401);
  await dashboard(1, 'delete', '/api/instagram/keys/' + made.id).expect(404);
});

// Posting feed diuji dengan Meta tiruan: isolasi tenant, izin, format JPEG, proses container,
// permintaan serentak, dan hasil publish yang belum pasti tidak boleh dikirim ulang.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { encrypt } from '../../../src/libraries/crypto.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import { storeContent } from '../../../src/components/ai/domain/content-files.js';
import { removeContent } from '../../../src/components/ai/data-access/content-file-storage.js';
import { preparePostImage } from '../../../src/components/instagram/domain/official-posts.js';
import { outboundMedia } from '../../../src/components/instagram/data-access/outbound-media-store.js';
import * as officialSql from '../../../src/components/instagram/data-access/official-queries.js';
import { rm } from 'node:fs/promises';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const accounts = [randomUUID(), randomUUID()],
  tokens = [randomUUID(), randomUUID()];
const igUserId = '17841400000456789';
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-posts-test');
const app = createApp(gateway);
let containerStatus = 'FINISHED',
  publishFailure = false,
  created = 0,
  published = 0;
let submitted: URLSearchParams, file: { id: string; url: string }, reference: { id: string }, foreign: { id: string };
const mediaPaths: string[] = [];
const meta = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer post-token');
  assert.ok(!req.url!.includes('access_token'));
  const url = new URL(req.url!, 'http://meta.test');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && url.pathname.endsWith('/media')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    submitted = new URLSearchParams(body);
    created++;
    return void res.end(JSON.stringify({ id: '990000' + created }));
  }
  if (req.method === 'POST' && url.pathname.endsWith('/media_publish')) {
    published++;
    if (publishFailure) {
      res.statusCode = 500;
      return void res.end('{}');
    }
    return void res.end('{"id":"88111222"}');
  }
  return void res.end(JSON.stringify({ status_code: containerStatus }));
});
before(async () => {
  await new Promise<void>(r => meta.listen(0, '127.0.0.1', r));
  process.env.INSTAGRAM_GRAPH_URL = 'http://127.0.0.1:' + (meta.address() as AddressInfo).port;
  for (const [i, account] of accounts.entries()) {
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      account,
      account + '@posts.invalid',
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
    'posts_fixture',
    'BUSINESS',
    encrypt('post-token'),
    'instagram_business_content_publish',
    5184000,
  ]);
  const png = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#ededed' } })
    .png()
    .toBuffer();
  file = await storeContent(accounts[0], png, 'result');
  reference = await storeContent(accounts[0], png, 'reference');
  foreign = await storeContent(accounts[1], png, 'result');
});
after(async () => {
  await removeContent(accounts[0], file.id);
  await removeContent(accounts[0], reference.id);
  await removeContent(accounts[1], foreign.id);
  for (const path of mediaPaths) await rm(path, { force: true });
  for (const id of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await new Promise<void>(r => meta.close(() => r()));
  await gateway.stop();
  await db.end();
});
const api = (method: 'get' | 'post', path: string, i = 0) =>
  request(app)
    [method](path)
    .set('Cookie', 'ncwa_session=' + tokens[i])
    .set('Origin', origin);
const payload = () => ({ requestId: randomUUID(), igUserId, fileId: file.id, caption: 'Kopi pagi ☕ #nusantara' });
async function rememberMedia() {
  if (!submitted!) return;
  const url = new URL(submitted.get('image_url')!);
  const media = await outboundMedia.get(url.pathname.split('/').at(-1)!);
  mediaPaths.push(media.path);
  assert.equal(media.mimetype, 'image/jpeg');
}

test('foto diposting sekali, JPEG dapat diambil Meta, caption utuh, dan sumber hasil tetap JPEG', async () => {
  const body = payload(),
    beforePublished = published;
  const result = await api('post', '/api/instagram/posts').send(body).expect(200);
  assert.equal(result.body.status, 'published');
  assert.equal(result.body.mediaId, '88111222');
  assert.equal(submitted.get('caption'), body.caption);
  await rememberMedia();
  const url = new URL(submitted.get('image_url')!);
  const publicImage = await request(app).get(url.pathname).expect(200);
  assert.match(publicImage.headers['content-type'], /image\/jpeg/);
  await api('get', file.url)
    .expect('Content-Type', /image\/jpeg/)
    .expect(200);
  assert.equal((await api('post', '/api/instagram/posts').send(body)).body.status, 'published');
  await api('post', '/api/instagram/posts/' + body.requestId + '/advance').expect(200);
  assert.equal(published, beforePublished + 1);
  const conflict = await api('post', '/api/instagram/posts')
    .send({ ...body, caption: 'caption lain' })
    .expect(409);
  assert.equal(conflict.body.error, 'idempotency_conflict');
});
test('akses gambar, akun tujuan, dan status terisolasi; caption/referensi/CSRF ditolak', async () => {
  const beforeCreated = created;
  await api('post', '/api/instagram/posts')
    .send({ ...payload(), fileId: foreign.id })
    .expect(404);
  await api('post', '/api/instagram/posts', 1)
    .send({ ...payload(), fileId: foreign.id })
    .expect(404);
  await api('post', '/api/instagram/posts')
    .send({ ...payload(), fileId: reference.id })
    .expect(400);
  await api('post', '/api/instagram/posts')
    .send({ ...payload(), caption: 'a'.repeat(2201) })
    .expect(400);
  await api('post', '/api/instagram/posts').set('Origin', 'https://attacker.invalid').send(payload()).expect(403);
  await request(app).post('/api/instagram/posts').set('Origin', origin).send(payload()).expect(401);
  assert.equal(created, beforeCreated);
  const body = payload();
  await api('post', '/api/instagram/posts').send(body).expect(200);
  await rememberMedia();
  await api('get', '/api/instagram/posts/' + body.requestId, 1).expect(404);
  await api('post', '/api/instagram/posts/' + body.requestId + '/advance', 1).expect(404);
});
test('izin posting wajib ada dan token harus masih berlaku', async () => {
  const beforeCreated = created;
  await db.execute("UPDATE instagram_official SET permissions='instagram_business_basic' WHERE account_id=?", [
    accounts[0],
  ]);
  assert.equal(
    (await api('post', '/api/instagram/posts').send(payload()).expect(409)).body.error,
    'instagram_publish_permission',
  );
  await db.execute(
    "UPDATE instagram_official SET permissions='instagram_business_content_publish',expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE account_id=?",
    [accounts[0]],
  );
  assert.equal((await api('post', '/api/instagram/posts').send(payload()).expect(409)).body.error, 'instagram_reauth');
  await db.execute('UPDATE instagram_official SET expires_at=DATE_ADD(NOW(),INTERVAL 60 DAY) WHERE account_id=?', [
    accounts[0],
  ]);
  assert.equal(created, beforeCreated);
});
test('container belum siap dilanjutkan dan permintaan bersamaan hanya menerbitkan sekali', async () => {
  containerStatus = 'IN_PROGRESS';
  const body = payload(),
    beforePublished = published,
    beforeCreated = created;
  const responses = await Promise.all([
    api('post', '/api/instagram/posts').send(body),
    api('post', '/api/instagram/posts').send(body),
  ]);
  assert.ok(responses.every(r => r.status === 202));
  assert.equal(created, beforeCreated + 1);
  await rememberMedia();
  assert.equal(published, beforePublished);
  assert.equal((await api('post', '/api/instagram/posts/' + body.requestId + '/advance')).body.status, 'processing');
  containerStatus = 'FINISHED';
  await Promise.all([
    api('post', '/api/instagram/posts/' + body.requestId + '/advance'),
    api('post', '/api/instagram/posts/' + body.requestId + '/advance'),
  ]);
  assert.equal((await api('get', '/api/instagram/posts/' + body.requestId)).body.status, 'published');
  assert.equal(published, beforePublished + 1);
});
test('kegagalan container tidak publish; kegagalan respons publish disimpan unknown tanpa pengiriman ulang', async () => {
  containerStatus = 'ERROR';
  const beforePublished = published,
    failed = payload();
  assert.equal((await api('post', '/api/instagram/posts').send(failed)).body.status, 'failed');
  await rememberMedia();
  assert.equal(published, beforePublished);
  containerStatus = 'FINISHED';
  publishFailure = true;
  const uncertain = payload();
  assert.equal((await api('post', '/api/instagram/posts').send(uncertain)).body.status, 'unknown');
  await rememberMedia();
  publishFailure = false;
  await api('post', '/api/instagram/posts').send(uncertain);
  await api('post', '/api/instagram/posts/' + uncertain.requestId + '/advance');
  assert.equal(published, beforePublished + 1);
});
test('permintaan terputus tidak tertahan selamanya atau mengulang publish', async () => {
  const body = payload();
  containerStatus = 'IN_PROGRESS';
  await api('post', '/api/instagram/posts').send(body);
  await rememberMedia();
  await db.execute(
    "UPDATE instagram_posts SET status='publishing',updated_at=DATE_SUB(NOW(),INTERVAL 2 MINUTE) WHERE account_id=? AND request_id=?",
    [accounts[0], body.requestId],
  );
  const beforePublished = published;
  assert.equal((await api('post', '/api/instagram/posts/' + body.requestId + '/advance')).body.status, 'unknown');
  assert.equal(published, beforePublished);
  containerStatus = 'FINISHED';
});
test('rasio feed diperiksa dan emoji caption dihitung sebagai satu karakter', async () => {
  const tall = await sharp({ create: { width: 90, height: 160, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await assert.rejects(preparePostImage(tall), { code: 'invalid_post_ratio' });
  const body = { ...payload(), caption: '😀'.repeat(2200) };
  await api('post', '/api/instagram/posts').send(body).expect(200);
  await rememberMedia();
});

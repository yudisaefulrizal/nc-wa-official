// Alur YouTube diuji dengan Google tiruan dan MySQL terisolasi, tanpa autentikasi atau posting sungguhan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { encrypt } from '../../../src/libraries/crypto.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import {
  startLogin,
  finishLogin,
  listConnections,
  disconnect,
  accessToken,
} from '../../../src/components/youtube/domain/connections.js';
import {
  createPost,
  processNext,
  checkPost,
  postInput,
  recoverUploads,
} from '../../../src/components/youtube/domain/posts.js';
import { createIntegrationKey } from '../../../src/components/instagram/domain/integration-keys.js';
const account = randomUUID(),
  other = randomUUID(),
  channel = 'UC' + 'a'.repeat(22);
let uploadCount = 0,
  refreshCount = 0,
  body: any;
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.YOUTUBE_CLIENT_ID = 'test-client';
process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
process.env.YOUTUBE_CREDENTIALS_FILE = '';
let base: string;
const google = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/token') {
    const p = new URLSearchParams(text);
    if (p.get('grant_type') === 'authorization_code') assert.ok(p.get('code_verifier'));
    else refreshCount++;
    return void res.end(
      JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
      }),
    );
  }
  if (req.url?.startsWith('/channels'))
    return void res.end(
      JSON.stringify({
        items: [
          {
            id: channel,
            snippet: { title: 'Uji Channel', thumbnails: { default: { url: 'https://example.com/avatar.jpg' } } },
          },
        ],
      }),
    );
  if (req.method === 'POST' && req.url?.startsWith('/upload')) {
    body = JSON.parse(text);
    res.setHeader('Location', base + '/upload?session=1');
    return void res.end('{}');
  }
  if (req.method === 'PUT') {
    if (req.headers['content-range']) return void res.end('{"id":"video123"}');
    uploadCount++;
    return void res.end('{"id":"video123"}');
  }
  if (req.url?.startsWith('/videos'))
    return void res.end('{"items":[{"id":"video123","status":{"uploadStatus":"processed"}}]}');
  if (req.url === '/revoke') return void res.end('{}');
  res.statusCode = 404;
  res.end('{}');
});
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-youtube-fixture');
const app = createApp(gateway);
before(async () => {
  await new Promise<void>(r => google.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (google.address() as AddressInfo).port;
  process.env.YOUTUBE_TOKEN_URL = base + '/token';
  process.env.YOUTUBE_API_URL = base;
  process.env.YOUTUBE_UPLOAD_URL = base + '/upload';
  process.env.YOUTUBE_REVOKE_URL = base + '/revoke';
  for (const id of [account, other])
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      id,
      id + '@youtube.invalid',
      'unused',
    ]);
});
after(async () => {
  await db.execute('DELETE FROM accounts WHERE id IN (?,?)', [account, other]);
  await gateway.stop();
  await new Promise<void>(r => google.close(() => r()));
  await db.end();
});
const input = (id: string) => ({
  channelId: channel,
  requestId: id,
  videoUrl: 'https://example.com/video.mp4',
  title: 'Video uji',
  description: 'Caption',
  privacyStatus: 'private',
  madeForKids: false,
  containsSyntheticMedia: true,
});
test('state terikat browser, sekali pakai, PKCE dan token tidak tampil', async () => {
  const started = await startLogin(account),
    url = new URL(started.url),
    state = url.searchParams.get('state')!;
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(await finishLogin({ state, code: 'code' }, 'b'.repeat(64)), 'error');
  assert.equal(await finishLogin({ state, code: 'code' }, started.browser), 'connected');
  assert.equal(await finishLogin({ state, code: 'code' }, started.browser), 'error');
  const connections = await listConnections(account);
  assert.equal(connections[0].id, channel);
  assert.ok(!JSON.stringify(connections).includes('refresh'));
  assert.deepEqual(await listConnections(other), []);
});
test('refresh token otomatis dan pemilik channel terisolasi', async () => {
  await db.execute(
    'UPDATE youtube_connections SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE account_id=?',
    [account],
  );
  assert.equal(await accessToken(account, channel), 'access');
  assert.equal(refreshCount, 1);
  await assert.rejects(accessToken(other, channel), /tidak ditemukan/);
  const started = await startLogin(other);
  assert.equal(
    await finishLogin({ state: new URL(started.url).searchParams.get('state'), code: 'code' }, started.browser),
    'in_use',
  );
});
test('izin key YouTube terpisah dari izin Instagram dan key milik akun lain', async () => {
  const ig = await createIntegrationKey(account, { name: 'ig', scopes: ['accounts:read', 'posts:publish'] }),
    yt = await createIntegrationKey(account, {
      name: 'yt',
      scopes: ['youtube:accounts:read', 'youtube:posts:publish'],
    }),
    foreign = await createIntegrationKey(other, {
      name: 'other',
      scopes: ['youtube:accounts:read', 'youtube:posts:publish'],
    });
  assert.equal((await request(app).get('/api/v1/youtube/accounts')).status, 401);
  assert.equal(
    (
      await request(app)
        .get('/api/v1/youtube/accounts')
        .set('Authorization', 'Bearer ' + ig.key)
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .get('/api/v1/youtube/accounts')
        .set('Authorization', 'Bearer ' + yt.key)
    ).body[0].id,
    channel,
  );
  assert.deepEqual(
    (
      await request(app)
        .get('/api/v1/youtube/accounts')
        .set('Authorization', 'Bearer ' + foreign.key)
    ).body,
    [],
  );
  assert.equal(
    (
      await request(app)
        .post('/api/v1/youtube/posts')
        .set('Authorization', 'Bearer ' + foreign.key)
        .send(input('foreign'))
    ).status,
    404,
  );
});
test('validasi metadata dan URL internal ditolak sebelum antrean', async () => {
  assert.throws(() => postInput({ ...input('bad'), madeForKids: undefined }));
  assert.throws(() => postInput({ ...input('bad'), title: 'x'.repeat(101) }));
  await assert.rejects(createPost(account, { ...input('internal'), videoUrl: 'http://127.0.0.1/video.mp4' }), /publik/);
});
test('idempotensi, upload worker satu kali, status dan log tanpa token', async () => {
  const first = await createPost(account, input('same'));
  assert.equal(first.status, 'queued');
  assert.deepEqual(await createPost(account, input('same')), first);
  await assert.rejects(createPost(account, { ...input('same'), title: 'berbeda' }), /isi berbeda/);
  const dir = await mkdtemp(join(tmpdir(), 'youtube-test-'));
  const file = join(dir, 'video');
  await writeFile(file, 'fake mp4');
  let cleaned = false;
  const download = async () => ({
    path: file,
    mimetype: 'video/mp4',
    cleanup: async () => {
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    },
  });
  await Promise.all([processNext(download), processNext(download)]);
  assert.equal(uploadCount, 1);
  assert.equal(body.status.privacyStatus, 'private');
  assert.equal(body.status.containsSyntheticMedia, true);
  assert.ok(cleaned);
  const post = await checkPost(account, 'same');
  assert.equal(post.status, 'published');
  assert.equal(post.videoId, 'video123');
  assert.ok(!JSON.stringify(post).includes('access'));
  await assert.rejects(checkPost(other, 'same'), /tidak ditemukan/);
});
test('restart dan hasil ambigu diperiksa tanpa upload baru', async () => {
  await createPost(account, input('interrupted'));
  await db.execute(
    "UPDATE youtube_posts SET status='uploading',upload_session=?,upload_size=8 WHERE account_id=? AND request_id='interrupted'",
    [encrypt(base + '/upload?session=2'), account],
  );
  await recoverUploads();
  const [interrupted]: any = await db.execute(
    "SELECT status FROM youtube_posts WHERE account_id=? AND request_id='interrupted'",
    [account],
  );
  assert.equal(interrupted[0].status, 'unknown');
  assert.equal((await checkPost(account, 'interrupted')).status, 'published');
  assert.equal(uploadCount, 1);
});
test('putuskan mencabut token dan menghapus koneksi serta log', async () => {
  await disconnect(account, channel);
  assert.deepEqual(await listConnections(account), []);
  await assert.rejects(checkPost(account, 'same'), /tidak ditemukan/);
});

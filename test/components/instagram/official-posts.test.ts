// Posting feed diuji dengan Meta tiruan: isolasi tenant, izin, format JPEG, proses container,
// permintaan serentak, dan hasil publish yang belum pasti tidak boleh dikirim ulang.
import { test, before, after, mock } from 'node:test';
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
import { rm, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { downloadPublicMedia, type DownloadOptions } from '../../../src/libraries/download.js';
import { postMediaSource } from '../../../src/components/instagram/domain/official-posts.js';
import { outboundVideo } from '../../../src/components/instagram/data-access/outbound-video-store.js';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const accounts = [randomUUID(), randomUUID()],
  tokens = [randomUUID(), randomUUID()];
const igUserId = '17841400000456789';
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-posts-test');
const app = createApp(gateway);
let containerStatus = 'FINISHED',
  publishFailure = false,
  containerFailure = false,
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
    if (containerFailure) {
      res.statusCode = 500;
      return void res.end('{}');
    }
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

test('tipe unsupported dan kombinasi video/gambar ditolak tanpa fallback foto', async () => {
  const count = created;
  for (const extra of [
    { mediaType: 'STORY' },
    { mediaType: 'REELS', videoUrl: 'https://example.com/video.mp4' },
    { videoUrl: 'https://example.com/video.mp4' },
  ])
    await api('post', '/api/instagram/posts')
      .send({ ...payload(), ...extra })
      .expect(400);
  assert.equal(created, count);
});

test('Reels API: MP4 unduh aman, range publik, processing, publish sekali dan konflik', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-api-'));
  const path = join(root, 'video.mp4');
  await promisify(execFile)('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x200:r=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-y',
    path,
  ]);
  const bytes = await readFile(path);
  const restore = mock.method(postMediaSource, 'download', (url: string, options: DownloadOptions) =>
    downloadPublicMedia(url, {
      ...options,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      open: async (_url, addresses) => {
        assert.equal(addresses[0].address, '8.8.8.8');
        return Object.assign(Readable.from([bytes]), {
          statusCode: 200,
          headers: { 'content-type': 'video/mp4' },
        }) as IncomingMessage;
      },
    }),
  );
  let videoToken: string | undefined;
  const videoTokens: string[] = [];
  try {
    const key = (
      await api('post', '/api/instagram/keys')
        .send({ name: 'Reels', scopes: ['posts:publish'] })
        .expect(201)
    ).body.key;
    const external = (method: 'post' | 'get', route: string) =>
      request(app)
        [method]('/api/v1/instagram' + route)
        .set('Authorization', 'Bearer ' + key);
    const body = {
      requestId: randomUUID(),
      igUserId,
      mediaType: 'REELS',
      videoUrl: 'https://fixture.example/video.mp4',
      caption: 'Reels uji',
    };
    containerStatus = 'IN_PROGRESS';
    const beforeCreated = created,
      beforePublished = published;
    const result = await external('post', '/posts').send(body).expect(202);
    assert.equal(result.body.status, 'processing');
    assert.equal(result.body.mediaType, 'REELS');
    assert.equal(submitted.get('media_type'), 'REELS');
    assert.equal(submitted.has('image_url'), false);
    assert.equal(submitted.get('caption'), body.caption);
    const url = new URL(submitted.get('video_url')!);
    videoToken = url.pathname.split('/').at(-1)!;
    videoTokens.push(videoToken);
    const range = await request(app).get(url.pathname).set('Range', 'bytes=0-31').expect(206);
    assert.match(range.headers['content-type'], /video\/mp4/);
    assert.equal(range.headers['x-content-type-options'], 'nosniff');
    assert.equal(range.headers['content-length'], '32');
    await request(app).get(url.pathname).set('Range', 'bytes=999999999-').expect(416);
    await external('post', '/posts').send(body).expect(202);
    for (const extra of [
      { caption: 'lain' },
      { videoUrl: 'https://fixture.example/other.mp4' },
      { mediaType: 'IMAGE', videoUrl: undefined, imageUrl: body.videoUrl },
    ])
      await external('post', '/posts')
        .send({ ...body, ...extra })
        .expect(409);
    await db.execute(
      'UPDATE instagram_posts SET updated_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE account_id=? AND request_id=?',
      [accounts[0], body.requestId],
    );
    assert.equal((await external('get', '/posts/' + body.requestId).expect(200)).body.status, 'processing');
    containerStatus = 'FINISHED';
    await Promise.all([external('get', '/posts/' + body.requestId), external('get', '/posts/' + body.requestId)]);
    assert.equal((await external('get', '/posts/' + body.requestId)).body.status, 'published');
    assert.equal(created, beforeCreated + 1);
    assert.equal(published, beforePublished + 1);
    const foreignKey = (
      await api('post', '/api/instagram/keys', 1)
        .send({ name: 'Asing', scopes: ['posts:publish'] })
        .expect(201)
    ).body.key;
    await request(app)
      .post('/api/v1/instagram/posts')
      .set('Authorization', 'Bearer ' + foreignKey)
      .send({ ...body, requestId: randomUUID() })
      .expect(404);
    for (const extra of [
      { imageUrl: body.videoUrl },
      { fileId: file.id },
      { mediaType: 'IMAGE' },
      { mediaType: 'STORY' },
      { mediaType: undefined },
    ])
      await external('post', '/posts')
        .send({ ...body, requestId: randomUUID(), ...extra })
        .expect(400);
    publishFailure = true;
    const uncertain = { ...body, requestId: randomUUID() };
    assert.equal((await external('post', '/posts').send(uncertain).expect(202)).body.status, 'unknown');
    videoTokens.push(new URL(submitted.get('video_url')!).pathname.split('/').at(-1)!);
    publishFailure = false;
    await external('post', '/posts').send(uncertain).expect(202);
    await external('get', '/posts/' + uncertain.requestId).expect(200);
    assert.equal(published, beforePublished + 2);
    containerFailure = true;
    await external('post', '/posts')
      .send({ ...body, requestId: randomUUID() })
      .expect(502);
    const failedToken = new URL(submitted.get('video_url')!).pathname.split('/').at(-1)!;
    videoTokens.push(failedToken);
    await assert.rejects(outboundVideo.get(failedToken), { code: 'media_not_found' });
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    restore.mock.restore();
    publishFailure = false;
    containerFailure = false;
    for (const token of videoTokens) await outboundVideo.remove(token);
    await rm(root, { recursive: true, force: true });
    containerStatus = 'FINISHED';
  }
});

test('mediaType null ditolak dan video tidak diterima di endpoint dashboard', async () => {
  const count = created;
  await api('post', '/api/instagram/posts')
    .send({ ...payload(), mediaType: null })
    .expect(400);
  await api('post', '/api/instagram/posts')
    .send({ requestId: randomUUID(), igUserId, mediaType: 'REELS', videoUrl: 'https://example.com/video.mp4' })
    .expect(400);
  assert.equal(created, count);
});

test('video invalid/oversize/timeout tidak mereservasi post; scope/izin dan token publik tetap aman', async () => {
  const key = (
    await api('post', '/api/instagram/keys')
      .send({ name: 'Validasi Reels', scopes: ['posts:publish'] })
      .expect(201)
  ).body.key;
  const readKey = (
    await api('post', '/api/instagram/keys')
      .send({ name: 'Baca Reels', scopes: ['accounts:read'] })
      .expect(201)
  ).body.key;
  const body = {
    requestId: randomUUID(),
    igUserId,
    mediaType: 'REELS',
    videoUrl: 'https://fixture.example/invalid.mp4',
  };
  const external = (payload: object, credential = key) =>
    request(app)
      .post('/api/v1/instagram/posts')
      .set('Authorization', 'Bearer ' + credential)
      .send(payload);
  let mode = 'invalid',
    downloads = 0;
  const restore = mock.method(postMediaSource, 'download', (url: string, options: DownloadOptions) => {
    downloads++;
    assert.equal(options.maxBytes, 64 * 1024 * 1024);
    assert.equal(options.timeoutMs, 120000);
    return downloadPublicMedia(url, {
      ...options,
      timeoutMs: 20,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      open: async () =>
        mode === 'timeout'
          ? (Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: {} }) as IncomingMessage)
          : (Object.assign(Readable.from(['not mp4']), {
              statusCode: 200,
              headers: mode === 'oversize' ? { 'content-length': 64 * 1024 * 1024 + 1 } : {},
            }) as IncomingMessage),
    });
  });
  const count = created;
  try {
    await external(body, readKey).expect(403);
    await db.execute("UPDATE instagram_official SET permissions='instagram_business_basic' WHERE account_id=?", [
      accounts[0],
    ]);
    await external(body).expect(409);
    assert.equal(downloads, 0);
    await db.execute(
      "UPDATE instagram_official SET permissions='instagram_business_content_publish' WHERE account_id=?",
      [accounts[0]],
    );
    for (const kind of ['invalid', 'oversize', 'timeout']) {
      mode = kind;
      const result = await external(body).expect(kind === 'timeout' ? 504 : 400);
      if (kind === 'timeout') assert.equal(result.body.error, 'video_download_timeout');
      const [rows] = await db.execute<any[]>(
        'SELECT request_id FROM instagram_posts WHERE account_id=? AND request_id=?',
        [accounts[0], body.requestId],
      );
      assert.equal(rows.length, 0);
    }
    await external({ ...body, videoUrl: 'http://127.0.0.1/video.mp4' }).expect(400);
    const expired = String(Date.now() - 1000) + '-' + 'a'.repeat(64);
    await request(app)
      .get('/instagram/video/' + expired)
      .expect(404);
    await request(app)
      .get('/instagram/video/' + 'a'.repeat(64))
      .expect(404);
    assert.equal(created, count);
  } finally {
    restore.mock.restore();
    await db.execute(
      "UPDATE instagram_official SET permissions='instagram_business_content_publish' WHERE account_id=?",
      [accounts[0]],
    );
  }
});

test('timeout persisten per tipe dan hasil publish Reels unknown tidak diulang', async () => {
  const key = (
    await api('post', '/api/instagram/keys')
      .send({ name: 'Status Reels', scopes: ['posts:publish'] })
      .expect(201)
  ).body.key;
  const get = (id: string) =>
    request(app)
      .get('/api/v1/instagram/posts/' + id)
      .set('Authorization', 'Bearer ' + key);
  const count = published;
  for (const [type, status, age, expected] of [
    ['IMAGE', 'preparing', 2, 'failed'],
    ['REELS', 'preparing', 2, 'preparing'],
    ['REELS', 'preparing', 6, 'failed'],
    ['IMAGE', 'processing', 6, 'failed'],
    ['REELS', 'processing', 31, 'failed'],
    ['REELS', 'publishing', 2, 'unknown'],
  ] as const) {
    const id = randomUUID();
    await db.execute(
      'INSERT INTO instagram_posts(account_id,request_id,ig_user_id,file_id,payload_hash,media_type,status,updated_at) VALUES (?,?,?,?,?,?,?,DATE_SUB(NOW(),INTERVAL ? MINUTE))',
      [accounts[0], id, igUserId, 'url', digest(id), type, status, age],
    );
    const result = await get(id).expect(200);
    assert.equal(result.body.mediaType, type);
    assert.equal(result.body.status, expected);
    assert.equal((await get(id).expect(200)).body.status, expected);
  }
  assert.equal(published, count);
});

test('tipe harus string; hash gambar historis tetap cocok dengan IMAGE eksplisit', async () => {
  await api('post', '/api/instagram/posts')
    .send({ ...payload(), mediaType: ['IMAGE'] })
    .expect(400);
  const key = (
    await api('post', '/api/instagram/keys')
      .send({ name: 'Tipe string', scopes: ['posts:publish'] })
      .expect(201)
  ).body.key;
  await request(app)
    .post('/api/v1/instagram/posts')
    .set('Authorization', 'Bearer ' + key)
    .send({ requestId: randomUUID(), igUserId, mediaType: ['IMAGE'], imageUrl: 'https://example.com/image.jpg' })
    .expect(400);
  const body = payload();
  const hash = digest(JSON.stringify({ igUserId, fileId: body.fileId, caption: body.caption }));
  await db.execute(
    "INSERT INTO instagram_posts(account_id,request_id,ig_user_id,file_id,payload_hash,status,media_id) VALUES (?,?,?,?,?,'published','9911')",
    [accounts[0], body.requestId, igUserId, body.fileId, hash],
  );
  const result = await api('post', '/api/instagram/posts')
    .send({ ...body, mediaType: 'IMAGE' })
    .expect(200);
  assert.equal(result.body.mediaType, 'IMAGE');
  assert.equal(result.body.mediaId, '9911');
});

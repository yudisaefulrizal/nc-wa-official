// Tes Direct Post TikTok dengan TikTok tiruan: foto dari Pustaka (dashboard) dan video dari URL (API v1 dan Test Post),
// info kreator, validasi aturan TikTok, media sementara, idempotensi, status pemrosesan, penolakan pasti vs hasil tidak
// pasti, kuota sesi, scope API key, dan isolasi antar akun.
import { test, before, after, mock } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import sharp from 'sharp';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { encrypt, decrypt } from '../../../src/libraries/crypto.js';
import { basicWallet } from '../../../src/components/billing/index.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import { migrateTikTok } from '../../../src/components/tiktok/index.js';
import { writeContent, removeContent } from '../../../src/components/ai/data-access/content-file-storage.js';
import { createIntegrationKey } from '../../../src/components/instagram/domain/integration-keys.js';
import { postMediaSource } from '../../../src/components/tiktok/domain/posts.js';
import { outboundMedia } from '../../../src/components/tiktok/data-access/outbound-media-store.js';

process.env.TIKTOK_CLIENT_KEY = 'test-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-secret';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.APP_ORIGIN ??= 'http://127.0.0.1:8069';
const origin = process.env.APP_ORIGIN;
const accounts = [randomUUID(), randomUUID()],
  sessions = [randomUUID(), randomUUID()],
  files = [randomUUID(), randomUUID(), randomUUID()],
  openId = 'creator-' + randomUUID();
const cookie = (i: number) => 'ncwa_session=' + sessions[i];
const inits: any[] = [];
const statuses = new Map<string, Record<string, unknown>>();
let refreshes = 0,
  creatorError = '',
  maxDuration = 60;
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  res.setHeader('Content-Type', 'application/json');
  const send = (body: unknown, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (req.url === '/v2/oauth/token/') {
    refreshes++;
    return send({
      open_id: openId,
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      scope: 'user.info.basic,video.publish,video.upload',
      expires_in: 86400,
      refresh_expires_in: 31536000,
    });
  }
  if (!['live-access', 'fresh-access'].includes(token ?? ''))
    return send({ error: { code: 'access_token_invalid' } }, 401);
  assert.equal(req.headers['content-type'], 'application/json; charset=UTF-8');
  const body = JSON.parse(raw || '{}');
  if (req.url === '/v2/post/publish/creator_info/query/') {
    if (creatorError) return send({ data: {}, error: { code: creatorError } });
    return send({
      data: {
        creator_nickname: 'Kreator Uji',
        creator_username: 'kreator.uji',
        creator_avatar_url: 'https://example.invalid/a.jpg',
        privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: true,
        max_video_post_duration_sec: maxDuration,
      },
      error: { code: 'ok' },
    });
  }
  if (req.url === '/v2/post/publish/content/init/' || req.url === '/v2/post/publish/video/init/') {
    inits.push({ path: req.url, ...body });
    if (body.post_info.title === 'tolak')
      return send({ error: { code: 'unaudited_client_can_only_post_to_private_accounts' } }, 403);
    // Koneksi putus setelah TikTok mungkin sudah menerima permintaan.
    if (body.post_info.title === 'putus') return void req.socket.destroy();
    const id = 'publish-' + inits.length;
    statuses.set(id, { status: 'PROCESSING_DOWNLOAD' });
    return send({ data: { publish_id: id }, error: { code: 'ok' } });
  }
  if (req.url === '/v2/post/publish/status/fetch/') {
    const status = statuses.get(body.publish_id);
    if (!status) return send({ error: { code: 'invalid_publish_id' } }, 400);
    return send({ data: status, error: { code: 'ok' } });
  }
  send({ error: { code: 'not_found' } }, 404);
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.TIKTOK_API_URL = 'http://127.0.0.1:' + (provider.address() as AddressInfo).port;
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-tiktok-posts-test');
const app = createApp(gateway);

before(async () => {
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
  await db.execute(
    `INSERT INTO tiktok_connections
      (account_id,open_id,display_name,avatar_url,access_token,refresh_token,permissions,expires_at,refresh_expires_at)
      VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR),DATE_ADD(NOW(),INTERVAL 300 DAY))`,
    [
      accounts[0],
      openId,
      'Kreator Uji',
      '',
      encrypt('live-access'),
      encrypt('live-refresh'),
      'user.info.basic,video.publish,video.upload',
    ],
  );
  // Dua hasil milik akun pertama (tegak dan mendatar besar) serta satu gambar milik akun kedua.
  const owners = [accounts[0], accounts[0], accounts[1]],
    sizes = [
      [1600, 2000],
      [3000, 1500],
      [500, 500],
    ];
  for (const [i, id] of files.entries()) {
    const [width, height] = sizes[i];
    const data = await sharp({ create: { width, height, channels: 3, background: '#88aacc' } })
      .png()
      .toBuffer();
    await db.execute("INSERT INTO ai_content_files(id,account_id,kind,bytes) VALUES (?,?,'result',?)", [
      id,
      owners[i],
      data.length,
    ]);
    await writeContent(owners[i], id, data);
  }
});
after(async () => {
  // Media sementara ditulis ke storage/ yang sama dengan server dev; hapus supaya tidak memenuhi kuotanya.
  await outboundMedia.remove(
    inits.flatMap(init => init.source_info?.photo_images ?? [init.source_info?.video_url]).map(mediaName),
  );
  for (const [i, id] of files.entries()) await removeContent(accounts[i === 2 ? 1 : 0], id);
  for (const account of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await gateway.stop();
  await db.end();
});
function post(body: Record<string, unknown>, i = 0) {
  return request(app).post('/api/tiktok/posts').set('Cookie', cookie(i)).set('Origin', origin).send(body);
}
const mediaName = (url: string) => new URL(url).pathname.split('/').pop() ?? '';
const valid = () => ({
  requestId: randomUUID(),
  openId,
  fileIds: [files[0], files[1]],
  title: 'Promo minggu ini',
  description: '#promo hemat',
  privacyLevel: 'SELF_ONLY',
  allowComment: false,
  brandOrganic: true,
  brandContent: false,
});

test('info kreator membutuhkan login dan memperpanjang token yang hampir habis', async () => {
  assert.equal((await request(app).get(`/api/tiktok/connections/${openId}/creator`)).status, 401);
  await db.execute('UPDATE tiktok_connections SET expires_at=DATE_ADD(NOW(),INTERVAL 1 MINUTE) WHERE open_id=?', [
    openId,
  ]);
  const response = await request(app).get(`/api/tiktok/connections/${openId}/creator`).set('Cookie', cookie(0));
  assert.equal(response.status, 200);
  assert.equal(response.body.nickname, 'Kreator Uji');
  assert.deepEqual(response.body.privacyOptions, ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']);
  assert.equal(refreshes, 1);
  const [rows] = await db.execute<any[]>('SELECT access_token,refresh_token FROM tiktok_connections WHERE open_id=?', [
    openId,
  ]);
  assert.equal(decrypt(rows[0].access_token), 'fresh-access');
  assert.equal(decrypt(rows[0].refresh_token), 'fresh-refresh');
  // Token baru masih lama berlaku, jadi permintaan berikutnya tidak memperpanjang lagi.
  await request(app).get(`/api/tiktok/connections/${openId}/creator`).set('Cookie', cookie(0)).expect(200);
  assert.equal(refreshes, 1);
});
test('kreator yang sedang tidak bisa posting ditolak dengan pesan TikTok', async () => {
  creatorError = 'spam_risk_too_many_posts';
  try {
    const response = await request(app).get(`/api/tiktok/connections/${openId}/creator`).set('Cookie', cookie(0));
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'spam_risk_too_many_posts');
    assert.equal((await post(valid())).status, 409);
  } finally {
    creatorError = '';
  }
});
test('posting foto mengirim Direct Post dengan foto sementara JPEG ≤1080p lalu memantau status', async () => {
  const body = valid(),
    count = inits.length;
  const created = await post(body);
  assert.equal(created.status, 202);
  assert.equal(created.body.status, 'processing');
  assert.equal(created.body.photoCount, 2);
  const init = inits[count];
  assert.equal(init.path, '/v2/post/publish/content/init/');
  assert.equal(init.media_type, 'PHOTO');
  assert.equal(init.post_mode, 'DIRECT_POST');
  assert.deepEqual(init.post_info, {
    title: 'Promo minggu ini',
    description: '#promo hemat',
    privacy_level: 'SELF_ONLY',
    disable_comment: true,
    brand_organic_toggle: true,
    brand_content_toggle: false,
  });
  assert.equal(init.source_info.source, 'PULL_FROM_URL');
  assert.equal(init.source_info.photo_cover_index, 0);
  assert.equal(init.source_info.photo_images.length, 2);
  const limits = [
    [1080, 1920],
    [1920, 1080],
  ];
  for (const [i, url] of init.source_info.photo_images.entries()) {
    assert.ok(url.startsWith(origin + '/tiktok/media/'));
    // TikTok mengunduh tanpa cookie.
    const photo = await request(app).get(new URL(url).pathname).buffer(true);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers['content-type'], 'image/jpeg');
    const meta = await sharp(photo.body).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(meta.width! <= limits[i][0] && meta.height! <= limits[i][1]);
  }
  assert.equal((await request(app).get('/tiktok/media/' + '1'.repeat(13) + '-' + 'a'.repeat(64))).status, 404);
  // Mengulang permintaan yang sama tidak membuat posting baru; isi berbeda dengan ID sama ditolak.
  assert.equal((await post(body)).body.status, 'processing');
  assert.equal(inits.length, count + 1);
  assert.equal((await post({ ...body, title: 'lain' })).status, 409);
  const path = '/api/tiktok/posts/' + body.requestId;
  assert.equal((await request(app).get(path).set('Cookie', cookie(0))).body.status, 'processing');
  statuses.set('publish-' + inits.length, { status: 'PUBLISH_COMPLETE' });
  assert.equal((await request(app).get(path).set('Cookie', cookie(0))).body.status, 'published');
  // Akun lain tidak dapat melihat posting ini.
  assert.equal((await request(app).get(path).set('Cookie', cookie(1))).status, 404);
});
test('kegagalan dari TikTok setelah diproses dicatat dengan alasan yang jelas', async () => {
  const body = valid();
  await post(body).expect(202);
  statuses.set('publish-' + inits.length, { status: 'FAILED', fail_reason: 'photo_pull_failed' });
  const response = await request(app)
    .get('/api/tiktok/posts/' + body.requestId)
    .set('Cookie', cookie(0));
  assert.equal(response.body.status, 'failed');
  assert.equal(response.body.errorCode, 'photo_pull_failed');
  assert.match(response.body.errorMessage, /mengunduh foto/);
});
test('pilihan yang melanggar aturan TikTok ditolak sebelum init', async () => {
  const count = inits.length;
  const cases: [Record<string, unknown>, number, string][] = [
    [{ privacyLevel: 'PUBLIC_TO_EVERYONE' }, 409, 'privacy_level_option_mismatch'],
    [{ brandContent: true, privacyLevel: 'SELF_ONLY' }, 400, 'branded_content_private'],
    [{ privacyLevel: undefined }, 400, 'invalid_privacy'],
    [{ allowComment: 'ya' }, 400, 'invalid_request'],
    [{ fileIds: [] }, 400, 'invalid_request'],
    [{ fileIds: [files[0], files[0]] }, 400, 'invalid_request'],
    [{ fileIds: Array.from({ length: 36 }, () => randomUUID()) }, 400, 'invalid_request'],
    [{ title: 'x'.repeat(91) }, 400, 'invalid_request'],
    [{ fileIds: [files[2]] }, 404, 'not_found'],
  ];
  for (const [change, status, error] of cases) {
    const response = await post({ ...valid(), ...change });
    assert.equal(response.status, status, JSON.stringify(change));
    assert.equal(response.body.error, error, JSON.stringify(change));
  }
  assert.equal(inits.length, count);
});
test('penolakan pasti menjadi gagal, koneksi putus menjadi tidak pasti tanpa kirim ulang', async () => {
  const rejected = await post({ ...valid(), title: 'tolak' });
  assert.equal(rejected.body.status, 'failed');
  assert.equal(rejected.body.errorCode, 'unaudited_client_can_only_post_to_private_accounts');
  const body = { ...valid(), title: 'putus' },
    count = inits.length;
  const lost = await post(body);
  assert.equal(lost.body.status, 'unknown');
  assert.equal((await post(body)).body.status, 'unknown');
  assert.equal(inits.length, count + 1);
});
test('koneksi di luar kuota sesi dan akun lain tidak dapat posting', async () => {
  assert.equal((await post(valid(), 1)).status, 404);
  await db.execute('UPDATE wallets SET session_limit=0 WHERE account_id=?', [accounts[0]]);
  try {
    const response = await post(valid());
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'session_inactive');
  } finally {
    await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [accounts[0]]);
  }
});

// Video uji asli (MP4 H.264/AAC 3 detik); unduhan URL diarahkan ke salinannya karena URL lokal ditolak unduhan publik.
const exec = promisify(execFile);
const workspace = await mkdtemp(join(tmpdir(), 'tiktok-video-')),
  sample = join(workspace, 'sample.mp4');
await exec('ffmpeg', [
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
  sample,
]);
after(() => rm(workspace, { recursive: true, force: true }));
const downloads: string[] = [];
mock.method(postMediaSource, 'download', async (url: string) => {
  downloads.push(url);
  const path = join(workspace, randomUUID() + '.mp4');
  if (url.endsWith('/bukan-video.mp4')) await writeFile(path, 'bukan video');
  else await copyFile(sample, path);
  return { path, mimetype: 'video/mp4', cleanup: () => rm(path, { force: true }) };
});
const videoBody = () => ({
  requestId: randomUUID(),
  openId,
  mediaType: 'VIDEO',
  videoUrl: 'https://media.example/video.mp4',
  title: 'Video baru #promo',
  privacyLevel: 'SELF_ONLY',
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  brandOrganic: false,
  brandContent: false,
});
async function apiKey(scopes: string[]) {
  return (await createIntegrationKey(accounts[0], { name: 'NC Post uji', scopes })).key;
}
test('API v1 TikTok memakai API key dan scope tiktok, tanpa membocorkan token', async () => {
  assert.equal((await request(app).get('/api/v1/tiktok/accounts')).status, 401);
  const instagramOnly = await apiKey(['posts:publish']);
  const denied = await request(app)
    .get('/api/v1/tiktok/accounts')
    .set('Authorization', 'Bearer ' + instagramOnly);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'insufficient_scope');
  const key = await apiKey(['tiktok:accounts:read', 'tiktok:posts:publish']);
  const list = await request(app)
    .get('/api/v1/tiktok/accounts')
    .set('Authorization', 'Bearer ' + key);
  assert.equal(list.status, 200);
  assert.equal(list.body[0].id, openId);
  assert.equal(/access|refresh/.test(JSON.stringify(list.body.map((c: any) => [c.id, c.name]))), false);
  assert.equal(/live-access|fresh-access|fresh-refresh/.test(list.text), false);
  const creator = await request(app)
    .get(`/api/v1/tiktok/accounts/${openId}/creator`)
    .set('Authorization', 'Bearer ' + key);
  assert.equal(creator.body.maxVideoDurationSec, 60);
  assert.equal(creator.body.stitchDisabled, true);
});
test('video dari API v1 diunduh, diperiksa, disajikan untuk TikTok, lalu dipantau sampai terbit', async () => {
  const key = await apiKey(['tiktok:posts:publish']),
    body = videoBody(),
    count = inits.length;
  const created = await request(app)
    .post('/api/v1/tiktok/posts')
    .set('Authorization', 'Bearer ' + key)
    .send(body);
  assert.equal(created.status, 202);
  assert.equal(created.body.status, 'processing');
  assert.equal(created.body.mediaType, 'VIDEO');
  assert.equal(downloads.at(-1), 'https://media.example/video.mp4');
  const init = inits[count];
  assert.equal(init.path, '/v2/post/publish/video/init/');
  assert.deepEqual(init.post_info, {
    title: 'Video baru #promo',
    privacy_level: 'SELF_ONLY',
    disable_comment: false,
    brand_organic_toggle: false,
    brand_content_toggle: false,
    disable_duet: true,
    disable_stitch: true,
  });
  assert.equal(init.source_info.source, 'PULL_FROM_URL');
  const url = new URL(init.source_info.video_url);
  assert.equal(url.origin, new URL(origin).origin);
  assert.match(url.pathname, /^\/tiktok\/media\/\d{13}-[a-f0-9]{64}\.mp4$/);
  const served = await request(app).get(url.pathname).buffer(true);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'video/mp4');
  // Mengulang permintaan yang sama tidak mengunduh atau menerbitkan lagi.
  const again = await request(app)
    .post('/api/v1/tiktok/posts')
    .set('Authorization', 'Bearer ' + key)
    .send(body);
  assert.equal(again.body.status, 'processing');
  assert.equal(inits.length, count + 1);
  statuses.set('publish-' + inits.length, { status: 'PUBLISH_COMPLETE' });
  const status = await request(app)
    .get('/api/v1/tiktok/posts/' + body.requestId)
    .set('Authorization', 'Bearer ' + key);
  assert.equal(status.body.status, 'published');
});
test('API v1 menolak pilihan yang tidak eksplisit, video tidak valid, dan video melebihi batas kreator', async () => {
  const key = await apiKey(['tiktok:posts:publish']),
    count = inits.length;
  const send = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/tiktok/posts')
      .set('Authorization', 'Bearer ' + key)
      .send(body);
  const cases: [Record<string, unknown>, number, string][] = [
    [{ allowDuet: undefined }, 400, 'invalid_request'],
    [{ brandContent: undefined }, 400, 'invalid_request'],
    [{ allowStitch: true }, 409, 'interaction_disabled'],
    [{ mediaType: 'PHOTO' }, 400, 'invalid_request'],
    [{ fileIds: [files[0]] }, 400, 'invalid_request'],
    [{ videoUrl: 'https://media.example/bukan-video.mp4' }, 400, 'invalid_video'],
  ];
  for (const [change, status, error] of cases) {
    const response = await send({ ...videoBody(), ...change });
    assert.equal(response.status, status, JSON.stringify(change));
    assert.equal(response.body.error, error, JSON.stringify(change));
  }
  maxDuration = 2;
  try {
    const body = videoBody();
    const response = await send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'video_too_long');
    // Video yang ditolak tidak meninggalkan baris posting.
    assert.equal(
      (
        await request(app)
          .get('/api/v1/tiktok/posts/' + body.requestId)
          .set('Authorization', 'Bearer ' + key)
      ).status,
      404,
    );
  } finally {
    maxDuration = 60;
  }
  assert.equal(inits.length, count);
});
test('Test Post TikTok di dashboard butuh konfirmasi; dialog Konten hanya untuk foto', async () => {
  const send = (path: string, body: Record<string, unknown>) =>
    request(app).post(path).set('Cookie', cookie(0)).set('Origin', origin).send(body);
  assert.equal((await send('/api/tiktok/test-post', videoBody())).status, 400);
  const tested = await send('/api/tiktok/test-post', { ...videoBody(), consent: true });
  assert.equal(tested.status, 202);
  assert.equal(tested.body.mediaType, 'VIDEO');
  assert.equal((await send('/api/tiktok/posts', videoBody())).status, 400);
  assert.equal((await send('/api/tiktok/test-post', { ...valid(), consent: true })).status, 400);
});

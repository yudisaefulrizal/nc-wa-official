// Pemeriksaan browser Post TikTok (1280/390 px) dengan TikTok tiruan: dialog foto di Pustaka konten (info kreator, privasi
// tanpa pilihan bawaan, beberapa foto, konten komersial, persetujuan musik) dan Test Post video di Integrasi.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { encrypt } from '../../src/libraries/crypto.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { blankDefinition } from '../../src/components/ai/domain/builder/definition.js';
import { writeContent, removeContent } from '../../src/components/ai/data-access/content-file-storage.js';
import { screenshots } from './screenshots.js';
import { postMediaSource } from '../../src/components/tiktok/domain/posts.js';
import { outboundMedia } from '../../src/components/tiktok/data-access/outbound-media-store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile } from 'node:fs/promises';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-tiktok-post-browser-'));
const inits: any[] = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v2/post/publish/creator_info/query/')
    return void res.end(
      JSON.stringify({
        data: {
          creator_nickname: 'Kreator Uji',
          creator_username: 'kreator.uji',
          privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: true,
          max_video_post_duration_sec: 60,
        },
        error: { code: 'ok' },
      }),
    );
  if (req.url === '/v2/post/publish/video/init/') {
    const body = JSON.parse(raw);
    const video = await fetch(body.source_info.video_url);
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    inits.push(body);
    return void res.end(JSON.stringify({ data: { publish_id: 'publish-' + inits.length }, error: { code: 'ok' } }));
  }
  if (req.url === '/v2/post/publish/content/init/') {
    const body = JSON.parse(raw);
    // TikTok mengambil setiap foto dari URL publik aplikasi.
    for (const url of body.source_info.photo_images) {
      const photo = await fetch(url);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    }
    inits.push(body);
    return void res.end(JSON.stringify({ data: { publish_id: 'publish-' + inits.length }, error: { code: 'ok' } }));
  }
  if (req.url === '/v2/post/publish/status/fetch/')
    return void res.end(JSON.stringify({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }));
  res.statusCode = 404;
  res.end('{}');
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.TIKTOK_API_URL = 'http://127.0.0.1:' + (provider.address() as AddressInfo).port;
process.env.TIKTOK_CLIENT_KEY = 'browser-key';
process.env.TIKTOK_CLIENT_SECRET = 'browser-secret';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'b'.repeat(64);
const slot = createServer();
await new Promise<void>(resolve => slot.listen(0, '127.0.0.1', resolve));
const port = (slot.address() as AddressInfo).port;
await new Promise<void>(resolve => slot.close(() => resolve()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
// Tiap lebar layar memakai IP tiruan sendiri supaya batas 120 permintaan/menit per IP tidak terbagi antarskenario.
process.env.TRUST_PROXY_HOPS = '1';
// Video uji asli; unduhan URL publik diarahkan ke salinannya karena server uji berjalan di proses yang sama.
const sample = join(temporary, 'sample.mp4');
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
  sample,
]);
postMediaSource.download = (async () => {
  const path = join(temporary, randomUUID() + '.mp4');
  await copyFile(sample, path);
  return { path, mimetype: 'video/mp4', cleanup: () => rm(path, { force: true }) };
}) as unknown as typeof postMediaSource.download;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), temporary);
const server = createServer(createApp(gateway)).listen(port, '127.0.0.1');
const account = randomUUID(),
  session = randomUUID(),
  files = [randomUUID(), randomUUID(), randomUUID()],
  creator = 'browser-creator-' + randomUUID();
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await basicWallet(account);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))', [
    digest(session),
    account,
  ]);
  await db.execute(
    `INSERT INTO tiktok_connections
      (account_id,open_id,display_name,avatar_url,access_token,refresh_token,permissions,expires_at,refresh_expires_at)
      VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 300 DAY))`,
    [
      account,
      creator,
      'Kreator Uji',
      '',
      encrypt('access'),
      encrypt('refresh'),
      'user.info.basic,video.publish,video.upload',
    ],
  );
  for (const [i, id] of files.entries()) {
    const data = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: ['#d97706', '#0d9488', '#7c3aed'][i] },
    })
      .jpeg()
      .toBuffer();
    await db.execute("INSERT INTO ai_content_files(id,account_id,kind,bytes) VALUES (?,?,'result',?)", [
      id,
      account,
      data.length,
    ]);
    await writeContent(account, id, data);
  }
  await db.execute(
    "INSERT INTO ai_content_jobs(id,account_id,request_key,payload_hash,profile_id,profile_revision,snapshot,input,status,stage,results,finished_at) VALUES (?,?,?,?,?,1,?,?,'completed','done',?,NOW(3))",
    [
      randomUUID(),
      account,
      randomUUID(),
      'c'.repeat(64),
      'uji-tiktok',
      JSON.stringify(blankDefinition('Poster promo', 'content')),
      JSON.stringify({ values: {}, summary: 'Poster promo uji', inputWords: 3, maxWords: 3 }),
      JSON.stringify([{ label: 'Poster', kind: 'image', value: files }]),
    ],
  );
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.6.0.' + (width % 250) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: session, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/dashboard/konten');
    await page.locator('[data-content-tab="library"]').click();
    await page.getByRole('button', { name: 'Lihat hasil' }).first().click();
    assert.equal(await page.getByRole('button', { name: 'Post TikTok', exact: true }).count(), 3);
    await page.getByRole('button', { name: 'Post TikTok', exact: true }).first().click();
    // Satu akun siap langsung terpilih, dan nama kreator tujuan ditampilkan.
    await page.waitForFunction(() =>
      document.getElementById('content-tiktok-creator-name')?.textContent?.includes('Kreator Uji'),
    );
    assert.equal(await page.locator('#content-tiktok-privacy').inputValue(), '');
    assert.equal(await page.locator('#content-tiktok-comment').isChecked(), false);
    assert.equal(await page.locator('#content-tiktok-submit').isDisabled(), true);
    await page.locator('#content-tiktok-add').click();
    await page.locator('.content-tiktok-tile').nth(1).click();
    assert.equal(await page.locator('#content-tiktok-photos li').count(), 2);
    // Konten komersial tanpa pilihan menahan tombol; konten bermerek menutup opsi "Hanya saya".
    await page.locator('#content-tiktok-privacy').selectOption('FOLLOWER_OF_CREATOR');
    await page.locator('#content-tiktok-commercial').check();
    assert.equal(await page.locator('#content-tiktok-submit').isDisabled(), true);
    assert.match((await page.locator('#content-tiktok-submit-wrap').getAttribute('title')) ?? '', /mempromosikan/);
    await page.locator('#content-tiktok-brand-content').check();
    // isDisabled() Playwright tidak berlaku untuk <option>, jadi properti disabled dibaca langsung.
    const selfOnly = page.locator('#content-tiktok-privacy option[value="SELF_ONLY"]');
    assert.equal(await selfOnly.evaluate(option => (option as HTMLOptionElement).disabled), true);
    assert.match(await page.locator('#content-tiktok-commercial-label').innerText(), /Paid partnership/);
    assert.match(await page.locator('#content-tiktok-consent').innerText(), /Branded Content Policy/);
    await page.locator('#content-tiktok-brand-content').uncheck();
    await page.locator('#content-tiktok-brand-organic').check();
    assert.match(await page.locator('#content-tiktok-commercial-label').innerText(), /Promotional content/);
    assert.doesNotMatch(await page.locator('#content-tiktok-consent').innerText(), /Branded Content Policy/);
    await page.locator('#content-tiktok-title-input').fill('Promo pekan ini');
    await page.locator('#content-tiktok-description').fill('Diskon spesial #promo');
    const dialog = page.locator('#content-tiktok-dialog');
    await dialog.evaluate(box => box.scrollTo(0, 0));
    await dialog.screenshot({ path: join(screenshots, 'tiktok-post-top-' + width + '.png') });
    await dialog.evaluate(box => box.scrollTo(0, box.scrollHeight));
    await dialog.screenshot({ path: join(screenshots, 'tiktok-post-dialog-' + width + '.png') });
    const overflow = await page.evaluate(() => {
      const box = document.getElementById('content-tiktok-dialog')!;
      return box.scrollWidth - box.clientWidth;
    });
    assert.ok(overflow <= 1, 'dialog tidak boleh bergeser mendatar');
    const before = inits.length;
    await page.locator('#content-tiktok-submit').click();
    await page.waitForFunction(
      () => document.getElementById('content-tiktok-submit')?.textContent?.trim() === 'Periksa status',
    );
    assert.equal(inits.length, before + 1);
    const init = inits[before];
    assert.equal(init.source_info.photo_images.length, 2);
    assert.equal(init.post_info.privacy_level, 'FOLLOWER_OF_CREATOR');
    assert.equal(init.post_info.disable_comment, true);
    assert.equal(init.post_info.brand_organic_toggle, true);
    assert.equal(init.post_info.brand_content_toggle, false);
    await page.locator('#content-tiktok-submit').click();
    await page.waitForFunction(
      () => document.getElementById('content-tiktok-status')?.textContent === 'Posting sudah terbit di TikTok.',
    );
    assert.equal(await page.locator('#content-tiktok-submit').isDisabled(), true);
    await dialog.screenshot({ path: join(screenshots, 'tiktok-post-done-' + width + '.png') });
    // Test Post video di Integrasi.
    await page.goto(origin + '/dashboard/integrasi');
    await page.waitForFunction(() =>
      document.getElementById('tiktok-test-creator')?.textContent?.includes('Kreator Uji'),
    );
    assert.equal(await page.locator('#tiktok-test-privacy').inputValue(), '');
    assert.equal(await page.locator('#tiktok-test-submit').isDisabled(), true);
    assert.equal(await page.locator('#tiktok-test-stitch').isDisabled(), true);
    await page.locator('#tiktok-test-video').fill('https://media.example/video.mp4');
    await page.locator('#tiktok-test-caption').fill('Video uji #promo');
    await page.locator('#tiktok-test-privacy').selectOption('SELF_ONLY');
    await page.locator('#tiktok-test-duet').check();
    await page.locator('#tiktok-test-agree').check();
    page.once('dialog', dialog => void dialog.accept());
    const videoCount = inits.length;
    await page.locator('#tiktok-test-submit').click();
    await page.waitForFunction(() => !document.getElementById('tiktok-test-check')?.hidden);
    const videoInit = inits[videoCount];
    assert.equal(videoInit.post_info.title, 'Video uji #promo');
    assert.equal(videoInit.post_info.privacy_level, 'SELF_ONLY');
    assert.equal(videoInit.post_info.disable_duet, false);
    assert.equal(videoInit.post_info.disable_stitch, true);
    assert.equal(videoInit.post_info.disable_comment, true);
    await page.locator('#tiktok-test-check').click();
    await page.waitForFunction(() =>
      document.getElementById('tiktok-test-status')?.textContent?.startsWith('Video sudah terbit di TikTok.'),
    );
    await page
      .locator('#tiktok-test-form')
      .screenshot({ path: join(screenshots, 'tiktok-test-post-' + width + '.png') });
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(pageOverflow <= 1, 'halaman Integrasi tidak boleh bergeser mendatar');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Browser Post TikTok lulus pada lebar 1280 dan 390 px; screenshot: ' + screenshots);
} finally {
  await browser?.close();
  // Media sementara ditulis ke storage/ yang sama dengan server dev; hapus supaya tidak memenuhi kuotanya.
  await outboundMedia.remove(
    inits
      .flatMap(init => init.source_info.photo_images ?? [init.source_info.video_url])
      .map((url: string) => new URL(url).pathname.split('/').pop() ?? ''),
  );
  for (const id of files) await removeContent(account, id);
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await gateway.stop();
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}

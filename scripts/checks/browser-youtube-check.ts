// Pemeriksaan UI YouTube pada desktop dan ponsel; endpoint publikasi ditiru, tidak mengunggah video nyata.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { encrypt } from '../../src/libraries/crypto.js';
import { createGateway } from '../../src/http/gateway.js';
process.env.YOUTUBE_CLIENT_ID = 'fixture';
process.env.YOUTUBE_CLIENT_SECRET = 'fixture';
process.env.YOUTUBE_CREDENTIALS_FILE = '';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const account = randomUUID(),
  session = randomUUID(),
  channel = 'UC' + 'a'.repeat(22);
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-youtube-browser');
const net = await import('node:net');
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as any).port;
await new Promise<void>(r => slot.close(() => r()));
process.env.APP_ORIGIN = 'http://127.0.0.1:' + port;
process.env.YOUTUBE_AUTHORIZE_URL = process.env.APP_ORIGIN + '/mock-google';
const { createApp } = await import('../../src/http/app.js');
const app = createApp(gateway);
app.get('/mock-google', (_req, res) => res.send('Google OAuth fixture'));
const server = app.listen(port, '127.0.0.1');
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@browser.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(session),
    account,
  ]);
  await db.execute(
    'INSERT INTO youtube_connections(account_id,channel_id,name,avatar,access_token,refresh_token,permissions,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',
    [account, channel, 'Channel Uji', '', encrypt('token'), encrypt('refresh'), 'youtube'],
  );
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: session, url: process.env.APP_ORIGIN }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  let sent: any;
  let status = 'failed';
  await page.route('**/api/youtube/posts**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      sent = req.postDataJSON();
      await route.fulfill({ json: { requestId: sent.requestId, status: 'queued' } });
      return;
    }
    if (new URL(req.url()).pathname.endsWith('/request')) status = 'published';
    await route.fulfill({
      json: new URL(req.url()).pathname.endsWith('/posts')
        ? [
            {
              requestId: 'request',
              channelId: channel,
              name: 'Channel Uji',
              title: 'Video uji',
              status,
              error: status === 'failed' ? 'Kuota API YouTube habis.' : null,
              videoId: status === 'published' ? 'video123' : null,
              url: status === 'published' ? 'https://www.youtube.com/watch?v=video123' : null,
              createdAt: new Date().toISOString(),
            },
          ]
        : { status },
    });
  });
  await page.goto(process.env.APP_ORIGIN + '/dashboard/integrasi');
  await page.locator('#youtube-accounts').filter({ hasText: 'Channel Uji' }).waitFor();
  await page.locator('#youtube-post-rows').filter({ hasText: 'Kuota API YouTube habis.' }).waitFor();
  await page.locator('#youtube-post-rows button').click();
  await page.locator('#youtube-post-rows').filter({ hasText: 'Terbit' }).waitFor();
  assert.equal(
    await page.locator('#youtube-post-rows a').getAttribute('href'),
    'https://www.youtube.com/watch?v=video123',
  );
  await page.getByText('Test Post YouTube', { exact: true }).click();
  await page.locator('#youtube-test-url').fill('https://example.com/video.mp4');
  await page.locator('#youtube-test-title').fill('Video baru');
  await page.locator('#youtube-test-description').fill('Caption');
  await page.locator('#youtube-test-kids').selectOption('no');
  await page.locator('#youtube-test-synthetic').selectOption('yes');
  await page.locator('#youtube-test-form input[type=checkbox]').check();
  await page.locator('#youtube-test-submit').click();
  await page.locator('#youtube-test-status').filter({ hasText: 'Permintaan tersimpan' }).waitFor();
  assert.equal(sent.channelId, channel);
  assert.equal(sent.containsSyntheticMedia, true);
  assert.equal(sent.madeForKids, false);
  assert.equal(sent.privacyStatus, 'private');
  const id = sent.requestId;
  await page.locator('#youtube-test-submit').click();
  await page.waitForTimeout(200);
  assert.equal(sent.requestId, id);
  await mkdir('/tmp/ncwa-youtube-screenshots', { recursive: true });
  await page.screenshot({ path: '/tmp/ncwa-youtube-screenshots/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/ncwa-youtube-screenshots/mobile.png', fullPage: true });
  await page.locator('#youtube-connect').click();
  await page.waitForURL('**/mock-google?**');
  assert.equal(new URL(page.url()).searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: YouTube channel cards, log errors/status, upload settings/idempotency, OAuth button, desktop/mobile.',
  );
} finally {
  await browser?.close();
  await new Promise<void>(r => server.close(() => r()));
  await gateway.stop();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
}

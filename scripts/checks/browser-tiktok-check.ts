// Pemeriksaan Login Kit di browser desktop dan ponsel dengan TikTok tiruan: redirect, kartu, refresh, dan putus.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-tiktok-browser-'));
const provider = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://tiktok.test');
  if (url.pathname === '/authorize') {
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'test-code');
    res.writeHead(302, { Location: callback.toString() });
    return res.end();
  }
  for await (const _chunk of req);
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/v2/oauth/token/')
    return res.end(
      JSON.stringify({
        open_id: 'browser-user',
        access_token: 'browser-access',
        refresh_token: 'browser-refresh',
        scope: 'user.info.basic,video.publish,video.upload',
        expires_in: 86400,
        refresh_expires_in: 31536000,
      }),
    );
  if (url.pathname === '/v2/user/info/')
    return res.end(
      JSON.stringify({
        data: {
          user: {
            open_id: 'browser-user',
            display_name: 'Kreator <uji>',
            avatar_url: 'https://example.invalid/avatar.png',
          },
        },
        error: { code: 'ok' },
      }),
    );
  if (url.pathname === '/v2/oauth/revoke/') return res.end('{}');
  res.writeHead(404);
  res.end('{}');
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
process.env.TIKTOK_API_URL = 'http://127.0.0.1:' + (provider.address() as AddressInfo).port;
process.env.TIKTOK_AUTHORIZE_URL = process.env.TIKTOK_API_URL + '/authorize';
process.env.TIKTOK_CLIENT_KEY = 'browser-key';
process.env.TIKTOK_CLIENT_SECRET = 'browser-secret';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'b'.repeat(64);
const slot = createServer();
await new Promise<void>(resolve => slot.listen(0, '127.0.0.1', resolve));
const port = (slot.address() as AddressInfo).port;
await new Promise<void>(resolve => slot.close(() => resolve()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), temporary);
let app = createApp(gateway);
const server = createServer((req, res) => app(req, res)).listen(port, '127.0.0.1');
const account = randomUUID(),
  session = randomUUID();
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))', [
    digest(session),
    account,
  ]);
  await basicWallet(account);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    // Tiap viewport adalah skenario sendiri; limiter API tidak berbagi hitungan reload antarskenario.
    app = createApp(gateway);
    // Memastikan TikTok tetap bisa dipilih saat WhatsApp dan Zernio disembunyikan.
    process.env.SHOW_WHATSAPP = width === 1280 ? '1' : '';
    process.env.SHOW_ZERNIO = width === 1280 ? '1' : '';
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'ncwa_session', value: session, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/dashboard/integrasi');
    const grid = page.locator('#integrations-grid'),
      form = page.locator('#sessionform');
    await grid.getByRole('button', { name: /Tambah sesi/ }).click();
    await page.locator('#addconnection').waitFor({ state: 'visible' });
    if (width === 1280) {
      await form.locator('input[value="whatsapp"]').check();
      await form.locator('input[name="id"]').fill('nama tidak valid!');
    }
    await form.locator('input[value="tiktok"]').check();
    assert.equal(await page.locator('#session-name-field').isVisible(), false);
    assert.equal(await form.locator('input[name="id"]').isDisabled(), true);
    assert.equal(await page.locator('#session-instagram').isVisible(), false);
    assert.equal(await form.evaluate(node => (node as HTMLFormElement).checkValidity()), true);
    await form.locator('input[value="instagram-official"]').check();
    assert.equal(await page.locator('#session-submit').textContent(), 'Hubungkan Instagram');
    await form.locator('input[value="tiktok"]').check();
    await page.locator('#addconnection').screenshot({ path: join(screenshots, 'tiktok-add-' + width + '.png') });
    await form.getByRole('button', { name: 'Hubungkan TikTok', exact: true }).click();
    const card = grid.locator('.integration-tile', { has: page.locator('.integration-icon.tiktok') });
    await card.waitFor();
    assert.equal(await page.locator('#integrations-quota').textContent(), '1 dari 1 sesi');
    assert.equal(await grid.getByRole('button', { name: /Tingkatkan paket/ }).isVisible(), true);
    assert.equal(await grid.getByRole('button', { name: /Tambah sesi/ }).count(), 0);
    await page.waitForFunction(() => !location.search.includes('tiktok='));
    assert.equal(await card.locator('strong').textContent(), 'Kreator <uji>');
    assert.equal(await card.locator('uji').count(), 0);
    assert.match((await card.textContent()) ?? '', /Terhubung/);
    await card.click();
    const dialog = page.locator('#integration-dialog');
    assert.match((await dialog.textContent()) ?? '', /Publikasi langsung/);
    await dialog.getByRole('button', { name: 'Perpanjang izin' }).click();
    await page.waitForFunction(() => document.getElementById('message')?.textContent === 'Izin TikTok diperpanjang.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dialog.screenshot({ path: join(screenshots, 'tiktok-actions-' + width + '.png') });
    await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
    await page.screenshot({ path: join(screenshots, 'tiktok-' + width + '.png'), fullPage: true });
    // Akun konten juga muncul di Asisten AI tanpa dibuat menjadi sesi chat palsu.
    await page.locator('.tabs a[href="/dashboard/ai"]').click();
    const aiCard = page.locator('#ai-session-cards .ai-tiktok-card');
    await aiCard.waitFor();
    assert.equal(await aiCard.locator('strong').textContent(), 'Kreator <uji>');
    assert.equal(await aiCard.getByRole('button', { name: 'Pasang profil' }).count(), 0);
    assert.equal(await aiCard.getByRole('checkbox').count(), 0);
    assert.equal(await page.locator('#ai-session').inputValue(), '');
    assert.equal(
      await page
        .locator('#ai-session-cards')
        .getByRole('button', { name: /Tingkatkan paket/ })
        .isVisible(),
      true,
    );
    await page.screenshot({ path: join(screenshots, 'tiktok-ai-' + width + '.png'), fullPage: true });
    await aiCard.focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#integration-dialog-title').textContent(), 'Kreator <uji>');
    page.once('dialog', dialog => void dialog.accept());
    await dialog.getByRole('button', { name: 'Putuskan', exact: true }).click();
    await aiCard.waitFor({ state: 'detached' });
    assert.equal(
      await page
        .locator('#ai-session-cards')
        .getByRole('button', { name: /Tambah sesi/ })
        .isVisible(),
      true,
    );
    await page.locator('.tabs a[href="/dashboard/integrasi"]').click();
    await grid.getByRole('button', { name: /Tambah sesi/ }).waitFor();
    assert.equal(await page.locator('#integrations-quota').textContent(), '0 dari 1 sesi');
    assert.equal(await grid.getByRole('button', { name: /Tambah sesi/ }).isVisible(), true);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Browser TikTok lulus pada lebar 1280 dan 390 px; screenshot: ' + screenshots);
} finally {
  await browser?.close();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await gateway.stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}

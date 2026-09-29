// Pemeriksaan browser halaman Integrasi (/dashboard/integrasi): kisi kartu koneksi WhatsApp dan Instagram (rantai
// hijau/abu-abu), jatah sesi, dialog tindakan, Instagram Login resmi, akun penyedia, pengalihan dari
// /dashboard/nomor, dan tata letak ponsel. WhatsApp, Zernio, dan Meta adalah tiruan.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { encrypt } from '../../src/libraries/crypto.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-integrasi-browser-'));
async function freePort() {
  const slot = net.createServer();
  await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
  const port = (slot.address() as net.AddressInfo).port;
  await new Promise<void>(r => slot.close(() => r()));
  return port;
}
const port = await freePort(),
  zernioPort = await freePort();
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.ZERNIO_API_URL = 'http://127.0.0.1:' + zernioPort + '/api';
// Pemeriksaan ini menguji pesan "belum dikonfigurasi", jadi kunci Instagram dari .env dikosongkan.
delete process.env.INSTAGRAM_APP_ID;
delete process.env.INSTAGRAM_APP_SECRET;
process.env.PAYMENT_ENCRYPTION_KEY ??= 'c'.repeat(64);
const zernio = createServer(async (req, res) => {
  for await (const _ of req);
  const route = req.method + ' ' + new URL(req.url!, 'http://zernio.test').pathname;
  const json = (data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (route === 'GET /api/v1/profiles') return json({ profiles: [{ _id: 'prof1', name: 'Default', isDefault: true }] });
  if (route === 'POST /api/v1/webhooks/settings') return json({ success: true, webhook: { _id: 'wh1' } });
  if (route === 'GET /api/v1/accounts')
    return json({ accounts: [{ _id: 'igacc1', platform: 'instagram', username: 'kopisenja.id', isActive: true }] });
  res.writeHead(404);
  res.end();
});
await new Promise<void>(r => zernio.listen(zernioPort, '127.0.0.1', r));
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_session, update) => {
    update({ status: 'connected', phone: '628123456789' });
    return { close() {}, async logout() {} };
  },
  temporary,
);
const server = createApp(gateway).listen(port, '127.0.0.1');
const account = randomUUID(),
  token = randomUUID();
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
    account,
    account + '@test.invalid',
    'unused',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    account,
  ]);
  await basicWallet(account);
  await db.execute('UPDATE wallets SET session_limit=5 WHERE account_id=?', [account]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
  // Data awal lewat API: dua sesi WhatsApp (satu diputus) dan satu sesi Instagram.
  const post = (path: string, data: unknown) =>
    context.request.post(origin + path, { headers: { Origin: origin }, data });
  for (const id of ['toko-utama', 'cabang']) assert.equal((await post('/sessions', { id })).status(), 200);
  assert.equal((await post('/sessions/cabang/logout', {})).status(), 200);
  const added = await post('/api/instagram/zernio', { name: 'Pusat', apiKey: 'sk_integrasi_check_1' });
  assert.equal(added.status(), 200);
  const zernioId = (await added.json()).id;
  assert.equal(
    (await post('/api/instagram/connect', { zernioId, sessionId: 'ig-senja', instagramId: 'igacc1' })).status(),
    200,
  );

  await db.execute(
    "INSERT INTO instagram_official(account_id,ig_user_id,username,token,status,expires_at,refreshed_at) VALUES (?,?,?,?,'active',DATE_ADD(NOW(),INTERVAL 5 DAY),NOW())",
    [account, '17841400000000777', 'resmi.id', encrypt('token-uji')],
  );
  // Akun resmi langsung menjadi sesi (seperti setelah login Instagram berhasil).
  assert.equal((await post('/api/instagram/official/17841400000000777/session', {})).status(), 200);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => void dialog.accept());
  // Tautan lama halaman Nomor diarahkan ke Integrasi.
  await page.goto(origin + '/dashboard/nomor');
  await page.waitForURL(origin + '/dashboard/integrasi');
  const grid = page.locator('#integrations-grid');
  await grid.locator('.integration-tile.connected').nth(2).waitFor();
  assert.equal(await page.locator('#integrations-quota').textContent(), '4 dari 5 sesi');
  assert.equal(await page.locator('.tabs a[aria-current="page"]').first().textContent(), 'Integrasi');
  // Terhubung = rantai hijau menyatu; terputus = rantai abu-abu terputus.
  const cabang = grid.locator('.integration-tile', { hasText: 'cabang' });
  assert.match(await cabang.innerText(), /Terputus/);
  assert.equal(await cabang.locator('svg.chain.off').count(), 1);
  assert.equal(
    await grid.locator('.integration-tile', { hasText: '628123456789' }).first().locator('svg.chain.on').count(),
    1,
  );
  assert.match(await page.locator('#integrations-providers').innerText(), /Zernio · Pusat/);
  // Instagram Login resmi: akun yang sudah masuk tampil sebagai kartu, token hampir habis diberi tahu.
  const official = grid.locator('.integration-tile', { hasText: '@resmi.id' });
  await official.waitFor();
  assert.match(await official.innerText(), /Token 5 hari lagi/);
  assert.equal(await official.locator('svg.chain.on').count(), 1);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'integrasi-desktop.png'), fullPage: true });
  // Kartu dibuka untuk tindakan; Putuskan Instagram Zernio lalu hubungkan ulang (akunnya masih aktif di Zernio).
  const zernioTile = grid.locator('.integration-tile', { hasText: 'kopisenja.id' });
  await zernioTile.click();
  const dialog = page.locator('#integration-dialog');
  await dialog.getByRole('button', { name: 'Putuskan' }).click();
  await grid.locator('.integration-tile.disconnected', { hasText: 'kopisenja.id' }).waitFor();
  await dialog.getByRole('button', { name: 'Hubungkan ulang' }).click();
  await grid.locator('.integration-tile.connected', { hasText: 'kopisenja.id' }).waitFor();
  await dialog.getByRole('button', { name: 'Tutup' }).click();
  // Akun resmi: Perpanjang butuh Meta, jadi cukup memastikan dialog dan tombolnya ada, lalu Putuskan menghapusnya.
  await official.click();
  await dialog.getByRole('button', { name: 'Perpanjang' }).waitFor();
  await dialog.getByRole('button', { name: 'Putuskan' }).click();
  await official.waitFor({ state: 'detached' });
  // Tombol Hubungkan Instagram tanpa konfigurasi Meta menampilkan pesan, bukan error mentah.
  await page.locator('#integrations-add').click();
  await page.locator('#addconnection input[value="instagram-official"]').check();
  await page.locator('#session-submit').click();
  await page.locator('#message', { hasText: 'belum dikonfigurasi' }).waitFor();
  // Hasil callback dibaca dari ?instagram= lalu dibersihkan dari alamat.
  await page.goto(origin + '/dashboard/integrasi?instagram=cancelled');
  await page.locator('#message', { hasText: 'dibatalkan' }).waitFor();
  assert.equal(new URL(page.url()).search, '');
  // Tambah koneksi membuka dialog yang sama dengan pilihan WhatsApp atau Instagram.
  await page.locator('#integrations-add').click();
  await page.locator('#addconnection').waitFor({ state: 'visible' });
  await page.locator('#addconnection').getByRole('button', { name: 'Tutup' }).click();
  // Carousel di Asisten AI: kartu tengah punya tombol Putuskan; setelah diputus tombolnya hilang.
  await page.goto(origin + '/dashboard/ai');
  const selected = page.locator('.ai-session-card.selected');
  await selected.first().waitFor();
  const disconnect = selected.locator('.ai-session-disconnect').first();
  await disconnect.waitFor();
  await disconnect.click();
  await selected.locator('.ai-session-disconnect').first().waitFor({ state: 'detached' });
  await page.goto(origin + '/dashboard/integrasi');
  // Tab API key dan webhook di Asisten AI tidak lagi bernama Integrasi.
  assert.equal(await page.locator('[data-ai-tab="integrasi"]').textContent(), 'API & Webhook');
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, 'Tidak boleh ada gulir horizontal di ponsel: ' + width);
  await page.screenshot({ path: join(screenshots, 'integrasi-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Pemeriksaan browser Integrasi lulus. Screenshot di ' + screenshots);
} finally {
  await browser?.close();
  server.close();
  zernio.close();
  await gateway.stop();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}

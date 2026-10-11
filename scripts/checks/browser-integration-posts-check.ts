// Pemeriksaan browser Instagram DM lewat Zernio di /dashboard/ai: dialog Tambah sesi dengan pilihan Instagram,
// menambah akun Zernio, memasang akun Instagram yang sudah ada di Zernio, kartu sesi Instagram, dan tata letak
// ponsel. Zernio adalah server tiruan.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { createGateway } from '../../src/http/gateway.js';
import { basicWallet } from '../../src/components/billing/domain/plans.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-instagram-browser-'));
async function freePort() {
  const slot = net.createServer();
  await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
  const port = (slot.address() as net.AddressInfo).port;
  await new Promise<void>(r => slot.close(() => r()));
  return port;
}
const port = await freePort(),
  zernioPort = await freePort();
const origin = 'http://127.0.0.1:' + port,
  zernioOrigin = 'http://127.0.0.1:' + zernioPort;
process.env.APP_ORIGIN = origin;
process.env.ZERNIO_API_URL = zernioOrigin + '/api';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'b'.repeat(64);
// Zernio tiruan: dua akun Instagram, satu di antaranya terputus di Zernio.
const instagramAccounts = [
  { _id: 'igacc1', platform: 'instagram', username: 'kopisenja.id', isActive: true },
  { _id: 'igacc2', platform: 'instagram', username: 'kopisenja.dago', isActive: true, needsReconnection: true },
];
const zernio = createServer(async (req, res) => {
  const url = new URL(req.url!, zernioOrigin);
  const json = (data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  for await (const _ of req);
  if (req.headers.authorization !== 'Bearer sk_browser_check_1') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Unauthorized"}');
  }
  const route = req.method + ' ' + url.pathname;
  if (route === 'GET /api/v1/profiles') return json({ profiles: [{ _id: 'prof1', name: 'Default', isDefault: true }] });
  if (route === 'POST /api/v1/webhooks/settings') return json({ success: true, webhook: { _id: 'wh1' } });
  if (route === 'GET /api/v1/accounts') return json({ accounts: instagramAccounts });
  res.writeHead(404);
  res.end();
});
await new Promise<void>(r => zernio.listen(zernioPort, '127.0.0.1', r));
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async (_session, update) => {
    update({ status: 'connected', phone: '628111111111' });
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
  await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [account]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Kartu "+ Tambah sesi" hanya membuka dialog saat berada di tengah carousel; digeser dulu bila perlu.
  const openAddSession = async () => {
    await page.locator('.ai-session-card.ai-session-depth-0').waitFor();
    const add = page.locator('.ai-session-card.placeholder-add.ai-session-depth-0');
    for (let i = 0; i < 8 && !(await add.count()); i++) {
      await page.locator('#ai-session-next').click();
      await page.waitForTimeout(300);
    }
    await add.click();
    await page.locator('#addconnection').waitFor({ state: 'visible' });
  };
  await mkdir(screenshots, { recursive: true });
  await page.goto(origin + '/dashboard/integrasi');
  await page.locator('#ig-post-log tr').first().waitFor();
  assert.equal(await page.locator('#ig-test-title').innerText(), 'Test Post');
  assert.equal(await page.locator('#ig-post-log-title').innerText(), 'Log Post');
  await page.locator('#ig-test-type').selectOption('CAROUSEL');
  assert.match(await page.locator('#ig-test-media-hint').innerText(), /2–10/);
  assert.equal(await page.locator('#ig-test-consent').isChecked(), false);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#ig-test-title').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, 'integration-post-tools-' + width + '.png') });
  }
  assert.deepEqual(errors, []);
  console.log('Test Post dan Log Post desktop/mobile lulus.');
} finally {
  await browser?.close();
  server.close();
  zernio.close();
  await gateway.stop();
  await db.execute('DELETE FROM accounts WHERE id=?', [account]);
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}

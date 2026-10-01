// Memeriksa mode Isi tabel/Teks manual Router, pergantian nama koleksi, dan simpan-buka ulang pada desktop/HP.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { screenshots } from './screenshots.js';
import { routerTableGraph } from '../../test/components/ai/router-table-fixture.js';
import { parseDefinition, validateGraph } from '../../src/components/ai/domain/builder/definition.js';

const owner = randomUUID(),
  token = randomUUID(),
  ids: string[] = [];
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
const { createApp } = await import('../../src/http/app.js');
const server = createApp().listen(port, '127.0.0.1');
let browser;
try {
  await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
    owner,
    owner + '@test.invalid',
    'unused',
    'owner',
  ]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
    digest(token),
    owner,
  ]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await mkdir(screenshots, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.6.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const response = await context.request.post(origin + '/api/admin/ai/builder', {
      data: routerTableGraph(),
      headers: { Origin: origin },
    });
    assert.ok(response.ok());
    const created = await response.json();
    ids.push(created.id);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/dashboard/admin/ai-builder?profile=' + created.id);
    await page.locator('#editor').waitFor();
    const select = async (id: string) => {
      if (width === 390) await page.locator('#node-picker select').selectOption(id);
      else {
        await page.locator('#fit').click();
        await page.locator('[data-node="' + id + '"] .node-heading').click();
      }
    };
    const inspector = page.locator('#inspector');
    await page.locator('#layout').click();
    await select('router');
    const source = () => inspector.getByLabel('Sumber “Kapan dipilih?”', { exact: true }).first();
    assert.equal(await source().inputValue(), 'table');
    await source().selectOption('manual');
    await inspector.getByLabel('Kapan dipilih?', { exact: true }).first().fill('Pertanyaan katalog');
    await source().selectOption('table');
    await inspector.getByLabel('Tabel untuk pemilihan Agent', { exact: true }).selectOption('produk');
    assert.equal(await inspector.getByLabel('Kapan dipilih?', { exact: true }).count(), 1);
    assert.equal(await inspector.getByLabel('Sumber “Kapan dipilih?”', { exact: true }).last().inputValue(), 'manual');
    await page.getByRole('button', { name: 'Struktur data', exact: true }).click();
    await page.locator('#collections').getByLabel('Nama koleksi', { exact: true }).fill('Katalog lengkap');
    await page.locator('#collections').getByLabel('Nama koleksi', { exact: true }).blur();
    await page.getByRole('button', { name: 'Alur', exact: true }).click();
    await select('router');
    assert.equal(
      await inspector.getByLabel('Tabel untuk pemilihan Agent', { exact: true }).inputValue(),
      'katalog_lengkap',
    );
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.reload();
    await page.locator('#editor').waitFor();
    const exported = parseDefinition(
      await (await context.request.get(origin + '/api/admin/ai/builder/' + created.id + '/export')).json(),
    );
    assert.deepEqual(validateGraph(exported), []);
    const branch = exported.nodes.find(n => n.id === 'router')!.branches[0];
    assert.equal(branch.source, 'table');
    assert.equal(branch.collection, 'katalog_lengkap');
    assert.equal(branch.description, 'Pertanyaan katalog');
    assert.equal(exported.nodes.find(n => n.id === 'cari_data')!.collection, 'katalog_lengkap');
    await select('router');
    assert.equal(await source().inputValue(), 'table');
    await source().selectOption('manual');
    assert.equal(
      await inspector.getByLabel('Kapan dipilih?', { exact: true }).first().inputValue(),
      'Pertanyaan katalog',
    );
    await source().selectOption('table');
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await source().scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-router-tables-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Router Isi tabel/Teks manual, rename koleksi, dan simpan-buka ulang lulus pada 1280 dan 390px.');
} finally {
  await browser?.close();
  await new Promise<void>(r => server.close(() => r()));
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.execute('DELETE FROM audit_events WHERE account_id=?', [owner]);
  await db.execute('DELETE FROM accounts WHERE id=?', [owner]);
  await db.end();
}

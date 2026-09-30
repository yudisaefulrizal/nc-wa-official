// Memeriksa pengaturan tugas pada desktop/HP, simpan-buka ulang, rujukan sumber setelah rename, dan port Selesai.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { screenshots } from './screenshots.js';
import { taskGraph } from '../../test/components/ai/task-graph-fixture.js';
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
      extraHTTPHeaders: { 'X-Forwarded-For': '10.5.0.' + (width === 1280 ? 1 : 2) },
    });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const response = await context.request.post(origin + '/api/admin/ai/builder', {
      data: taskGraph(),
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
    await select('extract');
    await inspector.getByLabel('Mode ekstraksi', { exact: true }).selectOption('fields');
    await inspector.getByLabel('Mode ekstraksi', { exact: true }).selectOption('tasks');
    await inspector.getByLabel('Maksimal tugas (1–5)', { exact: true }).fill('3');
    await inspector.getByLabel('Nama node', { exact: true }).fill('Daftar tugas');
    await inspector.getByLabel('Nama node', { exact: true }).blur();
    await select('router');
    assert.equal(await inspector.getByLabel('Mode routing', { exact: true }).inputValue(), 'tasks');
    assert.equal(await inspector.getByLabel('Sumber tugas', { exact: true }).inputValue(), 'daftar_tugas');
    await inspector.getByLabel('Maksimal percobaan per tugas (1–3)', { exact: true }).fill('2');
    await select('info');
    await inspector.getByLabel('Izinkan mengembalikan tugas', { exact: true }).uncheck();
    await inspector.getByLabel('Izinkan mengembalikan tugas', { exact: true }).check();
    await select('merge');
    await inspector.getByRole('button', { name: 'Gabungkan hasil router', exact: true }).click();
    await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
    await page.reload();
    await page.locator('#editor').waitFor();
    const exported = parseDefinition(
      await (await context.request.get(origin + '/api/admin/ai/builder/' + created.id + '/export')).json(),
    );
    assert.deepEqual(validateGraph(exported), []);
    assert.equal(exported.nodes.find(n => n.id === 'daftar_tugas')!.max_tasks, 3);
    assert.equal(exported.nodes.find(n => n.id === 'router')!.max_attempts, 2);
    assert.equal(exported.nodes.find(n => n.id === 'router')!.tasks_source, 'daftar_tugas');
    assert.equal(exported.nodes.find(n => n.id === 'info')!.return_to_router, true);
    assert.match(exported.nodes.find(n => n.id === 'merge')!.prompt, /nodes.router.results/);
    await select('router');
    assert.equal(await inspector.getByLabel('Maksimal percobaan per tugas (1–3)', { exact: true }).inputValue(), '2');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(screenshots, 'ai-builder-tasks-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Pengaturan tugas, sumber, penggabung, dan simpan-buka ulang lulus pada 1280 dan 390px.');
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

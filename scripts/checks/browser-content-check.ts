// Pemeriksaan browser profil Konten di 1280/390 px: owner membuat dan menerbitkan profil di Editor profil, klien memakainya
// di menu Konten (formulir dinamis, brand, hasil, Instagram, pustaka). Provider gambar tiruan; API dan database nyata.
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { encrypt } from '../../src/libraries/crypto.js';
import * as officialSql from '../../src/components/instagram/data-access/official-queries.js';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { db } from '../../src/libraries/db.js';
import { digest } from '../../src/libraries/security.js';
import { ai } from '../../src/components/ai/domain/service.js';
import { modelTiers } from '../../src/components/ai/domain/pipeline/models.js';
import { processNextContent } from '../../src/components/ai/domain/content-jobs.js';
import { createGateway } from '../../src/http/gateway.js';
import { removeContent } from '../../src/components/ai/data-access/content-file-storage.js';
import { screenshots } from './screenshots.js';

const temporary = await mkdtemp(join(tmpdir(), 'ncwa-image-browser-'));
const client = randomUUID(),
  owner = randomUUID(),
  clientToken = randomUUID(),
  ownerToken = randomUUID();
const slot = net.createServer();
await new Promise<void>(r => slot.listen(0, '127.0.0.1', r));
const port = (slot.address() as net.AddressInfo).port;
await new Promise<void>(r => slot.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
process.env.APP_ORIGIN = origin;
process.env.TRUST_PROXY_HOPS = '1';
const { createApp } = await import('../../src/http/app.js');
const gateway = createGateway(
  () => async () => ({
    close() {},
    async logout() {},
    async typing() {},
    async read() {},
    async send() {
      return randomUUID();
    },
  }),
  temporary,
);
const meta = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url?.endsWith('/media')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw);
    const image = await fetch(body.get('image_url')!);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    return void res.end('{"id":"990001"}');
  }
  if (req.method === 'POST' && req.url?.endsWith('/media_publish')) return void res.end('{"id":"880001"}');
  return void res.end('{"status_code":"FINISHED"}');
});
await new Promise<void>(r => meta.listen(0, '127.0.0.1', r));
process.env.INSTAGRAM_GRAPH_URL = 'http://127.0.0.1:' + (meta.address() as net.AddressInfo).port;
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
const server = createApp(gateway).listen(port, '127.0.0.1');
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let imageProvider: Awaited<ReturnType<typeof ai.saveProviderProfile>>;
const providers: string[] = [],
  profiles: string[] = [];
let sequence = 20;
try {
  for (const [id, role] of [
    [client, 'user'],
    [owner, 'owner'],
  ])
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@image-browser.invalid',
      'unused',
      role,
    ]);
  for (const [id, token] of [
    [client, clientToken],
    [owner, ownerToken],
  ])
    await db.execute(
      'INSERT INTO login_sessions(token_hash,account_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))',
      [digest(token), id],
    );
  await officialSql.upsert(db, [
    client,
    '17841400000777777',
    'kopi_fixture',
    'BUSINESS',
    encrypt('browser-post-token'),
    'instagram_business_content_publish',
    5184000,
  ]);
  const textProvider = await ai.saveProviderProfile({
    name: 'Text fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture',
    model_cheap: 'fixture',
    model_medium: 'fixture',
    model_smart: 'fixture',
    model_structured: 'fixture',
    model_decision: 'fixture',
  });
  providers.push(textProvider.id);
  imageProvider = await ai.saveProviderProfile({
    name: 'Gambar fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture',
    model_image: 'fixture-image',
    image_options: { references: true, maxImages: 4, creditsPerImage: 25 },
  });
  providers.push(imageProvider.id);
  await ai.setProviderRoutes({
    ...Object.fromEntries(modelTiers.map(tier => [tier, { profileId: textProvider.id }])),
    image: { profileId: imageProvider.id },
  });
  for (const id of [client, owner]) {
    await ai.wallet(id);
    await db.execute('UPDATE ai_wallets SET balance=5000 WHERE account_id=?', [id]);
  }
  const png = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#e9d7ba' } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="500"><rect x="145" y="120" width="110" height="260" rx="20" fill="#b98448"/><rect x="145" y="105" width="110" height="35" rx="8" fill="#233b30"/><rect x="153" y="220" width="94" height="95" rx="6" fill="#f8f0e3"/><text x="200" y="260" text-anchor="middle" fill="#233b30" font-size="17">KOPI</text><text x="200" y="285" text-anchor="middle" fill="#233b30" font-size="17">SUSU</text></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const open = async (token: string, path: string, width: number) => {
    const context = await browser!.newContext({
      viewport: { width, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': '10.5.0.' + sequence++ },
    });
    await context.addCookies([{ name: 'ncwa_session', value: token, url: origin }]);
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => void dialog.accept());
    await page.goto(origin + path);
    return { page, context, errors };
  };
  // Owner: membuat profil Konten di Editor profil, menerbitkan, lalu menyalakannya untuk klien.
  let created = '';
  for (const width of [1280, 390]) {
    const { page, context, errors } = await open(
      ownerToken,
      width === 1280 ? '/dashboard/admin/ai-builder' : '/dashboard/admin/ai-builder?profile=' + created,
      width,
    );
    if (width === 1280) {
      await page.locator('#create-content').click();
      await page.waitForSelector('#editor:not([hidden])');
      created = new URL(page.url()).searchParams.get('profile')!;
      profiles.push(created);
      assert.equal(await page.locator('#role-chip').textContent(), 'Konten');
      const inspector = page.locator('#inspector');
      // Formulir: tambah isian teks dan isian gambar.
      await page.locator('[data-node="input"] .node-heading').click();
      await inspector.getByRole('button', { name: '＋ Isian' }).click();
      await inspector.getByLabel('Label untuk klien', { exact: true }).nth(1).fill('Teks promosi');
      await inspector.getByRole('button', { name: '＋ Isian' }).click();
      await inspector.getByLabel('Label untuk klien', { exact: true }).nth(2).fill('Foto');
      await inspector.getByLabel('Jenis', { exact: true }).nth(2).selectOption('image');
      // Buat gambar: prompt dari isian, referensi dari isian gambar, dua gambar.
      await page.locator('[data-node="gambar"] .node-heading').click();
      await inspector
        .getByLabel('Prompt gambar', { exact: true })
        .fill('{{input.brief}} dengan teks {{input.teks_promosi}}');
      await inspector.getByLabel('Gambar referensi (opsional)', { exact: true }).fill('{{input.foto}}');
      await inspector.getByLabel('Jumlah gambar (1–3)', { exact: true }).fill('2');
      await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
      // Peran bisa diganti selagi draft, dan terkunci setelah terbit.
      await page.locator('[data-tab=settings]').click();
      await page.locator('#profile-name').fill('Poster Promosi');
      await page.locator('#profile-description').fill('Poster dari brief dan foto produk.');
      assert.equal(
        await page
          .locator('.role-card[aria-pressed=true]')
          .textContent()
          .then(t => t?.includes('Konten')),
        true,
      );
      await page.locator('#dirty').filter({ hasText: 'Tersimpan' }).waitFor();
      await page.locator('#publish').click();
      await page.waitForFunction(() => document.getElementById('revision')?.textContent?.startsWith('Terbit v'));
      assert.equal(await page.locator('.role-card:not([aria-pressed=true])').isDisabled(), true);
      await page.screenshot({ path: join(screenshots, 'content-role-' + width + '.png'), fullPage: true });
      await page.locator('[data-tab=flow]').click();
      await page.locator('#test-toggle').click();
      await page.locator('#test-fields [name=brief]').fill('Poster kopi susu');
      await page.locator('#test-fields [name=teks_promosi]').fill('Promo Jumat');
      await page.locator('#test-fields [name=foto]').fill('kopi.jpg');
      await page.locator('#run-test').click();
      await page.waitForSelector('#chat .bubble.assistant.media', { timeout: 20000 });
      assert.match(
        (await page.locator('#chat .bubble.assistant.media').first().textContent()) ?? '',
        /gambar-simulasi-1\.jpg/,
      );
    } else await page.waitForSelector('#editor:not([hidden])');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, 'content-builder-' + width + '.png'), fullPage: true });
    // Profil AI: nyalakan untuk klien sekali; tampil sebagai Konten tanpa tab Generator Gambar.
    await page.goto(origin + '/dashboard/admin/profiles');
    await page.waitForSelector('#admin-profiles-list tbody tr');
    assert.equal(await page.getByText('Generator Gambar').count(), 0);
    const row = page.locator('#admin-profiles-list tbody tr', { hasText: 'Poster Promosi' });
    assert.match((await row.textContent()) ?? '', /Konten/);
    if (width === 1280) {
      await row.locator('label.admin-profile-toggle').click();
      await row.getByText('Aktif', { exact: true }).waitFor();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, 'content-profiles-' + width + '.png'), fullPage: true });
    await page.goto(origin + '/dashboard/admin/ai');
    await page.getByRole('button', { name: 'Model', exact: true }).click();
    await page.waitForSelector('select[name=imageProfile]');
    assert.equal(await page.locator('select[name=imageProfile]').inputValue(), imageProvider.id);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Klien: formulir dari profil, brand, hasil, Instagram, dan pustaka.
  for (const width of [1280, 390]) {
    const { page, context, errors } = await open(clientToken, '/dashboard/konten', width);
    await page.waitForSelector('#content-profile option[value="' + created + '"]', { state: 'attached' });
    await page.locator('#content-profile').selectOption(created);
    assert.equal(await page.locator('#content-fields [name=brief]').count(), 1);
    await page.locator('#content-fields [name=brief]').fill('Kopi susu botolan di atas meja kayu, cahaya pagi.');
    await page.locator('#content-fields [name=teks_promosi]').fill('Promo Jumat');
    await page
      .locator('#content-fields input[type=file]')
      .setInputFiles({ name: 'kopi.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#content-fields .content-reference-thumb img');
    await page.locator('#content-brand-open').click();
    await page.locator('#content-brand-form [name=name]').fill('Kopi Nusantara');
    await page.locator('#content-brand-form [name=colors]').fill('Hijau dan krem');
    await page.locator('#content-brand-logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#content-brand-preview img');
    await page.locator('#content-brand-form button[type=submit]').click();
    await page.waitForFunction(() => !(document.getElementById('content-brand-dialog') as HTMLDialogElement).open);
    const response = page.waitForResponse(
      r => r.url().endsWith('/api/content/jobs') && r.request().method() === 'POST',
    );
    await page.locator('#content-generate').click();
    const result = await response;
    assert.equal(result.status(), 202);
    assert.equal((await result.json()).status, 'queued');
    await processNextContent({
      imageTransport: async (_config, input) => {
        // Foto dari formulir dan logo brand ikut sebagai referensi; prompt memuat isian dan identitas brand.
        assert.equal(input.references.length, 2);
        assert.match(input.prompt, /Promo Jumat/);
        assert.match(input.prompt, /Kopi Nusantara/);
        return [png, png];
      },
    });
    await page.waitForFunction(
      () => document.getElementById('content-job-state')?.textContent === 'Selesai',
      {},
      { timeout: 15000 },
    );
    assert.equal(await page.locator('#content-results img').count(), 2);
    const access = await page.evaluate(async () => ({ admin: (await fetch('/api/admin/ai/builder')).status }));
    assert.equal(access.admin, 403);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, 'content-' + width + '.png'), fullPage: true });
    assert.equal(await page.getByRole('button', { name: 'Post Instagram', exact: true }).count(), 2);
    await page.getByRole('button', { name: 'Post Instagram', exact: true }).first().click();
    await page.waitForFunction(() =>
      document.getElementById('content-instagram-account')?.querySelector('option[value="17841400000777777"]'),
    );
    await page.locator('#content-instagram-caption').fill('Kopi pagi dari Nusantara ☕ #kopi');
    await page.screenshot({ path: join(screenshots, 'content-instagram-dialog-' + width + '.png'), fullPage: false });
    assert.equal(
      await page.evaluate(() => {
        const dialog = document.getElementById('content-instagram-dialog')!;
        return dialog.scrollWidth <= dialog.clientWidth && dialog.getBoundingClientRect().right <= window.innerWidth;
      }),
      true,
    );
    const postResponse = page.waitForResponse(
      r => r.url().endsWith('/api/instagram/posts') && r.request().method() === 'POST',
    );
    await page.locator('#content-instagram-submit').click();
    const posted = await postResponse;
    assert.equal(posted.status(), 200);
    const post = await posted.json();
    await page.waitForFunction(
      () =>
        document.getElementById('content-instagram-status')?.textContent === 'Gambar berhasil diposting ke Instagram.',
    );
    assert.equal(await page.locator('#content-instagram-submit').isDisabled(), true);
    const [saved] = await db.execute<any[]>(
      'SELECT status,media_id FROM instagram_posts WHERE account_id=? AND request_id=?',
      [client, post.requestId],
    );
    assert.equal(saved[0].status, 'published');
    assert.equal(saved[0].media_id, '880001');
    await page.locator('#content-instagram-close').click();
    // Membuka kembali tidak memposting apa pun sampai tombol submit ditekan pengguna.
    await page.getByRole('button', { name: 'Post Instagram', exact: true }).first().click();
    await page.waitForSelector('#content-instagram-account option[value="17841400000777777"]', { state: 'attached' });
    assert.equal(await page.locator('#content-instagram-caption').inputValue(), '');
    await page.locator('#content-instagram-close').click();
    if (width === 1280) {
      // Respons hilang setelah server menerbitkan: dialog memulihkan status tersimpan, tanpa publish ulang.
      await page.route('**/api/instagram/posts', async route => {
        await route.fetch();
        await route.abort('failed');
      });
      await page.getByRole('button', { name: 'Post Instagram', exact: true }).first().click();
      await page.waitForSelector('#content-instagram-account option[value="17841400000777777"]', { state: 'attached' });
      await page.locator('#content-instagram-caption').fill('Uji pemulihan respons');
      await page.locator('#content-instagram-submit').click();
      await page.waitForFunction(
        () =>
          document.getElementById('content-instagram-status')?.textContent ===
          'Gambar berhasil diposting ke Instagram.',
      );
      assert.equal(await page.locator('#content-instagram-submit').isDisabled(), true);
      await page.locator('#content-instagram-close').click();
      await page.unroute('**/api/instagram/posts');
    }
    if (width === 390) {
      await page.route('**/api/instagram/official', route => route.fulfill({ json: [] }));
      await page.getByRole('button', { name: 'Post Instagram', exact: true }).first().click();
      await page.waitForFunction(() =>
        document.getElementById('content-instagram-status')?.textContent?.includes('berikan izin posting'),
      );
      assert.equal(await page.locator('#content-instagram-submit').isDisabled(), true);
      assert.equal(await page.locator('#content-instagram-connect').isVisible(), true);
      await page.locator('#content-instagram-close').click();
      await page.unroute('**/api/instagram/official');
    }
    await page.getByRole('button', { name: 'Jadikan referensi', exact: true }).first().click();
    assert.equal(await page.locator('#content-fields .content-reference-thumb img').count(), 1);
    await page.locator('[data-content-tab=library]').click();
    await page.waitForSelector('.content-library-card');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, 'content-library-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Profil Konten (Editor profil, Profil AI, menu Konten), brand, posting Instagram, tier gambar dan akses owner lulus pada desktop/ponsel. Screenshot: ' +
      screenshots,
  );
} finally {
  await browser?.close();
  await gateway.stop();
  await new Promise<void>(r => server.close(() => r()));
  await new Promise<void>(r => meta.close(() => r()));
  const [files] = await db.execute<any[]>('SELECT account_id,id FROM ai_content_files WHERE account_id IN (?,?)', [
    client,
    owner,
  ]);
  for (const file of files) await removeContent(file.account_id, file.id);
  for (const id of [client, owner]) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  for (const id of profiles) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  for (const id of providers) {
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id=?', [id]);
    await db.execute('DELETE FROM ai_provider_profiles WHERE id=?', [id]);
  }
  await db.end();
  await rm(temporary, { recursive: true, force: true });
}

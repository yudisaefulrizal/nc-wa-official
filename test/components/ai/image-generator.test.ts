// Tes generator dengan MySQL terisolasi dan provider tiruan: lifecycle profil, isolasi akun,
// reservasi/refund, idempotensi, snapshot versi, pemulihan restart dan kontrak payload gambar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../../../src/libraries/db.js';
import { ai } from '../../../src/components/ai/domain/service.js';
import { tierConfig, modelTiers } from '../../../src/components/ai/domain/pipeline/models.js';
import { imagePayload, parseImageOptions } from '../../../src/components/ai/domain/image-provider.js';
import {
  blankImageDefinition,
  parseImageDefinition,
  createImageProfile,
  saveImageProfile,
  enableImageProfile,
  deleteImageProfile,
  listImageProfiles,
  imageProfileState,
  composeImagePrompt,
} from '../../../src/components/ai/domain/image-profiles.js';
import {
  enqueueImage,
  imageJob,
  processNextImage,
  recoverImageJobs,
} from '../../../src/components/ai/domain/image-jobs.js';
import { storeContent, contentFile } from '../../../src/components/ai/domain/content-files.js';
import { saveImageBrand } from '../../../src/components/ai/domain/image-brand.js';
import { removeContent } from '../../../src/components/ai/data-access/content-file-storage.js';

const account = randomUUID(),
  other = randomUUID();
const providerIds: string[] = [],
  profileIds: string[] = [];
let previousSettings: Record<string, unknown> | undefined;
let previousRoutes: Record<string, unknown>[] = [];
let profileId = '',
  imageProvider = '',
  png: Buffer;
const payload = (overrides: Record<string, unknown> = {}) => ({
  profileId,
  requestId: randomUUID(),
  brief: 'Kopi di meja kayu',
  fields: {},
  ratio: '4:5',
  count: 2,
  references: [],
  ...overrides,
});
const balance = async () => {
  const [rows] = await db.execute<any[]>('SELECT balance,plan_balance,plan_period FROM ai_wallets WHERE account_id=?', [
    account,
  ]);
  return rows[0];
};
before(async () => {
  const [settings] = await db.query<any[]>('SELECT * FROM ai_settings WHERE id=1');
  const [routes] = await db.query<any[]>('SELECT * FROM ai_provider_routes');
  previousSettings = settings[0];
  previousRoutes = routes;
  for (const id of [account, other])
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      id,
      id + '@image.test.invalid',
      'unused',
    ]);
  png = await sharp({ create: { width: 24, height: 30, channels: 3, background: '#087f5b' } })
    .png()
    .toBuffer();
  const textProvider = await ai.saveProviderProfile({
    name: 'Text fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture-only',
    model_cheap: 'fixture-cheap',
    model_medium: 'fixture-medium',
    model_smart: 'fixture-smart',
    model_structured: 'fixture-structured',
    model_decision: 'fixture-decision',
  });
  providerIds.push(textProvider.id);
  const image = await ai.saveProviderProfile({
    name: 'Image fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture-only',
    model_image: 'fixture-image',
    image_options: { protocol: 'compatible', references: true, maxImages: 4, creditsPerImage: 25 },
  });
  imageProvider = image.id;
  providerIds.push(image.id);
  await ai.setProviderRoutes({
    ...Object.fromEntries(modelTiers.map(tier => [tier, { profileId: textProvider.id }])),
    image: { profileId: image.id },
  });
  const profile = await createImageProfile(account, blankImageDefinition());
  profileId = profile.id;
  profileIds.push(profileId);
  await saveImageProfile(account, profileId, { revision: profile.revision }, true);
  await enableImageProfile(account, profileId, true);
  await ai.wallet(account);
  await ai.wallet(other);
  await db.execute(
    'UPDATE ai_wallets SET balance=10000,plan_balance=100,plan_quota=100,plan_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE account_id=?',
    [account],
  );
});
after(async () => {
  const [files] = await db.execute<any[]>('SELECT account_id,id FROM ai_content_files WHERE account_id IN (?,?)', [
    account,
    other,
  ]);
  for (const file of files) await removeContent(file.account_id, file.id);
  for (const id of [account, other]) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  for (const id of profileIds) await db.execute('DELETE FROM ai_image_profiles WHERE id=?', [id]);
  for (const id of providerIds) {
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id=?', [id]);
    await db.execute('DELETE FROM ai_provider_profiles WHERE id=?', [id]);
  }
  await db.query('DELETE FROM ai_settings WHERE id=1');
  if (previousSettings) await db.query('INSERT INTO ai_settings SET ?', [previousSettings]);
  await db.query('DELETE FROM ai_provider_routes');
  for (const route of previousRoutes) await db.query('INSERT INTO ai_provider_routes SET ?', [route]);
  await db.end();
});
test('tier gambar tidak fallback ke teks, dan bukan pilihan node teks', async () => {
  assert.ok(!modelTiers.includes('image' as any));
  const config = await ai.config();
  assert.equal(config.tier_profiles?.image?.model, 'fixture-image');
  assert.equal(config.model, 'fixture-medium');
  assert.equal(tierConfig({ ...config, tier_profiles: { medium: config.tier_profiles?.medium } }, 'image').secret, '');
});
test('validasi formulir dan template menolak ID berbahaya serta variabel tak dikenal', () => {
  assert.throws(() => parseImageDefinition({ ...blankImageDefinition(), prompt: '{{unknown}}' }));
  assert.throws(() =>
    parseImageDefinition({
      ...blankImageDefinition(),
      fields: [{ id: '__proto__', label: 'X', type: 'text', required: false, options: [] }],
    }),
  );
  assert.throws(() => parseImageOptions({ maxImages: 5 }));
  const d = blankImageDefinition();
  d.prompt = '{{brief}} {{brand}}';
  assert.equal(composeImagePrompt(d, '{{brand}}', 'Kopi', {}), '{{brand}} Kopi');
});
test('payload protokol gambar dan referensi mengikuti kontrak provider', () => {
  const connection = { profileId: imageProvider, model: 'fixture', options: parseImageOptions({ references: true }) };
  const input = { prompt: 'foto', ratio: '4:5' as const, count: 2, references: [png] };
  const native = imagePayload('openrouter', connection, input) as any;
  assert.equal(native.aspect_ratio, '4:5');
  assert.equal(native.n, 2);
  assert.match(native.input_references[0].image_url.url, /^data:image\/png;base64,/);
  const compatible = imagePayload('compatible', connection, input) as any;
  assert.equal(compatible.size, '1024x1280');
  const chat = imagePayload('chat', connection, input) as any;
  assert.deepEqual(chat.modalities, ['image', 'text']);
  assert.equal(chat.messages[0].content.length, 2);
});
test('draft harus diterbitkan sebelum aktif, katalog klien tidak membocorkan prompt', async () => {
  const draft = await createImageProfile(account, { ...blankImageDefinition(), name: 'Draft only' });
  profileIds.push(draft.id);
  await assert.rejects(() => enableImageProfile(account, draft.id, true));
  const rows = (await listImageProfiles(true)) as any[];
  assert.ok(rows.some(row => row.id === profileId));
  assert.ok(!rows.some(row => row.id === draft.id));
  assert.equal(rows.find(row => row.id === profileId).prompt, undefined);
});
test('dua permintaan bersamaan dengan ID sama mereservasi hanya sekali', async () => {
  const body = payload(),
    before = await balance();
  const [a, b] = await Promise.all([enqueueImage(account, body), enqueueImage(account, body)]);
  assert.equal(a.id, b.id);
  const after = await balance();
  assert.equal(before.balance + before.plan_balance - after.balance - after.plan_balance, 50);
  await assert.rejects(() => enqueueImage(account, { ...body, brief: 'brief berbeda' }), /ID permintaan/);
  await processNextImage({ transport: async () => [png, png] });
  assert.equal((await imageJob(account, a.id)).charged, 50);
});
test('saldo tidak cukup tidak membuat pekerjaan dan tidak mendebit', async () => {
  const before = await balance();
  await db.execute('UPDATE ai_wallets SET balance=0,plan_balance=0 WHERE account_id=?', [account]);
  await assert.rejects(() => enqueueImage(account, payload()), /Kredit AI tidak cukup/);
  assert.equal((await balance()).balance, 0);
  await db.execute('UPDATE ai_wallets SET balance=?,plan_balance=? WHERE account_id=?', [
    before.balance,
    before.plan_balance,
    account,
  ]);
});
test('pekerjaan dan file akun lain tidak dapat diakses atau dijadikan referensi', async () => {
  const ref = await storeContent(other, png, 'reference');
  await assert.rejects(() => contentFile(account, ref.id), /tidak ditemukan/);
  await assert.rejects(() => enqueueImage(account, payload({ references: [ref.id] })), /tidak ditemukan/);
  const job = await enqueueImage(account, payload());
  await assert.rejects(() => imageJob(other, job.id), /tidak ditemukan/);
  await processNextImage({ transport: async () => [png, png] });
});
test('profil/formulir dan brand tersimpan sebagai snapshot versi ketika antrean dibuat', async () => {
  const state = await imageProfileState(profileId),
    d = state.draft;
  const saved = await saveImageProfile(account, profileId, {
    revision: state.revision,
    definition: {
      ...d,
      prompt: 'Versi asli {{brief}} {{brand}} {{fields.tujuan}}',
      fields: [{ id: 'tujuan', label: 'Tujuan', type: 'choice', required: true, options: ['Instagram', 'Poster'] }],
    },
  });
  await saveImageProfile(account, profileId, { revision: saved.revision }, true);
  const ref = await storeContent(account, png, 'reference');
  await saveImageBrand(account, { name: 'Kopi Nusantara', description: 'Hangat', colors: '#087f5b', logo: ref.id });
  await assert.rejects(() => enqueueImage(account, payload()), /Tujuan wajib/);
  const job = await enqueueImage(account, payload({ fields: { tujuan: 'Instagram' }, references: [ref.id] }));
  const current = await imageProfileState(profileId);
  await saveImageProfile(account, profileId, {
    revision: current.revision,
    definition: { ...current.draft, prompt: 'Versi baru {{brief}}' },
  });
  await saveImageBrand(account, { name: 'Brand berubah', description: '', colors: '', logo: '' });
  await processNextImage({
    transport: async (_connection, input) => {
      assert.match(input.prompt, /Versi asli/);
      assert.match(input.prompt, /Kopi Nusantara/);
      assert.match(input.prompt, /Instagram/);
      assert.equal(input.references.length, 1);
      return [png, png];
    },
  });
  assert.equal((await imageJob(account, job.id)).profile_revision, saved.revision);
  const reset = await imageProfileState(profileId);
  const blank = await saveImageProfile(account, profileId, {
    revision: reset.revision,
    definition: blankImageDefinition(),
  });
  await saveImageProfile(account, profileId, { revision: blank.revision }, true);
});
test('provider gagal mengembalikan seluruh reservasi, recovery berulang tidak refund ganda', async () => {
  const before = await balance(),
    job = await enqueueImage(account, payload());
  await processNextImage({
    transport: async () => {
      throw Error('fixture failed');
    },
  });
  const done = await imageJob(account, job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.charged, 0);
  assert.equal(done.reserved, 0);
  assert.deepEqual(await balance(), before);
  await recoverImageJobs();
  await recoverImageJobs();
  assert.deepEqual(await balance(), before);
});
test('hasil parsial hanya menagih satu gambar dan refund sisanya', async () => {
  const before = await balance(),
    job = await enqueueImage(account, payload());
  await processNextImage({ transport: async () => [png] });
  const done = await imageJob(account, job.id);
  assert.equal(done.results.length, 1);
  assert.equal(done.charged, 25);
  assert.equal(done.status, 'completed');
  const after = await balance();
  assert.equal(before.balance + before.plan_balance - after.balance - after.plan_balance, 25);
});
test('gambar keluaran yang tidak valid tidak ditagihkan, hasil pertama tetap disimpan', async () => {
  const job = await enqueueImage(account, payload());
  await processNextImage({ transport: async () => [png, Buffer.from('not an image')] });
  const done = await imageJob(account, job.id);
  assert.equal(done.results.length, 1);
  assert.equal(done.charged, 25);
  assert.ok(done.error);
});
test('restart memulihkan pekerjaan running dan tidak mengulang panggilan provider', async () => {
  const before = await balance(),
    job = await enqueueImage(account, payload());
  await db.execute("UPDATE ai_image_jobs SET status='running' WHERE id=?", [job.id]);
  await recoverImageJobs();
  assert.equal((await imageJob(account, job.id)).status, 'interrupted');
  assert.deepEqual(await balance(), before);
  assert.equal(
    await processNextImage({
      transport: async () => {
        throw Error('must not run');
      },
    }),
    false,
  );
});
test('restart mempertahankan hasil yang sudah tersimpan dan refund gambar lainnya', async () => {
  const job = await enqueueImage(account, payload()),
    file = await storeContent(account, png, 'result');
  await db.execute("UPDATE ai_image_jobs SET status='running',results=? WHERE id=?", [
    JSON.stringify([file.id]),
    job.id,
  ]);
  await recoverImageJobs();
  const done = await imageJob(account, job.id);
  assert.equal(done.charged, 25);
  assert.equal(done.results[0].id, file.id);
  assert.equal(done.status, 'completed');
});
test('refund kredit paket lama tidak mengisi paket baru setelah pergantian periode', async () => {
  await ai.wallet(account);
  const oldPeriod = (await balance()).plan_period;
  await db.execute('UPDATE ai_wallets SET plan_balance=100 WHERE account_id=?', [account]);
  const purchased = (await balance()).balance;
  const job = await enqueueImage(account, payload());
  await db.execute('UPDATE ai_wallets SET plan_period=?,plan_balance=100 WHERE account_id=?', [
    'new-image-period',
    account,
  ]);
  await processNextImage({
    transport: async () => {
      throw Error('failed');
    },
  });
  const after = await balance();
  assert.equal(after.plan_balance, 100);
  assert.equal(after.balance, purchased);
  assert.equal((await imageJob(account, job.id)).charged, 0);
  await db.execute('UPDATE ai_wallets SET plan_period=? WHERE account_id=?', [oldPeriod, account]);
});
test('profil dengan pekerjaan berjalan tidak bisa dihapus, nonaktif menolak pekerjaan baru', async () => {
  const job = await enqueueImage(account, payload());
  const state = await imageProfileState(profileId);
  await assert.rejects(() => deleteImageProfile(account, profileId, state.revision), /Tunggu pekerjaan/);
  await enableImageProfile(account, profileId, false);
  await assert.rejects(() => enqueueImage(account, payload()), /tidak tersedia/);
  await processNextImage({ transport: async () => [png, png] });
  assert.equal((await imageJob(account, job.id)).status, 'completed');
  await enableImageProfile(account, profileId, true);
});
test('akun dinonaktifkan saat antrean dibuat mendapat refund saat worker berjalan', async () => {
  const before = await balance(),
    job = await enqueueImage(account, payload());
  await db.execute('UPDATE accounts SET suspended=TRUE WHERE id=?', [account]);
  await processNextImage({
    transport: async () => {
      throw Error('must not call');
    },
  });
  assert.equal((await imageJob(account, job.id)).status, 'failed');
  assert.deepEqual(await balance(), before);
  await db.execute('UPDATE accounts SET suspended=FALSE WHERE id=?', [account]);
});

test('rute gambar dapat disimpan sendiri tanpa mengubah rute teks', async () => {
  const before = (await ai.config()).tier_profiles?.medium?.id;
  await ai.setProviderRoutes({ image: { profileId: imageProvider } });
  assert.equal((await ai.config()).tier_profiles?.medium?.id, before);
  assert.equal((await ai.config()).tier_profiles?.image?.id, imageProvider);
});

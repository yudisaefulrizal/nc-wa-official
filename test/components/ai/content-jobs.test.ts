// Profil Konten dan pekerjaannya: aturan peran di definisi, katalog klien, validasi formulir, reservasi dan refund kredit
// (kata dan gambar), idempotensi, isolasi akun, hasil JPEG di Pustaka konten, serta pemulihan restart.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { db } from '../../../src/libraries/db.js';
import { ai } from '../../../src/components/ai/domain/service.js';
import { modelTiers, tierConfig } from '../../../src/components/ai/domain/pipeline/models.js';
import { imagePayload } from '../../../src/components/ai/domain/image-provider.js';
import { creditCost } from '../../../src/components/ai/domain/metering.js';
import { contentFile, storeContent } from '../../../src/components/ai/domain/content-files.js';
import { saveImageBrand } from '../../../src/components/ai/domain/image-brand.js';
import {
  contentJob,
  contentJobs,
  contentProfiles,
  enqueueContent,
  processNextContent,
  recoverContentJobs,
} from '../../../src/components/ai/domain/content-jobs.js';
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';
import { contentPath, removeContent } from '../../../src/components/ai/data-access/content-file-storage.js';
import { creditsPerImage, installImageProviders, removeImageProviders, type ImageProviders } from './image-fixture.js';

const owner = randomUUID(),
  account = randomUUID(),
  other = randomUUID();
const graphIds: string[] = [];
let providers: ImageProviders;
let png: Buffer;
let imageProfile = '',
  textProfile = '';
const answer = async () => '{"answer":"Caption singkat dan hangat"}';
const images =
  (count = 2) =>
  async () =>
    Promise.all(Array.from({ length: count }, () => sharp(png).png().toBuffer()));
const wallet = async () => {
  const [rows] = await db.execute<any[]>('SELECT balance,plan_balance FROM ai_wallets WHERE account_id=?', [account]);
  return Number(rows[0].balance) + Number(rows[0].plan_balance);
};
const resetWallet = async () => {
  await db.execute('DELETE FROM ai_content_jobs WHERE account_id=?', [account]);
  await db.execute('DELETE FROM ai_usage WHERE account_id=?', [account]);
  await db.execute(
    'UPDATE ai_wallets SET balance=1000,plan_balance=30,plan_quota=30,plan_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE account_id=?',
    [account],
  );
};
const request = (profileId: string, values: Record<string, unknown> = { brief: 'Kopi di meja kayu' }) => ({
  profileId,
  requestId: randomUUID(),
  values,
});
// Formulir (brief wajib, gaya pilihan) → [Agent] → Buat gambar → Hasil; Buat gambar gagal → pesan.
function contentGraph(name: string, withAgent: boolean): GraphDefinition {
  const d = blankDefinition(name, 'content');
  const [input, image, ok, failed] = d.nodes;
  input.form = [
    { id: 'brief', label: 'Brief', type: 'textarea', required: true, options: [] },
    { id: 'gaya', label: 'Gaya', type: 'choice', required: false, options: ['Hangat', 'Minimalis'] },
    { id: 'foto', label: 'Foto', type: 'image', required: false, options: [] },
  ];
  image.image_count = 2;
  image.image_refs = '{{input.foto}}';
  if (!withAgent) return d;
  const agent: GraphNode = { ...image, id: 'agent', type: 'agent', label: 'Penulis', prompt: 'Tulis caption.', x: 300 };
  delete agent.image_ratio;
  delete agent.image_count;
  delete agent.image_brand;
  delete agent.image_refs;
  agent.value = '{}';
  ok.results = [
    { label: 'Gambar', kind: 'image', value: '{{nodes.gambar.files}}' },
    { label: 'Caption', kind: 'text', value: '{{nodes.agent.answer}}' },
  ];
  d.nodes = [input, agent, image, ok, failed];
  d.edges = [
    { id: 'e0', source: 'input', port: 'next', target: 'agent' },
    { id: 'e1', source: 'agent', port: 'next', target: 'gambar' },
    { id: 'e2', source: 'gambar', port: 'created', target: 'hasil' },
    { id: 'e3', source: 'gambar', port: 'failed', target: 'gagal' },
  ];
  return d;
}
async function publish(d: GraphDefinition, enabled = true) {
  const g = await store.createGraph(owner, d);
  graphIds.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  if (enabled) await setProfileEnabled(owner, g.id, true);
  return g.id;
}
before(async () => {
  providers = await installImageProviders();
  for (const [id, role] of [
    [owner, 'owner'],
    [account, 'user'],
    [other, 'user'],
  ])
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@content.test.invalid',
      'unused',
      role,
    ]);
  png = await sharp({ create: { width: 24, height: 30, channels: 4, background: { r: 8, g: 127, b: 91, alpha: 1 } } })
    .png()
    .toBuffer();
  imageProfile = await publish(contentGraph('Poster', false));
  textProfile = await publish(contentGraph('Poster dan caption', true));
  await ai.wallet(account);
  await ai.wallet(other);
  await resetWallet();
});
after(async () => {
  const [files] = await db.execute<any[]>('SELECT account_id,id FROM ai_content_files WHERE account_id IN (?,?)', [
    account,
    other,
  ]);
  for (const file of files) await removeContent(file.account_id, file.id);
  for (const id of [owner, account, other]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of graphIds) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await removeImageProviders(providers);
  await db.end();
});

test('Image tier does not fall back to text and is not a text node tier', async () => {
  assert.ok(!modelTiers.includes('image' as any));
  const config = await ai.config();
  assert.equal(config.tier_profiles?.image?.model, 'fixture-image');
  assert.equal(tierConfig({ ...config, tier_profiles: { medium: config.tier_profiles?.medium } }, 'image').secret, '');
});
test('Image payload follows each provider protocol and reference contract', () => {
  const connection = {
    profileId: 'x',
    model: 'fixture-image',
    options: {
      protocol: 'auto' as const,
      references: true,
      maxImages: 4,
      creditsPerImage,
      quality: 'auto' as const,
      sizes: { '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '1024x1792' },
    },
  };
  const input = { prompt: 'Kopi', ratio: '4:5' as const, count: 2, references: [png] };
  const native = imagePayload('openrouter', connection, input) as any;
  assert.equal(native.aspect_ratio, '4:5');
  assert.equal(native.n, 2);
  assert.match(native.input_references[0].image_url.url, /^data:image\/png;base64,/);
  assert.equal((imagePayload('compatible', connection, input) as any).size, '1024x1280');
  const chat = imagePayload('chat', connection, input) as any;
  assert.deepEqual(chat.modalities, ['image', 'text']);
  assert.equal(chat.messages[0].content.length, 2);
});

test('Content role: only content nodes, a form on Input, and results on Output', () => {
  assert.deepEqual(validateGraph(parseDefinition(contentGraph('Valid', true))), []);
  assert.equal(parseDefinition(blankDefinition('Chat')).role, 'chat');
  const withData = contentGraph('Salah', false);
  withData.nodes.push({ ...withData.nodes[1], id: 'ingat', type: 'memory', label: 'Ingat' });
  assert.match(
    validateGraph(parseDefinition(withData))
      .map(i => i.message)
      .join(),
    /tidak tersedia di profil Konten/,
  );
  const noForm = contentGraph('Tanpa form', false);
  delete noForm.nodes[0].form;
  assert.match(validateGraph(parseDefinition(noForm))[0].message, /minimal satu isian/);
  const noResult = contentGraph('Tanpa hasil', false);
  noResult.nodes[2].results = [];
  assert.match(validateGraph(parseDefinition(noResult))[0].message, /minimal satu hasil/);
  const unknown = contentGraph('Variabel', false);
  unknown.nodes[1].value = '{{input.tidak_ada}}';
  assert.match(validateGraph(parseDefinition(unknown))[0].message, /Field input tidak dikenal/);
  const chatWithForm = blankDefinition('Chat');
  chatWithForm.nodes[0].form = [{ id: 'a', label: 'A', type: 'text', required: false, options: [] }];
  assert.match(validateGraph(parseDefinition(chatWithForm))[0].message, /hanya untuk Input profil Konten/);
});
test('The role cannot change after publishing, and content profiles never attach to chat sessions', async () => {
  const state = await store.graphState(imageProfile);
  await assert.rejects(
    () =>
      store.saveGraph(owner, imageProfile, {
        revision: state.revision,
        definition: { ...state.draft, role: 'chat' },
      }),
    /Peran profil tidak bisa diubah/,
  );
  await assert.rejects(
    () => ai.createDataProfile(account, { profile_type: imageProfile, name: 'Salah' }),
    /dipakai di menu Konten/,
  );
});
test('The client catalog lists only published, enabled content profiles with their form', async () => {
  await publish(contentGraph('Dimatikan', false), false);
  const draft = await store.createGraph(owner, contentGraph('Draft', false));
  graphIds.push(draft.id);
  const chat = await publish(blankDefinition('Chat saja'));
  const list = await contentProfiles();
  assert.ok(list.some(p => p.id === imageProfile && p.fields.length === 3 && p.maxImages === 2));
  assert.ok(!list.some(p => p.name === 'Dimatikan' || p.id === draft.id || p.id === chat));
  assert.equal((list.find(p => p.id === imageProfile) as any).definition, undefined);
});

test('Image-only job: no word credit, JPEG results in the library, and charged per image', async () => {
  await resetWallet();
  const job = await enqueueContent(account, request(imageProfile));
  assert.equal(job.status, 'queued');
  assert.equal(await wallet(), 1030);
  await processNextContent({ imageTransport: images(2), transport: answer });
  const done = await contentJob(account, job.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.charged, 2 * creditsPerImage);
  assert.equal(await wallet(), 1030 - 2 * creditsPerImage);
  const result = done.results[0] as any;
  assert.equal(result.kind, 'image');
  assert.equal(result.files.length, 2);
  const file = await contentFile(account, result.files[0].id);
  assert.equal(file.kind, 'result');
  assert.equal((await sharp(await readFile(file.path)).metadata()).format, 'jpeg');
  assert.equal((await contentJobs(account)).total, 1);
});
test('Job with a text model charges words from the final text and refunds the rest of the reservation', async () => {
  await resetWallet();
  const config = await ai.config();
  const job = await enqueueContent(account, request(textProfile));
  const summary = 'Brief: Kopi di meja kayu';
  const words = summary.split(' ').length;
  const reserved = creditCost(words, 300, config.input_rate, config.output_rate);
  assert.equal(1030 - (await wallet()), reserved);
  await processNextContent({ imageTransport: images(2), transport: answer });
  const done = await contentJob(account, job.id);
  assert.equal(done.status, 'completed');
  const caption = done.results.find(r => r.kind === 'text') as any;
  assert.equal(caption.text, 'Caption singkat dan hangat');
  const wordCharge = creditCost(words, 4, config.input_rate, config.output_rate);
  assert.equal(done.charged, wordCharge + 2 * creditsPerImage);
  assert.equal(await wallet(), 1030 - done.charged);
});
test('Image failure takes the failure branch: text result, no image credit', async () => {
  await resetWallet();
  const job = await enqueueContent(account, request(imageProfile));
  await processNextContent({
    imageTransport: async () => {
      throw Error('provider_down');
    },
  });
  const done = await contentJob(account, job.id);
  assert.equal(done.status, 'completed');
  assert.match((done.results[0] as any).text, /belum berhasil dibuat \(gagal\)/);
  assert.equal(done.charged, 0);
  assert.equal(await wallet(), 1030);
});
test('A failing text model fails the job and returns the whole word reservation', async () => {
  await resetWallet();
  const job = await enqueueContent(account, request(textProfile));
  await processNextContent({
    transport: async () => {
      throw Error('ai_provider_http_401');
    },
    imageTransport: images(2),
  });
  const done = await contentJob(account, job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.results.length, 0);
  assert.equal(await wallet(), 1030);
});
test('Brand identity and a reference image from the form reach the model; foreign files are refused', async () => {
  await resetWallet();
  const ref = await storeContent(account, png, 'reference');
  await saveImageBrand(account, { name: 'Kopi Nusantara', description: 'Hangat', colors: '#087f5b', logo: ref.id });
  const seen: any[] = [];
  const job = await enqueueContent(account, request(imageProfile, { brief: 'Poster promo', foto: ref.id }));
  await processNextContent({
    imageTransport: async (_connection, input) => {
      seen.push(input);
      return images(input.count)();
    },
  });
  assert.equal((await contentJob(account, job.id)).status, 'completed');
  assert.match(seen[0].prompt, /Poster promo[\s\S]*Identitas brand:\nKopi Nusantara\nHangat\n#087f5b/);
  assert.equal(seen[0].references.length, 2);
  const foreign = await storeContent(other, png, 'reference');
  await assert.rejects(
    () => enqueueContent(account, request(imageProfile, { brief: 'x', foto: foreign.id })),
    /tidak ditemukan/,
  );
  await assert.rejects(() => contentJob(other, job.id), /tidak ditemukan/);
});
test('Form validation: unknown, required, and invalid choices are refused; empty optionals are accepted', async () => {
  await resetWallet();
  await assert.rejects(
    () => enqueueContent(account, request(imageProfile, { brief: 'x', hack: '1' })),
    /tidak dikenal/,
  );
  await assert.rejects(() => enqueueContent(account, request(imageProfile, { brief: '' })), /Brief wajib diisi/);
  await assert.rejects(
    () => enqueueContent(account, request(imageProfile, { brief: 'x', gaya: 'Mewah' })),
    /Gaya tidak valid/,
  );
  await assert.rejects(() => enqueueContent(account, request(textProfile + 'x', { brief: 'x' })), /tidak tersedia/);
  const job = await enqueueContent(account, request(imageProfile, { brief: 'x', gaya: '', foto: '' }));
  assert.equal(job.status, 'queued');
  await processNextContent({ imageTransport: images(2), transport: answer });
});
test('Concurrent requests with the same ID reserve once, and a different body is a conflict', async () => {
  await resetWallet();
  const body = request(textProfile);
  const [a, b] = await Promise.all([enqueueContent(account, body), enqueueContent(account, body)]);
  assert.equal(a.id, b.id);
  const config = await ai.config();
  assert.equal(1030 - (await wallet()), creditCost(5, 300, config.input_rate, config.output_rate));
  await assert.rejects(
    () => enqueueContent(account, { ...body, values: { brief: 'brief lain' } }),
    /ID permintaan telah dipakai/,
  );
  await processNextContent({ imageTransport: images(2), transport: answer });
});
test('Not enough credit creates no job and debits nothing; the queue holds at most three open jobs', async () => {
  await resetWallet();
  await db.execute('UPDATE ai_wallets SET balance=0,plan_balance=0 WHERE account_id=?', [account]);
  await assert.rejects(() => enqueueContent(account, request(textProfile)), /Kredit AI tidak cukup/);
  assert.equal(await wallet(), 0);
  await resetWallet();
  for (let i = 0; i < 3; i++) await enqueueContent(account, request(imageProfile));
  await assert.rejects(() => enqueueContent(account, request(imageProfile)), /Maksimum 3 pekerjaan/);
  for (let i = 0; i < 3; i++) await processNextContent({ imageTransport: images(2), transport: answer });
});
test('A restart interrupts pending jobs and returns their word reservation exactly once', async () => {
  await resetWallet();
  const job = await enqueueContent(account, request(textProfile));
  await db.execute("UPDATE ai_content_jobs SET status='running' WHERE id=?", [job.id]);
  assert.ok((await wallet()) < 1030);
  await ai.recover();
  await recoverContentJobs();
  await ai.recover();
  await recoverContentJobs();
  assert.equal(await wallet(), 1030);
  const done = await contentJob(account, job.id);
  assert.equal(done.status, 'interrupted');
  assert.match(String(done.error), /Kredit dikembalikan/);
  assert.equal(await processNextContent({ transport: answer, imageTransport: images(2) }), false);
});
test('Result files are served from the account library only and never from another account', async () => {
  const file = await storeContent(account, png, 'result');
  assert.equal((await sharp(await readFile(contentPath(account, file.id))).metadata()).format, 'jpeg');
  await assert.rejects(() => contentFile(other, file.id), /tidak ditemukan/);
});

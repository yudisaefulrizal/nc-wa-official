// Node Buat gambar: kontrak (port created/failed wajib tersambung), hasil JPEG di data profil yang dikirim lewat Kirim
// media, reservasi dan pengembalian kredit (sukses, gagal, sebagian, dibatalkan, restart), serta simulasi tanpa kredit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../../../src/libraries/db.js';
import { storagePaths } from '../../../src/libraries/storage.js';
import { ai } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import type { ImageTransport } from '../../../src/components/ai/domain/image-provider.js';
import {
  blankDefinition,
  outputFields,
  parseDefinition,
  ports,
  validateGraph,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import {
  dataProfileImages,
  databaseImages,
  previewImages,
} from '../../../src/components/ai/domain/builder/image-generation.js';
import { previewMedia } from '../../../src/components/ai/domain/builder/media.js';
import { previewFiles } from '../../../src/components/ai/domain/builder/generated-files.js';
import { recordFilePath } from '../../../src/components/ai/domain/builder/record-files.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';
import { recover } from '../../../src/components/ai/domain/runtime.js';
import { installImageProviders, removeImageProviders, type ImageProviders } from './image-fixture.js';
import * as walletsSql from '../../../src/components/ai/data-access/wallets-queries.js';
import * as usageSql from '../../../src/components/ai/data-access/usage-queries.js';

const owner = randomUUID(),
  client = randomUUID();
const graphIds: string[] = [];
let providers: ImageProviders;
let profile = '';
const noModel: AITransport = async () => {
  throw Error('Model tidak boleh dipanggil');
};
const scope = () => ({
  account: client,
  profile,
  session: 'wa',
  customer: '62811',
  requestId: randomUUID(),
  fallbackEnabled: false,
});
const wallet = async () => {
  const [rows] = await db.execute<any[]>('SELECT balance,plan_balance FROM ai_wallets WHERE account_id=?', [client]);
  return { balance: Number(rows[0].balance), plan: Number(rows[0].plan_balance) };
};
// Saldo awal: 30 kredit paket + 1000 kredit hasil beli; catatan pemakaian gambar dibersihkan agar tiap tes berdiri sendiri.
const resetWallet = async () => {
  await db.execute("DELETE FROM ai_usage WHERE account_id=? AND agent='image'", [client]);
  await db.execute(
    'UPDATE ai_wallets SET balance=1000,plan_balance=30,plan_quota=30,plan_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE account_id=?',
    [client],
  );
};
const transparent = () =>
  sharp({ create: { width: 32, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
const returning =
  (calls: { n: number }): ImageTransport =>
  async (_connection, input) => {
    calls.n++;
    return Promise.all(Array.from({ length: input.count }, transparent));
  };
before(async () => {
  providers = await installImageProviders();
  for (const [id, role] of [
    [owner, 'owner'],
    [client, 'user'],
  ])
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@image-node.test.invalid',
      'unused',
      role,
    ]);
  const d = blankDefinition();
  d.collections = [];
  const g = await store.createGraph(owner, d);
  graphIds.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  profile = (await ai.createDataProfile(client, { profile_type: g.id, name: 'Gambar' })).id;
  await ai.wallet(client);
  await resetWallet();
});
after(async () => {
  await rm(join(storagePaths().recordFiles, client), { recursive: true, force: true });
  for (const id of [owner, client]) {
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
// Input → Buat gambar; created → Kirim media → Output; failed → Output permintaan maaf.
function graph(extra: Partial<GraphNode> = {}): GraphDefinition {
  const d = blankDefinition();
  const base = d.nodes[2];
  d.nodes = [
    d.nodes[0],
    {
      ...base,
      id: 'gambar',
      type: 'image_gen',
      label: 'Gambar',
      value: 'Poster {{input.message}}',
      image_ratio: '4:5',
      image_count: 2,
      image_brand: false,
      image_refs: '',
      ...extra,
    },
    { ...base, id: 'kirim', type: 'media', label: 'Kirim', value: '{{nodes.gambar.files}}', media_as: 'image' },
    { ...base, id: 'output', label: 'output', value: 'Jadi {{nodes.gambar.count}} gambar' },
    { ...base, id: 'maaf', label: 'maaf', value: 'Maaf gagal: {{nodes.gambar.reason}}' },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'gambar' },
    { id: 'e2', source: 'gambar', port: 'created', target: 'kirim' },
    { id: 'e3', source: 'kirim', port: 'next', target: 'output' },
    { id: 'e4', source: 'gambar', port: 'failed', target: 'maaf' },
  ];
  return d;
}
const run = async (transport: ImageTransport, extra: Partial<GraphNode> = {}, config: Record<string, unknown> = {}) => {
  const s = scope();
  const base = { ...(await ai.config()), ...config } as Awaited<ReturnType<typeof ai.config>>;
  return runGraph(
    graph(extra),
    noModel,
    base,
    [{ role: 'user', content: 'Kopi Senja' }],
    s,
    null,
    undefined,
    300,
    undefined,
    undefined,
    undefined,
    databaseImages(s, base, dataProfileImages(s), transport),
  );
};
const usage = async () => {
  const [rows] = await db.execute<any[]>(
    "SELECT status,charged,reserved FROM ai_usage WHERE account_id=? AND request_id LIKE 'img\\_%' ORDER BY created_at DESC,request_id DESC",
    [client],
  );
  return rows;
};

test('Contract: ports, outputs, required prompt, and limits', () => {
  const d = parseDefinition(graph());
  assert.deepEqual(validateGraph(d), []);
  const node = d.nodes[1];
  assert.deepEqual(ports(node), ['created', 'failed']);
  assert.deepEqual(outputFields(node), ['file', 'files', 'count', 'reason']);
  assert.match(validateGraph(parseDefinition(graph({ value: ' ' })))[0].message, /Isi prompt gambar/);
  assert.throws(() => parseDefinition(graph({ image_count: 4 })), /Jumlah gambar/);
  assert.throws(() => parseDefinition(graph({ image_ratio: '16:9' as never })));
  const missing = graph();
  missing.edges = missing.edges.filter(e => e.port !== 'failed');
  assert.match(
    validateGraph(parseDefinition(missing))
      .map(i => i.message)
      .join(),
    /port failed/,
  );
  const misplaced = graph();
  misplaced.nodes[3] = { ...misplaced.nodes[3], image_count: 2 };
  assert.match(
    validateGraph(parseDefinition(misplaced))
      .map(i => i.message)
      .join(),
    /hanya untuk Buat gambar/,
  );
});

test('Success: reserves and charges per image, stores JPEG in the data profile, and queues it for Kirim media', async () => {
  await resetWallet();
  const calls = { n: 0 };
  const result = await run(returning(calls));
  assert.equal(calls.n, 1);
  assert.equal(result.answer, 'Jadi 2 gambar');
  const media = ('media' in result && result.media) || [];
  assert.equal(media.length, 2);
  assert.ok(media.every(m => m.type === 'image' && m.kind === 'file'));
  const file = await recordFilePath(client, profile, media[0].ref);
  assert.equal(file.media_type, 'image');
  assert.equal(file.mimetype, 'image/jpeg');
  const stored = await readFile(file.path);
  assert.equal((await sharp(stored).metadata()).format, 'jpeg');
  // Bagian transparan menjadi putih, bukan hitam.
  const { data } = await sharp(stored).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] >= 250 && data[1] >= 250 && data[2] >= 250);
  // Kredit paket (30) dipakai lebih dulu; 20 sisanya dari saldo beli.
  assert.deepEqual(await wallet(), { balance: 980, plan: 0 });
  const [row] = await usage();
  assert.equal(row.status, 'image_completed');
  assert.equal(Number(row.charged), 50);
  assert.equal(Number(row.reserved), 0);
});

test('Provider failure: failed port, reason gagal, and the whole reservation returns to the original buckets', async () => {
  await resetWallet();
  const result = await run(async () => {
    throw Error('provider_down');
  });
  assert.equal(result.answer, 'Maaf gagal: gagal');
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
  const [row] = await usage();
  assert.equal(row.status, 'image_failed');
  assert.equal(Number(row.charged), 0);
});

test('Partial result: saved images are charged, the rest is refunded', async () => {
  await resetWallet();
  const result = await run(async () => [await transparent(), Buffer.from('bukan gambar')]);
  assert.equal(result.answer, 'Jadi 1 gambar');
  // Dipesan 50 (30 paket + 20 beli), terpakai 25: refund 25 kembali 20 ke saldo beli dan 5 ke kredit paket.
  assert.deepEqual(await wallet(), { balance: 1000, plan: 5 });
  const [row] = await usage();
  assert.equal(Number(row.charged), 25);
});

test('Not enough credit never calls the model; missing image tier fails with belum_diatur', async () => {
  await db.execute('UPDATE ai_wallets SET balance=10,plan_balance=0 WHERE account_id=?', [client]);
  const calls = { n: 0 };
  assert.equal((await run(returning(calls))).answer, 'Maaf gagal: kredit');
  assert.equal(calls.n, 0);
  await resetWallet();
  const none = await run(returning(calls), {}, { tier_profiles: {} });
  assert.equal(none.answer, 'Maaf gagal: belum_diatur');
  assert.equal(calls.n, 0);
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
});

test('A prompt made only of a variable works; a reference outside this data profile fails with referensi', async () => {
  await resetWallet();
  const calls = { n: 0 };
  assert.equal((await run(returning(calls), { value: '{{input.message}}' })).answer, 'Jadi 2 gambar');
  await resetWallet();
  const bad = await run(returning(calls), { image_refs: randomUUID() });
  assert.equal(bad.answer, 'Maaf gagal: referensi');
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
});

test('Cancelling the flow stops it instead of taking the failed port, and the credit is refunded', async () => {
  await resetWallet();
  const controller = new AbortController();
  await assert.rejects(
    run(
      async () => {
        controller.abort();
        throw Error('aborted');
      },
      {},
      { signal: controller.signal },
    ),
  );
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
});

test('A reservation left by a restart is refunded by recovery', async () => {
  await resetWallet();
  const id = 'img_' + randomUUID();
  const c = await db.getConnection();
  try {
    await walletsSql.debit(c, [50, client]);
    await usageSql.insertNodeImage(c, [client, id, 'wa', '62811', 50, 'fixture-image', 30]);
  } finally {
    c.release();
  }
  assert.deepEqual(await wallet(), { balance: 980, plan: 0 });
  await recover(ai, client);
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
  const [rows] = await db.execute<any[]>('SELECT status,reserved FROM ai_usage WHERE account_id=? AND request_id=?', [
    client,
    id,
  ]);
  assert.equal(rows[0].status, 'interrupted');
});

test('Simulation shows file names without calling a model or spending credit', async () => {
  await resetWallet();
  const result = await runGraph(
    graph(),
    noModel,
    { ...defaults },
    [{ role: 'user', content: 'Kopi' }],
    scope(),
    null,
    undefined,
    300,
    previewMedia,
    previewFiles,
    undefined,
    previewImages,
  );
  assert.equal(result.answer, 'Jadi 2 gambar');
  const media = ('media' in result && result.media) || [];
  assert.deepEqual(
    media.map(m => m.filename),
    ['gambar-simulasi-1.jpg', 'gambar-simulasi-2.jpg'],
  );
  assert.deepEqual(await wallet(), { balance: 1000, plan: 30 });
});

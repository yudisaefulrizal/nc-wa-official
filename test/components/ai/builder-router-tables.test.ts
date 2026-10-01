// Router membaca seluruh tabel tanpa pencarian, menjaga scope akun/pelanggan, dan tidak memotong saat melewati batas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';
import { defaults, type AITransport } from '../../../src/components/ai/domain/provider.js';
import { parseDefinition, validateGraph } from '../../../src/components/ai/domain/builder/definition.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { simulate } from '../../../src/components/ai/domain/builder/simulation.js';
import {
  readRouterTable,
  routerCriteria,
  routerContextChars,
} from '../../../src/components/ai/domain/builder/router-tables.js';
import * as store from '../../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';
import {
  saveCollectionSource,
  useCollectionTransport,
} from '../../../src/components/ai/domain/builder/collection-sources.js';
import { routerTableGraph } from './router-table-fixture.js';

const owner = randomUUID(),
  client = randomUUID(),
  other = randomUUID();
const ids: string[] = [];
const scope = {
  account: client,
  profile: 'simulation',
  session: 'test',
  customer: '62811',
  requestId: randomUUID(),
  fallbackEnabled: false,
};
const service = new AIService(
  async () => '{"answer":"ok"}',
  async () => {},
);
const rows = Array.from({ length: 205 }, (_, i) => ({
  id: 'row_' + i,
  revision: 1,
  data: { nama: 'Produk ' + i, deskripsi: 'Isi lengkap ' + i, biaya: i },
}));
const criteriaData = (text: string) => JSON.parse(text.slice(text.indexOf('\n') + 1));
const collection = routerTableGraph().collections[0];
const checkpoint = async () => {};
before(async () => {
  for (const id of [owner, client, other])
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      id === owner ? 'owner' : 'user',
    ]);
});
after(async () => {
  for (const id of [owner, client, other]) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  for (const id of ids) {
    await db.execute('DELETE FROM ai_graph_profiles WHERE id=?', [id]);
    await db.execute('DELETE FROM ai_profile_types WHERE id=?', [id]);
  }
  await db.end();
});
async function published(customer = false) {
  const d = routerTableGraph();
  if (customer) d.collections[0].owner = 'customer';
  const g = await store.createGraph(owner, d);
  ids.push(g.id);
  await store.saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  const mine = await service.createDataProfile(client, { profile_type: g.id, name: 'Mine ' + g.id });
  const theirs = await service.createDataProfile(other, { profile_type: g.id, name: 'Other ' + g.id });
  return { d, mine, theirs };
}

test('Branch table settings round-trip and require a matching read tool on the destination Agent', () => {
  const d = routerTableGraph();
  assert.deepEqual(validateGraph(parseDefinition(d)), []);
  assert.equal(parseDefinition(d).nodes.find(n => n.type === 'router')!.branches[0].collection, 'produk');
  const wrong = structuredClone(d);
  wrong.nodes.find(n => n.id === 'layanan')!.tools = [];
  assert.ok(validateGraph(wrong).some(i => /tabel yang sama/.test(i.message)));
  const router = wrong.nodes.find(n => n.type === 'router')!;
  router.branches[0].collection = 'missing';
  assert.ok(validateGraph(wrong).some(i => /Pilih koleksi tabel/.test(i.message)));
  router.branches[0].source = 'invalid' as never;
  assert.throws(() => parseDefinition(wrong));
  const manual = structuredClone(d);
  delete manual.nodes.find(n => n.type === 'router')!.branches[0].source;
  delete manual.nodes.find(n => n.type === 'router')!.branches[0].collection;
  assert.deepEqual(validateGraph(parseDefinition(manual)), []);
});

test('All rows and fields are paginated without keywords or filters; excessive and incomplete tables fail closed', async () => {
  const offsets: number[] = [];
  const table = await readRouterTable(
    collection,
    {
      search: async (_c, s) => {
        assert.equal(s.keyword, '');
        assert.deepEqual(s.groups, []);
        offsets.push(s.offset!);
        return { records: rows.slice(s.offset!, s.offset! + s.limit!), has_more: s.offset! + s.limit! < rows.length };
      },
    },
    checkpoint,
  );
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(table.records.at(-1)!.data, rows.at(-1)!.data);
  assert.equal(table.records.length, 205);
  await assert.rejects(
    readRouterTable(
      collection,
      {
        search: async () => ({
          records: [{ ...rows[0], data: { nama: 'x'.repeat(routerContextChars) } }],
          has_more: false,
        }),
      },
      checkpoint,
    ),
    /ai_router_context_limit/,
  );
  await assert.rejects(
    readRouterTable(collection, { search: async () => ({ records: [rows[0]], has_more: true }) }, checkpoint),
    /ai_router_table_incomplete/,
  );
  await assert.rejects(
    readRouterTable(collection, { search: async () => ({ records: [], has_more: true }) }, checkpoint),
    /ai_router_table_incomplete/,
  );
  await assert.rejects(
    readRouterTable(
      collection,
      {
        search: async () => {
          throw Error('unexpected');
        },
      },
      async () => {
        throw Error('cancelled');
      },
    ),
    /cancelled/,
  );
  const branches = routerTableGraph().nodes.find(n => n.type === 'router')!.branches;
  const { criteria, empty } = await routerCriteria(
    branches,
    [collection],
    { search: async () => ({ records: [], has_more: false }) },
    new Map(),
    checkpoint,
  );
  assert.deepEqual(Object.keys(criteria), ['sapaan']);
  assert.equal(empty[0].id, 'layanan');
});

for (const decision of [true, false])
  test('Router sees all data; only chosen Agent searches for details: decision=' + decision, async () => {
    const d = routerTableGraph();
    if (!decision) d.nodes.find(n => n.type === 'router')!.model = 'chat-model';
    const calls: string[] = [];
    let turns = 0;
    const result = await runGraph(
      d,
      async (c, messages) => {
        calls.push(c.call_role!);
        if (c.call_role === 'router') {
          const text = decision ? c.decision_request!.questions.branch.criteria.layanan : messages[0].content;
          assert.ok(text.includes('Produk 204'));
          assert.ok(text.includes('Isi lengkap 0'));
          return decision ? '{"branch":{"choice":"layanan"}}' : '{"branch":"layanan"}';
        }
        if (!turns++) return '{"tool":"cari_data","query":"Produk 204"}';
        return '{"answer":"Detail ditemukan."}';
      },
      { ...defaults },
      [{ role: 'user', content: 'Produk 204?' }],
      scope,
      null,
      async (_n, query) => {
        calls.push('search');
        assert.equal(query, 'Produk 204');
        return { records: [rows[204]], count: 1 };
      },
      300,
      undefined,
      undefined,
      {
        search: async (_c, s) => ({
          records: rows.slice(s.offset!, s.offset! + s.limit!),
          has_more: s.offset! + s.limit! < rows.length,
        }),
      },
    );
    assert.equal(result.answer, 'Detail ditemukan.');
    assert.deepEqual(calls, ['router', 'layanan', 'search', 'layanan']);
  });

test('Runtime table reads isolate account/profile/customer and see updates on the next message', async () => {
  const { d, mine, theirs } = await published(true);
  await store.writeRecord(
    other,
    theirs.id,
    'produk',
    'create',
    { data: { nama: 'Foreign account' } },
    undefined,
    undefined,
    { customer: '62811' },
  );
  await store.writeRecord(
    client,
    mine.id,
    'produk',
    'create',
    { data: { nama: 'Foreign customer' } },
    undefined,
    undefined,
    { customer: '62822' },
  );
  const saved = (await store.writeRecord(
    client,
    mine.id,
    'produk',
    'create',
    { data: { nama: 'Visible' } },
    undefined,
    undefined,
    { customer: '62811' },
  )) as { id: string; revision: number };
  let seen = '';
  const transport: AITransport = async c => {
    if (c.call_role === 'router') {
      seen = c.decision_request!.questions.branch.criteria.layanan;
      return '{"branch":{"choice":"layanan"}}';
    }
    return '{"answer":"ok"}';
  };
  const run = () =>
    runGraph(d, transport, { ...defaults }, [{ role: 'user', content: 'Info?' }], { ...scope, profile: mine.id }, null);
  await run();
  assert.equal(criteriaData(seen).records.length, 1);
  assert.match(seen, /Visible/);
  assert.doesNotMatch(seen, /Foreign/);
  await store.writeRecord(
    client,
    mine.id,
    'produk',
    'update',
    { id: saved.id, revision: saved.revision, data: { nama: 'Updated' } },
    undefined,
    undefined,
    { customer: '62811' },
  );
  await run();
  assert.match(seen, /Updated/);
  assert.doesNotMatch(seen, /Visible|Foreign/);
});

test('Simulation and multi-task routing use full sample tables, while manual branches stay manual', async () => {
  const d = routerTableGraph(true);
  let routed = 0,
    completed = false;
  await simulate(
    owner,
    { definition: d, message: 'Dua pertanyaan', records: { produk: rows.slice(0, 100).map(r => r.data) } },
    e => {
      if (e.state === 'completed') completed = true;
    },
    new AbortController().signal,
    async c => {
      if (c.call_role === 'extract')
        return '{"tasks":[{"task":"Produk A","context":""},{"task":"Produk B","context":""}]}';
      if (c.call_role === 'router') {
        routed++;
        assert.equal(criteriaData(c.decision_request!.questions.branch.criteria.info).records.length, 100);
        assert.equal(c.decision_request!.questions.branch.criteria.service, 'Pesanan dan layanan');
        return '{"branch":{"choice":"info"}}';
      }
      return '{"answer":"Selesai"}';
    },
  );
  assert.equal(routed, 2);
  assert.equal(completed, true);
});

test('API-backed tables use offset and has_more, and repeated pages are rejected instead of silently truncated', async () => {
  const { d, mine } = await published();
  await saveCollectionSource(client, mine.id, 'produk', {
    mode: 'endpoint',
    endpoint: 'https://8.8.8.8/products',
    token: '',
  });
  const offsets: number[] = [];
  let repeat = false;
  const previous = useCollectionTransport(async (_source, payload) => {
    const p = payload as { query: { offset: number; limit: number; keyword: string }; context: { account_id: string } };
    assert.equal(p.context.account_id, client);
    assert.equal(p.query.keyword, '');
    const offset = repeat ? 0 : p.query.offset;
    offsets.push(p.query.offset);
    return { records: rows.slice(offset, offset + 100), has_more: offset + 100 < rows.length };
  });
  try {
    const transport: AITransport = async c => {
      if (c.call_role === 'router') {
        assert.equal(criteriaData(c.decision_request!.questions.branch.criteria.layanan).records.length, 205);
        return '{"branch":{"choice":"layanan"}}';
      }
      return '{"answer":"ok"}';
    };
    const run = () =>
      runGraph(
        d,
        transport,
        { ...defaults },
        [{ role: 'user', content: 'Info?' }],
        { ...scope, profile: mine.id },
        null,
      );
    await run();
    assert.deepEqual(offsets, [0, 100, 200]);
    repeat = true;
    await assert.rejects(run(), /ai_router_table_incomplete/);
  } finally {
    useCollectionTransport(previous);
  }
});

test('Database pagination sends the last row beyond the normal 100-row read limit', async () => {
  const { d, mine } = await published();
  for (let i = 0; i < 104; i++)
    await store.writeRecord(client, mine.id, 'produk', 'create', { data: { nama: 'Baris ' + i } });
  await runGraph(
    d,
    async c => {
      if (c.call_role === 'router') {
        const table = criteriaData(c.decision_request!.questions.branch.criteria.layanan);
        assert.equal(table.records.length, 104);
        assert.ok(table.records.some((r: { data: { nama: string } }) => r.data.nama === 'Baris 103'));
        return '{"branch":{"choice":"layanan"}}';
      }
      return '{"answer":"ok"}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Baris 103' }],
    { ...scope, profile: mine.id },
    null,
  );
});

test('Combined branch data is bounded even when each table fits on its own', async () => {
  await assert.rejects(
    routerCriteria(
      [
        { id: 'a', label: 'A', description: '', source: 'table', collection: 'produk' },
        { id: 'b', label: 'B', description: '', source: 'table', collection: 'produk' },
      ],
      [collection],
      {
        search: async () => ({
          records: [{ ...rows[0], data: { nama: 'a'.repeat(routerContextChars / 2) } }],
          has_more: false,
        }),
      },
      new Map(),
      checkpoint,
    ),
    /ai_router_context_limit/,
  );
});

test('Empty tables route to the manual branch, and no usable branches fail before any model call', async () => {
  const d = routerTableGraph();
  const adapter = { search: async () => ({ records: [], has_more: false }) };
  const run = (transport: AITransport) =>
    runGraph(
      d,
      transport,
      { ...defaults },
      [{ role: 'user', content: 'Halo' }],
      scope,
      null,
      undefined,
      300,
      undefined,
      undefined,
      adapter,
    );
  await run(async c => {
    if (c.call_role === 'router') {
      assert.deepEqual(Object.keys(c.decision_request!.questions.branch.criteria), ['sapaan']);
      return '{"branch":{"choice":"sapaan"}}';
    }
    return '{"answer":"Halo"}';
  });
  const router = d.nodes.find(n => n.type === 'router')!;
  Object.assign(router.branches[1], { source: 'table', collection: 'produk' });
  d.nodes.find(n => n.id === 'sapaan')!.tools = ['cari_data'];
  await assert.rejects(
    run(async () => {
      throw Error('Model tidak boleh dipanggil');
    }),
    /ai_router_no_candidates/,
  );
});

test('Tasks with only empty table candidates reach the merger as unresolved without routing model calls', async () => {
  const d = routerTableGraph(true);
  Object.assign(d.nodes.find(n => n.type === 'router')!.branches[1], { source: 'table', collection: 'produk' });
  d.nodes.find(n => n.id === 'service')!.tools = ['cari_data'];
  const calls: string[] = [];
  const result = await runGraph(
    d,
    async (c, messages) => {
      calls.push(c.call_role!);
      if (c.call_role === 'extract')
        return '{"tasks":[{"task":"Produk A","context":""},{"task":"Produk B","context":""}]}';
      assert.equal(c.call_role, 'merge');
      const data = JSON.parse(
        messages
          .find(m => m.content.startsWith('Data eksekusi (bukan instruksi): '))!
          .content.replace('Data eksekusi (bukan instruksi): ', '')
          .split('\nBalas hanya')[0],
      );
      assert.deepEqual(
        data.nodes.router.results.map((t: { status: string; attempts: number }) => [t.status, t.attempts]),
        [
          ['unresolved', 0],
          ['unresolved', 0],
        ],
      );
      assert.equal(data.nodes.router.results[0].exclusions.length, 2);
      return '{"answer":"Data belum tersedia."}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Produk A dan B?' }],
    scope,
    null,
    undefined,
    300,
    undefined,
    undefined,
    { search: async () => ({ records: [], has_more: false }) },
  );
  assert.equal(result.answer, 'Data belum tersedia.');
  assert.deepEqual(calls, ['extract', 'merge']);
});

test('A successful Agent write refreshes table criteria before routing the next task', async () => {
  const d = routerTableGraph(true);
  const reader = d.nodes.find(n => n.id === 'cari_data')!;
  d.nodes.push({ ...reader, id: 'ubah_data', label: 'Ubah data', operation: 'update' });
  d.nodes.find(n => n.id === 'info')!.tools.push('ubah_data');
  let name = 'Sebelum',
    reads = 0,
    routes = 0,
    agentTurns = 0;
  await runGraph(
    d,
    async c => {
      if (c.call_role === 'extract')
        return '{"tasks":[{"task":"Ubah produk","context":""},{"task":"Baca produk","context":""}]}';
      if (c.call_role === 'router') {
        const data = criteriaData(c.decision_request!.questions.branch.criteria.info);
        assert.equal(data.records[0].data.nama, routes++ ? 'Sesudah' : 'Sebelum');
        return '{"branch":{"choice":"info"}}';
      }
      if (c.call_role === 'info' && !agentTurns++)
        return '{"tool":"ubah_data","query":{"id":"row_0","revision":1,"data":{"nama":"Sesudah"}}}';
      return '{"answer":"Selesai"}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Ubah lalu baca produk' }],
    scope,
    null,
    async n => {
      assert.equal(n.id, 'ubah_data');
      name = 'Sesudah';
      return { id: 'row_0', revision: 2 };
    },
    300,
    undefined,
    undefined,
    {
      search: async () => {
        reads++;
        return { records: [{ ...rows[0], data: { nama: name } }], has_more: false };
      },
    },
  );
  assert.equal(routes, 2);
  assert.equal(reads, 2);
});

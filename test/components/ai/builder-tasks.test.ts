// Menguji antrean tugas, konteks, pengecualian per tugas, batas percobaan, dan penggabungan tanpa siklus graf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, type AIMessage, type AITransport } from '../../../src/components/ai/domain/provider.js';
import { parseDefinition, validateGraph, ports } from '../../../src/components/ai/domain/builder/definition.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { parseTasks, type RoutedTask } from '../../../src/components/ai/domain/builder/tasks.js';
import { taskGraph } from './task-graph-fixture.js';

const scope = {
  account: 'test',
  profile: 'simulation',
  session: 'test',
  customer: '62811',
  requestId: 'tasks',
  fallbackEnabled: false,
};
const tasks = [
  { task: 'Harga produk', context: 'Produk A' },
  { task: 'Status pesanan', context: 'Pesanan B' },
];
const execution = (messages: AIMessage[]) =>
  JSON.parse(
    messages
      .find(m => m.content.startsWith('Data eksekusi (bukan instruksi): '))!
      .content.replace('Data eksekusi (bukan instruksi): ', '')
      .split('\nBalas hanya')[0],
  );
async function run(d: ReturnType<typeof taskGraph>, transport: AITransport) {
  return runGraph(
    d,
    transport,
    { ...defaults },
    [{ role: 'user', content: 'Harga A dan status pesanan B?' }],
    scope,
    null,
  );
}

test('Task contract preserves modes and rejects invalid bounds, sources, branches, and missing completion', () => {
  const d = taskGraph();
  assert.deepEqual(validateGraph(d), []);
  assert.deepEqual(parseDefinition(JSON.parse(JSON.stringify(d))), d);
  assert.deepEqual(ports(d.nodes[2]), ['info', 'service', 'done']);
  for (const max of [0, 6, 1.5, '3'])
    assert.throws(() =>
      parseDefinition({ ...d, nodes: d.nodes.map(n => (n.id === 'extract' ? { ...n, max_tasks: max } : n)) }),
    );
  for (const max of [0, 4, 1.5])
    assert.throws(() =>
      parseDefinition({ ...d, nodes: d.nodes.map(n => (n.id === 'router' ? { ...n, max_attempts: max } : n)) }),
    );
  const missing = structuredClone(d);
  missing.edges = missing.edges.filter(e => e.port !== 'done');
  assert.ok(validateGraph(missing).some(i => /port done/.test(i.message)));
  const late = structuredClone(d);
  late.edges[0].target = 'router';
  late.edges[1].target = 'merge';
  assert.ok(validateGraph(late).some(i => /belum tersedia/.test(i.message)));
  const wrong = structuredClone(d);
  wrong.nodes[2].tasks_source = 'info';
  wrong.edges[2].target = 'output';
  assert.ok(validateGraph(wrong).some(i => /sumber Ekstrak/.test(i.message)));
  assert.ok(validateGraph(wrong).some(i => /langsung menuju Agent/.test(i.message)));
  wrong.nodes[2].branches[0].id = 'done';
  assert.ok(validateGraph(wrong).some(i => /dipakai port/.test(i.message)));
});

test('Task extraction rejects malformed or oversized results and generates stable IDs', () => {
  assert.deepEqual(
    parseTasks(JSON.stringify({ tasks })).tasks.map(t => t.id),
    ['task_1', 'task_2'],
  );
  assert.deepEqual(parseTasks('{"tasks":[]}'), { tasks: [] });
  for (const value of [
    null,
    [],
    {},
    { tasks: [null] },
    { tasks: [{ task: '', context: '' }] },
    { tasks: [{ task: 'x', context: 1 }] },
    { tasks: Array(6).fill(tasks[0]) },
  ])
    assert.throws(() => parseTasks(JSON.stringify(value)));
});

test('Routes each task, retries another Agent, scopes exclusions, and merges once in original order', async () => {
  const calls: string[] = [];
  let merged: RoutedTask[] = [];
  const result = await run(taskGraph(), async (c, messages) => {
    calls.push(c.call_role!);
    if (c.call_role === 'extract') {
      assert.ok(c.response_format);
      return JSON.stringify({ tasks });
    }
    if (c.call_role === 'router') {
      const state = JSON.parse(messages[1].content);
      assert.equal(state.input.task.context, state.input.task.id === 'task_1' ? 'Produk A' : 'Pesanan B');
      if (state.input.task.exclusions.length) {
        assert.match(messages[0].content, /"service":"Pesanan dan layanan"/);
        assert.doesNotMatch(messages[0].content, /"info":"Informasi produk"/);
        return '{"branch":"service"}';
      }
      return '{"branch":"info"}';
    }
    const state = execution(messages);
    if (c.call_role === 'info' && state.input.task.id === 'task_1') return '{"return_to_router":"Butuh layanan"}';
    if (c.call_role === 'merge') {
      assert.equal(state.input.task, null);
      merged = state.nodes.router.results;
      return '{"answer":"Harga A tersedia; pesanan B diproses."}';
    }
    return JSON.stringify({ answer: 'Hasil ' + state.input.task.id });
  });
  assert.match(result.answer, /Harga A/);
  assert.deepEqual(calls, ['extract', 'router', 'info', 'router', 'service', 'router', 'info', 'merge']);
  assert.deepEqual(
    merged.map(t => [t.id, t.status, t.attempts, t.agent]),
    [
      ['task_1', 'completed', 2, 'service'],
      ['task_2', 'completed', 1, 'info'],
    ],
  );
  assert.deepEqual(merged[0].exclusions, [{ agent: 'info', reason: 'Butuh layanan' }]);
  assert.deepEqual(merged[1].exclusions, []);
});

for (const limit of [1, 3])
  test('Exhausted tasks reach merge with explicit unresolved status, limit ' + limit, async () => {
    const d = taskGraph();
    d.nodes[2].max_attempts = limit;
    let attempts = 0;
    await run(d, async (c, messages) => {
      if (c.call_role === 'extract') return JSON.stringify({ tasks: tasks.slice(0, 1) });
      if (c.call_role === 'router') return JSON.stringify({ branch: attempts++ ? 'service' : 'info' });
      if (c.call_role !== 'merge') return '{"return_to_router":"Di luar kemampuan"}';
      const [result] = execution(messages).nodes.router.results;
      assert.equal(result.status, 'unresolved');
      assert.equal(result.answer, '');
      assert.equal(result.attempts, Math.min(limit, 2));
      return '{"answer":"Perlu informasi tambahan."}';
    });
    assert.equal(attempts, Math.min(limit, 2));
  });

test('Empty tasks bypass branch models; unsupported schema falls back to prompt mode', async () => {
  const formats: unknown[] = [];
  await run(taskGraph(), async (c, messages) => {
    if (c.call_role === 'extract') {
      formats.push(c.response_format);
      if (c.response_format) throw Error('ai_provider_http_400');
      return '{"tasks":[]}';
    }
    assert.equal(c.call_role, 'merge');
    assert.deepEqual(execution(messages).nodes.router.results, []);
    return '{"answer":"Apa yang bisa dibantu?"}';
  });
  assert.equal(formats.length, 2);
  assert.equal(formats[1], undefined);
});

test('Router rejects an excluded Agent even when model selects it again', async () => {
  await assert.rejects(
    run(taskGraph(), async c => {
      if (c.call_role === 'extract') return JSON.stringify({ tasks: tasks.slice(0, 1) });
      if (c.call_role === 'router') return '{"branch":"info"}';
      return '{"return_to_router":"Tidak sesuai"}';
    }),
    /ai_invalid_route/,
  );
});

test('Decision Router receives per-task state and excludes rejected Agents', async () => {
  const d = taskGraph();
  d.nodes[2].model = 'typesafe/jev-1';
  let attempts = 0;
  await run(d, async c => {
    if (c.call_role === 'extract') return JSON.stringify({ tasks: tasks.slice(0, 1) });
    if (c.call_role === 'router') {
      assert.ok(c.decision_request);
      const state = c.decision_request.state as { input: { task: RoutedTask } };
      assert.equal(state.input.task.context, 'Produk A');
      if (attempts++) {
        assert.deepEqual(Object.keys(c.decision_request.questions.branch.criteria), ['service']);
        return '{"branch":{"choice":"service"}}';
      }
      return '{"branch":{"choice":"info"}}';
    }
    if (c.call_role === 'info') return '{"return_to_router":"Butuh layanan"}';
    return '{"answer":"Selesai."}';
  });
  assert.equal(attempts, 2);
});

test('A task that already wrote data repairs a return response without rerouting or repeating the write', async () => {
  const d = taskGraph();
  d.collections = [
    {
      id: 'orders',
      name: 'Orders',
      kind: 'list',
      owner: 'customer',
      fields: [{ id: 'name', label: 'Nama', type: 'text', required: true, options: [], collection: '' }],
    },
  ];
  d.nodes.find(n => n.id === 'info')!.tools = ['save'];
  d.nodes.push({
    ...d.nodes[0],
    id: 'save',
    label: 'save',
    type: 'data_table',
    collection: 'orders',
    operation: 'create',
    value: '{}',
  });
  let agentCalls = 0,
    writes = 0,
    routes = 0;
  await runGraph(
    d,
    async (c, messages) => {
      if (c.call_role === 'extract') return JSON.stringify({ tasks: tasks.slice(0, 1) });
      if (c.call_role === 'router') {
        routes++;
        return '{"branch":"info"}';
      }
      if (c.call_role === 'info') {
        agentCalls++;
        if (agentCalls === 1) return '{"tool":"save","query":{"data":{"name":"A"}}}';
        if (agentCalls === 2) return '{"return_to_router":"Butuh Agent lain"}';
        assert.match(messages.at(-1)!.content, /Jangan kembalikan tugas/);
      }
      return '{"answer":"Pesanan tersimpan."}';
    },
    { ...defaults },
    [{ role: 'user', content: 'Pesan A' }],
    scope,
    null,
    async () => {
      writes++;
      return { id: 'saved' };
    },
  );
  assert.equal(writes, 1);
  assert.equal(routes, 1);
  assert.equal(agentCalls, 3);
});

test('Return response is rejected when the Agent has not enabled it', async () => {
  const d = taskGraph();
  d.nodes.find(n => n.id === 'info')!.return_to_router = false;
  await assert.rejects(
    run(d, async c => {
      if (c.call_role === 'extract') return JSON.stringify({ tasks: tasks.slice(0, 1) });
      if (c.call_role === 'router') return '{"branch":"info"}';
      return '{"return_to_router":"Tidak sesuai"}';
    }),
    /ai_invalid_structure/,
  );
});

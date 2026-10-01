// Tes skill AI: ZIP terbaca, frontmatter sesuai format skill, referensi mencakup semua node/operator/tipe/tier/
// variabel dari validator, contoh S-P-O yang valid dan membawa ringkasan ke pesan berikutnya, serta unduhan hanya untuk
// pemilik.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { createZip } from '../../../src/libraries/zip.js';
import { modelTiers } from '../../../src/components/ai/domain/pipeline/models.js';
import {
  assertRunnable,
  computeArity,
  conditionOperators,
  fieldTypes,
  nodeTypes,
  parseDefinition,
  toolOperations,
} from '../../../src/components/ai/domain/builder/definition.js';
import { filterOperators } from '../../../src/components/ai/domain/builder/record-query.js';
import {
  contextVariablePaths,
  profileSkillZip,
  skillName,
  spoExample,
  spoExampleFile,
  tasksExample,
  tasksExampleFile,
  tasksGuideFile,
  routerTablesGuideFile,
  routerTablesExampleFile,
  singleAgentExampleFile,
  singleAgentExample,
  nodesGuideFile,
  nodeGuideFile,
} from '../../../src/components/ai/domain/builder/skill.js';
import { runGraph } from '../../../src/components/ai/domain/builder/engine.js';
import { defaults, type AIMessage } from '../../../src/components/ai/domain/provider.js';
import { qualityGuideFile, qualityPolicyMarkdown } from '../../../src/components/ai/domain/builder/quality-policy.js';
import {
  workflowFiles,
  structuralGuideFile,
  capabilitiesGuideFile,
  mediaGuideFile,
  contextGuideFile,
} from '../../../src/components/ai/domain/builder/skill-workflow.js';
import {
  dataDesignGuideFile,
  dataDesignMarkdown,
} from '../../../src/components/ai/domain/builder/skill-data-design.js';

// Pembaca ZIP minimal lewat central directory, cukup untuk memeriksa hasil createZip.
function unzip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const crc = zip.readUInt32LE(at + 16),
      size = zip.readUInt32LE(at + 20),
      nameLength = zip.readUInt16LE(at + 28),
      local = zip.readUInt32LE(at + 42),
      name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + size));
    assert.equal(crc32(data), crc, 'CRC ' + name);
    files.set(name, data.toString('utf8'));
    at += 46 + nameLength;
  }
  return files;
}

test('createZip round-trips UTF-8 names and content', () => {
  const files = unzip(createZip([{ name: 'folder/catatan é.md', data: 'Halo — dunia' }]));
  assert.deepEqual([...files], [['folder/catatan é.md', 'Halo — dunia']]);
});

test('Skill package has valid frontmatter, a complete reference, and a runnable S-P-O example', () => {
  const files = unzip(profileSkillZip());
  const skill = files.get(skillName + '/SKILL.md')!;
  const frontmatter = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(frontmatter, 'frontmatter SKILL.md');
  assert.match(frontmatter[1], /^[a-z0-9-]{1,64}$/);
  assert.ok(frontmatter[2].length <= 1024);
  const reference = files.get(skillName + '/reference/format.md')!;
  const nodes = files.get(skillName + '/' + nodesGuideFile)!;
  assert.ok(nodes);
  assert.doesNotMatch(reference + skill, /undefined|\[object Object\]/);
  for (const value of [
    ...nodeTypes,
    ...fieldTypes,
    ...conditionOperators,
    ...filterOperators,
    ...toolOperations,
    ...modelTiers,
    ...Object.keys(computeArity),
  ])
    assert.ok(reference.includes('`' + value + '`'), 'referensi memuat ' + value);
  for (const path of contextVariablePaths) assert.ok(reference.includes('{{' + path + '}}'), path);
  assert.deepEqual(
    [...files.keys()].sort(),
    [
      skillName + '/SKILL.md',
      skillName + '/' + spoExampleFile,
      skillName + '/' + tasksExampleFile,
      skillName + '/' + routerTablesGuideFile,
      skillName + '/' + routerTablesExampleFile,
      skillName + '/' + tasksGuideFile,
      skillName + '/reference/format.md',
      skillName + '/' + nodesGuideFile,
      ...nodeTypes.map(type => skillName + '/' + nodeGuideFile(type)),
      ...workflowFiles().map(f => skillName + '/' + f.path),
      ...[structuralGuideFile, capabilitiesGuideFile, mediaGuideFile, contextGuideFile].map(
        path => skillName + '/' + path,
      ),
      skillName + '/' + qualityGuideFile,
      skillName + '/' + dataDesignGuideFile,
      skillName + '/' + singleAgentExampleFile,
    ].sort(),
  );
  for (const [path, content] of files) {
    if (!path.endsWith('.md')) continue;
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^https?:/.test(target)) continue;
      assert.ok(files.has(posix.normalize(posix.join(posix.dirname(path), target))), path + ' → ' + target);
    }
  }
  assert.ok(skill.includes('](' + spoExampleFile + ')'), 'SKILL.md menaut contoh S-P-O');
  assert.ok(skill.includes('](' + nodesGuideFile + ')'));
  assert.ok(reference.includes('](nodes.md)'));
  // Setiap tipe harus punya satu kontrak lengkap dan tujuan indeks yang tersedia dalam ZIP.
  for (const type of nodeTypes) {
    const sections = files.get(skillName + '/' + nodeGuideFile(type))!.split('### ' + type + '\n');
    assert.equal(sections.length, 2, type);
    const contract = sections[1].split('\n### ')[0];
    for (const field of [
      'Kegunaan / proses',
      'Input',
      'Parameter',
      'Output data',
      'Port alur',
      'Sambungan',
      'Kosong / gagal / batasan',
      'Contoh',
    ])
      assert.ok(contract.includes('**' + field + ':**'), type + ': ' + field);
  }
  assert.ok(skill.includes('](' + qualityGuideFile + ')'));
  assert.equal(files.get(skillName + '/' + qualityGuideFile), qualityPolicyMarkdown());
  assert.equal(files.get(skillName + '/' + dataDesignGuideFile), dataDesignMarkdown());
  assert.ok(skill.includes('](' + dataDesignGuideFile + ')'));
  assert.ok(reference.includes('](data-design.md)'));
  assert.ok(skill.includes('](' + singleAgentExampleFile + ')'));
  assertRunnable(parseDefinition(JSON.parse(files.get(skillName + '/' + singleAgentExampleFile)!)));
  assertRunnable(parseDefinition(JSON.parse(files.get(skillName + '/' + spoExampleFile)!)));
  assert.ok(skill.includes('](' + tasksGuideFile + ')'));
  assert.ok(skill.includes('](' + tasksExampleFile + ')'));
  assertRunnable(parseDefinition(JSON.parse(files.get(skillName + '/' + tasksExampleFile)!)));
  assertRunnable(parseDefinition(JSON.parse(files.get(skillName + '/' + routerTablesExampleFile)!)));
  assert.ok(skill.includes('](' + routerTablesGuideFile + ')'));
  assert.match(files.get(skillName + '/' + routerTablesGuideFile)!, /Seluruh nilai field semua baris/);
  const tasksGuide = files.get(skillName + '/' + tasksGuideFile)!;
  for (const term of [
    'extract_mode',
    'routing_mode',
    'tasks_source',
    'max_attempts',
    'return_to_router',
    'input.task.context',
    'nodes.maksud.results',
    'unresolved',
    'done',
    'WebP',
    'kredit pesan tambahan',
  ])
    assert.ok(tasksGuide.includes(term), term);
  assert.match(reference, /input.task/);
  assert.doesNotMatch(skill, /Agent dan Context punya `prompt`|kosongkan `caption`|aplikasi tidak memisahkan caption/);
});

// Contoh minimum harus benar-benar menyelesaikan jalur dengan satu panggilan model.
test('The single-agent example answers without router, extractor or synthesis calls', async () => {
  const d = singleAgentExample();
  assertRunnable(parseDefinition(d));
  const calls: string[] = [];
  const result = await runGraph(
    d,
    async config => {
      calls.push(config.call_role!);
      return JSON.stringify({ answer: 'Ringkasan dari teks pelanggan.' });
    },
    { ...defaults },
    [{ role: 'user', content: 'Ringkas: rapat hari Senin membahas anggaran.' }],
    {
      account: randomUUID(),
      profile: 'simulation',
      session: 'test',
      customer: '628001',
      requestId: randomUUID(),
      fallbackEnabled: false,
    },
    null,
    async () => {
      throw Error('Tidak perlu tool untuk teks yang sudah diberikan');
    },
    100,
  );
  assert.equal(result.answer, 'Ringkasan dari teks pelanggan.');
  assert.deepEqual(calls, ['agent']);
});

// Contoh skill dijalankan dua giliran untuk setiap cabang: ringkasan S-P-O dari giliran pertama sampai ke Router di
// giliran kedua, dan setiap cabang jawaban melewati Context sebelum Output.
test('The S-P-O example carries the summary from one message to the router of the next', async () => {
  const d = spoExample();
  const scope = {
    account: randomUUID(),
    profile: 'simulation',
    session: 'test',
    customer: '628001',
    requestId: randomUUID(),
    fallbackEnabled: true,
  };
  for (const branch of ['informasi', 'layanan', 'sapaan']) {
    const calls: string[] = [];
    let routerInput = '';
    const config = { ...defaults };
    const turn = (message: string, previous: string | null, history: AIMessage[] = []) =>
      runGraph(
        d,
        async (c, messages) => {
          calls.push(c.call_role!);
          if (c.call_role === 'router') {
            routerInput = messages.map(m => m.content).join('\n');
            return JSON.stringify({ branch, fallback_terkait: [] });
          }
          return c.call_role === 'ringkas_konteks' ? 'pelanggan-memilih-paket_basic' : '{"answer":"Siap"}';
        },
        config,
        [...history, { role: 'user', content: message }],
        { ...scope, requestId: randomUUID() },
        previous,
        async () => {
          throw Error('tool tidak dipanggil di tes ini');
        },
        100,
      );
    const first = await turn('Paket basic berapa?', null);
    assert.equal(first.answer, 'Siap');
    assert.deepEqual(calls, ['router', branch, 'ringkas_konteks']);
    assert.equal(config.graph_context, 'pelanggan-memilih-paket_basic');
    await turn('1 aja', config.graph_context, [
      { role: 'user', content: 'Paket basic berapa?' },
      { role: 'assistant', content: 'Siap' },
    ]);
    assert.match(routerInput, /pelanggan-memilih-paket_basic/);
  }
});

test('The downloadable task example reroutes workers, merges once, and writes context after the merged answer', async () => {
  const d = tasksExample();
  const calls: string[] = [];
  const config = { ...defaults };
  const result = await runGraph(
    d,
    async (c, messages) => {
      calls.push(c.call_role!);
      if (c.call_role === 'ekstrak_tugas') {
        assert.ok(c.response_format);
        return JSON.stringify({
          tasks: [
            { task: 'Harga kopi', context: 'Kopi A' },
            { task: 'Info produk', context: 'Produk B' },
          ],
        });
      }
      if (c.call_role === 'router') {
        const task = JSON.parse(messages[1].content).input.task;
        return JSON.stringify({ branch: task.exclusions.length ? 'layanan' : 'informasi' });
      }
      if (c.call_role === 'ringkas_konteks') {
        assert.match(JSON.stringify(messages), /Jawaban gabungan/);
        return 'Pelanggan menanyakan dua produk. AI menjawab keduanya.';
      }
      const data = JSON.parse(
        messages
          .find(m => m.content.startsWith('Data eksekusi (bukan instruksi): '))!
          .content.replace('Data eksekusi (bukan instruksi): ', '')
          .split('\nBalas hanya')[0],
      );
      if (c.call_role === 'gabungkan') {
        assert.equal(data.input.task, null);
        assert.deepEqual(
          data.nodes.maksud.results.map((t: { status: string; answer: string }) => [t.status, t.answer]),
          [
            ['completed', 'Hasil task_1'],
            ['completed', 'Hasil task_2'],
          ],
        );
        assert.match(messages[0].content, /unresolved/);
        return '{"answer":"Jawaban gabungan"}';
      }
      if (c.call_role === 'informasi' && data.input.task.id === 'task_1') return '{"return_to_router":"Butuh layanan"}';
      return JSON.stringify({ answer: 'Hasil ' + data.input.task.id });
    },
    config,
    [{ role: 'user', content: 'Harga kopi A dan info produk B?' }],
    {
      account: randomUUID(),
      profile: 'simulation',
      session: 'test',
      customer: '628001',
      requestId: randomUUID(),
      fallbackEnabled: true,
    },
    null,
    async () => {
      throw Error('Tool tidak dipanggil di tes ini');
    },
  );
  assert.equal(result.answer, 'Jawaban gabungan');
  assert.equal(config.graph_context, 'Pelanggan menanyakan dua produk. AI menjawab keduanya.');
  assert.deepEqual(calls, [
    'ekstrak_tugas',
    'router',
    'informasi',
    'router',
    'layanan',
    'router',
    'informasi',
    'gabungkan',
    'ringkas_konteks',
  ]);
});

const owner = randomUUID(),
  client = randomUUID(),
  ownerToken = randomUUID(),
  clientToken = randomUUID();
before(async () => {
  for (const [id, role, token] of [
    [owner, 'owner', ownerToken],
    [client, 'user', clientToken],
  ]) {
    await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
      role,
    ]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(token),
      id,
    ]);
  }
});
after(async () => {
  for (const id of [owner, client]) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.end();
});

test('Only the owner can download the skill ZIP', async () => {
  const app = createApp();
  const path = '/api/admin/ai/builder/skill';
  const denied = await request(app)
    .get(path)
    .set('Cookie', 'ncwa_session=' + clientToken);
  assert.equal(denied.status, 403);
  const res = await request(app)
    .get(path)
    .set('Cookie', 'ncwa_session=' + ownerToken)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.match(res.headers['content-disposition'], new RegExp('attachment; filename="' + skillName + '\\.zip"'));
  assert.ok(unzip(res.body as Buffer).has(skillName + '/SKILL.md'));
});

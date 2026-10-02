// Pekerjaan profil Konten: klien mengisi formulir profil, graf terbit dijalankan di latar belakang, dan hasilnya
// (gambar dan teks) masuk pustaka. Kata dipesan saat pekerjaan masuk antrean; kredit gambar dipesan node Buat gambar.
// Pekerjaan yang terputus tidak diulang otomatis dan kreditnya dikembalikan.
import { randomUUID, createHash } from 'node:crypto';
import { db, type Executor } from '../../../libraries/db.js';
import { basicWallet } from '../../billing/index.js';
import { ApiError } from '../../../libraries/errors.js';
import { record } from '../../../libraries/validation.js';
import { integer, text, fail } from './input-validation.js';
import { transaction, lockAccount } from './transaction.js';
import { countWords, creditCost, planPart, refundSplit } from './metering.js';
import { ai, type AIService } from './service.js';
import { contentFile } from './content-files.js';
import { runGraph } from './builder/engine.js';
import { parseDefinition, type FormField, type GraphDefinition } from './builder/definition.js';
import { readForm } from './builder/content-form.js';
import { contentLibraryImages, databaseImages } from './builder/image-generation.js';
import type { ContentResult } from './builder/content-results.js';
import { contentGraphs, graphSystem } from './profiles/registry.js';
import type { AIMessage, AITransport } from './provider.js';
import type { ImageTransport } from './image-provider.js';
import * as jobsSql from '../data-access/content-jobs-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';
import * as usageSql from '../data-access/usage-queries.js';

export interface ContentJobDependencies {
  service?: AIService;
  // Penggantian untuk tes: model teks dan model gambar tiruan.
  transport?: AITransport;
  imageTransport?: ImageTransport;
}
interface JobInput {
  values: Record<string, string>;
  // Isian dalam bentuk teks, dibaca node Agent sebagai pesan pelanggan.
  summary: string;
  inputWords: number;
  maxWords: number;
}
const decode = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
const formOf = (d: GraphDefinition): FormField[] => d.nodes.find(n => n.type === 'input')?.form ?? [];
// Node yang memanggil model teks; hanya profil yang memakainya ditagih kredit kata.
const usesTextModel = (d: GraphDefinition) => d.nodes.some(n => ['agent', 'router', 'extract'].includes(n.type));
const maxOpenJobs = 3;

// Profil Konten yang boleh dipakai klien, dengan formulirnya.
export async function contentProfiles() {
  return (await contentGraphs()).map(({ id, revision, definition }) => ({
    id,
    name: definition.name,
    description: definition.description,
    revision,
    fields: formOf(definition),
    // Batas atas jumlah gambar satu pekerjaan, untuk estimasi biaya di formulir.
    maxImages: definition.nodes.filter(n => n.type === 'image_gen').reduce((sum, n) => sum + (n.image_count ?? 1), 0),
  }));
}
function publicJob(row: import('mysql2/promise').RowDataPacket, charged: number) {
  const input = decode(row.input) as JobInput;
  const results = row.results ? (decode(row.results) as ContentResult[]) : [];
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    profile_name: parseDefinition(decode(row.snapshot)).name,
    profile_revision: Number(row.profile_revision),
    status: String(row.status),
    stage: String(row.stage),
    values: input.values,
    summary: input.summary,
    results: results.map(r =>
      r.kind === 'image'
        ? {
            label: r.label,
            kind: r.kind,
            files: (r.value as string[]).map(id => ({ id, url: '/api/content/files/' + id })),
          }
        : { label: r.label, kind: r.kind, text: r.value as string },
    ),
    charged,
    error: row.error ?? null,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}
async function chargedBy(account: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const [rows] = await usageSql.sumContent(db, account, ids);
  return new Map(rows.map(r => [String(r.job), Number(r.charged)]));
}
export async function contentJob(account: string, id: string) {
  const [rows] = await jobsSql.find(db, [account, id]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Pekerjaan tidak ditemukan.');
  return publicJob(rows[0], (await chargedBy(account, [id])).get(id) ?? 0);
}
export async function contentJobs(account: string, pageValue: unknown = 1) {
  const page = integer(Number(pageValue), 1, 100000, 'Halaman');
  const [counts] = await jobsSql.count(db, [account]);
  const total = Number(counts[0].total),
    pages = Math.max(1, Math.ceil(total / 20)),
    current = Math.min(page, pages);
  const [rows] = await jobsSql.list(db, [account], current);
  const charged = await chargedBy(
    account,
    rows.map(r => String(r.id)),
  );
  return { items: rows.map(r => publicJob(r, charged.get(String(r.id)) ?? 0)), page: current, pages, total };
}
// Isian formulir divalidasi terhadap definisi terbit, bukan terhadap apa yang dikirim klien.
const validateForm = (account: string, form: FormField[], body: Record<string, unknown>) =>
  readForm(form, body, async id => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail('Gambar referensi tidak valid');
    await contentFile(account, id);
  });
export async function enqueueContent(
  account: string,
  value: unknown,
  options: { dependencies?: ContentJobDependencies } = {},
) {
  const svc = options.dependencies?.service ?? ai;
  const body = record(value),
    profileId = text(body.profileId, 32, 'Profil');
  const requestKey = text(body.requestId, 64, 'ID permintaan');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) throw fail('ID permintaan wajib valid');
  const values = record(body.values ?? {});
  const hash = createHash('sha256').update(JSON.stringify({ profileId, values })).digest('hex');
  // Retry dengan ID sama mengembalikan hasil lama walau profil berubah.
  const retry = async (executor: Executor) => {
    const [existing] = await jobsSql.findRequest(executor, [account, requestKey]);
    if (!existing[0]) return null;
    if (existing[0].payload_hash !== hash)
      throw new ApiError(409, 'idempotency_conflict', 'ID permintaan telah dipakai untuk isian lain.');
    return existing[0];
  };
  const old = await retry(db);
  if (old) return contentJob(account, String(old.id));
  const profile = (await contentGraphs()).find(g => g.id === profileId);
  if (!profile) throw new ApiError(404, 'profile_unavailable', 'Profil Konten tidak tersedia.');
  const d = profile.definition;
  const { values: clean, summary } = await validateForm(account, formOf(d), values);
  const config = await svc.config();
  const metered = usesTextModel(d);
  const inputWords = countWords(summary);
  await basicWallet(account);
  const id = randomUUID();
  await transaction(async c => {
    await lockAccount(c, account);
    if (await retry(c)) return;
    const [open] = await jobsSql.countOpen(c, [account]);
    if (Number(open[0].n) >= maxOpenJobs)
      throw new ApiError(409, 'content_queue_full', 'Maksimum ' + maxOpenJobs + ' pekerjaan konten berjalan.');
    await walletsSql.ensure(c, [account]);
    const [wallet] = await walletsSql.lockBalance(c, [account]);
    const maxWords = Math.min(
      300,
      Math.floor((Number(wallet[0].balance) - inputWords * config.input_rate) / config.output_rate),
    );
    if (metered && maxWords < 1) throw new ApiError(402, 'insufficient_ai_credit', 'Kredit AI tidak cukup.');
    const reserved = metered ? creditCost(inputWords, maxWords, config.input_rate, config.output_rate) : 0;
    const fromPlan = planPart(reserved, Number(wallet[0].plan_balance));
    await walletsSql.debit(c, [reserved, account]);
    await usageSql.insertContent(c, [
      account,
      id,
      id,
      inputWords,
      config.input_rate,
      config.output_rate,
      reserved,
      config.model,
      profileId,
      fromPlan,
    ]);
    const input: JobInput = { values: clean, summary, inputWords, maxWords: Math.max(1, maxWords) };
    await jobsSql.insert(c, [
      id,
      account,
      requestKey,
      hash,
      profileId,
      profile.revision,
      JSON.stringify(d),
      JSON.stringify(input),
    ]);
  });
  const [row] = await jobsSql.findRequest(db, [account, requestKey]);
  return contentJob(account, String(row[0].id));
}
async function settle(
  account: string,
  id: string,
  outcome: { status: 'completed' | 'failed'; results: ContentResult[] | null; error: string | null },
  words: { output: number; charged: number },
) {
  await transaction(async c => {
    await lockAccount(c, account, true);
    const [jobs] = await jobsSql.find(c, [account, id], true);
    if (jobs[0]?.status !== 'running') return;
    const [usage] = await usageSql.findContent(c, [account, id]);
    const reserved = Number(usage[0]?.reserved ?? 0),
      charged = Math.min(words.charged, reserved);
    const back = refundSplit(reserved, Number(usage[0]?.reserved_plan ?? 0), reserved - charged);
    await walletsSql.refund(c, [back.toBalance, back.toPlan, account]);
    await usageSql.finishContent(c, [
      'content_' + outcome.status,
      words.output,
      charged,
      JSON.stringify([{ role: 'content', status: outcome.status }]),
      account,
      id,
    ]);
    await jobsSql.settle(c, [
      outcome.status,
      outcome.results ? JSON.stringify(outcome.results) : null,
      outcome.error,
      account,
      id,
    ]);
  });
}
export async function processNextContent(dependencies: ContentJobDependencies = {}) {
  const svc = dependencies.service ?? ai;
  const row = await transaction(async c => {
    const [rows] = await jobsSql.lockNext(c);
    if (!rows[0]) return null;
    await jobsSql.markRunning(c, [rows[0].account_id, rows[0].id]);
    return rows[0];
  });
  if (!row) return false;
  const account = String(row.account_id),
    id = String(row.id);
  try {
    const d = parseDefinition(decode(row.snapshot));
    const input = decode(row.input) as JobInput;
    const config = await svc.config();
    const messages: AIMessage[] = [
      { role: 'system', content: graphSystem },
      { role: 'user', content: input.summary },
    ];
    const scope = {
      account,
      profile: '',
      session: 'content',
      customer: id,
      requestId: id,
      form: input.values,
      fallbackEnabled: false,
    };
    const makeImage = dependencies.imageTransport
      ? databaseImages(scope, config, contentLibraryImages(account), dependencies.imageTransport)
      : undefined;
    const result = await runGraph(
      d,
      dependencies.transport ?? svc.transport,
      config,
      messages,
      scope,
      null,
      undefined,
      input.maxWords,
      undefined,
      undefined,
      undefined,
      makeImage,
    );
    const results = 'results' in result ? result.results : null;
    if (!results) throw Error('ai_results_empty');
    // Gambar hasil harus file Pustaka konten akun ini; ID lain (salah tulis atau milik akun lain) menggagalkan pekerjaan.
    for (const r of results) if (r.kind === 'image') for (const file of r.value) await contentFile(account, file);
    const output = results.reduce((sum, r) => sum + (r.kind === 'text' ? countWords(r.value as string) : 0), 0);
    const charged = usesTextModel(d) ? creditCost(input.inputWords, output, config.input_rate, config.output_rate) : 0;
    await settle(account, id, { status: 'completed', results, error: null }, { output, charged });
  } catch {
    await settle(
      account,
      id,
      { status: 'failed', results: null, error: 'Pekerjaan gagal diselesaikan. Kredit kata dikembalikan.' },
      { output: 0, charged: 0 },
    );
  }
  return true;
}
// Dipanggil saat start setelah ai.recover(), yang mengembalikan kredit kata semua reservasi yang menggantung.
export async function recoverContentJobs() {
  await jobsSql.interruptPending(db, [
    'Proses terputus saat server berhenti. Kredit dikembalikan; isian tetap tersimpan.',
  ]);
}
export function startContentWorker() {
  let stopping = false;
  const active = new Set<Promise<void>>();
  const tick = () => {
    if (stopping || active.size >= 2) return;
    const task = processNextContent()
      .then(() => {})
      .catch(() => console.error('Pekerjaan konten gagal diselesaikan; periksa antrean.'))
      .finally(() => active.delete(task));
    active.add(task);
  };
  const timer = setInterval(tick, 1000).unref();
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await Promise.all(active);
  };
}

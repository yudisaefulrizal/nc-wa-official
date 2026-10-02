// Reservasi kredit, antrean tahan restart, eksekusi generator dan pustaka per akun.
// Panggilan provider tidak diulang otomatis; settle dan refund hanya sekali di bawah kunci akun.
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { basicWallet } from '../../billing/index.js';
import { ApiError } from '../../../libraries/errors.js';
import { record } from '../../../libraries/validation.js';
import { integer, text, fail } from './input-validation.js';
import { transaction, lockAccount } from './transaction.js';
import { planPart, refundSplit } from './metering.js';
import { ai, type AIService } from './service.js';
import { tierConfig } from './pipeline/models.js';
import {
  imageConnection,
  callImage,
  type ImageConnection,
  type ImageTransport,
  type ImageRatio,
} from './image-provider.js';
import { imageBrand } from './image-brand.js';
import { contentFile, contentReference, storeContent } from './content-files.js';
import { decodeImageJson, parseImageDefinition, composeImagePrompt, type ImageDefinition } from './image-profiles.js';
import * as jobsSql from '../data-access/image-jobs-queries.js';
import * as profilesSql from '../data-access/image-profiles-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';
import * as usageSql from '../data-access/usage-queries.js';
interface JobInput {
  brief: string;
  fields: Record<string, string>;
  ratio: ImageRatio;
  count: number;
  references: string[];
  brand: Record<string, unknown>;
}
export interface ImageJobDependencies {
  service?: AIService;
  transport?: ImageTransport;
}
export function publicImageJob(row: import('mysql2/promise').RowDataPacket) {
  const definition = parseImageDefinition(decodeImageJson(row.snapshot));
  const input = record(decodeImageJson(row.input));
  const results = row.results ? (decodeImageJson(row.results) as string[]) : [];
  return {
    id: String(row.id),
    profile_id: row.profile_id,
    profile_name: definition.name,
    profile_revision: Number(row.profile_revision),
    status: String(row.status),
    stage: String(row.stage),
    brief: input.brief,
    fields: input.fields,
    ratio: input.ratio,
    count: input.count,
    references: input.references,
    charged: Number(row.charged),
    reserved: Number(row.reserved),
    error: row.error ?? null,
    results: results.map(id => ({ id, url: '/api/content/files/' + id })),
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}
export async function imageJob(account: string, id: string) {
  const [rows] = await jobsSql.find(db, [account, id]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Pekerjaan tidak ditemukan.');
  return publicImageJob(rows[0]);
}
export async function imageJobs(account: string, pageValue: unknown = 1) {
  const page = integer(Number(pageValue), 1, 100000, 'Halaman');
  const [counts] = await jobsSql.count(db, [account]);
  const total = Number(counts[0].total),
    pages = Math.max(1, Math.ceil(total / 20)),
    current = Math.min(page, pages);
  const [rows] = await jobsSql.list(db, [account], current);
  return { items: rows.map(publicImageJob), page: current, pages, total };
}
export async function enqueueImage(
  account: string,
  value: unknown,
  options: { draftId?: string; dependencies?: ImageJobDependencies } = {},
) {
  const svc = options.dependencies?.service ?? ai;
  const body = record(value),
    profileId = text(options.draftId ?? body.profileId, 36, 'Profil');
  const requestKey = text(body.requestId, 64, 'ID permintaan');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) throw fail('ID permintaan wajib valid');
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        profileId,
        brief: body.brief,
        fields: body.fields ?? {},
        ratio: body.ratio,
        count: body.count,
        references: body.references ?? [],
        draft: Boolean(options.draftId),
      }),
    )
    .digest('hex');
  // Retry dengan ID sama mengembalikan hasil lama walau profil/model kemudian berubah.
  const [existing] = await jobsSql.findRequest(db, [account, requestKey]);
  if (existing[0]) {
    if (existing[0].payload_hash !== hash)
      throw new ApiError(409, 'idempotency_conflict', 'ID permintaan telah dipakai untuk brief lain.');
    return publicImageJob(existing[0]);
  }
  await basicWallet(account);
  const connection = await imageConnection(svc);
  if (!connection.options.creditsPerImage)
    throw new ApiError(409, 'image_rate_unset', 'Owner belum mengatur tarif kredit gambar.');
  const id = randomUUID();
  await transaction(async c => {
    await lockAccount(c, account);
    const [old] = await jobsSql.findRequest(c, [account, requestKey]);
    if (old[0]) {
      if (old[0].payload_hash !== hash) throw new ApiError(409, 'idempotency_conflict', 'ID permintaan telah dipakai.');
      return;
    }
    const [profiles] = await profilesSql.find(c, [profileId], true);
    const profile = profiles[0];
    if (!profile || (!options.draftId && (!profile.active || !profile.enabled)))
      throw new ApiError(404, 'profile_unavailable', 'Profil generator tidak tersedia.');
    const definition = parseImageDefinition(decodeImageJson(options.draftId ? profile.draft : profile.active));
    const input = await validateInput(account, body, definition, connection);
    const [open] = await jobsSql.countOpen(c, [account]);
    if (Number(open[0].n) >= 3) throw new ApiError(409, 'image_queue_full', 'Maksimum tiga pekerjaan gambar berjalan.');
    const [balances] = await walletsSql.lockBalance(c, [account]);
    const reserved = input.count * connection.options.creditsPerImage;
    if (!balances[0] || Number(balances[0].balance) < reserved)
      throw new ApiError(402, 'insufficient_ai_credit', 'Kredit AI tidak cukup untuk jumlah gambar ini.');
    const [period] = await walletsSql.imagePlanPeriod(c, [account]);
    const taken = planPart(reserved, Number(balances[0].plan_balance));
    await walletsSql.debit(c, [reserved, account]);
    await jobsSql.insert(c, [
      id,
      account,
      requestKey,
      hash,
      profileId,
      Number(options.draftId ? profile.revision : profile.published_revision),
      JSON.stringify(definition),
      JSON.stringify(input),
      JSON.stringify(connection),
      reserved,
      taken,
      period[0]?.plan_period ?? null,
    ]);
    await usageSql.insertImage(c, [account, id, connection.model]);
  });
  const [row] = await jobsSql.findRequest(db, [account, requestKey]);
  return publicImageJob(row[0]);
}
async function validateInput(
  account: string,
  body: Record<string, unknown>,
  d: ImageDefinition,
  connection: ImageConnection,
): Promise<JobInput> {
  const brief = text(body.brief, 4000, 'Brief gambar');
  if (!brief) throw fail('Brief gambar wajib diisi');
  const ratio = body.ratio as ImageRatio;
  if (!d.ratios.includes(ratio)) throw fail('Rasio tidak diizinkan oleh profil');
  const count = integer(body.count, 1, Math.min(d.maxImages, connection.options.maxImages), 'Jumlah gambar');
  const source = record(body.fields ?? {}),
    fields: Record<string, string> = {};
  if (Object.keys(source).some(key => !d.fields.some(f => f.id === key))) throw fail('Field formulir tidak dikenal');
  for (const field of d.fields) {
    const v = text(source[field.id] ?? '', field.type === 'textarea' ? 2000 : 500, field.label);
    if (field.required && !v) throw fail(field.label + ' wajib diisi');
    if (field.type === 'choice' && v && !field.options.includes(v)) throw fail(field.label + ' tidak valid');
    fields[field.id] = v;
  }
  const references = body.references ?? [];
  if (
    !Array.isArray(references) ||
    references.length > 4 ||
    references.some(v => typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v))
  )
    throw fail('Referensi gambar tidak valid');
  if (references.length && (!d.references || !connection.options.references))
    throw fail('Profil atau provider tidak mendukung referensi gambar');
  for (const id of references) await contentFile(account, id);
  const brand = d.useBrand ? await imageBrand(account) : {};
  return { brief, fields, ratio, count, references, brand };
}
async function settleImage(
  account: string,
  id: string,
  resultIds: string[],
  error: string | null,
  interrupted = false,
) {
  await transaction(async c => {
    await lockAccount(c, account, true);
    const [rows] = await jobsSql.find(c, [account, id], true);
    const row = rows[0];
    if (!row || !['running', 'queued'].includes(row.status)) return;
    const connection = record(decodeImageJson(row.connection)) as unknown as ImageConnection;
    const charged = Math.min(Number(row.reserved), resultIds.length * connection.options.creditsPerImage);
    const back = refundSplit(Number(row.reserved), Number(row.reserved_plan), Number(row.reserved) - charged);
    await walletsSql.refundImage(c, [back.toBalance, back.toPlan, row.plan_period, account]);
    const status = resultIds.length ? 'completed' : interrupted ? 'interrupted' : 'failed';
    await jobsSql.settle(c, [status, status, charged, JSON.stringify(resultIds), error, account, id]);
    await usageSql.finishImage(c, [
      'image_' + status,
      charged,
      JSON.stringify([{ role: 'image', model: connection.model, status, images: resultIds.length }]),
      account,
      id,
    ]);
  });
}
export async function processNextImage(dependencies: ImageJobDependencies = {}) {
  const svc = dependencies.service ?? ai;
  const row = await transaction(async c => {
    const [rows] = await jobsSql.lockNext(c);
    if (!rows[0]) return null;
    await jobsSql.markRunning(c, [rows[0].account_id, rows[0].id]);
    return rows[0];
  });
  if (!row) return false;
  const account = String(row.account_id),
    id = String(row.id),
    results: string[] = [];
  try {
    await transaction(c => lockAccount(c, account));
    const d = parseImageDefinition(decodeImageJson(row.snapshot));
    const input = record(decodeImageJson(row.input)) as unknown as JobInput;
    const connection = record(decodeImageJson(row.connection)) as unknown as ImageConnection;
    const brandText = [input.brand.name, input.brand.description, input.brand.colors].filter(Boolean).join('\n');
    let prompt = composeImagePrompt(d, input.brief, brandText, input.fields);
    if (d.refine) {
      const config = tierConfig(await svc.config(), 'smart');
      if (!config.secret) throw Error('image_prompt_model_unavailable');
      prompt = await svc.transport(
        { ...config, max_tokens: 2048 },
        [
          {
            role: 'system',
            content:
              'Susun prompt gambar yang jelas berdasarkan brief dan identitas brand. Pertahankan fakta produk dan teks yang diminta. Jawab hanya prompt gambar, maksimum 1500 kata.',
          },
          { role: 'user', content: prompt },
        ],
        1500,
      );
    }
    const refs = [...input.references];
    if (
      d.useBrand &&
      d.references &&
      connection.options.references &&
      typeof input.brand.logo === 'string' &&
      input.brand.logo &&
      !refs.includes(input.brand.logo) &&
      refs.length < 4
    )
      refs.push(input.brand.logo);
    const references: Buffer[] = [];
    for (const ref of refs) references.push(await contentReference(account, ref));
    await jobsSql.updateStage(db, ['generating', account, id]);
    const images = await (dependencies.transport ?? callImage)(connection, {
      prompt,
      ratio: input.ratio,
      count: input.count,
      references,
    });
    if (!images.length || images.length > input.count) throw Error('image_invalid_response');
    await jobsSql.updateStage(db, ['saving', account, id]);
    for (const image of images) {
      const saved = await storeContent(account, image, 'result');
      results.push(saved.id);
      await jobsSql.updateResults(db, [JSON.stringify(results), account, id]);
    }
    await settleImage(
      account,
      id,
      results,
      results.length < input.count ? 'Sebagian gambar tidak dihasilkan; hanya hasil tersimpan yang ditagihkan.' : null,
    );
  } catch {
    await settleImage(
      account,
      id,
      results,
      results.length
        ? 'Sebagian hasil tersimpan; kredit gambar yang gagal dikembalikan.'
        : 'Gambar gagal dibuat. Kredit dikembalikan; brief tetap tersimpan.',
    );
  }
  return true;
}
export async function recoverImageJobs() {
  const [rows] = await jobsSql.listInterrupted(db);
  for (const row of rows)
    await settleImage(
      String(row.account_id),
      String(row.id),
      row.results ? (decodeImageJson(row.results) as string[]) : [],
      'Proses terputus saat server berhenti. Kredit untuk gambar yang belum tersimpan dikembalikan; brief tetap tersimpan.',
      true,
    );
}
export function startImageWorker() {
  let stopping = false;
  const active = new Set<Promise<void>>();
  const tick = () => {
    if (stopping || active.size >= 2) return;
    const task = processNextImage()
      .then(() => {})
      .catch(() => console.error('Pekerjaan gambar gagal diselesaikan; periksa antrean.'))
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

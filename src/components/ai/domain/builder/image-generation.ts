// Node Buat gambar: memesan kredit gambar akun, memanggil model gambar, mengubah hasilnya ke JPEG, dan menyimpannya
// sebagai file data profil supaya bisa dikirim node Kirim media. Kredit gambar yang tidak jadi dikembalikan.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ApiError } from '../../../../libraries/errors.js';
import { transaction, lockAccount } from '../transaction.js';
import { planPart, refundSplit } from '../metering.js';
import {
  imageConnectionFrom,
  callImage,
  type ImageConnection,
  type ImageRatio,
  type ImageTransport,
} from '../image-provider.js';
import { imageBrand } from '../image-brand.js';
import { contentReference, storeContent, toJpeg } from '../content-files.js';
import { limits, type GraphRole } from './definition.js';
import { recordFilePath, saveGeneratedFile } from './record-files.js';
import type { AIConfig } from '../provider.js';
import type { ToolContext } from '../pipeline/scope.js';
import * as walletsSql from '../../data-access/wallets-queries.js';
import * as usageSql from '../../data-access/usage-queries.js';

// Alasan gagal yang bisa dibaca alur lewat {{nodes.<id>.reason}}.
export type ImageFailure = 'belum_diatur' | 'kredit' | 'referensi' | 'prompt' | 'waktu' | 'gagal';
export class ImageNodeError extends Error {
  constructor(readonly reason: ImageFailure) {
    super('ai_image_' + reason);
  }
}
export interface ImageMakeRequest {
  prompt: string;
  ratio: ImageRatio;
  count: number;
  brand: boolean;
  // ID file data profil (misalnya dari node Terima media); dipakai sebagai gambar referensi.
  references: string[];
  signal?: AbortSignal;
}
// Hasil: ID file (atau nama file pada simulasi) yang bisa langsung dikirim lewat Kirim media.
export type ImageMaker = (request: ImageMakeRequest) => Promise<{ files: string[] }>;

// Profil chat menunggu pelanggan, jadi singkat; pekerjaan Konten berjalan di latar belakang dan boleh lebih lama.
export const imageNodeTimeoutMs = (role: GraphRole) => (role === 'content' ? 240000 : 60000);
export const maxPromptChars = 4000;
// Tempat gambar disimpan dan referensi dibaca. Profil chat memakai file data profil sesi (bisa dikirim lewat Kirim
// media); profil Konten memakai Pustaka konten akun. Keduanya menyimpan hasil sebagai JPEG.
export interface ImageStore {
  // Menyimpan gambar dari model dan mengembalikan ID file untuk variabel node.
  save(image: Buffer, name: string): Promise<string>;
  // Isi gambar referensi milik pemakai, siap dikirim ke model.
  reference(id: string): Promise<Buffer>;
}
export const dataProfileImages = (scope: ToolContext): ImageStore => ({
  save: async (image, name) =>
    (await saveGeneratedFile(scope.account, scope.profile, name, await toJpeg(image), 'image/jpeg')).id,
  reference: async id => {
    const file = await recordFilePath(scope.account, scope.profile, id);
    if (file.media_type !== 'image') throw Error('not_image');
    return sharp(await readFile(file.path), { limitInputPixels: 20000000, animated: false })
      .png()
      .toBuffer();
  },
});
export const contentLibraryImages = (account: string): ImageStore => ({
  save: async image => (await storeContent(account, image, 'result')).id,
  reference: id => contentReference(account, id),
});
async function loadReferences(store: ImageStore, ids: string[]) {
  try {
    return await Promise.all(ids.map(id => store.reference(id)));
  } catch {
    throw new ImageNodeError('referensi');
  }
}
async function settle(
  account: string,
  id: string,
  reservation: { reserved: number; fromPlan: number; period: string | null },
  connection: ImageConnection,
  made: number,
) {
  const charged = Math.min(reservation.reserved, made * connection.options.creditsPerImage);
  const status = made ? 'image_completed' : 'image_failed';
  await transaction(async c => {
    await lockAccount(c, account, true);
    const back = refundSplit(reservation.reserved, reservation.fromPlan, reservation.reserved - charged);
    await walletsSql.refundImage(c, [back.toBalance, back.toPlan, reservation.period, account]);
    await usageSql.finishNodeImage(c, [
      status,
      charged,
      JSON.stringify([{ role: 'image', model: connection.model, status, images: made }]),
      account,
      id,
    ]);
  });
}
export function databaseImages(
  scope: ToolContext,
  config: AIConfig,
  store: ImageStore,
  transport: ImageTransport = callImage,
): ImageMaker {
  return async request => {
    const prompt = request.prompt.trim().slice(0, maxPromptChars);
    if (!prompt) throw new ImageNodeError('prompt');
    let connection: ImageConnection;
    try {
      connection = await imageConnectionFrom(config);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'image_not_configured') throw new ImageNodeError('belum_diatur');
      throw error;
    }
    const perImage = connection.options.creditsPerImage;
    if (!perImage) throw new ImageNodeError('belum_diatur');
    const count = Math.min(request.count, connection.options.protocol === 'chat' ? 1 : connection.options.maxImages);
    if (request.references.length && !connection.options.references) throw new ImageNodeError('referensi');
    const references = await loadReferences(store, request.references.slice(0, limits.imageRefs));
    let text = prompt;
    if (request.brand) {
      const brand = await imageBrand(scope.account);
      const identity = [brand.name, brand.description, brand.colors].filter(Boolean).join('\n');
      if (identity) text += '\n\nIdentitas brand:\n' + identity;
      if (
        connection.options.references &&
        typeof brand.logo === 'string' &&
        brand.logo &&
        references.length < limits.imageRefs
      )
        references.push(await contentReference(scope.account, brand.logo));
    }
    const reserved = count * perImage,
      id = 'img_' + randomUUID();
    const reservation = { reserved, fromPlan: 0, period: null as string | null };
    await transaction(async c => {
      await lockAccount(c, scope.account);
      await walletsSql.ensure(c, [scope.account]);
      const [balances] = await walletsSql.lockBalance(c, [scope.account]);
      if (!balances[0] || Number(balances[0].balance) < reserved) throw new ImageNodeError('kredit');
      const [period] = await walletsSql.imagePlanPeriod(c, [scope.account]);
      reservation.period = period[0]?.plan_period ?? null;
      reservation.fromPlan = planPart(reserved, Number(balances[0].plan_balance));
      await walletsSql.debit(c, [reserved, scope.account]);
      await usageSql.insertNodeImage(c, [
        scope.account,
        id,
        scope.session,
        scope.customer,
        reserved,
        connection.model,
        reservation.fromPlan,
      ]);
    });
    const files: string[] = [];
    try {
      const images = await transport(
        connection,
        { prompt: text, ratio: request.ratio, count, references },
        request.signal,
      );
      if (!images.length || images.length > count) throw Error('image_invalid_response');
      for (const [i, image] of images.entries()) files.push(await store.save(image, 'gambar-' + (i + 1) + '.jpg'));
    } catch (error) {
      // Gambar yang sudah tersimpan tetap ditagih; sisanya dikembalikan.
      await settle(scope.account, id, reservation, connection, files.length);
      if (files.length) return { files };
      // Kesalahan lain dilempar apa adanya; engine yang membedakan pembatalan alur dari gagal biasa.
      throw error;
    }
    await settle(scope.account, id, reservation, connection, files.length);
    return { files };
  };
}
// Simulasi: tidak memanggil model gambar dan tanpa kredit; nama file dipakai sebagai nilainya, seperti previewFiles.
export const previewImages: ImageMaker = async request => ({
  files: Array.from({ length: request.count }, (_, i) => 'gambar-simulasi-' + (i + 1) + '.jpg'),
});

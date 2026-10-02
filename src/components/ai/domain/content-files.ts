// Unggah dan akses gambar referensi/hasil milik akun. Dekode raster dan kuota diperiksa sebelum menyimpan.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { transaction, lockAccount } from './transaction.js';
import * as filesSql from '../data-access/content-files-queries.js';
import * as storage from '../data-access/content-file-storage.js';
export const contentLimits = { uploadBytes: 10 * 1024 * 1024, storageBytes: 512 * 1024 * 1024, files: 500 };
export async function normalizeContent(data: Buffer) {
  if (!data.length || data.length > 15 * 1024 * 1024)
    throw new ApiError(400, 'invalid_image', 'Gambar terlalu besar atau kosong.');
  try {
    const image = sharp(data, { limitInputPixels: 20000000, animated: false });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw Error('unsupported');
    const result = await image.png().toBuffer();
    if (result.length > 15 * 1024 * 1024) throw Error('too_large');
    return result;
  } catch {
    throw new ApiError(400, 'invalid_image', 'Gunakan gambar JPG, PNG, atau WebP yang valid.');
  }
}
export async function storeContent(account: string, data: Buffer, kind: 'reference' | 'result') {
  const png = await normalizeContent(data),
    id = randomUUID();
  try {
    await transaction(async c => {
      await lockAccount(c, account, kind === 'result');
      const [totals] = await filesSql.sum(c, [account]);
      if (
        Number(totals[0].n) >= contentLimits.files ||
        Number(totals[0].bytes) + png.length > contentLimits.storageBytes
      )
        throw new ApiError(409, 'content_storage_full', 'Pustaka mencapai batas 500 file atau 512 MB.');
      await storage.writeContent(account, id, png);
      await filesSql.insert(c, [id, account, kind, png.length]);
    });
  } catch (e) {
    await storage.removeContent(account, id).catch(() => {});
    throw e;
  }
  return { id, url: '/api/content/files/' + id, bytes: png.length };
}
export async function contentFile(account: string, id: string) {
  const [rows] = await filesSql.find(db, [account, id]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Gambar tidak ditemukan.');
  return { id, kind: String(rows[0].kind), path: storage.contentPath(account, id) };
}
export async function contentReference(account: string, id: string) {
  await contentFile(account, id);
  return storage.readContent(account, id);
}
export async function listReferences(account: string) {
  const [rows] = await filesSql.listReferences(db, [account]);
  return rows.map(row => ({ id: String(row.id), url: '/api/content/files/' + row.id }));
}

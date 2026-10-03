// Posting satu gambar hasil ke feed Instagram resmi. Container diproses Meta; klaim database memastikan
// media_publish hanya dipanggil sekali, termasuk ketika klien mengulang permintaan setelah koneksi terputus.
import sharp from 'sharp';
import { contentFile } from '../../ai/index.js';
import { db } from '../../../libraries/db.js';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { officialToken } from './official-token.js';
import { outboundMedia } from '../data-access/outbound-media-store.js';
import * as postsSql from '../data-access/posts-queries.js';

const publishPermission = 'instagram_business_content_publish';
const graph = () => (process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com') + '/v23.0';

export async function createOfficialPost(account: string, body: unknown) {
  const input = object(body),
    requestId = postRequestId(input.requestId),
    igUserId = requiredString(input.igUserId, 'Akun Instagram', 64),
    // Gambar berasal dari pustaka konten (fileId) atau dari alamat publik (imageUrl), tidak keduanya.
    fileId = input.fileId === undefined ? undefined : requiredString(input.fileId, 'Gambar', 36),
    imageUrl = input.imageUrl === undefined ? undefined : requiredString(input.imageUrl, 'Alamat gambar', 4096),
    caption = input.caption === undefined ? '' : input.caption;
  if (typeof caption !== 'string' || [...caption].length > 2200)
    throw new ApiError(400, 'invalid_caption', 'Caption maksimal 2.200 karakter.');
  if ((fileId === undefined) === (imageUrl === undefined))
    throw new ApiError(400, 'invalid_request', 'Isi salah satu: fileId atau imageUrl.');
  const hash = digest(JSON.stringify(imageUrl ? { igUserId, imageUrl, caption } : { igUserId, fileId, caption }));
  const previous = await findPost(account, requestId);
  if (previous) return matchingPost(previous, hash);
  const token = await officialToken(account, igUserId, publishPermission, 'instagram_publish_permission');
  const file = fileId ? await contentFile(account, fileId) : undefined;
  if (file && file.kind !== 'result')
    throw new ApiError(400, 'invalid_post_image', 'Pilih gambar hasil dari pustaka konten.');
  let origin: URL;
  try {
    origin = new URL(process.env.APP_ORIGIN ?? '');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw Error();
  } catch {
    throw new ApiError(503, 'media_origin_unavailable', 'Alamat publik aplikasi belum dikonfigurasi.');
  }
  try {
    // Kolom file_id wajib terisi; posting dari alamat gambar mengisinya dengan penanda "url".
    await postsSql.insert(db, [account, requestId, igUserId, fileId ?? 'url', hash]);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    return matchingPost((await findPost(account, requestId))!, hash);
  }
  let download: Awaited<ReturnType<typeof downloadPublicMedia>> | undefined;
  try {
    download = file ? undefined : await downloadPublicMedia(imageUrl!);
    const media = await outboundMedia.publish(file?.path ?? download!.path, preparePostImage);
    const container = await metaRequest(igUserId + '/media', token, {
      image_url: new URL('/instagram/media/' + media, origin).href,
      caption,
    });
    if (typeof container.id !== 'string' || !/^\d+$/.test(container.id)) throw metaError();
    await postsSql.prepared(db, [container.id, account, requestId]);
  } catch (error) {
    await postsSql.fail(db, [account, requestId]);
    throw error;
  } finally {
    await download?.cleanup();
  }
  return advanceOfficialPost(account, requestId);
}

export async function officialPost(account: string, request: unknown) {
  const requestId = postRequestId(request),
    row = await findPost(account, requestId);
  if (!row) throw new ApiError(404, 'not_found', 'Permintaan posting tidak ditemukan.');
  // Setelah crash, jangan menerbitkan lagi kiriman yang mungkin sudah diterima Meta.
  const age = Date.now() - new Date(row.updated_at).getTime();
  if (row.status === 'publishing' && age > 60000) await postsSql.uncertain(db, [account, requestId]);
  if ((row.status === 'preparing' && age > 60000) || (row.status === 'processing' && age > 5 * 60000))
    await postsSql.fail(db, [account, requestId]);
  return postView((await findPost(account, requestId))!);
}

export async function advanceOfficialPost(account: string, request: unknown) {
  const requestId = postRequestId(request),
    current = await officialPost(account, requestId);
  if (current.status !== 'processing') return current;
  const row = (await findPost(account, requestId))!,
    token = await officialToken(account, String(row.ig_user_id), publishPermission, 'instagram_publish_permission');
  const container = await metaRequest(String(row.container_id) + '?fields=status_code', token);
  if (['ERROR', 'EXPIRED'].includes(String(container.status_code))) {
    await postsSql.fail(db, [account, requestId]);
    return officialPost(account, requestId);
  }
  if (container.status_code !== 'FINISHED') return current;
  const [claim] = await postsSql.claim(db, [account, requestId]);
  if (!claim.affectedRows) return officialPost(account, requestId);
  try {
    const result = await metaRequest(String(row.ig_user_id) + '/media_publish', token, {
      creation_id: String(row.container_id),
    });
    if (typeof result.id !== 'string' || !/^\d+$/.test(result.id)) throw metaError();
    await postsSql.finish(db, [result.id, account, requestId]);
  } catch {
    // Timeout/5xx bisa terjadi setelah Meta menerbitkan. Status belum pasti selalu memerlukan pemeriksaan akun.
    await postsSql.uncertain(db, [account, requestId]);
  }
  return officialPost(account, requestId);
}

export async function preparePostImage(data: Buffer) {
  const image = sharp(data, { limitInputPixels: 20000000 }).rotate(),
    meta = await image.metadata(),
    ratio = (meta.width ?? 0) / (meta.height ?? 1);
  if (!meta.width || !meta.height || ratio < 0.8 || ratio > 1.91)
    throw new ApiError(400, 'invalid_post_ratio', 'Untuk feed Instagram, pilih gambar dengan rasio 1:1 atau 4:5.');
  // Publishing API menerima JPEG; gambar sumber tetap utuh di pustaka.
  return image
    .resize({ width: 1440, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function postRequestId(value: unknown) {
  const id = requiredString(value, 'ID permintaan', 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ApiError(400, 'invalid_request', 'ID permintaan tidak valid.');
  return id;
}
async function findPost(account: string, requestId: string) {
  const [rows] = await postsSql.find(db, [account, requestId]);
  return rows[0];
}
function postView(row: NonNullable<Awaited<ReturnType<typeof findPost>>>) {
  return {
    requestId: String(row.request_id),
    status: String(row.status),
    mediaId: row.media_id ? String(row.media_id) : null,
  };
}
function matchingPost(row: NonNullable<Awaited<ReturnType<typeof findPost>>>, hash: string) {
  if (row.payload_hash !== hash)
    throw new ApiError(409, 'idempotency_conflict', 'ID permintaan sudah dipakai untuk posting lain.');
  return postView(row);
}
async function metaRequest(path: string, token: string, body?: Record<string, string>) {
  try {
    const response = await fetch(graph() + '/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw metaError();
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw metaError();
  }
}
function metaError() {
  return new ApiError(
    502,
    'instagram_post_failed',
    'Instagram belum dapat memproses posting. Periksa koneksi dan izin akun.',
  );
}

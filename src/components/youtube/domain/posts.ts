// Antrean unggahan video dengan idempotensi; unggahan yang hasilnya belum pasti hanya diperiksa, tidak dikirim ulang.
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { db } from '../../../libraries/db.js';
import { encrypt, decrypt } from '../../../libraries/crypto.js';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { downloadPublicMedia, validatePublicUrl } from '../../../libraries/download.js';
import * as sql from '../data-access/youtube-queries.js';
import { accessToken } from './connections.js';
import { googleError, json, requestApi, uploadSession, urls } from './client.js';
export function postInput(body: unknown) {
  const value = object(body),
    channelId = requiredString(value.channelId, 'Channel', 64),
    requestId = requiredString(value.requestId, 'ID permintaan', 128),
    videoUrl = requiredString(value.videoUrl, 'URL video', 2048),
    title = requiredString(value.title, 'Judul', 100).trim();
  if (!/^UC[-\w]{22}$/.test(channelId) || !/^[\w.-]+$/.test(requestId))
    throw new ApiError(400, 'invalid_request', 'Channel atau ID permintaan tidak valid');
  if (typeof value.description !== 'string' || value.description.length > 5000)
    throw new ApiError(400, 'invalid_request', 'Deskripsi maksimal 5.000 karakter');
  if (!['public', 'private', 'unlisted'].includes(String(value.privacyStatus)))
    throw new ApiError(400, 'invalid_request', 'Pilih privasi video');
  if (typeof value.madeForKids !== 'boolean' || typeof value.containsSyntheticMedia !== 'boolean')
    throw new ApiError(400, 'invalid_request', 'Pengaturan peruntukan anak dan konten sintetis wajib dipilih');
  return {
    channelId,
    requestId,
    videoUrl,
    title,
    description: value.description,
    privacyStatus: String(value.privacyStatus),
    madeForKids: value.madeForKids,
    containsSyntheticMedia: value.containsSyntheticMedia,
  };
}
export async function createPost(account: string, body: unknown) {
  const input = postInput(body);
  await accessToken(account, input.channelId);
  await validatePublicUrl(input.videoUrl);
  const hash = digest(JSON.stringify(input));
  try {
    await sql.insertPost(db, [randomUUID(), account, input.channelId, input.requestId, hash, JSON.stringify(input)]);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
  }
  const [rows] = await sql.post(db, [account, input.requestId]);
  if (!rows[0] || rows[0].input_hash !== hash)
    throw new ApiError(409, 'idempotency_conflict', 'ID permintaan sudah dipakai dengan isi berbeda');
  return summary(rows[0]);
}
function summary(row: any) {
  return {
    requestId: row.request_id,
    channelId: row.channel_id,
    name: row.name ?? '',
    title: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)?.title ?? '',
    status: row.status,
    videoId: row.video_id ?? null,
    url: row.video_id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(row.video_id) : null,
    error: row.error ?? null,
    createdAt: row.created_at,
  };
}
export async function listPosts(account: string) {
  const [rows] = await sql.posts(db, [account]);
  return rows.map(summary);
}
export async function checkPost(account: string, id: string) {
  const [rows] = await sql.post(db, [account, id]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'youtube_post_not_found', 'Publikasi YouTube tidak ditemukan');
  if (row.status === 'unknown' && row.upload_session) {
    const token = await accessToken(account, row.channel_id);
    const response = await fetch(uploadSession(decrypt(row.upload_session)), {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Length': '0',
        'Content-Range': 'bytes */' + row.upload_size,
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (response.status === 308) {
      await sql.finish(db, [
        'failed',
        null,
        'Unggahan terputus dan belum selesai. Anda dapat mengirim permintaan baru.',
        row.id,
      ]);
    } else if (response.status === 404 || response.status === 410) {
      await sql.finish(db, [
        'unknown',
        null,
        'Sesi unggahan sudah kedaluwarsa. Periksa channel YouTube sebelum mengirim ulang.',
        row.id,
      ]);
    } else if (response.ok) {
      const data = await json(response);
      if (typeof data.id === 'string') await sql.finish(db, ['processing', data.id, null, row.id]);
    } else await googleError(response);
  }
  if (row.status === 'unknown' && !row.upload_session)
    await sql.finish(db, ['failed', null, 'Unggahan terhenti sebelum video dikirim. Kirim permintaan baru.', row.id]);
  const [current] = await sql.post(db, [account, id]);
  const post = current[0];
  if (post.video_id && post.status === 'processing') {
    const token = await accessToken(account, post.channel_id),
      data = await requestApi('/videos?part=status,processingDetails&id=' + encodeURIComponent(post.video_id), token),
      video = data.items?.[0];
    if (video?.status?.uploadStatus === 'processed') await sql.finish(db, ['published', post.video_id, null, post.id]);
    else if (['failed', 'rejected', 'deleted'].includes(video?.status?.uploadStatus))
      await sql.finish(db, [
        'failed',
        post.video_id,
        'YouTube gagal memproses video: ' +
          String(video.status.failureReason ?? video.status.rejectionReason ?? video.status.uploadStatus).slice(0, 200),
        post.id,
      ]);
  }
  const [final] = await sql.post(db, [account, id]);
  return summary(final[0]);
}
// Diekspor agar pengujian transport dapat memakai unduhan tiruan tanpa membuka akses jaringan internal di produksi.
export async function processNext(download = downloadPublicMedia) {
  const c = await db.getConnection();
  let row;
  try {
    await c.beginTransaction();
    const [rows] = await sql.queued(c);
    row = rows[0];
    if (row) await sql.claim(c, [row.id]);
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
  if (!row) return false;
  let media: Awaited<ReturnType<typeof downloadPublicMedia>> | undefined,
    sending = false;
  try {
    const input = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const token = await accessToken(row.account_id, row.channel_id);
    media = await download(input.videoUrl, { maxBytes: 1024 * 1024 * 1024, timeoutMs: 300000 });
    if (!media || !media.mimetype?.startsWith('video/'))
      throw new ApiError(400, 'invalid_media', 'URL harus menghasilkan file video (maksimal 1 GB).');
    const size = (await stat(media.path)).size;
    if (!size) throw new ApiError(400, 'invalid_media', 'Video kosong');
    const response = await fetch(urls().upload + '?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': media.mimetype,
      },
      body: JSON.stringify({
        snippet: { title: input.title, description: input.description, categoryId: '22' },
        status: {
          privacyStatus: input.privacyStatus,
          selfDeclaredMadeForKids: input.madeForKids,
          containsSyntheticMedia: input.containsSyntheticMedia,
        },
      }),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!response.ok) await googleError(response);
    const session = uploadSession(response.headers.get('location') ?? '');
    await sql.session(db, [encrypt(session), size, row.id]);
    sending = true;
    const uploaded = await fetch(session, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': media.mimetype, 'Content-Length': String(size) },
      body: createReadStream(media.path) as unknown as NonNullable<RequestInit['body']>,
      duplex: 'half',
      signal: AbortSignal.timeout(600000),
      redirect: 'error',
    } as RequestInit & { duplex: string });
    if (!uploaded.ok) {
      if (uploaded.status < 500 && uploaded.status !== 308) sending = false;
      await googleError(uploaded);
    }
    const data = await json(uploaded);
    if (typeof data.id !== 'string') throw Error('missing video id');
    await sql.finish(db, ['processing', data.id, null, row.id]);
  } catch (error) {
    await sql.finish(db, [
      sending ? 'unknown' : 'failed',
      null,
      error instanceof ApiError ? error.message : 'Koneksi unggahan terputus; periksa status sebelum mencoba ulang.',
      row.id,
    ]);
  } finally {
    await media?.cleanup();
  }
  return true;
}
export function startYouTubeWorker() {
  let work: Promise<unknown> | undefined,
    stopping = false;
  const tick = () => {
    if (stopping || work) return;
    work = processNext()
      .catch(() => console.error('Antrean YouTube gagal diproses.'))
      .finally(() => {
        work = undefined;
      });
  };
  const timer = setInterval(tick, 3000).unref();
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await work;
  };
}
export async function recoverUploads() {
  await sql.interrupted(db);
}

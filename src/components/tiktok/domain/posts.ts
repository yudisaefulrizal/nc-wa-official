// Direct Post TikTok: foto dari Pustaka konten (dashboard) dan video dari URL publik (API v1 dan Test Post). Berisi info
// kreator, validasi pilihan pengguna, penerbitan, dan pemantauan status. Init Direct Post langsung menerbitkan, jadi
// hasil yang tidak pasti tidak pernah dikirim ulang otomatis.
import sharp from 'sharp';
import { contentFile } from '../../ai/index.js';
import { validatePostVideo, maxVideoBytes } from '../../instagram/index.js';
import { db } from '../../../libraries/db.js';
import { digest } from '../../../libraries/security.js';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { outboundMedia } from '../data-access/outbound-media-store.js';
import * as postsSql from '../data-access/posts-queries.js';
import { accessToken, postingToken } from './connections.js';
import { postingRequest } from './client.js';

type PostChoices = {
  privacyLevel: string;
  allowComment: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  // Hanya untuk video: TikTok tidak mengenal Duet dan Stitch pada posting foto.
  allowDuet?: boolean;
  allowStitch?: boolean;
};
const privacyLevels = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
// Dependensi unduhan dapat diganti tes dengan sumber lokal; tidak ada flag bypass keamanan produksi.
export const postMediaSource = { download: downloadPublicMedia };

export function tiktokMedia(name: string) {
  return outboundMedia.get(name);
}
export async function creatorInfo(account: string, openId: string) {
  return queryCreator(await postingToken(account, openId));
}
export async function createTikTokPost(account: string, body: unknown) {
  const input = object(body),
    requestId = postRequestId(input.requestId),
    openId = requiredString(input.openId, 'Akun TikTok', 128),
    mediaType = input.mediaType ?? 'PHOTO';
  if (mediaType !== 'PHOTO' && mediaType !== 'VIDEO')
    throw new ApiError(400, 'invalid_request', 'mediaType harus PHOTO atau VIDEO.');
  const video = mediaType === 'VIDEO';
  // Foto berasal dari Pustaka konten (fileIds), video dari URL publik (videoUrl); kombinasi lain ditolak.
  if (video ? input.fileIds !== undefined || input.description !== undefined : input.videoUrl !== undefined)
    throw new ApiError(400, 'invalid_request', 'Isi fileIds untuk PHOTO, atau hanya videoUrl untuk VIDEO.');
  const choices = postChoices(input, video),
    fileIds = video ? [] : photoIds(input.fileIds),
    videoUrl = video ? requiredString(input.videoUrl, 'URL video', 4096) : '',
    // Pada video, title adalah caption posting (maks 2.200); pada foto, judul pendek dengan deskripsi terpisah.
    title = optionalText(input.title, video ? 'Caption' : 'Judul', video ? 2200 : 90),
    description = video ? '' : optionalText(input.description, 'Deskripsi', 4000);
  const hash = digest(
    JSON.stringify(
      video ? { openId, mediaType, videoUrl, title, ...choices } : { openId, fileIds, title, description, ...choices },
    ),
  );
  const previous = await findPost(account, requestId);
  if (previous) return matchingPost(account, previous, hash);
  const token = await postingToken(account, openId);
  const files = [];
  for (const id of fileIds) {
    const file = await contentFile(account, id);
    if (file.kind !== 'result')
      throw new ApiError(400, 'invalid_post_image', 'Pilih gambar hasil dari Pustaka konten.');
    files.push(file);
  }
  const origin = publicOrigin();
  // Info kreator dibaca ulang tepat sebelum posting, karena privasi akun dan batas harian bisa berubah.
  const creator = await queryCreator(token);
  if (!creator.privacyOptions.includes(choices.privacyLevel))
    throw new ApiError(
      409,
      'privacy_level_option_mismatch',
      'Pilihan privasi tidak tersedia untuk akun ini. Buka ulang dialog.',
    );
  if (choices.allowComment && creator.commentDisabled)
    throw new ApiError(409, 'comment_disabled', 'Komentar dimatikan di pengaturan akun TikTok ini.');
  if (video && ((choices.allowDuet && creator.duetDisabled) || (choices.allowStitch && creator.stitchDisabled)))
    throw new ApiError(409, 'interaction_disabled', 'Duet atau Stitch dimatikan di pengaturan akun TikTok ini.');
  // Video diunduh dan diperiksa sebelum permintaan dicatat, seperti Reels: video yang ditolak tidak meninggalkan baris.
  let names: string[] = video ? [await stageVideo(videoUrl, creator.maxVideoDurationSec)] : [];
  try {
    await postsSql.insert(db, [account, requestId, openId, hash, mediaType, fileIds.length]);
  } catch (error) {
    await outboundMedia.remove(names);
    if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    return matchingPost(account, (await findPost(account, requestId))!, hash);
  }
  if (!video)
    try {
      const photos = [];
      for (const file of files) photos.push(await preparePhoto(file.path));
      names = await outboundMedia.publishPhotos(photos);
    } catch (error) {
      await rememberFailure(account, requestId, error);
      throw error;
    }
  const [claim] = await postsSql.claim(db, [account, requestId]);
  if (!claim.affectedRows) return findView(account, requestId);
  const urls = names.map(name => new URL('/tiktok/media/' + name, origin).href);
  const interactions = {
    privacy_level: choices.privacyLevel,
    disable_comment: !choices.allowComment,
    brand_organic_toggle: choices.brandOrganic,
    brand_content_toggle: choices.brandContent,
  };
  const result = video
    ? await postingRequest('/v2/post/publish/video/init/', token, {
        post_info: {
          title,
          ...interactions,
          disable_duet: !choices.allowDuet,
          disable_stitch: !choices.allowStitch,
        },
        source_info: { source: 'PULL_FROM_URL', video_url: urls[0] },
      })
    : await postingRequest('/v2/post/publish/content/init/', token, {
        media_type: 'PHOTO',
        post_mode: 'DIRECT_POST',
        post_info: { title, description, ...interactions },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls },
      });
  if (result.kind === 'ok' && typeof result.data.publish_id === 'string' && result.data.publish_id.length <= 64)
    await postsSql.markProcessing(db, [result.data.publish_id, account, requestId]);
  else if (result.kind === 'rejected') {
    await outboundMedia.remove(names);
    await postsSql.fail(db, [result.code, rejectionMessage(result.code), account, requestId]);
  } else
    await postsSql.uncertain(db, [
      'publication_unknown',
      'Hasil posting belum pasti. Periksa akun TikTok sebelum mengirim ulang.',
      account,
      requestId,
    ]);
  return findView(account, requestId);
}
// Membaca status tersimpan lalu, bila TikTok masih memproses, menanyakan perkembangan terbarunya.
export async function tiktokPost(account: string, request: unknown) {
  const requestId = postRequestId(request),
    row = await findPost(account, requestId);
  if (!row) throw new ApiError(404, 'not_found', 'Permintaan posting tidak ditemukan.');
  const age = Date.now() - new Date(row.updated_at).getTime();
  // Proses yang berhenti di tengah (misalnya server restart) diselesaikan sesuai seberapa jauh ia sudah berjalan.
  if (row.status === 'preparing' && age > 5 * 60000)
    await postsSql.fail(db, ['preparation_timeout', 'Persiapan media melewati batas waktu.', account, requestId]);
  if (row.status === 'publishing' && age > 2 * 60000)
    await postsSql.uncertain(db, [
      'publication_unknown',
      'Hasil posting belum pasti. Periksa akun TikTok sebelum mengirim ulang.',
      account,
      requestId,
    ]);
  if (row.status === 'processing') await advance(account, requestId, String(row.open_id), String(row.publish_id), age);
  return findView(account, requestId);
}

async function advance(account: string, requestId: string, openId: string, publishId: string, age: number) {
  let token: string;
  try {
    token = await accessToken(account, openId);
  } catch {
    return;
  }
  const result = await postingRequest('/v2/post/publish/status/fetch/', token, { publish_id: publishId });
  if (result.kind === 'ok') {
    if (result.data.status === 'PUBLISH_COMPLETE') await postsSql.markPublished(db, [account, requestId]);
    if (result.data.status === 'FAILED') {
      const reason = typeof result.data.fail_reason === 'string' ? result.data.fail_reason.slice(0, 64) : 'failed';
      await postsSql.fail(db, [reason, failureMessage(reason), account, requestId]);
    }
    return;
  }
  // TikTok menyerah mengunduh setelah satu jam; tanpa jawaban jauh setelah itu, status dianggap tidak pasti.
  if (age > 3 * 3600000)
    await postsSql.uncertain(db, [
      'status_unavailable',
      'Status posting tidak dapat diperiksa. Periksa akun TikTok.',
      account,
      requestId,
    ]);
}
async function queryCreator(token: string) {
  const result = await postingRequest('/v2/post/publish/creator_info/query/', token, {});
  if (result.kind === 'unreachable')
    throw new ApiError(502, 'tiktok_request_failed', 'TikTok sedang tidak dapat dihubungi; coba lagi.');
  if (result.kind === 'rejected') throw new ApiError(409, result.code, rejectionMessage(result.code));
  const data = result.data;
  const options = Array.isArray(data.privacy_level_options)
    ? data.privacy_level_options.filter((level: unknown) => typeof level === 'string' && privacyLevels.includes(level))
    : [];
  return {
    nickname: String(data.creator_nickname ?? '').slice(0, 200),
    username: String(data.creator_username ?? '').slice(0, 200),
    avatarUrl:
      typeof data.creator_avatar_url === 'string' && data.creator_avatar_url.startsWith('https://')
        ? data.creator_avatar_url
        : null,
    privacyOptions: options as string[],
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoDurationSec: Number.isSafeInteger(data.max_video_post_duration_sec)
      ? (data.max_video_post_duration_sec as number)
      : 0,
  };
}
// Semua pilihan wajib dikirim eksplisit: pedoman TikTok melarang nilai bawaan untuk privasi dan interaksi.
function postChoices(input: Record<string, unknown>, video: boolean): PostChoices {
  const { privacyLevel, allowComment, brandOrganic, brandContent } = input;
  const allowDuet = video ? input.allowDuet : false,
    allowStitch = video ? input.allowStitch : false;
  if (!video && (input.allowDuet !== undefined || input.allowStitch !== undefined))
    throw new ApiError(400, 'invalid_request', 'Duet dan Stitch hanya untuk video.');
  if (typeof privacyLevel !== 'string' || !privacyLevels.includes(privacyLevel))
    throw new ApiError(400, 'invalid_privacy', 'Pilih siapa yang dapat melihat posting.');
  if (![allowComment, allowDuet, allowStitch, brandOrganic, brandContent].every(value => typeof value === 'boolean'))
    throw new ApiError(400, 'invalid_request', 'Pilihan interaksi dan konten komersial wajib diisi true atau false.');
  // Aturan TikTok: konten bermerek (kerja sama berbayar) tidak boleh diposting privat.
  if (brandContent && privacyLevel === 'SELF_ONLY')
    throw new ApiError(
      400,
      'branded_content_private',
      'Konten bermerek tidak dapat diposting dengan privasi "Hanya saya".',
    );
  const base = {
    privacyLevel,
    allowComment: allowComment as boolean,
    brandOrganic: brandOrganic as boolean,
    brandContent: brandContent as boolean,
  };
  return video ? { ...base, allowDuet: allowDuet as boolean, allowStitch: allowStitch as boolean } : base;
}
// Unduhan, pemeriksaan format (aturan yang sama dengan Reels), dan batas durasi akun kreator sebelum disalin.
async function stageVideo(url: string, maxDurationSec: number) {
  let source: Awaited<ReturnType<typeof downloadPublicMedia>>;
  try {
    source = await postMediaSource.download(url, { maxBytes: maxVideoBytes, timeoutMs: 120000 });
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes((error as Error).name))
      throw new ApiError(504, 'video_download_timeout', 'Unduhan video melewati batas waktu.');
    throw error;
  }
  try {
    const { duration } = await validatePostVideo(source.path);
    if (maxDurationSec > 0 && duration > maxDurationSec)
      throw new ApiError(
        400,
        'video_too_long',
        `Video melebihi durasi maksimum akun TikTok ini (${maxDurationSec} detik).`,
      );
    return await outboundMedia.publishVideo(source.path);
  } finally {
    await source.cleanup();
  }
}
// TikTok menerima JPEG/WebP hingga 1080p; gambar diperkecil ke 1080×1920 (tegak) atau 1920×1080 (mendatar).
async function preparePhoto(path: string) {
  const image = sharp(path, { limitInputPixels: 40000000 }).rotate(),
    meta = await image.metadata();
  if (!meta.width || !meta.height) throw new ApiError(400, 'invalid_post_image', 'Gambar tidak dapat dibaca.');
  const portrait = meta.height >= meta.width;
  return image
    .resize({ width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
}
function publicOrigin() {
  try {
    const origin = new URL(process.env.APP_ORIGIN ?? '');
    if (['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password) return origin;
  } catch {
    /* ditangani di bawah */
  }
  throw new ApiError(503, 'media_origin_unavailable', 'Alamat publik aplikasi belum dikonfigurasi.');
}
function photoIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 35)
    throw new ApiError(400, 'invalid_request', 'Pilih 1 sampai 35 gambar.');
  const ids = value.map(id => requiredString(id, 'Gambar', 36));
  if (new Set(ids).size !== ids.length)
    throw new ApiError(400, 'invalid_request', 'Gambar yang sama dipilih dua kali.');
  return ids;
}
// Batas TikTok dihitung dalam satuan UTF-16, sama dengan panjang string JavaScript.
function optionalText(value: unknown, name: string, max: number) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max)
    throw new ApiError(400, 'invalid_request', `${name} maksimal ${max.toLocaleString('id-ID')} karakter.`);
  return value;
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
async function findView(account: string, requestId: string) {
  const row = (await findPost(account, requestId))!;
  return {
    requestId: String(row.request_id),
    status: String(row.status),
    mediaType: String(row.media_type),
    photoCount: Number(row.photo_count),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}
async function matchingPost(account: string, row: NonNullable<Awaited<ReturnType<typeof findPost>>>, hash: string) {
  if (row.payload_hash !== hash)
    throw new ApiError(409, 'idempotency_conflict', 'ID permintaan sudah dipakai untuk posting lain.');
  return findView(account, String(row.request_id));
}
async function rememberFailure(account: string, requestId: string, error: unknown) {
  // Isi respons TikTok, URL media, dan token tidak boleh masuk ke log maupun database.
  const code = error instanceof ApiError ? error.code : 'post_failed';
  const message = error instanceof ApiError ? error.message : 'Posting gagal disiapkan. Periksa log server.';
  await postsSql.fail(db, [code.slice(0, 64), message.slice(0, 500), account, requestId]);
}
function rejectionMessage(code: string) {
  const messages: Record<string, string> = {
    spam_risk_too_many_posts: 'Batas posting harian akun TikTok ini sudah tercapai. Coba lagi besok.',
    spam_risk_user_banned_from_posting: 'Akun TikTok ini sedang dibatasi untuk posting.',
    spam_risk_too_many_pending_share: 'Terlalu banyak posting yang masih diproses TikTok. Coba lagi nanti.',
    reached_active_user_cap: 'Kuota harian pengguna aplikasi di TikTok sudah tercapai. Coba lagi besok.',
    unaudited_client_can_only_post_to_private_accounts:
      'Aplikasi belum diaudit TikTok: akun TikTok harus privat dan posting hanya bisa "Hanya saya".',
    url_ownership_unverified: 'Domain aplikasi belum diverifikasi di TikTok Developer Portal.',
    privacy_level_option_mismatch: 'Pilihan privasi tidak tersedia untuk akun ini. Buka ulang dialog.',
    access_token_invalid: 'Izin TikTok tidak berlaku lagi. Hubungkan ulang akun.',
    scope_not_authorized: 'Hubungkan ulang TikTok dan izinkan posting konten.',
    rate_limit_exceeded: 'Terlalu banyak permintaan ke TikTok. Tunggu satu menit lalu coba lagi.',
  };
  return messages[code] ?? 'TikTok menolak posting ini.';
}
function failureMessage(reason: string) {
  const messages: Record<string, string> = {
    file_format_check_failed: 'Format foto tidak diterima TikTok.',
    picture_size_check_failed: 'Ukuran foto tidak diterima TikTok.',
    photo_pull_failed: 'TikTok gagal mengunduh foto. Pastikan domain aplikasi terverifikasi dan dapat diakses.',
    video_pull_failed: 'TikTok gagal mengunduh video. Pastikan domain aplikasi terverifikasi dan dapat diakses.',
    duration_check_failed: 'Durasi video tidak diterima TikTok.',
    frame_rate_check_failed: 'Frame rate video tidak diterima TikTok.',
    auth_removed: 'Izin TikTok dicabut saat posting diproses.',
    spam_risk_too_many_posts: 'Batas posting harian akun TikTok ini sudah tercapai.',
    spam_risk_user_banned_from_posting: 'Akun TikTok ini sedang dibatasi untuk posting.',
    spam_risk_text: 'TikTok menolak judul atau deskripsi posting.',
    spam_risk: 'TikTok menolak posting ini.',
    internal: 'TikTok mengalami gangguan. Anda dapat mencoba lagi.',
  };
  return messages[reason] ?? 'TikTok gagal memproses posting.';
}
// Pembersihan tetap berjalan walaupun tidak ada posting berikutnya.
setInterval(() => {
  void outboundMedia.prune().catch(() => log('tiktok', 'Pembersihan media sementara gagal'));
}, 10 * 60000).unref();

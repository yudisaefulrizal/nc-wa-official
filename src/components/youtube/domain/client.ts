// Transport Google dengan tenggat dan error yang disaring; token dan respons mentah tidak masuk log.
import { readFileSync } from 'node:fs';
import { ApiError } from '../../../libraries/errors.js';
export const scopes = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];
export function settings() {
  let config: { client_id?: string; client_secret?: string } = {};
  if (process.env.YOUTUBE_CREDENTIALS_FILE) {
    try {
      config = JSON.parse(readFileSync(process.env.YOUTUBE_CREDENTIALS_FILE, 'utf8')).web ?? {};
    } catch {
      throw new ApiError(503, 'youtube_not_configured', 'File kredensial YouTube tidak dapat dibaca');
    }
  }
  const id = process.env.YOUTUBE_CLIENT_ID || config.client_id,
    secret = process.env.YOUTUBE_CLIENT_SECRET || config.client_secret;
  if (!id || !secret) throw new ApiError(503, 'youtube_not_configured', 'YouTube belum dikonfigurasi di server');
  return { id, secret, redirect: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069') + '/auth/youtube/callback' };
}
export const urls = () => ({
  authorize: process.env.YOUTUBE_AUTHORIZE_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.YOUTUBE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
  revoke: process.env.YOUTUBE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke',
  api: process.env.YOUTUBE_API_URL ?? 'https://www.googleapis.com/youtube/v3',
  upload: process.env.YOUTUBE_UPLOAD_URL ?? 'https://www.googleapis.com/upload/youtube/v3/videos',
});
export async function googleError(response: Response): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as { error?: string | { errors?: { reason?: string }[] } };
  const reason = typeof data.error === 'string' ? data.error : data.error?.errors?.[0]?.reason;
  const known: Record<string, string> = {
    invalid_grant: 'Izin Google berakhir atau dicabut; hubungkan YouTube ulang.',
    quotaExceeded: 'Kuota API YouTube habis.',
    dailyLimitExceeded: 'Batas harian API YouTube tercapai.',
    uploadLimitExceeded: 'Batas unggahan channel YouTube tercapai.',
    forbidden: 'YouTube menolak izin untuk tindakan ini.',
    youtubeSignupRequired: 'Akun Google belum memiliki channel YouTube.',
    invalidVideoMetadata: 'Metadata video tidak valid.',
    invalidTitle: 'Judul video tidak valid.',
    videoNotFound: 'Video YouTube tidak ditemukan.',
  };
  throw new ApiError(
    502,
    reason === 'invalid_grant' || response.status === 401 ? 'youtube_reauth' : 'youtube_failed',
    (reason && known[reason]) || `YouTube menolak permintaan (HTTP ${response.status}).`,
  );
}
export async function json(response: Response) {
  if (!response.ok) return googleError(response);
  return response.json() as Promise<any>;
}
export async function tokenRequest(fields: Record<string, string>) {
  const { id, secret } = settings();
  const token = await json(
    await fetch(urls().token, {
      method: 'POST',
      body: new URLSearchParams({ ...fields, client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    }),
  );
  if (
    typeof token.access_token !== 'string' ||
    !Number.isFinite(Number(token.expires_in)) ||
    Number(token.expires_in) <= 0
  )
    throw new ApiError(502, 'youtube_failed', 'Token Google tidak valid');
  return token;
}
export function requestApi(route: string, token: string) {
  return fetch(urls().api + route, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  }).then(json);
}
// Session upload hanya boleh ke origin Google yang digunakan; mencegah token bocor ke redirect/provider palsu.
export function uploadSession(value: string) {
  const url = new URL(value),
    base = new URL(urls().upload);
  if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(base.pathname))
    throw new ApiError(502, 'youtube_failed', 'Alamat sesi upload Google tidak valid');
  return url.toString();
}

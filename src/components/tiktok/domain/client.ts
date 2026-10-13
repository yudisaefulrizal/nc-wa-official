// Klien HTTP TikTok Login Kit v2; secret dan respons provider tidak pernah dicatat ke log.
import { ApiError } from '../../../libraries/errors.js';

export function settings() {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim(),
    secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!key || !secret) throw new ApiError(503, 'tiktok_not_configured', 'TikTok belum dikonfigurasi di server');
  return { key, secret, redirect: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069') + '/auth/tiktok/callback' };
}
// Penggantian alamat hanya untuk server tiruan dalam tes, bukan konfigurasi dashboard.
export const apiBase = () => process.env.TIKTOK_API_URL ?? 'https://open.tiktokapis.com';
export const authorizeUrl = () => process.env.TIKTOK_AUTHORIZE_URL ?? 'https://www.tiktok.com/v2/auth/authorize/';
export function failed() {
  return new ApiError(502, 'tiktok_request_failed', 'Permintaan TikTok gagal; coba lagi atau hubungkan ulang akun');
}
export async function requestTikTok(path: string, init: RequestInit) {
  try {
    const response = await fetch(apiBase() + path, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw failed();
    const body = (await response.json()) as Record<string, any>;
    if (!body || typeof body !== 'object' || (body.error && body.error.code !== 'ok')) throw failed();
    return body;
  } catch {
    throw failed();
  }
}
export async function tokenRequest(params: Record<string, string>) {
  const { key, secret } = settings();
  return requestTikTok('/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, ...params }).toString(),
  });
}
export function validateToken(body: Record<string, any>) {
  for (const field of ['access_token', 'refresh_token', 'open_id', 'scope'])
    if (typeof body[field] !== 'string' || !body[field]) throw failed();
  if (body.open_id.length > 128 || body.scope.length > 1000) throw failed();
  for (const field of ['expires_in', 'refresh_expires_in'])
    if (!Number.isSafeInteger(body[field]) || body[field] <= 0 || body[field] > 10 * 366 * 86400) throw failed();
  if (!body.scope.split(',').includes('user.info.basic')) throw failed();
}
// Pemanggilan Content Posting API dengan token pengguna. Berbeda dari requestTikTok, kode error TikTok dikembalikan
// karena alur posting membedakan penolakan pasti (`rejected`) dari hasil yang tidak diketahui (`unreachable`).
export type PostingResult =
  | { kind: 'ok'; data: Record<string, any> }
  | { kind: 'rejected'; code: string; status: number }
  | { kind: 'unreachable' };
export async function postingRequest(path: string, accessToken: string, body: object): Promise<PostingResult> {
  let response: Response;
  try {
    response = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
  } catch {
    return { kind: 'unreachable' };
  }
  let parsed: Record<string, any> | undefined;
  try {
    parsed = (await response.json()) as Record<string, any>;
  } catch {
    parsed = undefined;
  }
  const code = typeof parsed?.error?.code === 'string' ? parsed.error.code.slice(0, 64) : '';
  if (response.ok && code === 'ok' && parsed?.data && typeof parsed.data === 'object')
    return { kind: 'ok', data: parsed.data };
  // 5xx tanpa kode jelas berarti TikTok mungkin sudah memproses permintaan.
  if (response.status >= 500 || !code) return { kind: 'unreachable' };
  return { kind: 'rejected', code, status: response.status };
}

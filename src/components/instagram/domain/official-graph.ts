// Pemanggilan Instagram Graph API resmi dengan token di header Authorization (bukan query string, supaya tidak masuk
// log proxy). Dipakai komentar dan insight; isi respons error Meta tidak dicatat karena bisa memuat data akun.
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';

const graph = () => (process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com') + '/v23.0';
export async function graphRequest(path: string, token: string, body?: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(graph() + '/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(502, 'instagram_request_failed', 'Instagram tidak dapat dihubungi');
  }
  if (!response.ok) {
    log('instagram-official', 'Permintaan Graph API ditolak Meta (' + response.status + ')');
    throw new ApiError(502, 'instagram_request_failed', 'Instagram menolak permintaan; periksa izin dan ID-nya');
  }
  return (await response.json()) as Record<string, unknown>;
}

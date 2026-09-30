// Instagram Messaging API resmi (Instagram Login): kirim DM teks dan gambar dan baca nama pelanggan. Token dikirim lewat header
// Authorization, bukan query string, supaya tidak masuk log proxy.
import { prepareOfficialImage } from './official-image.js';
import { ApiError } from '../../../libraries/errors.js';
import { outboundMedia } from '../data-access/outbound-media-store.js';
import { log } from '../../../libraries/log.js';

const graph = () => (process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com') + '/v23.0';
// Mengembalikan ID pesan (mid). Jendela balasan Meta 24 jam; penolakannya diteruskan sebagai kesalahan kirim.
export async function sendOfficialText(igUser: string, token: string, recipient: string, text: string) {
  return sendOfficialMessage(igUser, token, recipient, { text });
}
export async function sendOfficialImage(igUser: string, token: string, recipient: string, path: string) {
  let origin: URL;
  try {
    origin = new URL(process.env.APP_ORIGIN ?? '');
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error();
  } catch {
    throw new ApiError(503, 'media_origin_unavailable', 'Alamat publik aplikasi untuk gambar Instagram tidak valid');
  }
  const media = await outboundMedia.publish(path, prepareOfficialImage);
  const url = new URL('/instagram/media/' + media, origin).href;
  return sendOfficialMessage(igUser, token, recipient, { attachment: { type: 'image', payload: { url } } });
}
export function getOfficialMedia(token: string) {
  return outboundMedia.get(token);
}
// Pembersihan tetap berjalan walaupun tidak ada kiriman berikutnya.
setInterval(() => {
  void outboundMedia.prune().catch(() => log('instagram-official', 'Pembersihan gambar sementara gagal'));
}, 60000).unref();

async function sendOfficialMessage(igUser: string, token: string, recipient: string, message: object) {
  const response = await fetch(graph() + '/' + encodeURIComponent(igUser) + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipient }, message }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    log('instagram-official', 'Kirim DM ditolak Meta (' + response.status + ')');
    throw new ApiError(
      502,
      'instagram_send_failed',
      response.status === 400 ? 'Instagram menolak pesan (di luar jendela balasan 24 jam?)' : 'Instagram menolak pesan',
    );
  }
  const data = (await response.json()) as { message_id?: string };
  if (!data.message_id) throw new ApiError(502, 'instagram_send_failed', 'Instagram tidak mengembalikan ID pesan');
  return data.message_id;
}
// Nama dan @username pelanggan, sekadar pelengkap tampilan: gagal tidak pernah menahan pesan.
export async function fetchCustomer(token: string, id: string) {
  try {
    const response = await fetch(graph() + '/' + encodeURIComponent(id) + '?fields=name,username', {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return {};
    const data = (await response.json()) as { name?: string; username?: string };
    return { name: data.name, username: data.username };
  } catch {
    return {};
  }
}

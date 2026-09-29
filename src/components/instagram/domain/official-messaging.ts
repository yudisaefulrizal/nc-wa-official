// Instagram Messaging API resmi (Instagram Login): kirim DM teks dan baca nama pelanggan. Token dikirim lewat header
// Authorization, bukan query string, supaya tidak masuk log proxy.
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';

const graph = () => (process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com') + '/v23.0';
// Mengembalikan ID pesan (mid). Jendela balasan Meta 24 jam; penolakannya diteruskan sebagai kesalahan kirim.
export async function sendOfficialText(igUser: string, token: string, recipient: string, text: string) {
  const response = await fetch(graph() + '/' + encodeURIComponent(igUser) + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipient }, message: { text } }),
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

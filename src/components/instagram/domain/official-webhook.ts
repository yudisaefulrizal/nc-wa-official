// Webhook Instagram Login resmi dari Meta: verifikasi callback (hub.challenge dengan verify token buatan sendiri) dan
// penerimaan event bertanda tangan X-Hub-Signature-256 (HMAC-SHA256 body mentah dengan App Secret). DM masuk dan
// gema DM keluar diteruskan ke sesi Instagram yang cocok lewat ChannelHub, seperti pada Zernio.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { db } from '../../../libraries/db.js';
import { decrypt } from '../../../libraries/crypto.js';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import type { IncomingMessage, MediaType } from '../../whatsapp/index.js';
import { type ChannelHub, messageIdOf } from './channel-connection.js';
import { fetchCustomer } from './official-messaging.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as contactsSql from '../data-access/contacts-queries.js';
import * as officialSql from '../data-access/official-queries.js';

function same(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
// Mengembalikan hub.challenge bila Meta mengirim verify token yang benar.
export function verifyChallenge(query: Record<string, unknown>) {
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!expected) throw new ApiError(503, 'instagram_not_configured', 'Verify token webhook belum dikonfigurasi');
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = query;
  if (mode !== 'subscribe' || typeof token !== 'string' || !same(token, expected) || typeof challenge !== 'string')
    throw new ApiError(403, 'forbidden', 'Verify token tidak cocok');
  return challenge;
}
interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
}
const mediaTypes: Record<string, MediaType> = { image: 'image', video: 'video', audio: 'audio', file: 'document' };
const seen = new Set<string>();
export async function receiveOfficialEvent(hub: ChannelHub, raw: Buffer, signature: unknown) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) throw new ApiError(503, 'instagram_not_configured', 'Instagram Login belum dikonfigurasi di server');
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  if (typeof signature !== 'string' || !same(signature, expected))
    throw new ApiError(403, 'invalid_signature', 'Tanda tangan webhook tidak valid');
  let body: {
    entry?: { id?: string; messaging?: MessagingEvent[]; changes?: { field?: string; value?: MessagingEvent }[] }[];
  };
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body webhook tidak valid');
  }
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const igUser = String(entry.id ?? '');
    const [channels] = await channelsSql.findOfficialByUser(db, [igUser]);
    const channel = channels[0];
    if (!channel) continue;
    // Payload nyata bisa memakai entry.messaging[] atau entry.changes[] dengan field "messages".
    const events = [
      ...(entry.messaging ?? []),
      ...(entry.changes ?? []).filter(c => c.field === 'messages' && c.value).map(c => c.value!),
    ];
    for (const event of events)
      await route(hub, String(channel.account_id), String(channel.session_id), igUser, event).catch(() =>
        log(String(channel.session_id), 'Event Instagram gagal diproses'),
      );
  }
}
async function route(hub: ChannelHub, account: string, session: string, igUser: string, event: MessagingEvent) {
  const mid = event.message?.mid;
  if (!mid || seen.has(mid)) return;
  const echo = event.message?.is_echo === true;
  const customer = String((echo ? event.recipient?.id : event.sender?.id) ?? '');
  if (!/^[0-9]{5,20}$/.test(customer) || customer === igUser) return;
  const message = parse(event, mid, customer);
  if (!message) return;
  if (echo) hub.emit(account, session, { outgoing: message });
  else {
    const [owner] = await officialSql.findByUserWithToken(db, [igUser]);
    const profile = owner[0]?.token ? await fetchCustomer(decrypt(owner[0].token), customer) : {};
    await contactsSql
      .upsert(db, [
        account,
        session,
        customer,
        String(profile.username ?? '').slice(0, 100),
        String(profile.name ?? '').slice(0, 100),
      ])
      .catch(() => log(session, 'Gagal menyimpan kontak Instagram'));
    const name = profile.name || (profile.username ? '@' + profile.username : '');
    hub.emit(account, session, { incoming: name ? { ...message, pushName: name.slice(0, 100) } : message });
  }
  // Dicatat setelah berhasil, supaya kiriman ulang Meta masih diproses bila percobaan pertama gagal.
  seen.add(mid);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);
}
function parse(event: MessagingEvent, mid: string, customer: string): IncomingMessage | undefined {
  const message = event.message!;
  const common = {
    messageId: messageIdOf(mid),
    from: customer,
    isGroup: false,
    groupId: null,
    sender: customer,
    timestamp: Math.floor((event.timestamp && event.timestamp > 0 ? event.timestamp : Date.now()) / 1000),
  };
  const attachment = message.attachments?.[0];
  const type = attachment?.type ? mediaTypes[attachment.type] : undefined;
  const url = attachment?.payload?.url;
  if (url && type)
    return {
      ...common,
      type,
      text: message.text ?? '',
      mimetype: 'application/octet-stream',
      // Tautan CDN Meta kedaluwarsa, jadi diunduh saat pesan diproses; filenya dihapus setelah dibaca.
      download: async () => {
        const file = await downloadPublicMedia(url);
        const stream = createReadStream(file.path);
        stream.once('close', () => void file.cleanup());
        return stream;
      },
    };
  const label = attachment ? '[Pesan ' + (attachment.type ?? 'lampiran') + ' Instagram]' : '';
  const text = [message.text ?? '', label].filter(Boolean).join(' ').trim();
  return text ? { ...common, type: 'text', text } : undefined;
}

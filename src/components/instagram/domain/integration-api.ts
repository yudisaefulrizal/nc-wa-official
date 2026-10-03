// Operasi API untuk aplikasi lain (kunci integrasi): daftar akun, percakapan dan pesan, serta kirim DM. Semua
// berpegang pada akun pemilik key; ID akun Instagram dari klien hanya dipakai bila memang milik akun itu.
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { chatMessages, listChats } from '../../ai/index.js';
import { sendBilled } from '../../billing/index.js';
import type { SessionManager } from '../../whatsapp/index.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as contactsSql from '../data-access/contacts-queries.js';
import { listOfficial } from './official-login.js';

// Sesi Instagram resmi milik akun untuk satu akun Instagram; 404 bila akun itu bukan miliknya atau belum dipasang.
export async function sessionOfAccount(account: string, igUserId: string) {
  const [rows] = await channelsSql.findOfficialByUser(db, [igUserId]);
  const channel = rows[0];
  if (!channel || channel.account_id !== account)
    throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ditemukan');
  return String(channel.session_id);
}
export async function integrationAccounts(account: string) {
  const rows = await listOfficial(account);
  return rows.map(({ id, username, status, permissions, daysLeft, session }) => ({
    id,
    username,
    status,
    permissions,
    daysLeft,
    sessionActive: Boolean(session),
  }));
}
export async function integrationConversations(account: string, igUserId: string) {
  const session = await sessionOfAccount(account, igUserId);
  const [contacts] = await contactsSql.listBySession(db, [account, session]);
  const names = new Map(contacts.map(c => [String(c.customer), c]));
  return (await listChats(account, session)).map(chat => {
    const contact = names.get(String(chat.customer));
    return { ...chat, username: contact?.username || null, name: contact?.name || null };
  });
}
export async function integrationMessages(account: string, igUserId: string, customer: string, before?: unknown) {
  return chatMessages(account, await sessionOfAccount(account, igUserId), customer, before);
}
// Kirim DM memotong kredit pesan seperti pengiriman lewat API key akun; Idempotency-Key mencegah kirim ganda.
export async function integrationSend(account: string, manager: SessionManager, body: unknown, key?: string) {
  const input = object(body),
    session = await sessionOfAccount(account, requiredString(input.igUserId, 'igUserId', 64)),
    to = requiredString(input.to, 'to', 30);
  if (input.imageUrl !== undefined)
    return sendBilled(account, manager, session, 'media', { to, type: 'image', url: input.imageUrl }, key);
  return sendBilled(account, manager, session, 'text', { to, text: input.text }, key);
}

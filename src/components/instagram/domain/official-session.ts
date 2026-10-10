// Memasang akun Instagram Login resmi sebagai sesi, seperti nomor WhatsApp: langsung setelah login berhasil, memakai
// jatah sesi paket yang sama. Kanalnya memakai tabel instagram_channels dengan provider 'official'.
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import type { SessionManager } from '../../whatsapp/index.js';
import { assertSessionSlot, createSessionWithSlot } from './connect-flow.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as officialSql from '../data-access/official-queries.js';

// ID sesi dari username (titik dan karakter lain diganti "-"), diberi nomor bila sudah dipakai.
function sessionIdFor(username: string, taken: Set<string>) {
  const base = ('ig-' + username.replace(/[^a-zA-Z0-9_-]/g, '-')).slice(0, 56);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = base + '-' + n;
  return id;
}
export async function attachOfficialSession(account: string, manager: SessionManager, igUser: string) {
  const [owned] = await officialSql.findOwned(db, [account, igUser]);
  const row = owned[0];
  if (!row) throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ditemukan');
  if (row.status !== 'active')
    throw new ApiError(409, 'instagram_reauth', 'Izin sudah berakhir; hubungkan Instagram lagi');
  const [existing] = await channelsSql.findOfficialByUser(db, [igUser]);
  if (existing[0]) {
    // Sesi sudah ada (misalnya izin dulu dicabut lalu diberikan lagi): aktifkan dan sambungkan kembali.
    const session = String(existing[0].session_id);
    await channelsSql.updateOfficialStatus(db, ['active', igUser]);
    await channelsSql.updateOfficialUsername(db, [row.username, igUser]);
    if (manager.detail(session).status === 'logged_out') await manager.reconnect(session);
    return { session };
  }
  await assertSessionSlot(account, manager);
  const session = sessionIdFor(
    String(row.username),
    new Set([
      ...manager.list().map(s => s.id),
      ...(await channelsSql.listSessionIds(db, [account]))[0].map(r => String(r.session_id)),
    ]),
  );
  await channelsSql.insertOfficial(db, [account, session, igUser, row.username]);
  try {
    await createSessionWithSlot(account, manager, session);
  } catch (error) {
    await channelsSql.deleteBySession(db, [account, session]);
    throw error;
  }
  return { session };
}

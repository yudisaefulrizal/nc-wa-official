// Kuota sesi bersama WhatsApp, Instagram, dan TikTok. Pemeriksaan penambahan memakai kunci akun ensureBasic.
import type { PoolConnection } from 'mysql2/promise';
import type { SessionManager } from '../../whatsapp/index.js';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { ensureBasic } from './plans.js';
import * as auditEventsSql from '../data-access/audit-events-queries.js';
import * as slotsSql from '../data-access/session-slots-queries.js';
import * as walletsSql from '../data-access/wallets-queries.js';

export async function assertSessionSlot(c: PoolConnection, account: string, manager: SessionManager) {
  const wallet = await ensureBasic(c, account);
  const [rows] = await slotsSql.countTikTok(c, account);
  if (manager.list().filter(s => s.serviceActive !== false).length + Number(rows[0].used) >= wallet.session_limit)
    throw new ApiError(409, 'session_limit', 'Slot sesi paket sudah penuh');
}
export async function chatSessionLimit(account: string, limit: number) {
  const [rows] = await slotsSql.countTikTok(db, account);
  return Math.max(0, limit - Number(rows[0].used));
}
// Pemilik menetapkan jumlah slot tambahan (bukan menambah), supaya permintaan yang diulang tetap aman.
export async function setSessionBonus(account: string, bonus: number, actor: string) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await ensureBasic(c, account);
    await walletsSql.setBonusSessions(c, [bonus, account]);
    await auditEventsSql.insert(c, [actor, `session_bonus_set:${account}:${bonus}`]);
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

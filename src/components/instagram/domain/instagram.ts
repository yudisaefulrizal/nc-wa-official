// Layanan Instagram DM lewat Zernio untuk gateway dan rute: konektor sesi, akun Zernio, alur hubungkan, webhook,
// dan kontak pelanggan. Gateway memasang `host` supaya layanan ini bisa memakai SessionManager tiap akun tanpa
// komponen whatsapp atau ai mengimpor komponen ini.
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import type { Connector, SessionManager } from '../../whatsapp/index.js';
import { ChannelHub, channelConnector } from './channel-connection.js';
import { connectInstagram, reconnectInstagram } from './connect-flow.js';
import { receiveWebhook } from './webhook-events.js';
import * as official from './official-login.js';
import { attachOfficialSession } from './official-session.js';
import { receiveOfficialEvent, verifyChallenge } from './official-webhook.js';
import * as accounts from './zernio-accounts.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as contactsSql from '../data-access/contacts-queries.js';

export interface InstagramHost {
  manager(account: string): Promise<SessionManager>;
  // Menghapus sesi beserta data AI-nya, sama seperti tombol Hapus di halaman Sesi.
  removeSession(account: string, session: string): Promise<void>;
}
export class Instagram {
  hub = new ChannelHub();
  host?: InstagramHost;
  connector(
    account: string,
    whatsapp: Connector,
    registerSystemMessage: (session: string, messageId: string) => Promise<void>,
  ) {
    return channelConnector(account, whatsapp, this.hub, registerSystemMessage);
  }
  zernioAccounts(account: string) {
    return accounts.listZernioAccounts(account);
  }
  addZernioAccount(account: string, body: unknown) {
    return accounts.addZernioAccount(account, body);
  }
  checkZernioAccount(account: string, id: string) {
    return accounts.checkZernioAccount(account, id);
  }
  replaceZernioKey(account: string, id: string, body: unknown) {
    return accounts.replaceZernioKey(account, id, body);
  }
  instagramAccounts(account: string, id: string) {
    return accounts.instagramAccounts(account, id);
  }
  async deleteZernioAccount(account: string, id: string) {
    for (const session of await accounts.sessionsOfZernioAccount(account, id))
      await this.requireHost().removeSession(account, session);
    return accounts.deleteZernioAccount(account, id);
  }
  async connect(account: string, body: unknown) {
    return connectInstagram(account, await this.requireHost().manager(account), body);
  }
  async reconnect(account: string, session: unknown) {
    return reconnectInstagram(account, await this.requireHost().manager(account), session);
  }
  startOfficialLogin(account: string) {
    return official.startLogin(account);
  }
  // Login berhasil langsung memasang akunnya sebagai sesi, seperti nomor WhatsApp. Bila jatah sesi paket penuh,
  // izinnya tetap tersimpan dan halaman Integrasi menawarkan pemasangan lagi.
  async finishOfficialLogin(query: Record<string, unknown>) {
    const { result, account, igUser } = await official.finishLogin(query);
    if (result !== 'connected' || !account || !igUser) return result;
    try {
      await this.attachOfficialSession(account, igUser);
      return 'connected';
    } catch (error) {
      return error instanceof ApiError && error.code === 'session_limit' ? 'no_slot' : 'error';
    }
  }
  async attachOfficialSession(account: string, igUser: string) {
    return attachOfficialSession(account, await this.requireHost().manager(account), igUser);
  }
  officialAccounts(account: string) {
    return official.listOfficial(account);
  }
  refreshOfficial(account: string, igUser: string) {
    return official.refreshOfficial(account, igUser);
  }
  refreshExpiringOfficial() {
    return official.refreshExpiring();
  }
  // Memutus melepas sesinya juga (riwayat chat dan data AI sesi itu ikut terhapus, seperti tombol Hapus sesi).
  async disconnectOfficial(account: string, igUser: string) {
    const [channels] = await channelsSql.findOfficialByUser(db, [igUser]);
    if (channels[0] && channels[0].account_id === account)
      await this.requireHost().removeSession(account, String(channels[0].session_id));
    return official.disconnectOfficial(account, igUser);
  }
  async deauthorizeOfficial(signedRequest: unknown) {
    const payload = official.verifySignedRequest(signedRequest);
    if (!payload) return false;
    await official.deauthorized(payload.user_id);
    const [channels] = await channelsSql.findOfficialByUser(db, [payload.user_id]);
    if (channels[0]) {
      await channelsSql.updateOfficialStatus(db, ['disconnected', payload.user_id]);
      this.hub.emit(String(channels[0].account_id), String(channels[0].session_id), { disconnected: 401 });
    }
    return true;
  }
  async deleteOfficialData(signedRequest: unknown) {
    const payload = official.verifySignedRequest(signedRequest);
    if (!payload) return null;
    const [channels] = await channelsSql.findOfficialByUser(db, [payload.user_id]);
    if (channels[0])
      await this.requireHost().removeSession(String(channels[0].account_id), String(channels[0].session_id));
    return official.deleteData(payload.user_id);
  }
  verifyOfficialWebhook(query: Record<string, unknown>) {
    return verifyChallenge(query);
  }
  receiveOfficialWebhook(raw: Buffer, signature: unknown) {
    return receiveOfficialEvent(this.hub, raw, signature);
  }
  receiveWebhook(zernioId: string, raw: Buffer, signature: unknown) {
    // Akun yang dihubungkan ulang di Zernio langsung menyambungkan lagi sesinya yang terputus.
    return receiveWebhook(this.hub, zernioId, raw, signature, async (account, session) => {
      const manager = await this.requireHost().manager(account);
      if (manager.list().find(s => s.id === session)?.status === 'logged_out') await manager.reconnect(session);
    });
  }
  async contacts(account: string, session: unknown) {
    if (typeof session !== 'string') return [];
    const [rows] = await contactsSql.listBySession(db, [account, session]);
    return rows;
  }
  // Dipanggil saat sesi dihapus: data kanal dan kontaknya ikut hilang; sesi WhatsApp tidak punya baris di sini.
  async forgetSession(account: string, session: string) {
    await contactsSql.deleteBySession(db, [account, session]);
    await channelsSql.deleteBySession(db, [account, session]);
  }
  // SessionManager akun, untuk rute API integrasi yang mengirim DM.
  managerOf(account: string) {
    return this.requireHost().manager(account);
  }
  private requireHost() {
    if (!this.host) throw new Error('Host Instagram belum dipasang');
    return this.host;
  }
}
export const instagram = new Instagram();

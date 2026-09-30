// Tes Instagram Login resmi dengan Meta tiruan: state sekali pakai per akun, penukaran kode menjadi token yang
// disimpan terenkripsi, daftar tanpa token, perpanjangan, isolasi antar akun, dan callback deauthorize/data-deletion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { db } from '../../../src/libraries/db.js';
import { digest } from '../../../src/libraries/security.js';
import { createApp } from '../../../src/http/app.js';
import { createGateway } from '../../../src/http/gateway.js';
import { instagram } from '../../../src/components/instagram/index.js';
import { basicWallet } from '../../../src/components/billing/domain/plans.js';

const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8069';
process.env.PAYMENT_ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.INSTAGRAM_APP_ID = '111';
process.env.INSTAGRAM_APP_SECRET = 'secret-uji';
let refreshed = 0;
const sentMessages: { path: string; auth?: string; body: string }[] = [];
const subscriptions: string[] = [];
const meta = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://meta.test');
  if (req.method === 'POST' && url.pathname.endsWith('/subscribed_apps')) {
    subscriptions.push(
      url.pathname + '?' + url.searchParams.get('subscribed_fields') + ' ' + req.headers.authorization,
    );
    res.setHeader('Content-Type', 'application/json');
    return void res.end('{"success":true}');
  }
  if (req.method === 'POST' && url.pathname.endsWith('/messages')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    sentMessages.push({ path: url.pathname, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    return void res.end(JSON.stringify({ recipient_id: '1', message_id: 'mid.sent1' }));
  }
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/oauth/access_token')
    return void res.end(
      JSON.stringify({ access_token: 'short', user_id: '17841400000000009', permissions: ['a', 'b'] }),
    );
  if (url.pathname === '/access_token')
    return void res.end(JSON.stringify({ access_token: 'long-token', expires_in: 5184000 }));
  if (url.pathname === '/me')
    return void res.end(
      JSON.stringify({ user_id: '17841400000000009', username: 'kopisenja', account_type: 'BUSINESS' }),
    );
  if (url.pathname === '/refresh_access_token') {
    refreshed++;
    return void res.end(JSON.stringify({ access_token: 'long-token-2', expires_in: 5184000 }));
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise<void>(r => meta.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + (meta.address() as AddressInfo).port;
process.env.INSTAGRAM_AUTHORIZE_URL = base + '/oauth/authorize';
process.env.INSTAGRAM_TOKEN_URL = base + '/oauth/access_token';
process.env.INSTAGRAM_GRAPH_URL = base;
const gateway = createGateway(() => async () => ({ close() {}, async logout() {} }), '/tmp/ncwa-official-test');
const app = createApp(gateway);
const accounts = [randomUUID(), randomUUID()],
  tokens = [randomUUID(), randomUUID()];
const cookie = (i: number) => 'ncwa_session=' + tokens[i];
const signed = (payload: object) => {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload })).toString('base64url');
  return createHmac('sha256', 'secret-uji').update(body).digest('base64url') + '.' + body;
};
before(async () => {
  for (const [i, id] of accounts.entries()) {
    await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [
      id,
      id + '@test.invalid',
      'unused',
    ]);
    await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))', [
      digest(tokens[i]),
      id,
    ]);
    await basicWallet(id);
    await db.execute('UPDATE wallets SET session_limit=3 WHERE account_id=?', [id]);
  }
});
after(async () => {
  for (const id of accounts) await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  await db.execute('DELETE FROM instagram_official WHERE ig_user_id=?', ['17841400000000009']);
  meta.close();
  await gateway.stop();
  await db.end();
});
async function login(i: number, code = 'kode-1') {
  const start = await request(app).post('/api/instagram/official/start').set('Cookie', cookie(i)).set('Origin', origin);
  assert.equal(start.status, 200);
  const authorize = new URL(start.body.url);
  assert.equal(authorize.searchParams.get('client_id'), '111');
  assert.equal(authorize.searchParams.get('redirect_uri'), origin + '/auth/instagram/callback');
  assert.match(authorize.searchParams.get('scope')!, /manage_messages/);
  const state = authorize.searchParams.get('state')!;
  return { state, callback: () => request(app).get('/auth/instagram/callback').query({ code, state }) };
}
test('login menyimpan token terenkripsi dan daftar tidak membocorkannya', async () => {
  const { callback } = await login(0);
  const result = await callback();
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, '/dashboard/integrasi?instagram=connected');
  assert.deepEqual(subscriptions.at(-1), '/v23.0/17841400000000009/subscribed_apps?messages Bearer long-token');
  const listed = await request(app).get('/api/instagram/official').set('Cookie', cookie(0));
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].username, 'kopisenja');
  assert.equal(listed.body[0].status, 'active');
  assert.ok(listed.body[0].daysLeft >= 59);
  assert.ok(!JSON.stringify(listed.body).includes('long-token'));
  const [rows] = await db.execute<any[]>('SELECT token FROM instagram_official WHERE account_id=?', [accounts[0]]);
  assert.ok(!rows[0].token.includes('long-token'));
});
test('state hanya berlaku sekali dan state palsu ditolak', async () => {
  const { state, callback } = await login(0);
  assert.equal((await callback()).headers.location, '/dashboard/integrasi?instagram=connected');
  assert.equal((await callback()).headers.location, '/dashboard/integrasi?instagram=error');
  const forged = await request(app)
    .get('/auth/instagram/callback')
    .query({ code: 'x', state: state + '0' });
  assert.equal(forged.headers.location, '/dashboard/integrasi?instagram=error');
});
test('pembatalan di Instagram tidak menyimpan apa pun dan akun lain tidak bisa mengambil akun yang sama', async () => {
  const cancelled = await login(1);
  const denied = await request(app)
    .get('/auth/instagram/callback')
    .query({ error: 'access_denied', state: cancelled.state });
  assert.equal(denied.headers.location, '/dashboard/integrasi?instagram=cancelled');
  assert.equal((await request(app).get('/api/instagram/official').set('Cookie', cookie(1))).body.length, 0);
  const other = await login(1);
  assert.equal((await other.callback()).headers.location, '/dashboard/integrasi?instagram=in_use');
  assert.equal((await request(app).get('/api/instagram/official').set('Cookie', cookie(1))).body.length, 0);
});
test('perpanjang butuh akun pemilik dan memakai token baru', async () => {
  const before = refreshed;
  const foreign = await request(app)
    .post('/api/instagram/official/17841400000000009/refresh')
    .set('Cookie', cookie(1))
    .set('Origin', origin);
  assert.equal(foreign.status, 404);
  const own = await request(app)
    .post('/api/instagram/official/17841400000000009/refresh')
    .set('Cookie', cookie(0))
    .set('Origin', origin);
  assert.equal(own.status, 200);
  assert.equal(refreshed, before + 1);
});
test('login memasang akun Instagram sebagai sesi otomatis seperti WhatsApp', async () => {
  const sessions = await request(app).get('/sessions').set('Cookie', cookie(0));
  const session = sessions.body.find((s: { channel?: string }) => s.channel === 'instagram');
  assert.equal(session.id, 'ig-kopisenja');
  assert.equal(session.phone, '@kopisenja');
  assert.equal(session.status, 'connected');
  const listed = await request(app).get('/api/instagram/official').set('Cookie', cookie(0));
  assert.equal(listed.body[0].session, 'ig-kopisenja');
  // Login ulang tidak membuat sesi kedua.
  const again = await login(0);
  await again.callback();
  const after = await request(app).get('/sessions').set('Cookie', cookie(0));
  assert.equal(after.body.filter((s: { channel?: string }) => s.channel === 'instagram').length, 1);
});
test('DM masuk dan gema DM keluar dari webhook diteruskan ke sesi', async () => {
  const events: { account: string; session: string; event: any }[] = [];
  const emit = instagram.hub.emit.bind(instagram.hub);
  instagram.hub.emit = (account, session, event) => {
    events.push({ account, session, event });
    return emit(account, session, event);
  };
  const send = (payload: object) => {
    const body = JSON.stringify(payload);
    return request(app)
      .post('/webhook/instagram')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=' + createHmac('sha256', 'secret-uji').update(body).digest('hex'))
      .send(body);
  };
  const me = '17841400000000009',
    customer = '17841400000000555';
  const incoming = await send({
    object: 'instagram',
    entry: [
      {
        id: me,
        messaging: [
          {
            sender: { id: customer },
            recipient: { id: me },
            timestamp: Date.now(),
            message: { mid: 'mid.in1', text: 'Halo, ada kopi?' },
          },
        ],
      },
    ],
  });
  assert.equal(incoming.status, 200);
  const got = events.find(e => e.event.incoming);
  assert.equal(got?.account, accounts[0]);
  assert.equal(got?.session, 'ig-kopisenja');
  assert.equal(got?.event.incoming.from, customer);
  assert.equal(got?.event.incoming.text, 'Halo, ada kopi?');
  // Kiriman ulang dengan mid sama tidak diteruskan dua kali.
  await send({
    object: 'instagram',
    entry: [
      {
        id: me,
        messaging: [
          { sender: { id: customer }, recipient: { id: me }, message: { mid: 'mid.in1', text: 'Halo, ada kopi?' } },
        ],
      },
    ],
  });
  assert.equal(events.filter(e => e.event.incoming).length, 1);
  // Gema pesan keluar (is_echo) menjadi pesan keluar ke pelanggan yang sama.
  await send({
    object: 'instagram',
    entry: [
      {
        id: me,
        changes: [
          {
            field: 'messages',
            value: {
              sender: { id: me },
              recipient: { id: customer },
              message: { mid: 'mid.out1', text: 'Ada kak', is_echo: true },
            },
          },
        ],
      },
    ],
  });
  const echo = events.find(e => e.event.outgoing);
  assert.equal(echo?.event.outgoing.from, customer);
  // Akun yang tidak dikenal diabaikan tanpa error.
  assert.equal((await send({ object: 'instagram', entry: [{ id: '999', messaging: [] }] })).status, 200);
  instagram.hub.emit = emit;
});
test('sesi Instagram resmi bisa diputus dari carousel lalu disambungkan lagi tanpa Zernio', async () => {
  const off = await request(app).post('/sessions/ig-kopisenja/logout').set('Cookie', cookie(0)).set('Origin', origin);
  assert.equal(off.status, 200);
  const down = await request(app).get('/sessions').set('Cookie', cookie(0));
  assert.equal(down.body.find((s: { id: string }) => s.id === 'ig-kopisenja').status, 'logged_out');
  const on = await request(app)
    .post('/api/instagram/sessions/ig-kopisenja/reconnect')
    .set('Cookie', cookie(0))
    .set('Origin', origin);
  assert.equal(on.status, 200);
  const up = await request(app).get('/sessions').set('Cookie', cookie(0));
  assert.equal(up.body.find((s: { id: string }) => s.id === 'ig-kopisenja').status, 'connected');
});
test('kirim DM lewat Graph API resmi memakai token di header Authorization', async () => {
  const { sendOfficialText } = await import('../../../src/components/instagram/domain/official-messaging.js');
  const mid = await sendOfficialText('17841400000000009', 'long-token', '17841400000000555', 'Ada kak');
  assert.equal(mid, 'mid.sent1');
  const sent = sentMessages.at(-1)!;
  assert.equal(sent.path, '/v23.0/17841400000000009/messages');
  assert.equal(sent.auth, 'Bearer long-token');
  assert.deepEqual(JSON.parse(sent.body), { recipient: { id: '17841400000000555' }, message: { text: 'Ada kak' } });
});
test('konektor resmi mengirim gambar melalui URL sementara tanpa login dan mencatat ID gema', async () => {
  const { channelConnector, ChannelHub, messageIdOf } =
    await import('../../../src/components/instagram/domain/channel-connection.js');
  const { outboundMedia } = await import('../../../src/components/instagram/data-access/outbound-media-store.js');
  const root = await mkdtemp(join(tmpdir(), 'ig-send-test-'));
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = origin;
  const registered: string[] = [];
  const connect = channelConnector(
    accounts[0],
    async () => {
      throw new Error('Bukan WhatsApp');
    },
    new ChannelHub(),
    async (_session, id) => {
      registered.push(id);
    },
  );
  const connection = await connect('ig-kopisenja', () => {});
  assert.equal(connection.mediaCaption, 'separate');
  let publishedPath: string | undefined;
  let convertedPath: string | undefined;
  try {
    const path = join(root, 'image.png');
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    await writeFile(path, png);
    const before = sentMessages.length;
    await assert.rejects(
      connection.send!('17841400000000555@s.whatsapp.net', { type: 'image', url: path, caption: 'Keterangan' }),
      { code: 'unsupported_caption' },
    );
    await assert.rejects(connection.send!('17841400000000555@s.whatsapp.net', { type: 'document', url: path }), {
      code: 'unsupported_media',
    });
    assert.equal(sentMessages.length, before);
    const mid = await connection.send!('17841400000000555@s.whatsapp.net', { type: 'image', url: path });
    assert.equal(mid, messageIdOf('mid.sent1'));
    assert.deepEqual(registered, [mid]);
    const sent = sentMessages.at(-1)!;
    assert.equal(sent.auth, 'Bearer long-token');
    const payload = JSON.parse(sent.body);
    assert.equal(payload.recipient.id, '17841400000000555');
    assert.equal(payload.message.attachment.type, 'image');
    const url = new URL(payload.message.attachment.payload.url);
    assert.equal(url.origin, new URL(origin).origin);
    publishedPath = (await outboundMedia.get(url.pathname.split('/').at(-1)!)).path;
    await rm(path);
    const downloaded = await request(app).get(url.pathname);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers['content-type'], /image\/png/);
    assert.equal(downloaded.headers['cache-control'], 'private, no-store');
    assert.deepEqual(downloaded.body, png);
    assert.equal((await request(app).get('/instagram/media/1800000000000-' + '0'.repeat(64))).status, 404);
    const webp = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff000080' } })
      .webp()
      .toBuffer();
    await writeFile(path, webp);
    await connection.send!('17841400000000555@s.whatsapp.net', { type: 'image', url: path });
    const convertedUrl = new URL(JSON.parse(sentMessages.at(-1)!.body).message.attachment.payload.url);
    convertedPath = (await outboundMedia.get(convertedUrl.pathname.split('/').at(-1)!)).path;
    const converted = await request(app).get(convertedUrl.pathname);
    assert.match(converted.headers['content-type'], /image\/jpeg/);
    assert.equal((await sharp(converted.body).metadata()).format, 'jpeg');
  } finally {
    connection.close();
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
    if (publishedPath) await rm(publishedPath, { force: true });
    if (convertedPath) await rm(convertedPath, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
test('callback deauthorize dan data-deletion memverifikasi tanda tangan Meta', async () => {
  const bad = await request(app).post('/instagram/deauthorize').type('form').send({ signed_request: 'x.y' });
  assert.equal(bad.status, 403);
  const ok = await request(app)
    .post('/instagram/deauthorize')
    .type('form')
    .send({ signed_request: signed({ user_id: '17841400000000009' }) });
  assert.equal(ok.status, 200);
  const listed = await request(app).get('/api/instagram/official').set('Cookie', cookie(0));
  assert.equal(listed.body[0].status, 'revoked');
  const revoked = await request(app).get('/sessions').set('Cookie', cookie(0));
  assert.equal(revoked.body.find((s: { id: string }) => s.id === 'ig-kopisenja').status, 'logged_out');
  const refreshAfter = await request(app)
    .post('/api/instagram/official/17841400000000009/refresh')
    .set('Cookie', cookie(0))
    .set('Origin', origin);
  assert.equal(refreshAfter.status, 409);
  const deletion = await request(app)
    .post('/instagram/data-deletion')
    .type('form')
    .send({ signed_request: signed({ user_id: '17841400000000009' }) });
  assert.equal(deletion.status, 200);
  assert.match(deletion.body.confirmation_code, /^[a-f0-9]{16}$/);
  assert.equal((await request(app).get('/api/instagram/official').set('Cookie', cookie(0))).body.length, 0);
});
test('kebijakan privasi bisa dibuka publik tanpa login', async () => {
  const response = await request(app).get('/privacy');
  assert.equal(response.status, 200);
  assert.match(response.text, /Kebijakan Privasi/);
  assert.match(response.text, /data-deletion|Putuskan/);
});
test('ketentuan layanan bisa dibuka publik tanpa login', async () => {
  const response = await request(app).get('/terms');
  assert.equal(response.status, 200);
  assert.match(response.text, /Ketentuan Layanan/);
});
test('tanpa konfigurasi Instagram Login, tombol mengembalikan 503', async () => {
  const id = process.env.INSTAGRAM_APP_ID;
  delete process.env.INSTAGRAM_APP_ID;
  const start = await request(app).post('/api/instagram/official/start').set('Cookie', cookie(0)).set('Origin', origin);
  process.env.INSTAGRAM_APP_ID = id;
  assert.equal(start.status, 503);
});
test('webhook Instagram: verify token dan tanda tangan diperiksa', async () => {
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'token-webhook-uji';
  const ok = await request(app)
    .get('/webhook/instagram')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-webhook-uji', 'hub.challenge': '12345' });
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '12345');
  const wrong = await request(app)
    .get('/webhook/instagram')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'salah', 'hub.challenge': '12345' });
  assert.equal(wrong.status, 403);
  const body = JSON.stringify({ object: 'instagram', entry: [{ id: '1' }] });
  const signature = 'sha256=' + createHmac('sha256', 'secret-uji').update(body).digest('hex');
  const accepted = await request(app)
    .post('/webhook/instagram')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature)
    .send(body);
  assert.equal(accepted.status, 200);
  const forged = await request(app)
    .post('/webhook/instagram')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
    .send(body);
  assert.equal(forged.status, 403);
});

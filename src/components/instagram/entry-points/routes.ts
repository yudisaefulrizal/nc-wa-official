// Rute HTTP Instagram DM: pengelolaan akun Zernio dan alur hubungkan untuk dashboard (login cookie, akun dari
// res.locals.account), serta webhook dari Zernio yang publik.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Instagram } from '../domain/instagram.js';

// Didaftarkan sebelum parser JSON global: tanda tangan webhook dihitung dari body mentah.
export function instagramPublicRoutes(app: express.Express, { instagram }: { instagram: Instagram }) {
  app.post(
    '/zernio/webhook/:id',
    rateLimit({ windowMs: 60000, limit: 600 }),
    express.raw({ type: '*/*', limit: '256kb' }),
    async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await instagram.receiveWebhook(req.params.id as string, raw, req.get('X-Zernio-Signature'));
      res.json({ ok: true });
    },
  );
  // Webhook Instagram resmi: GET untuk verifikasi callback di Meta, POST untuk event (body mentah untuk tanda tangan).
  app.get('/webhook/instagram', rateLimit({ windowMs: 60000, limit: 60 }), (req, res) => {
    res.type('text/plain').send(instagram.verifyOfficialWebhook(req.query));
  });
  app.post(
    '/webhook/instagram',
    rateLimit({ windowMs: 60000, limit: 600 }),
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
      await instagram.receiveOfficialWebhook(
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        req.get('X-Hub-Signature-256'),
      );
      res.sendStatus(200);
    },
  );
  // Instagram Login resmi. Callback berasal dari redirect browser Meta, jadi pemilik akun dibaca dari state.
  app.get('/auth/instagram/callback', rateLimit({ windowMs: 60000, limit: 60 }), async (req, res) => {
    let result = 'error';
    try {
      result = await instagram.finishOfficialLogin(req.query);
    } catch {
      console.error('Instagram Login gagal diselesaikan.');
    }
    res.redirect(302, '/dashboard/integrasi?instagram=' + result);
  });
  const meta = [rateLimit({ windowMs: 60000, limit: 60 }), express.urlencoded({ extended: false, limit: '16kb' })];
  app.post('/instagram/deauthorize', ...meta, async (req, res) => {
    res.sendStatus((await instagram.deauthorizeOfficial(req.body?.signed_request)) ? 200 : 403);
  });
  app.post('/instagram/data-deletion', ...meta, async (req, res) => {
    const code = await instagram.deleteOfficialData(req.body?.signed_request);
    if (!code) {
      res.sendStatus(403);
      return;
    }
    res.json({ url: (process.env.APP_ORIGIN ?? '') + '/data-deletion-status/' + code, confirmation_code: code });
  });
  app.get('/data-deletion-status/:code', (req, res) => {
    res
      .type('text/plain')
      .send('Permintaan penghapusan data ' + String(req.params.code).replace(/[^a-f0-9]/g, '') + ' sudah diproses.');
  });
}
export function instagramRoutes(app: express.Express, { instagram }: { instagram: Instagram }) {
  app.get('/api/instagram/zernio', async (_req, res) =>
    res.json(await instagram.zernioAccounts(res.locals.account.id)),
  );
  app.post('/api/instagram/zernio', async (req, res) =>
    res.json(await instagram.addZernioAccount(res.locals.account.id, req.body)),
  );
  app.post('/api/instagram/zernio/:id/check', async (req, res) =>
    res.json(await instagram.checkZernioAccount(res.locals.account.id, req.params.id)),
  );
  app.put('/api/instagram/zernio/:id/key', async (req, res) =>
    res.json(await instagram.replaceZernioKey(res.locals.account.id, req.params.id, req.body)),
  );
  app.delete('/api/instagram/zernio/:id', async (req, res) =>
    res.json(await instagram.deleteZernioAccount(res.locals.account.id, req.params.id)),
  );
  app.get('/api/instagram/zernio/:id/instagram', async (req, res) =>
    res.json(await instagram.instagramAccounts(res.locals.account.id, req.params.id)),
  );
  app.get('/api/instagram/official', async (_req, res) =>
    res.json(await instagram.officialAccounts(res.locals.account.id)),
  );
  app.post('/api/instagram/official/start', async (_req, res) =>
    res.json(await instagram.startOfficialLogin(res.locals.account.id)),
  );
  app.post('/api/instagram/official/:id/session', async (req, res) =>
    res.json(await instagram.attachOfficialSession(res.locals.account.id, req.params.id)),
  );
  app.post('/api/instagram/official/:id/refresh', async (req, res) =>
    res.json(await instagram.refreshOfficial(res.locals.account.id, req.params.id)),
  );
  app.delete('/api/instagram/official/:id', async (req, res) =>
    res.json(await instagram.disconnectOfficial(res.locals.account.id, req.params.id)),
  );
  app.post('/api/instagram/connect', async (req, res) =>
    res.json(await instagram.connect(res.locals.account.id, req.body)),
  );
  app.post('/api/instagram/sessions/:id/reconnect', async (req, res) =>
    res.json(await instagram.reconnect(res.locals.account.id, req.params.id)),
  );
  app.get('/api/instagram/contacts', async (req, res) =>
    res.json(await instagram.contacts(res.locals.account.id, req.query.session)),
  );
}

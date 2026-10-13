// Rute TikTok: callback Login Kit dan media sementara untuk TikTok bersifat publik; API dashboard memakai sesi akun
// NC-WA; API v1 untuk aplikasi lain (NC Post) memakai API key integrasi yang sama dengan Instagram dan YouTube.
import express from 'express';
import type { SessionManager } from '../../whatsapp/index.js';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../../../libraries/errors.js';
import { digest } from '../../../libraries/security.js';
import { object } from '../../../libraries/validation.js';
import { authenticateIntegrationKey } from '../../instagram/index.js';
import { startLogin, finishLogin } from '../domain/login.js';
import { listConnections, refreshConnection, disconnectConnection } from '../domain/connections.js';
import { creatorInfo, createTikTokPost, tiktokPost, tiktokMedia } from '../domain/posts.js';

const cookieName = 'ncwa_tiktok_oauth';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: (process.env.APP_ORIGIN ?? '').startsWith('https:'),
  path: '/auth/tiktok/callback',
});

export function tiktokPublicRoutes(app: express.Express, host: { manager(account: string): Promise<SessionManager> }) {
  // TikTok mengambil foto dan video Direct Post dari sini tanpa cookie; satu posting bisa berisi hingga 35 foto.
  app.get('/tiktok/media/:token', rateLimit({ windowMs: 60000, limit: 600 }), async (req, res) => {
    const media = await tiktokMedia(String(req.params.token));
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(media.mimetype).sendFile(media.path);
  });
  app.get('/auth/tiktok/callback', rateLimit({ windowMs: 60000, limit: 120 }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const browser =
      req.headers.cookie
        ?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1) ?? '';
    let result = 'error';
    try {
      result = await finishLogin(req.query, browser, host.manager);
    } catch {
      // Tidak mencatat error provider, kode OAuth, ataupun token.
      console.error('TikTok Login gagal diselesaikan.');
    }
    res.clearCookie(cookieName, cookieOptions());
    res.redirect(302, '/dashboard/integrasi?tiktok=' + result);
  });
}
export function tiktokRoutes(app: express.Express) {
  app.get('/api/tiktok/connections', async (_req, res) => res.json(await listConnections(res.locals.account.id)));
  app.post('/api/tiktok/start', async (_req, res) => {
    const { url, browser } = await startLogin(res.locals.account.id);
    res.cookie(cookieName, browser, { ...cookieOptions(), maxAge: 10 * 60 * 1000 }).json({ url });
  });
  app.post('/api/tiktok/connections/:id/refresh', async (req, res) =>
    res.json(await refreshConnection(res.locals.account.id, String(req.params.id))),
  );
  app.delete('/api/tiktok/connections/:id', async (req, res) =>
    res.json(await disconnectConnection(res.locals.account.id, String(req.params.id))),
  );
  app.get('/api/tiktok/connections/:id/creator', async (req, res) =>
    res.json(await creatorInfo(res.locals.account.id, String(req.params.id))),
  );
  // Dialog Post TikTok di Pustaka konten hanya memposting foto hasil Konten.
  app.post('/api/tiktok/posts', async (req, res) => {
    if (object(req.body).mediaType !== undefined && req.body.mediaType !== 'PHOTO')
      throw new ApiError(400, 'invalid_request', 'Dashboard Konten hanya memposting foto.');
    const post = await createTikTokPost(res.locals.account.id, req.body);
    res.status(post.status === 'published' ? 200 : 202).json(post);
  });
  // Test Post di Integrasi: video dari URL publik lewat alur yang sama dengan API v1, untuk pengujian pemilik akun.
  app.post('/api/tiktok/test-post', async (req, res) => {
    const input = object(req.body);
    if (input.consent !== true)
      throw new ApiError(400, 'invalid_request', 'Konfirmasi posting sungguhan terlebih dahulu.');
    if (input.mediaType !== 'VIDEO') throw new ApiError(400, 'invalid_request', 'Test Post TikTok untuk video.');
    const { consent: _consent, ...body } = input;
    const post = await createTikTokPost(res.locals.account.id, body);
    res.status(post.status === 'published' ? 200 : 202).json(post);
  });
  app.get('/api/tiktok/posts/:id', async (req, res) =>
    res.json(await tiktokPost(res.locals.account.id, String(req.params.id))),
  );
}
// Dipasang sebelum pemeriksaan Origin dashboard di /api: aplikasi lain tidak mengirim header Origin. Pedoman TikTok
// (privasi tanpa nilai bawaan, persetujuan musik, dan seterusnya) wajib ditampilkan oleh aplikasi pemanggil.
export function tiktokApiRoutes(app: express.Express) {
  const router = express.Router();
  const bearer = (req: express.Request) => /^Bearer (\S+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';
  // Batas per key, bukan per IP, supaya satu aplikasi yang boros tidak menghabiskan jatah aplikasi lain.
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 120,
      keyGenerator: req => digest(bearer(req) || 'anonymous'),
      validate: { keyGeneratorIpFallback: false },
    }),
  );
  router.use(async (req, res, next) => {
    const key = await authenticateIntegrationKey(bearer(req));
    if (!key) throw new ApiError(401, 'unauthorized', 'API key tidak valid');
    res.locals.tiktokKey = key;
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  const need =
    (scope: string): express.RequestHandler =>
    (_req, res, next) => {
      if (!(res.locals.tiktokKey.scopes as string[]).includes(scope))
        throw new ApiError(403, 'insufficient_scope', 'Key tidak punya izin ' + scope);
      next();
    };
  const account = (res: express.Response) => res.locals.tiktokKey.account as string;
  router.get('/accounts', need('tiktok:accounts:read'), async (_req, res) =>
    res.json(await listConnections(account(res))),
  );
  router.get('/accounts/:id/creator', need('tiktok:posts:publish'), async (req, res) =>
    res.json(await creatorInfo(account(res), String(req.params.id))),
  );
  // API v1 menerima video dari URL publik; foto Pustaka konten (fileIds) hanya untuk dashboard.
  router.post('/posts', need('tiktok:posts:publish'), async (req, res) => {
    if (object(req.body).mediaType !== 'VIDEO')
      throw new ApiError(400, 'invalid_request', 'API v1 TikTok saat ini menerima mediaType VIDEO dengan videoUrl.');
    const post = await createTikTokPost(account(res), req.body);
    res.status(post.status === 'published' ? 200 : 202).json(post);
  });
  // Dipanggil berulang oleh klien sampai published, failed, atau unknown.
  router.get('/posts/:requestId', need('tiktok:posts:publish'), async (req, res) =>
    res.json(await tiktokPost(account(res), req.params.requestId)),
  );
  router.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Endpoint tidak ditemukan')));
  app.use('/api/v1/tiktok', router);
}

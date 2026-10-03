// Rute API Instagram untuk aplikasi lain. instagramKeyRoutes: pembuatan dan pencabutan key dari dashboard (login
// cookie). instagramApiRoutes: /api/v1/instagram dengan header "Authorization: Bearer ncig_…"; tiap rute meminta
// scope key dan memakai akun pemilik key, bukan ID akun dari klien.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../../../libraries/errors.js';
import { digest } from '../../../libraries/security.js';
import { object, requiredString } from '../../../libraries/validation.js';
import type { Instagram } from '../domain/instagram.js';
import {
  authenticateIntegrationKey,
  createIntegrationKey,
  keyScopes,
  listIntegrationKeys,
  revokeIntegrationKey,
  type KeyScope,
} from '../domain/integration-keys.js';
import {
  integrationAccounts,
  integrationConversations,
  integrationMessages,
  integrationSend,
} from '../domain/integration-api.js';
import {
  hideOfficialComment,
  listOfficialComments,
  listOfficialMedia,
  replyOfficialComment,
} from '../domain/official-comments.js';
import { advanceOfficialPost, createOfficialPost } from '../domain/official-posts.js';

// Dipasang sesudah sessionAuth: akun dari sesi login dashboard di res.locals.account.
export function instagramKeyRoutes(app: express.Express) {
  app.get('/api/instagram/keys', async (_req, res) =>
    res.json({ keys: await listIntegrationKeys(res.locals.account.id), scopes: keyScopes }),
  );
  app.post('/api/instagram/keys', async (req, res) =>
    res.status(201).json(await createIntegrationKey(res.locals.account.id, req.body)),
  );
  app.delete('/api/instagram/keys/:id', async (req, res) =>
    res.json(await revokeIntegrationKey(res.locals.account.id, req.params.id as string)),
  );
}
const need =
  (scope: KeyScope): express.RequestHandler =>
  (_req, res, next) => {
    if (!(res.locals.key.scopes as KeyScope[]).includes(scope))
      throw new ApiError(403, 'insufficient_scope', 'Key tidak punya izin ' + scope);
    next();
  };
const bearer = (req: express.Request) => /^Bearer (\S+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';

// Dipasang sebelum pemeriksaan origin dashboard di /api: aplikasi lain tidak mengirim header Origin.
export function instagramApiRoutes(app: express.Express, { instagram }: { instagram: Instagram }) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  // Batas per key (bukan per IP) supaya satu aplikasi yang boros tidak menghabiskan jatah aplikasi lain.
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
    res.locals.key = key;
    next();
  });
  const account = (res: express.Response) => (res.locals.key as { account: string }).account;
  router.get('/accounts', need('accounts:read'), async (_req, res) =>
    res.json(await integrationAccounts(account(res))),
  );
  router.get('/accounts/:ig/conversations', need('messages:read'), async (req, res) =>
    res.json(await integrationConversations(account(res), req.params.ig as string)),
  );
  router.get('/accounts/:ig/conversations/:customer/messages', need('messages:read'), async (req, res) =>
    res.json(
      await integrationMessages(account(res), req.params.ig as string, req.params.customer as string, req.query.before),
    ),
  );
  router.post('/messages', need('messages:send'), async (req, res) =>
    res.json(
      await integrationSend(
        account(res),
        await instagram.managerOf(account(res)),
        req.body,
        req.get('Idempotency-Key'),
      ),
    ),
  );
  router.get('/accounts/:ig/media', need('comments:read'), async (req, res) =>
    res.json(await listOfficialMedia(account(res), req.params.ig as string, req.query)),
  );
  router.get('/accounts/:ig/media/:media/comments', need('comments:read'), async (req, res) =>
    res.json(await listOfficialComments(account(res), req.params.ig as string, req.params.media, req.query)),
  );
  router.post('/accounts/:ig/comments/:comment/replies', need('comments:write'), async (req, res) =>
    res
      .status(201)
      .json(await replyOfficialComment(account(res), req.params.ig as string, req.params.comment, req.body)),
  );
  router.post('/accounts/:ig/comments/:comment/hide', need('comments:write'), async (req, res) =>
    res.json(
      await hideOfficialComment(
        account(res),
        req.params.ig as string,
        req.params.comment,
        object(req.body).hide !== false,
      ),
    ),
  );
  router.post('/posts', need('posts:publish'), async (req, res) => {
    const input = object(req.body);
    requiredString(input.igUserId, 'igUserId', 64);
    // Posting lewat API selalu dari alamat gambar; fileId pustaka konten hanya untuk dashboard.
    const post = await createOfficialPost(account(res), { ...input, fileId: undefined });
    res.status(post.status === 'published' ? 200 : 202).json(post);
  });
  // Dipanggil berulang oleh klien sampai status published; setiap panggilan melanjutkan posting yang sudah siap.
  router.get('/posts/:requestId', need('posts:publish'), async (req, res) =>
    res.json(await advanceOfficialPost(account(res), req.params.requestId)),
  );
  router.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Endpoint tidak ditemukan')));
  app.use('/api/v1/instagram', router);
}

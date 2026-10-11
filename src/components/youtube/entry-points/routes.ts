// Rute YouTube: callback publik, dashboard dengan sesi, dan API integrasi dengan key serta scope terpisah.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../../../libraries/errors.js';
import { authenticateIntegrationKey } from '../../instagram/index.js';
import { startLogin, finishLogin, listConnections, refreshConnection, disconnect } from '../domain/connections.js';
import { createPost, listPosts, checkPost } from '../domain/posts.js';
const cookie = 'ncwa_youtube_oauth';
const options = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: (process.env.APP_ORIGIN ?? '').startsWith('https:'),
  path: '/auth/youtube/callback',
});
export function youtubePublicRoutes(app: express.Express) {
  app.get('/auth/youtube/callback', rateLimit({ windowMs: 60000, limit: 60 }), async (req, res) => {
    const browser =
      req.headers.cookie
        ?.split(';')
        .map(v => v.trim())
        .find(v => v.startsWith(cookie + '='))
        ?.slice(cookie.length + 1) ?? '';
    let result = 'error';
    try {
      result = await finishLogin(req.query, browser);
    } catch {
      console.error('YouTube Login gagal diselesaikan.');
    }
    res
      .clearCookie(cookie, options())
      .set('Cache-Control', 'no-store')
      .redirect('/dashboard/integrasi?youtube=' + result);
  });
}
export function youtubeRoutes(app: express.Express) {
  app.get('/api/youtube/connections', async (_req, res) => res.json(await listConnections(res.locals.account.id)));
  app.post('/api/youtube/start', async (_req, res) => {
    const { url, browser } = await startLogin(res.locals.account.id);
    res.cookie(cookie, browser, { ...options(), maxAge: 600000 }).json({ url });
  });
  app.post('/api/youtube/connections/:id/refresh', async (req, res) =>
    res.json(await refreshConnection(res.locals.account.id, String(req.params.id))),
  );
  app.delete('/api/youtube/connections/:id', async (req, res) =>
    res.json(await disconnect(res.locals.account.id, String(req.params.id))),
  );
  app.get('/api/youtube/posts', async (_req, res) => res.json(await listPosts(res.locals.account.id)));
  app.post('/api/youtube/posts', async (req, res) =>
    res.status(202).json(await createPost(res.locals.account.id, req.body)),
  );
  app.get('/api/youtube/posts/:id', async (req, res) =>
    res.json(await checkPost(res.locals.account.id, String(req.params.id))),
  );
}
export function youtubeApiRoutes(app: express.Express) {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60000, limit: 120 }));
  router.get('/openapi.json', (_req, res) =>
    res.json({
      openapi: '3.0.3',
      info: { title: 'NC-WA YouTube API', version: '1.0.0' },
      servers: [{ url: (process.env.APP_ORIGIN ?? '') + '/api/v1/youtube' }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
      paths: {
        '/accounts': {
          get: {
            summary: 'Daftar channel; scope youtube:accounts:read',
            responses: { '200': { description: 'Array channel: id, name, avatar, status' } },
          },
        },
        '/posts': {
          post: {
            summary: 'Upload video; scope youtube:posts:publish',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'channelId',
                      'requestId',
                      'videoUrl',
                      'title',
                      'description',
                      'privacyStatus',
                      'madeForKids',
                      'containsSyntheticMedia',
                    ],
                    properties: {
                      channelId: { type: 'string' },
                      requestId: { type: 'string' },
                      videoUrl: { type: 'string', format: 'uri' },
                      title: { type: 'string', maxLength: 100 },
                      description: { type: 'string', maxLength: 5000 },
                      privacyStatus: { type: 'string', enum: ['public', 'private', 'unlisted'] },
                      madeForKids: { type: 'boolean' },
                      containsSyntheticMedia: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            responses: { '202': { description: 'queued/uploading/processing/published/failed/unknown' } },
          },
        },
        '/posts/{requestId}': {
          get: {
            summary: 'Periksa status; scope youtube:posts:publish',
            parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Status publikasi dan alasan gagal' } },
          },
        },
      },
    }),
  );
  router.use(async (req, res, next) => {
    const raw = /^Bearer (\S+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';
    const key = await authenticateIntegrationKey(raw);
    if (!key) throw new ApiError(401, 'unauthorized', 'API key tidak valid');
    res.locals.youtubeKey = key;
    res.set('Cache-Control', 'no-store');
    next();
  });
  const need =
    (scope: string): express.RequestHandler =>
    (_req, res, next) => {
      if (!res.locals.youtubeKey.scopes.includes(scope))
        throw new ApiError(403, 'insufficient_scope', 'Key tidak punya izin ' + scope);
      next();
    };
  router.get('/accounts', need('youtube:accounts:read'), async (_req, res) =>
    res.json(await listConnections(res.locals.youtubeKey.account)),
  );
  router.post('/posts', need('youtube:posts:publish'), async (req, res) =>
    res.status(202).json(await createPost(res.locals.youtubeKey.account, req.body)),
  );
  router.get('/posts/:id', need('youtube:posts:publish'), async (req, res) =>
    res.json(await checkPost(res.locals.youtubeKey.account, String(req.params.id))),
  );
  router.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Endpoint tidak ditemukan')));
  app.use('/api/v1/youtube', router);
}

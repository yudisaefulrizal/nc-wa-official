// Rute Login Kit TikTok: callback publik memakai state dan cookie khusus; API memakai sesi akun NC-WA.
import type express from 'express';
import type { SessionManager } from '../../whatsapp/index.js';
import { rateLimit } from 'express-rate-limit';
import { startLogin, finishLogin } from '../domain/login.js';
import { listConnections, refreshConnection, disconnectConnection } from '../domain/connections.js';

const cookieName = 'ncwa_tiktok_oauth';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: (process.env.APP_ORIGIN ?? '').startsWith('https:'),
  path: '/auth/tiktok/callback',
});

export function tiktokPublicRoutes(app: express.Express, host: { manager(account: string): Promise<SessionManager> }) {
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
}

// Komponen Instagram DM lewat Zernio: akun Zernio milik klien, sesi Instagram di SessionManager, webhook, dan
// rute HTTP-nya. Komponen lain dan src/http hanya memakai nama yang diekspor di sini.
export { migrateInstagram, migrateInstagramOfficial } from './data-access/schema.js';
export { instagram, Instagram } from './domain/instagram.js';
export { instagramPublicRoutes, instagramRoutes } from './entry-points/routes.js';
export { instagramApiRoutes, instagramKeyRoutes } from './entry-points/integration-routes.js';

export { authenticateIntegrationKey } from './domain/integration-keys.js';
// Pemeriksa video posting (MP4 H.264/AAC, 3–180 detik, maks 64 MiB) juga dipakai Direct Post video TikTok.
export { validatePostVideo, maxVideoBytes } from './domain/official-video.js';

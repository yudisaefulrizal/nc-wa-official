// API Konten untuk akun login dan builder generator untuk owner; identitas akun berasal dari server.
import express from 'express';
import { ApiError } from '../../../libraries/errors.js';
import { ai } from '../domain/service.js';
import { imageConnection, testImageProvider } from '../domain/image-provider.js';
import { contentLimits, storeContent, contentFile, listReferences } from '../domain/content-files.js';
import { imageBrand, saveImageBrand } from '../domain/image-brand.js';
import { imageJobs, imageJob, enqueueImage } from '../domain/image-jobs.js';
import * as profiles from '../domain/image-profiles.js';
export function imageAccountRoutes(app: express.Express) {
  const base = '/api/content';
  app.get(base + '/profiles', async (_req, res) => res.json(await profiles.listImageProfiles(true)));
  app.get(base + '/capabilities', async (_req, res) => {
    try {
      const connection = await imageConnection(ai);
      res.json({
        configured: true,
        creditsPerImage: connection.options.creditsPerImage,
        maxImages: connection.options.protocol === 'chat' ? 1 : connection.options.maxImages,
        references: connection.options.references,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'image_not_configured')
        res.json({ configured: false, creditsPerImage: 0, maxImages: 1, references: false });
      else throw e;
    }
  });
  app.get(base + '/brand', async (_req, res) => res.json(await imageBrand(res.locals.account.id)));
  app.put(base + '/brand', async (req, res) => res.json(await saveImageBrand(res.locals.account.id, req.body)));
  app.get(base + '/references', async (_req, res) => res.json(await listReferences(res.locals.account.id)));
  app.post(
    base + '/references',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: contentLimits.uploadBytes }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'invalid_image', 'Unggah file PNG, JPG, atau WebP.');
      res.status(201).json(await storeContent(res.locals.account.id, req.body, 'reference'));
    },
  );
  app.get(base + '/files/:id', async (req, res) => {
    const file = await contentFile(res.locals.account.id, String(req.params.id));
    res.type('png').set('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') res.set('Content-Disposition', 'attachment; filename="ncwa-' + file.id + '.png"');
    res.sendFile(file.path);
  });
  app.get(base + '/jobs', async (req, res) => res.json(await imageJobs(res.locals.account.id, req.query.page ?? 1)));
  app.get(base + '/jobs/:id', async (req, res) =>
    res.json(await imageJob(res.locals.account.id, String(req.params.id))),
  );
  app.post(base + '/jobs', async (req, res) =>
    res.status(202).json(await enqueueImage(res.locals.account.id, req.body)),
  );
}
export function imageAdminRoutes(app: express.Express) {
  app.post('/api/admin/ai/image-test', async (req, res) => {
    const image = await testImageProvider(String(req.body?.id ?? ''));
    res.json(await storeContent(res.locals.account.id, image, 'result'));
  });
  const base = '/api/admin/ai/image-profiles';
  app.get(base, async (_req, res) => res.json(await profiles.listImageProfiles()));
  app.post(base, async (req, res) =>
    res.status(201).json(await profiles.createImageProfile(res.locals.account.id, req.body)),
  );
  app.get(base + '/:id', async (req, res) => res.json(await profiles.imageProfileState(String(req.params.id))));
  app.put(base + '/:id', async (req, res) =>
    res.json(await profiles.saveImageProfile(res.locals.account.id, String(req.params.id), req.body)),
  );
  app.post(base + '/:id/publish', async (req, res) =>
    res.json(await profiles.saveImageProfile(res.locals.account.id, String(req.params.id), req.body, true)),
  );
  app.put(base + '/:id/enabled', async (req, res) =>
    res.json(await profiles.enableImageProfile(res.locals.account.id, String(req.params.id), req.body?.enabled)),
  );
  app.delete(base + '/:id', async (req, res) =>
    res.json(await profiles.deleteImageProfile(res.locals.account.id, String(req.params.id), req.body?.revision)),
  );
  app.get(base + '/:id/versions', async (req, res) => res.json(await profiles.imageVersions(String(req.params.id))));
  app.get(base + '/:id/versions/:revision', async (req, res) =>
    res.json(await profiles.imageVersion(String(req.params.id), Number(req.params.revision))),
  );
  app.get(base + '/:id/export', async (req, res) =>
    res
      .set('Content-Disposition', 'attachment; filename="generator.json"')
      .json((await profiles.imageProfileState(String(req.params.id))).draft),
  );
  app.post(base + '/:id/run', async (req, res) =>
    res.status(202).json(await enqueueImage(res.locals.account.id, req.body, { draftId: String(req.params.id) })),
  );
}

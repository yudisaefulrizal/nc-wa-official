// Pengujian tautan gambar sementara: kedaluwarsa, format, batas ukuran, dan file sumber tetap aman.
import sharp from 'sharp';
import { prepareOfficialImage } from '../../../src/components/instagram/domain/official-image.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutboundMediaStore } from '../../../src/components/instagram/data-access/outbound-media-store.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
test('gambar disalin, token acak, akses kedaluwarsa dan traversal ditolak', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ig-media-test-'));
  let now = 1800000000000;
  const store = new OutboundMediaStore(join(root, 'public'), () => now, 1000);
  try {
    const source = join(root, 'source.png');
    await writeFile(source, png);
    const first = await store.publish(source);
    const second = await store.publish(source);
    assert.notEqual(first, second);
    assert.equal((await store.get(first)).mimetype, 'image/png');
    await rm(source);
    assert.deepEqual(await readFile((await store.get(first)).path), png);
    await assert.rejects(store.get('../source.png'), { code: 'media_not_found' });
    await assert.rejects(store.get(first.slice(0, -1) + 'z'), { code: 'media_not_found' });
    now += 1000;
    await assert.rejects(store.get(first), { code: 'media_not_found' });
    await store.prune();
    assert.deepEqual(await readdir(join(root, 'public')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('format palsu, kosong, dan gambar melampaui batas ditolak tanpa salinan publik', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ig-media-test-'));
  const store = new OutboundMediaStore(join(root, 'public'));
  try {
    const source = join(root, 'image.jpg');
    await writeFile(source, '<html>not image</html>');
    await assert.rejects(store.publish(source), { code: 'unsupported_media' });
    await writeFile(source, '');
    await assert.rejects(store.publish(source), { code: 'invalid_media_size' });
    await writeFile(source, Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(store.publish(source), { code: 'invalid_media_size' });
    assert.deepEqual(await readdir(join(root, 'public')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('WebP dikonversi ke JPEG pada salinan Instagram; sumber dan PNG tidak diubah', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ig-convert-test-'));
  const store = new OutboundMediaStore(join(root, 'public'));
  try {
    const source = join(root, 'image.webp');
    const webp = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#00880080' } })
      .webp()
      .toBuffer();
    await writeFile(source, webp);
    const token = await store.publish(source, prepareOfficialImage);
    const saved = await store.get(token);
    assert.equal(saved.mimetype, 'image/jpeg');
    assert.equal((await sharp(await readFile(saved.path)).metadata()).format, 'jpeg');
    assert.deepEqual(await readFile(source), webp);
    assert.equal(await prepareOfficialImage(png), png);
    await assert.rejects(prepareOfficialImage(Buffer.from('524946460000000057454250', 'hex')), {
      code: 'unsupported_media',
    });
    const animated = await sharp(Buffer.concat([Buffer.alloc(4 * 4 * 3), Buffer.alloc(4 * 4 * 3, 255)]), {
      raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    assert.equal((await sharp(animated).metadata()).pages, 2);
    await assert.rejects(prepareOfficialImage(animated), { code: 'unsupported_media' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

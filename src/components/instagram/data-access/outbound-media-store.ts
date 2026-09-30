// Salinan gambar sementara untuk diambil Meta. Nama acak menjadi akses terbatas waktu;
// file sumber milik klien tidak pernah diekspos atau dihapus oleh penyimpanan ini.
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '../../../libraries/errors.js';
import { sniffMediaType } from '../../../libraries/media-type.js';
import { storageRoot } from '../../../libraries/storage.js';

const maxImageBytes = 8 * 1024 * 1024;
export class OutboundMediaStore {
  private writing: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    private root: string,
    private now = Date.now,
    private lifetime = 15 * 60000,
  ) {}
  async publish(source: string, prepare?: (data: Buffer) => Promise<Buffer>) {
    if (this.pending >= 8) throw new ApiError(503, 'media_queue_full', 'Antrean gambar Instagram penuh');
    this.pending++;
    const work = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        await this.prune();
        // Batas jumlah juga membatasi ruang maksimum menjadi 256 MB.
        if ((await readdir(this.root)).length >= 32)
          throw new ApiError(503, 'media_storage_full', 'Penyimpanan gambar sementara Instagram penuh');
        const file = await open(source, 'r');
        let data: Buffer;
        try {
          const info = await file.stat();
          if (!info.isFile() || !info.size || info.size > maxImageBytes)
            throw new ApiError(400, 'invalid_media_size', 'Gambar Instagram harus berukuran 1 byte sampai 8 MB');
          data = Buffer.alloc(info.size);
          let offset = 0;
          while (offset < data.length) {
            const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
            if (!bytesRead) throw new ApiError(400, 'invalid_media_size', 'File gambar berubah saat dibaca');
            offset += bytesRead;
          }
        } finally {
          await file.close();
        }
        if (prepare) data = await prepare(data);
        if (!data.length || data.length > maxImageBytes)
          throw new ApiError(400, 'invalid_media_size', 'Gambar Instagram harus berukuran 1 byte sampai 8 MB');
        imageType(data);
        const token = String(this.now() + this.lifetime) + '-' + randomBytes(32).toString('hex');
        await writeFile(join(this.root, token), data, { flag: 'wx', mode: 0o600 });
        return token;
      });
    this.writing = work;
    try {
      return await work;
    } finally {
      this.pending--;
    }
  }
  async get(token: string) {
    if (!/^\d{13}-[a-f0-9]{64}$/.test(token) || Number(token.split('-')[0]) <= this.now())
      throw new ApiError(404, 'media_not_found', 'Gambar tidak ada atau sudah kedaluwarsa');
    try {
      const path = join(this.root, token);
      const file = await open(path, 'r');
      try {
        const head = Buffer.alloc(12);
        await file.read(head, 0, head.length, 0);
        return { path, mimetype: imageType(head) };
      } finally {
        await file.close();
      }
    } catch {
      throw new ApiError(404, 'media_not_found', 'Gambar tidak ada atau sudah kedaluwarsa');
    }
  }
  async prune() {
    const files = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of files)
      if (/^\d{13}-[a-f0-9]{64}$/.test(name) && Number(name.split('-')[0]) <= this.now())
        await rm(join(this.root, name), { force: true });
  }
}
function imageType(data: Buffer) {
  const type = sniffMediaType(data, '');
  if (!type || !['image/jpeg', 'image/png'].includes(type.mimetype))
    throw new ApiError(400, 'unsupported_media', 'Gambar Instagram resmi harus JPG atau PNG');
  return type.mimetype;
}
export const outboundMedia = new OutboundMediaStore(join(storageRoot, 'files', 'instagram-outbound'));

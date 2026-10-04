// Salinan MP4 privat dan atomik, terpisah dari buffer gambar; kuota global per proses.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, lstat, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { ApiError } from '../../../libraries/errors.js';
import { storageRoot } from '../../../libraries/storage.js';
const maxBytes = 64 * 1024 * 1024;
export class OutboundVideoStore {
  private writing: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    private root: string,
    private now = Date.now,
    private lifetime = 3600000,
    private capacity = 8,
  ) {}
  async publish(source: string) {
    if (this.pending >= 2) throw new ApiError(503, 'media_queue_full', 'Antrean video Instagram penuh.');
    this.pending++;
    const work = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        await this.prune();
        if ((await readdir(this.root)).length >= this.capacity)
          throw new ApiError(503, 'media_storage_full', 'Penyimpanan video sementara penuh.');
        const info = await stat(source);
        if (!info.isFile() || !info.size || info.size > maxBytes)
          throw new ApiError(400, 'invalid_video', 'Video maksimal 64 MiB.');
        const token = String(this.now() + this.lifetime) + '-' + randomBytes(32).toString('hex');
        const temporary = join(this.root, token + '.part');
        let size = 0;
        const limit = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            callback(size > maxBytes ? new ApiError(400, 'invalid_video', 'Video maksimal 64 MiB.') : null, chunk);
          },
        });
        try {
          await pipeline(createReadStream(source), limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), {
            signal: AbortSignal.timeout(120000),
          });
          if (size !== info.size) throw new ApiError(400, 'invalid_video', 'File video berubah saat disalin.');
          await rename(temporary, join(this.root, token));
          return token;
        } catch (error) {
          await rm(temporary, { force: true });
          throw error;
        }
      });
    this.writing = work;
    try {
      return await work;
    } finally {
      this.pending--;
    }
  }
  async get(token: string) {
    if (!/^\d{13}-[a-f0-9]{64}$/.test(token) || Number(token.split('-')[0]) <= this.now()) throw missing();
    const path = join(this.root, token);
    try {
      if (!(await lstat(path)).isFile()) throw missing();
    } catch {
      throw missing();
    }
    return { path, mimetype: 'video/mp4' };
  }
  async remove(token: string) {
    if (/^\d{13}-[a-f0-9]{64}$/.test(token)) await rm(join(this.root, token), { force: true });
  }
  async prune() {
    const files = await readdir(this.root).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    for (const name of files) {
      if (/^\d{13}-[a-f0-9]{64}(\.part)?$/.test(name) && Number(name.split('-')[0]) <= this.now())
        await rm(join(this.root, name), { force: true });
    }
  }
}
function missing() {
  return new ApiError(404, 'media_not_found', 'Video tidak ada atau sudah kedaluwarsa.');
}
export const outboundVideo = new OutboundVideoStore(join(storageRoot, 'files', 'instagram-outbound-video'));

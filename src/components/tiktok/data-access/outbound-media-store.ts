// Salinan foto (JPEG) dan video (MP4) sementara untuk diambil TikTok (PULL_FROM_URL). Nama acak menjadi akses terbatas
// waktu; file sumber tidak pernah diekspos. TikTok bisa mengunduh hingga satu jam, jadi masa berlakunya dua jam.
import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '../../../libraries/errors.js';
import { storageRoot } from '../../../libraries/storage.js';

const namePattern = /^(\d{13})-[a-f0-9]{64}\.(jpg|mp4)$/;
export class OutboundMediaStore {
  constructor(
    private root: string,
    private now = Date.now,
    private lifetime = 2 * 3600000,
    private maxPhotos = 350,
    // Video maksimal 64 MiB, jadi delapan video membatasi ruang sekitar 512 MiB.
    private maxVideos = 8,
  ) {}
  // Semua foto satu posting disimpan sekaligus supaya kapasitas tidak habis di tengah posting.
  async publishPhotos(photos: Buffer[]) {
    await this.ensureRoom('jpg', photos.length, this.maxPhotos);
    const names: string[] = [];
    try {
      for (const photo of photos) {
        const name = this.name('jpg');
        await writeFile(join(this.root, name), photo, { flag: 'wx', mode: 0o600 });
        names.push(name);
      }
    } catch (error) {
      await this.remove(names);
      throw error;
    }
    return names;
  }
  async publishVideo(source: string) {
    await this.ensureRoom('mp4', 1, this.maxVideos);
    const name = this.name('mp4');
    try {
      await copyFile(source, join(this.root, name));
      await chmod(join(this.root, name), 0o600);
    } catch (error) {
      await this.remove([name]);
      throw error;
    }
    return name;
  }
  async get(name: string) {
    const match = namePattern.exec(name);
    if (!match || Number(match[1]) <= this.now()) throw missing();
    const path = join(this.root, name);
    try {
      if (!(await stat(path)).isFile()) throw missing();
    } catch {
      throw missing();
    }
    return { path, mimetype: match[2] === 'mp4' ? 'video/mp4' : 'image/jpeg' };
  }
  async remove(names: string[]) {
    for (const name of names) if (namePattern.test(name)) await rm(join(this.root, name), { force: true });
  }
  async prune() {
    for (const name of await this.list())
      if (Number(namePattern.exec(name)![1]) <= this.now()) await rm(join(this.root, name), { force: true });
  }
  private name(extension: 'jpg' | 'mp4') {
    return String(this.now() + this.lifetime) + '-' + randomBytes(32).toString('hex') + '.' + extension;
  }
  private async ensureRoom(extension: 'jpg' | 'mp4', count: number, limit: number) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.prune();
    if ((await this.list()).filter(name => name.endsWith('.' + extension)).length + count > limit)
      throw new ApiError(503, 'media_storage_full', 'Penyimpanan media sementara TikTok penuh; coba lagi nanti');
  }
  private async list() {
    const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return names.filter(name => namePattern.test(name));
  }
}
function missing() {
  return new ApiError(404, 'media_not_found', 'Media tidak ada atau sudah kedaluwarsa');
}
export const outboundMedia = new OutboundMediaStore(join(storageRoot, 'files', 'tiktok-outbound'));

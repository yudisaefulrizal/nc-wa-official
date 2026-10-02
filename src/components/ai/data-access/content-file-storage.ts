// File gambar disimpan privat di storage/files/content/<akun>/<id> tanpa metadata asal: hasil generator JPEG, referensi PNG
// (lihat contentMimetype). Jenis file mengikuti kolom kind di database, bukan ekstensi.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { storageRoot } from '../../../libraries/storage.js';
const valid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
export function contentPath(account: string, id: string) {
  if (!valid(account) || !valid(id)) throw Error('invalid_content_path');
  return join(storageRoot, 'files', 'content', account, id);
}
export async function writeContent(account: string, id: string, data: Buffer) {
  const path = contentPath(account, id);
  await mkdir(join(storageRoot, 'files', 'content', account), { recursive: true, mode: 0o700 });
  await writeFile(path, data, { flag: 'wx', mode: 0o600 });
}
export const readContent = (account: string, id: string) => readFile(contentPath(account, id));
export const removeContent = (account: string, id: string) => rm(contentPath(account, id), { force: true });

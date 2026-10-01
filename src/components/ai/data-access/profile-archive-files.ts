// Membaca dan menyimpan lampiran arsip data profil; ID tujuan selalu dibuat server.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { storagePaths } from '../../../libraries/storage.js';

export async function readArchiveFile(path: string) {
  return (await readFile(path)).toString('base64');
}
export async function writeArchiveFile(account: string, id: string, content: Buffer) {
  const directory = join(storagePaths().recordFiles, account);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, id), content, { mode: 0o600, flag: 'wx' });
}

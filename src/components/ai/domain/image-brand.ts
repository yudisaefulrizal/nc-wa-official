// Identitas brand milik akun; logo selalu menunjuk gambar privat yang telah diverifikasi.
import { db } from '../../../libraries/db.js';
import { record } from '../../../libraries/validation.js';
import { fail, text } from './input-validation.js';
import { contentFile } from './content-files.js';
import * as brandsSql from '../data-access/image-brands-queries.js';
const decode = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
export async function imageBrand(account: string) {
  const [rows] = await brandsSql.find(db, [account]);
  return rows[0] ? record(decode(rows[0].definition)) : { name: '', description: '', colors: '', logo: '' };
}
export async function saveImageBrand(account: string, value: unknown) {
  const input = record(value);
  const definition = {
    name: text(input.name ?? '', 100, 'Nama brand'),
    description: text(input.description ?? '', 2000, 'Deskripsi brand'),
    colors: text(input.colors ?? '', 200, 'Warna brand'),
    logo: text(input.logo ?? '', 36, 'Logo'),
  };
  if (definition.logo) {
    if (!/^[0-9a-f-]{36}$/i.test(definition.logo)) throw fail('Logo tidak valid');
    await contentFile(account, definition.logo);
  }
  await brandsSql.upsert(db, [account, JSON.stringify(definition)]);
  return definition;
}

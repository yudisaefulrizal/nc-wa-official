// Isian formulir profil Konten menjadi nilai bersih dan ringkasan teks (pesan untuk node Agent). Dipakai pekerjaan
// sungguhan dan simulasi; pemeriksaan file gambar diserahkan ke pemanggil lewat `checkImage`.
import { fail, text } from '../input-validation.js';
import type { FormField } from './definition.js';

export const textFieldChars = 500;
export const textareaFieldChars = 4000;
export async function readForm(
  form: readonly FormField[],
  body: Record<string, unknown>,
  checkImage: (id: string) => Promise<void>,
) {
  if (Object.keys(body).some(key => !form.some(f => f.id === key))) throw fail('Isian formulir tidak dikenal');
  const values: Record<string, string> = {},
    lines: string[] = [];
  for (const field of form) {
    const value = text(
      body[field.id] ?? '',
      field.type === 'textarea' ? textareaFieldChars : textFieldChars,
      field.label,
    );
    if (!value && field.required) throw fail(field.label + ' wajib diisi');
    if (field.type === 'choice' && value && !field.options.includes(value)) throw fail(field.label + ' tidak valid');
    if (field.type === 'image' && value) await checkImage(value);
    values[field.id] = value;
    if (value) lines.push(field.label + ': ' + (field.type === 'image' ? '[gambar referensi]' : value));
  }
  if (!lines.length) throw fail('Isi formulir terlebih dahulu');
  return { values, summary: lines.join('\n') };
}

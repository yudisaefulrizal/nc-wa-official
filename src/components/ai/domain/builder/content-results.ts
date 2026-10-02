// Hasil profil Konten: node Output profil Konten mengubah daftar hasilnya menjadi gambar (ID file Pustaka konten)
// dan teks yang dibaca halaman Konten. Item gambar tanpa file dilewati, misalnya saat Buat gambar gagal. Pemeriksaan
// bahwa file milik akun dilakukan pekerjaan Konten sebelum hasil disimpan; simulasi hanya memakai nama file.
import type { ResultItem } from './definition.js';
import { countWords } from '../metering.js';
import { mediaRefs } from './media.js';

export interface ContentResult {
  label: string;
  kind: ResultItem['kind'];
  // Gambar: daftar ID file; teks: isi teksnya.
  value: string[] | string;
}
export function contentResults(
  items: readonly ResultItem[],
  fill: (value: string) => unknown,
  maxWords: number,
): ContentResult[] {
  const results: ContentResult[] = [];
  let words = 0;
  for (const item of items) {
    const value = fill(item.value);
    if (item.kind === 'image') {
      const files = mediaRefs(value);
      if (files.length) results.push({ label: item.label, kind: 'image', value: files });
      continue;
    }
    const text = (typeof value === 'string' ? value : JSON.stringify(value ?? '')).trim();
    if (!text) continue;
    words += countWords(text);
    results.push({ label: item.label, kind: 'text', value: text });
  }
  if (!results.length) throw Error('ai_results_empty');
  if (words > maxWords) throw Error('ai_output_limit');
  return results;
}

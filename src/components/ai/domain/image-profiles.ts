// Definisi builder generator: formulir, penyusunan prompt, brand dan aturan gambar.
// Draft, publikasi dan aktivasi terpisah; klien hanya menerima definisi formulir yang diterbitkan.
import { randomUUID } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { record } from '../../../libraries/validation.js';
import { integer, text, fail } from './input-validation.js';
import { imageRatios, type ImageRatio } from './image-provider.js';
import { transaction } from './transaction.js';
import * as profilesSql from '../data-access/image-profiles-queries.js';
import * as jobsSql from '../data-access/image-jobs-queries.js';
import * as auditSql from '../data-access/audit-events-queries.js';

export interface ImageField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'choice';
  required: boolean;
  options: string[];
}
export interface ImageDefinition {
  kind: 'image_generator';
  name: string;
  description: string;
  prompt: string;
  refine: boolean;
  useBrand: boolean;
  references: boolean;
  ratios: ImageRatio[];
  maxImages: number;
  fields: ImageField[];
}
export const blankImageDefinition = (): ImageDefinition => ({
  kind: 'image_generator',
  name: 'Generator baru',
  description: '',
  prompt:
    'Buat gambar berdasarkan brief berikut: {{brief}}.\nIdentitas brand: {{brand}}.\nDetail tambahan: {{fields}}.',
  refine: false,
  useBrand: true,
  references: true,
  ratios: ['1:1', '4:5', '9:16'],
  maxImages: 4,
  fields: [],
});
export const decodeImageJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
export function parseImageDefinition(value: unknown): ImageDefinition {
  const input = record(value);
  if (input.kind !== 'image_generator') throw fail('Jenis profil generator tidak valid');
  const name = text(input.name, 100, 'Nama profil');
  const prompt = text(input.prompt, 6000, 'Prompt gambar');
  if (!name || !prompt) throw fail('Nama profil dan prompt wajib diisi');
  const ratios = input.ratios;
  if (
    !Array.isArray(ratios) ||
    !ratios.length ||
    ratios.length > 3 ||
    ratios.some(v => !imageRatios.includes(v as ImageRatio)) ||
    new Set(ratios).size !== ratios.length
  )
    throw fail('Rasio gambar tidak valid');
  for (const key of ['refine', 'useBrand', 'references'])
    if (typeof input[key] !== 'boolean') throw fail('Pilihan generator tidak valid');
  if (!Array.isArray(input.fields) || input.fields.length > 12) throw fail('Maksimum 12 field formulir');
  const ids = new Set<string>();
  const fields = input.fields.map(value => {
    const field = record(value);
    const id = text(field.id, 50, 'ID field');
    const label = text(field.label, 100, 'Label field');
    if (
      !/^[a-z][a-z0-9_]{0,49}$/.test(id) ||
      ['brief', 'brand', 'fields', 'ratio', 'count', 'references', 'constructor', 'prototype', '__proto__'].includes(
        id,
      ) ||
      ids.has(id)
    )
      throw fail('ID field tidak valid atau duplikat');
    ids.add(id);
    if (!label || !['text', 'textarea', 'choice'].includes(String(field.type)) || typeof field.required !== 'boolean')
      throw fail('Field formulir tidak valid');
    const options = field.options ?? [];
    if (!Array.isArray(options) || options.length > 30) throw fail('Pilihan field tidak valid');
    const choices = options.map(v => text(v, 150, 'Pilihan'));
    if (
      choices.some(v => !v) ||
      new Set(choices).size !== choices.length ||
      (field.type === 'choice' && !choices.length)
    )
      throw fail('Isi pilihan field wajib valid');
    return { id, label, type: field.type as ImageField['type'], required: field.required, options: choices };
  });
  const allowed = new Set(['brief', 'brand', 'fields', ...fields.map(f => 'fields.' + f.id)]);
  for (const match of prompt.matchAll(/{{\s*([^{}]+?)\s*}}/g))
    if (!allowed.has(match[1])) throw fail('Variabel prompt tidak dikenal: ' + match[1]);
  return {
    kind: 'image_generator',
    name,
    description: text(input.description ?? '', 500, 'Deskripsi'),
    prompt,
    refine: input.refine as boolean,
    useBrand: input.useBrand as boolean,
    references: input.references as boolean,
    ratios: ratios as ImageRatio[],
    maxImages: integer(input.maxImages, 1, 4, 'Batas gambar'),
    fields,
  };
}
function state(row: import('mysql2/promise').RowDataPacket) {
  return {
    id: String(row.id),
    draft: parseImageDefinition(decodeImageJson(row.draft)),
    active: row.active ? parseImageDefinition(decodeImageJson(row.active)) : null,
    enabled: Boolean(row.enabled),
    revision: Number(row.revision),
    published_revision: Number(row.published_revision),
  };
}
export async function listImageProfiles(available = false) {
  const [rows] = await profilesSql.list(db, available);
  if (!available) return rows.map(state);
  return rows.map(row => {
    const d = parseImageDefinition(decodeImageJson(row.active));
    return {
      id: String(row.id),
      name: d.name,
      description: d.description,
      ratios: d.ratios,
      maxImages: d.maxImages,
      references: d.references,
      fields: d.fields,
      revision: Number(row.published_revision),
    };
  });
}
export async function imageProfileState(id: string) {
  const [rows] = await profilesSql.find(db, [id]);
  if (!rows[0]) throw new ApiError(404, 'profile_not_found', 'Profil generator tidak ditemukan.');
  return state(rows[0]);
}
export async function createImageProfile(actor: string, value: unknown) {
  const d = parseImageDefinition(value),
    id = randomUUID();
  await transaction(async c => {
    await profilesSql.insert(c, [id, JSON.stringify(d)]);
    await auditSql.insert(c, [actor, 'image_profile_created:' + id]);
  });
  return imageProfileState(id);
}
export async function saveImageProfile(actor: string, id: string, value: unknown, publish = false) {
  const input = record(value);
  const definition = publish ? undefined : parseImageDefinition(input.definition);
  await transaction(async c => {
    const [rows] = await profilesSql.find(c, [id], true);
    if (!rows[0]) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
    if (input.revision !== Number(rows[0].revision))
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang sebelum menyimpan.');
    if (publish) {
      const next = parseImageDefinition(decodeImageJson(rows[0].draft));
      await profilesSql.insertVersion(c, [id, Number(rows[0].revision), JSON.stringify(next)]);
      await profilesSql.publish(c, [id]);
    } else await profilesSql.update(c, [JSON.stringify(definition), id]);
    await auditSql.insert(c, [actor, (publish ? 'image_profile_published:' : 'image_profile_saved:') + id]);
  });
  return imageProfileState(id);
}
export async function enableImageProfile(actor: string, id: string, value: unknown) {
  if (typeof value !== 'boolean') throw fail('Status profil tidak valid');
  await transaction(async c => {
    const [rows] = await profilesSql.find(c, [id], true);
    if (!rows[0]) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
    if (value && !rows[0].active) throw fail('Terbitkan profil sebelum mengaktifkannya');
    await profilesSql.setEnabled(c, [value, id]);
    await auditSql.insert(c, [actor, 'image_profile_enabled:' + id + ':' + value]);
  });
  return imageProfileState(id);
}
export async function deleteImageProfile(actor: string, id: string, revision: unknown) {
  await transaction(async c => {
    const [rows] = await profilesSql.find(c, [id], true);
    if (!rows[0]) throw new ApiError(404, 'profile_not_found', 'Profil tidak ditemukan.');
    if (revision !== Number(rows[0].revision))
      throw new ApiError(409, 'workflow_conflict', 'Draft berubah. Muat ulang.');
    const [jobs] = await jobsSql.countProfileOpen(c, [id]);
    if (Number(jobs[0].n)) throw new ApiError(409, 'profile_in_use', 'Tunggu pekerjaan gambar profil ini selesai.');
    await profilesSql.deleteById(c, [id]);
    await auditSql.insert(c, [actor, 'image_profile_deleted:' + id]);
  });
  return { ok: true };
}
export async function imageVersions(id: string) {
  await imageProfileState(id);
  const [rows] = await profilesSql.listVersions(db, [id]);
  return rows;
}
export async function imageVersion(id: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw fail('Versi tidak valid');
  const [rows] = await profilesSql.findVersion(db, [id, revision]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Versi tidak ditemukan.');
  return parseImageDefinition(decodeImageJson(rows[0].definition));
}
export function composeImagePrompt(
  definition: ImageDefinition,
  brief: string,
  brand: string,
  fields: Record<string, string>,
) {
  const values = new Map<string, string>([
    ['brief', brief],
    ['brand', definition.useBrand ? brand : ''],
    ['fields', definition.fields.map(f => f.label + ': ' + (fields[f.id] ?? '')).join('\n')],
  ]);
  for (const field of definition.fields) values.set('fields.' + field.id, fields[field.id] ?? '');
  // Satu penggantian: teks pelanggan yang berisi {{...}} tidak diperlakukan sebagai template baru.
  return definition.prompt.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, key) => values.get(key) ?? '');
}

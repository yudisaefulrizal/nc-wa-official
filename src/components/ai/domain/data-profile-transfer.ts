// Arsip data profil versi 1: impor atomik dengan ID baru, tanpa sesi atau token API.
import { randomUUID } from 'node:crypto';
import { readArchiveFile, writeArchiveFile } from '../data-access/profile-archive-files.js';
import { documentFileType } from '../../../libraries/media-type.js';
import { object } from '../../../libraries/validation.js';
import { fail, text } from './input-validation.js';
import { transaction, lockAccount } from './transaction.js';
import { dataProfile, insertDataProfile } from './data-profiles.js';
import type { AIService } from './service.js';
import { collectionKind, parseDefinition, validateRecord } from './builder/definition.js';
import { recordFilePath, recordFileLimits, removeRecordFiles } from './builder/record-files.js';
import { sourceInput } from './endpoint.js';
import * as profilesSql from '../data-access/data-profiles-queries.js';
import * as graphsSql from '../data-access/graph-profiles-queries.js';
import * as filesSql from '../data-access/record-files-queries.js';
import * as sourcesSql from '../data-access/collection-sources-queries.js';
const decode = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
const format = 'nc-wa-data-profile';
export const profileArchiveBytes = 150 * 1024 * 1024;

export async function exportDataProfile(svc: AIService, account: string, id: string) {
  await svc.ownedDataProfile(account, id);
  return transaction(async c => {
    await lockAccount(c, account);
    const [rows] = await profilesSql.share(c, [id, account]);
    if (!rows[0]) throw fail('Data profil tidak ditemukan.');
    const p = rows[0];
    const [records] = await graphsSql.allRecords(c, [account, id]);
    const [attachments] = await filesSql.listByProfile(c, [account, id]);
    const [endpoints] = await sourcesSql.listByProfile(c, [account, id]);
    const archive = {
      format,
      version: 1,
      profile: {
        name: String(p.name),
        profile_type: String(p.profile_type),
        behavior: String(p.behavior),
        fallback_number: String(p.fallback_number),
        fallback_notify: Boolean(p.fallback_notify),
      },
      records: records.map(r => ({
        id: String(r.id),
        collection: String(r.collection_id),
        data: decode(r.data),
        customer: r.customer || null,
      })),
      files: [] as { id: string; filename: string; mimetype: string; content: string }[],
      sources: endpoints.map(s => ({ collection: String(s.collection_id), endpoint: String(s.endpoint) })),
    };
    for (const f of attachments.filter(f => f.record_id)) {
      const file = await recordFilePath(account, id, String(f.id));
      archive.files.push({
        id: file.id,
        filename: file.filename,
        mimetype: file.mimetype,
        content: await readArchiveFile(file.path),
      });
    }
    if (Buffer.byteLength(JSON.stringify(archive)) > profileArchiveBytes)
      throw fail('Arsip data profil melebihi 150 MB.');
    return archive;
  });
}

export async function importDataProfile(svc: AIService, account: string, body: unknown) {
  const input = object(body),
    archive = object(input.archive),
    p = object(archive.profile);
  if (archive.format !== format || archive.version !== 1) throw fail('Format file export data profil tidak didukung.');
  const name = text(input.name, 100, 'Nama data profil');
  const type = text(p.profile_type, 100, 'Profil AI');
  const behavior = text(p.behavior, 2000, 'Perilaku AI');
  const fallback = text(p.fallback_number, 20, 'Nomor fallback');
  if (!name || (fallback && !/^[1-9][0-9]{5,14}$/.test(fallback)) || typeof p.fallback_notify !== 'boolean')
    throw fail('Pengaturan data profil tidak valid.');
  if (!Array.isArray(archive.records) || !Array.isArray(archive.files) || !Array.isArray(archive.sources))
    throw fail('Isi arsip tidak valid.');
  const records = archive.records.map(object),
    attachments = archive.files.map(object);
  const endpoints = await Promise.all(
    archive.sources.map(async value => {
      const s = object(value);
      return {
        collection: text(s.collection, 100, 'Koleksi'),
        source: await sourceInput({ mode: 'endpoint', endpoint: s.endpoint }),
      };
    }),
  );
  const copied: string[] = [];
  try {
    const id = await transaction(async c => {
      await lockAccount(c, account);
      const [taken] = await profilesSql.lockByName(c, [account, name]);
      if (taken.length) throw fail('Nama data profil sudah dipakai. Gunakan nama lain.');
      const created = await insertDataProfile(svc, c, account, type, name);
      const [active] = await graphsSql.shareOwnedGraph(c, [account, created]);
      if (!active[0]?.active) throw fail('Profil AI tidak tersedia.');
      const definition = parseDefinition(decode(active[0].active));
      const ids = new Map<string, string>(),
        fileIds = new Map<string, string>();
      for (const r of records) {
        if (typeof r.id !== 'string' || !r.id || ids.has(r.id)) throw fail('ID record tidak valid atau duplikat.');
        ids.set(r.id, randomUUID());
      }
      let total = 0;
      for (const f of attachments) {
        if (typeof f.id !== 'string' || !f.id || fileIds.has(f.id) || typeof f.content !== 'string')
          throw fail('Lampiran tidak valid.');
        const filename = text(f.filename, 255, 'Nama file').replace(/[\\/\0\r\n]/g, '_');
        if (!filename) throw fail('Nama file wajib diisi.');
        const content = Buffer.from(f.content, 'base64');
        if (content.toString('base64') !== f.content || !content.length) throw fail('Isi lampiran tidak valid.');
        const media =
          f.mimetype === 'application/json' || f.mimetype === 'text/markdown'
            ? { media_type: 'document', mimetype: f.mimetype }
            : documentFileType(content.subarray(0, 64), filename);
        total += content.length;
        if (
          content.length >
            (media.media_type === 'image' ? recordFileLimits.imageBytes : recordFileLimits.documentBytes) ||
          total > recordFileLimits.totalBytes
        )
          throw fail('Ukuran lampiran melebihi batas penyimpanan.');
        const next = randomUUID();
        copied.push(next);
        await writeArchiveFile(account, next, content);
        fileIds.set(f.id, next);
        await filesSql.insert(c, [
          next,
          account,
          created,
          null,
          filename,
          media.mimetype,
          media.media_type,
          content.length,
        ]);
      }
      const singles = new Set<string>(),
        unique = new Set<string>(),
        claimed = new Map<string, string>();
      for (const r of records) {
        const schema = definition.collections.find(s => s.id === r.collection);
        if (!schema) throw fail('Koleksi dalam arsip tidak cocok dengan profil AI.');
        if (collectionKind(schema) !== 'list' && singles.has(schema.id))
          throw fail('Koleksi isian hanya boleh memiliki satu record.');
        singles.add(schema.id);
        const customer = schema.owner === 'customer' ? r.customer : null;
        if (schema.owner === 'customer' && (typeof customer !== 'string' || !/^[0-9]{5,20}$/.test(customer)))
          throw fail('Nomor pelanggan tidak valid.');
        const data = validateRecord(schema, r.data);
        for (const field of schema.fields) {
          const value = data[field.id];
          if (value === undefined) continue;
          if (field.unique) {
            const key = JSON.stringify([
              schema.id,
              field.id,
              typeof value === 'string' ? value.toLowerCase() : String(value),
            ]);
            if (unique.has(key)) throw fail('Nilai field unik dalam arsip duplikat.');
            unique.add(key);
          }
          if (field.type === 'relation') {
            const target = records.find(x => x.id === value && x.collection === field.collection);
            const owned = definition.collections.find(s => s.id === field.collection)?.owner === 'customer';
            if (!target || (owned && target.customer !== customer))
              throw fail('Relasi record dalam arsip tidak valid.');
            data[field.id] = ids.get(String(value))!;
          }
          if (field.type === 'file') {
            const next = fileIds.get(String(value));
            if (!next || (claimed.has(next) && claimed.get(next) !== r.id)) throw fail('Lampiran record tidak valid.');
            claimed.set(next, String(r.id));
            data[field.id] = next;
            await filesSql.attach(c, [ids.get(String(r.id))!, account, created, next]);
          }
        }
        await graphsSql.insertRecord(c, [
          ids.get(String(r.id))!,
          account,
          created,
          schema.id,
          JSON.stringify(data),
          customer as string | null,
        ]);
      }
      if (claimed.size !== attachments.length) throw fail('Arsip memuat lampiran tanpa record.');
      for (const s of endpoints) {
        const schema = definition.collections.find(c => c.id === s.collection);
        if (!schema || collectionKind(schema) !== 'list' || s.source.mode !== 'endpoint')
          throw fail('Sumber API tidak valid.');
        await sourcesSql.upsert(c, [account, created, s.collection, s.source.endpoint, '']);
      }
      await profilesSql.updateBehavior(c, [behavior, created, account]);
      await profilesSql.updateFallback(c, [
        fallback,
        Boolean(fallback) && p.fallback_notify === true,
        created,
        account,
      ]);
      return created;
    });
    return dataProfile(svc, account, id);
  } catch (error) {
    await removeRecordFiles(account, copied);
    throw error;
  }
}

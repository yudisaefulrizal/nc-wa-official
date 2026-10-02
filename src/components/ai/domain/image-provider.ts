// Transport gambar untuk provider terpilih: OpenRouter Images, Images API kompatibel,
// atau Chat Completions multimodal. DNS dikunci, redirect dan jawaban terlalu besar ditolak.
import { request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decrypt } from '../../../libraries/crypto.js';
import { validatePublicUrl, downloadPublicMedia } from '../../../libraries/download.js';
import { ApiError } from '../../../libraries/errors.js';
import { record } from '../../../libraries/validation.js';
import { fail, integer, text } from './input-validation.js';
import { db } from '../../../libraries/db.js';
import * as providersSql from '../data-access/provider-profiles-queries.js';
import type { AIConfig } from './provider.js';
import type { AIService } from './service.js';

export const imageRatios = ['1:1', '4:5', '9:16'] as const;
export type ImageRatio = (typeof imageRatios)[number];
export interface ImageOptions {
  protocol: 'auto' | 'openrouter' | 'compatible' | 'chat';
  references: boolean;
  maxImages: number;
  creditsPerImage: number;
  quality: 'auto' | 'low' | 'medium' | 'high';
  sizes: Record<ImageRatio, string>;
}
export interface ImageConnection {
  profileId: string;
  model: string;
  options: ImageOptions;
}
export interface ImageRequest {
  prompt: string;
  ratio: ImageRatio;
  count: number;
  references: Buffer[];
}
export type ImageTransport = (
  connection: ImageConnection,
  input: ImageRequest,
  signal?: AbortSignal,
) => Promise<Buffer[]>;

export function parseImageOptions(value: unknown): ImageOptions {
  const input = record(typeof value === 'string' ? JSON.parse(value) : (value ?? {}));
  const protocol = input.protocol ?? 'auto',
    quality = input.quality ?? 'auto';
  if (!['auto', 'openrouter', 'compatible', 'chat'].includes(String(protocol)))
    throw fail('Protokol gambar tidak valid');
  if (!['auto', 'low', 'medium', 'high'].includes(String(quality))) throw fail('Kualitas gambar tidak valid');
  if (input.references !== undefined && typeof input.references !== 'boolean')
    throw fail('Kemampuan referensi tidak valid');
  const sizes = record(input.sizes ?? {});
  const result = {} as Record<ImageRatio, string>;
  for (const ratio of imageRatios) {
    const size = text(
      sizes[ratio] ?? (ratio === '1:1' ? '1024x1024' : ratio === '4:5' ? '1024x1280' : '1024x1792'),
      20,
      'Ukuran gambar',
    );
    if (!/^\d{3,4}x\d{3,4}$/.test(size)) throw fail('Ukuran harus berbentuk lebarxtinggi');
    const [w, h] = size.split('x').map(Number);
    if (w < 256 || h < 256 || w > 4096 || h > 4096) throw fail('Ukuran gambar di luar batas');
    result[ratio] = size;
  }
  return {
    protocol: protocol as ImageOptions['protocol'],
    references: input.references === true,
    maxImages: integer(input.maxImages ?? 1, 1, 4, 'Batas gambar'),
    creditsPerImage: integer(input.creditsPerImage ?? 0, 0, 1000000, 'Tarif kredit gambar'),
    quality: quality as ImageOptions['quality'],
    sizes: result,
  };
}
export const imageConnection = async (svc: AIService) => imageConnectionFrom(await svc.config());
// Dipakai juga oleh node Buat gambar, yang sudah memegang konfigurasi AI dari runtime.
export async function imageConnectionFrom(config: AIConfig): Promise<ImageConnection> {
  const profile = config.tier_profiles?.image;
  if (!profile?.id || !profile.model || !profile.secret)
    throw new ApiError(409, 'image_not_configured', 'Owner belum mengatur tier Model Gambar.');
  const [rows] = await providersSql.findImageConnection(db, [profile.id]);
  if (!rows[0]) throw new ApiError(409, 'image_not_configured', 'Provider gambar tidak aktif.');
  return { profileId: profile.id, model: profile.model, options: parseImageOptions(rows[0].image_options) };
}
export function imagePayload(protocol: string, connection: ImageConnection, input: ImageRequest) {
  const refs = input.references.map(image => ({
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,' + image.toString('base64') },
  }));
  if (protocol === 'chat')
    return {
      model: connection.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }, ...refs] }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: input.ratio },
      stream: false,
    };
  return {
    model: connection.model,
    prompt: input.prompt,
    n: input.count,
    quality: connection.options.quality,
    ...(protocol === 'openrouter'
      ? { aspect_ratio: input.ratio, output_format: 'png', ...(refs.length ? { input_references: refs } : {}) }
      : { size: connection.options.sizes[input.ratio] }),
  };
}
export const callImage: ImageTransport = async (connection, input, signal) => {
  const [rows] = await providersSql.findImageConnection(db, [connection.profileId]);
  const profile = rows[0];
  if (!profile) throw new ApiError(409, 'image_not_configured', 'Provider gambar tidak aktif.');
  const protocol =
    connection.options.protocol === 'auto'
      ? profile.provider === 'openrouter'
        ? 'openrouter'
        : 'compatible'
      : connection.options.protocol;
  if (input.references.length && !connection.options.references)
    throw fail('Model ini belum diatur untuk menerima referensi');
  if (protocol === 'chat' && input.count !== 1)
    throw fail('Protokol chat gambar hanya mendukung satu gambar per pekerjaan');
  const endpoint = new URL(profile.endpoint);
  endpoint.pathname = endpoint.pathname.replace(
    /\/chat\/completions$/,
    protocol === 'chat'
      ? '/chat/completions'
      : protocol === 'openrouter'
        ? '/images'
        : input.references.length
          ? '/images/edits'
          : '/images/generations',
  );
  const { url, addresses } = await validatePublicUrl(endpoint.href);
  if (url.protocol !== 'https:') throw fail('Endpoint gambar wajib HTTPS');
  let payload: Buffer,
    contentType = 'application/json';
  if (protocol === 'compatible' && input.references.length) {
    const boundary = 'ncwa-' + randomUUID();
    const parts: Buffer[] = [];
    const fields = imagePayload(protocol, connection, input);
    for (const [key, value] of Object.entries(fields))
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    input.references.forEach((image, i) => {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-${i}.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        image,
        Buffer.from('\r\n'),
      );
    });
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    payload = Buffer.concat(parts);
    contentType = 'multipart/form-data; boundary=' + boundary;
  } else payload = Buffer.from(JSON.stringify(imagePayload(protocol, connection, input)));
  const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000),
        headers: {
          Authorization: 'Bearer ' + decrypt(profile.secret),
          'Content-Type': contentType,
          'Content-Length': payload.length,
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      res => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(Error('image_provider_rejected'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 48 * 1024 * 1024) res.destroy(Error('image_response_too_large'));
          else chunks.push(chunk);
        });
        res.once('error', reject);
        res.once('end', () => {
          try {
            resolve(record(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
          } catch {
            reject(Error('image_invalid_response'));
          }
        });
      },
    );
    req.once('error', reject);
    req.end(payload);
  });
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const message = choices[0] && typeof choices[0] === 'object' ? record(record(choices[0]).message ?? {}) : {};
  const entries = Array.isArray(response.data) ? response.data : Array.isArray(message.images) ? message.images : [];
  if (!entries.length || entries.length > input.count) throw Error('image_invalid_response');
  const output: Buffer[] = [];
  for (const entry of entries) {
    const item = record(entry);
    if (typeof item.b64_json === 'string') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json) || item.b64_json.length > 20 * 1024 * 1024)
        throw Error('image_invalid_response');
      output.push(Buffer.from(item.b64_json, 'base64'));
      continue;
    }
    const imageUrl =
      typeof item.url === 'string'
        ? item.url
        : typeof item.image_url === 'object'
          ? record(item.image_url).url
          : undefined;
    if (typeof imageUrl !== 'string') throw Error('image_invalid_response');
    const data = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(imageUrl);
    if (data) {
      output.push(Buffer.from(data[1], 'base64'));
      continue;
    }
    if (!imageUrl.startsWith('https://')) throw Error('image_invalid_response');
    const downloaded = await downloadPublicMedia(imageUrl, { maxBytes: 15 * 1024 * 1024 });
    try {
      output.push(await readFile(downloaded.path));
    } finally {
      await downloaded.cleanup();
    }
  }
  return output;
};
export async function testImageTier(svc: AIService) {
  const connection = await imageConnection(svc);
  const result = await callImage(connection, {
    prompt: 'A plain green circle on a white background.',
    ratio: '1:1',
    count: 1,
    references: [],
  });
  if (!result.length) throw Error('image_empty');
  return { ok: true, tier: 'image', model: connection.model, message: 'Koneksi Model Gambar berhasil diuji.' };
}

export async function testImageProvider(id: string) {
  const [rows] = await providersSql.findImageConnection(db, [id]);
  if (!rows[0]?.model_image) throw fail('Pilih provider dengan Model Gambar');
  const images = await callImage(
    {
      profileId: String(rows[0].id),
      model: String(rows[0].model_image),
      options: parseImageOptions(rows[0].image_options),
    },
    { prompt: 'A plain green circle on a white background.', ratio: '1:1', count: 1, references: [] },
  );
  return images[0];
}

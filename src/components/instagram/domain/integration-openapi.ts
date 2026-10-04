// Dokumentasi API Instagram untuk aplikasi lain dalam format OpenAPI 3 (JSON), supaya aplikasi atau agent lain
// bisa membacanya tanpa panduan tertulis. Dibuat dari kode, jadi daftar scope selalu sama dengan yang ditegakkan server.
import { keyScopes, type KeyScope } from './integration-keys.js';

const error = { $ref: '#/components/responses/Error' };
const ig = {
  name: 'ig',
  in: 'path',
  required: true,
  description: 'id akun Instagram dari GET /accounts',
  schema: { type: 'string' },
};
const path = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});
const query = (name: string, description: string, schema: object = { type: 'string' }) => ({
  name,
  in: 'query',
  description,
  schema,
});
const json = (schema: object) => ({ 'application/json': { schema } });
const ok = (description: string, schema: object) => ({ description, content: json(schema) });
const errors = {
  '400': error,
  '401': error,
  '403': error,
  '404': error,
  '409': error,
  '429': error,
  '502': error,
  '503': error,
  '504': error,
};
function operation(scope: KeyScope, summary: string, extra: Record<string, unknown>) {
  return {
    summary,
    description: 'Scope key yang diperlukan: `' + scope + '`.',
    'x-required-scope': scope,
    security: [{ bearerAuth: [] }],
    ...extra,
    responses: { ...errors, ...(extra.responses as object) },
  };
}
const list = { type: 'array', items: { type: 'object', additionalProperties: true } };
const paged = {
  type: 'object',
  properties: {
    data: list,
    next: { type: ['string', 'null'], description: 'Isi ke parameter after untuk halaman berikutnya; null bila habis' },
  },
};

export function integrationOpenApi(origin: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'NC-WA Instagram API',
      version: '1.0.0',
      description:
        'Memakai akun Instagram resmi yang sudah terhubung di NC-WA tanpa login ke Meta sendiri. Buat key di Dashboard › Integrasi › "API untuk aplikasi lain". Key berbentuk ncig_… dan dikirim lewat header Authorization: Bearer. Batas 120 permintaan per menit per key. Balasan DM hanya dalam 24 jam setelah pesan pelanggan. Pengiriman DM memotong kredit pesan akun.',
    },
    servers: [{ url: origin + '/api/v1/instagram' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/accounts': {
        get: operation('accounts:read', 'Daftar akun Instagram yang terhubung', {
          responses: {
            '200': ok('Akun milik pemilik key', {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Dipakai sebagai :ig di endpoint lain dan igUserId di body' },
                  username: { type: 'string' },
                  status: { type: 'string', enum: ['active', 'expiring', 'expired', 'revoked'] },
                  permissions: { type: 'array', items: { type: 'string' } },
                  daysLeft: { type: 'integer', description: 'Sisa hari token; diperpanjang otomatis' },
                  sessionActive: { type: 'boolean' },
                },
              },
            }),
          },
        }),
      },
      '/accounts/{ig}/conversations': {
        get: operation('messages:read', 'Daftar percakapan akun, terbaru lebih dulu', {
          parameters: [ig],
          responses: { '200': ok('Percakapan', list) },
        }),
      },
      '/accounts/{ig}/conversations/{customer}/messages': {
        get: operation('messages:read', 'Pesan satu percakapan (100 terbaru per halaman, urut lama ke baru)', {
          parameters: [
            ig,
            path('customer', 'ID pengguna Instagram pelanggan'),
            query('before', 'Kursor dari halaman sebelumnya'),
          ],
          responses: { '200': ok('Pesan', { type: 'object', additionalProperties: true }) },
        }),
      },
      '/messages': {
        post: operation('messages:send', 'Kirim DM teks atau gambar', {
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              description: 'Mencegah kirim ganda; 1–128 huruf, angka, _ atau -',
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['igUserId', 'to'],
              properties: {
                igUserId: { type: 'string' },
                to: { type: 'string', description: 'ID pengguna Instagram penerima' },
                text: { type: 'string', description: 'Wajib bila imageUrl tidak diisi' },
                imageUrl: { type: 'string', format: 'uri', description: 'Alamat gambar publik (JPG/PNG)' },
              },
            }),
          },
          responses: {
            '200': ok('Pesan terkirim', {
              type: 'object',
              properties: { messageId: { type: 'string' }, to: { type: 'string' }, requestId: { type: 'string' } },
            }),
          },
        }),
      },
      '/accounts/{ig}/summary': {
        get: operation(
          'insights:read',
          'Angka akun saat ini: follower dan total bulan ini (hanya kondisi sekarang, tanpa riwayat)',
          {
            description:
              'Scope key yang diperlukan: `insights:read`. Akun harus memberi izin instagram_business_manage_insights (hubungkan ulang bila belum). Untuk melihat perkembangan, simpan hasilnya tiap kali dipanggil lalu bandingkan dengan pemanggilan sebelumnya. Bulan berjalan menurut UTC; Meta membatasi rentang maksimal 30 hari, jadi month.from bisa lebih akhir dari tanggal 1 pada akhir bulan 31 hari. Metrik yang tidak tersedia untuk akun bernilai null dan tercantum di month.unavailable.',
            parameters: [ig],
            responses: {
              '200': ok('Ringkasan', {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                  followers: { type: 'integer' },
                  following: { type: ['integer', 'null'] },
                  mediaCount: { type: ['integer', 'null'] },
                  month: {
                    type: 'object',
                    properties: {
                      from: { type: 'string', format: 'date-time' },
                      to: { type: 'string', format: 'date-time' },
                      views: { type: ['integer', 'null'] },
                      reach: { type: ['integer', 'null'], description: 'Akun unik yang melihat konten' },
                      accounts_engaged: { type: ['integer', 'null'] },
                      total_interactions: { type: ['integer', 'null'] },
                      likes: { type: ['integer', 'null'] },
                      comments: { type: ['integer', 'null'] },
                      shares: { type: ['integer', 'null'] },
                      saves: { type: ['integer', 'null'] },
                      profile_views: { type: ['integer', 'null'] },
                      unavailable: { type: 'array', items: { type: 'string' } },
                    },
                  },
                  fetchedAt: { type: 'string', format: 'date-time' },
                },
              }),
            },
          },
        ),
      },
      '/accounts/{ig}/media': {
        get: operation('comments:read', 'Daftar postingan akun', {
          parameters: [
            ig,
            query('limit', '1–50, bawaan 25', { type: 'integer' }),
            query('after', 'Kursor halaman berikutnya'),
          ],
          responses: { '200': ok('Postingan', paged) },
        }),
      },
      '/accounts/{ig}/media/{media}/comments': {
        get: operation('comments:read', 'Komentar sebuah postingan', {
          parameters: [
            ig,
            path('media', 'ID media'),
            query('limit', '1–50, bawaan 25', { type: 'integer' }),
            query('after', 'Kursor halaman berikutnya'),
          ],
          responses: { '200': ok('Komentar', paged) },
        }),
      },
      '/accounts/{ig}/comments/{comment}/replies': {
        post: operation('comments:write', 'Balas komentar', {
          parameters: [ig, path('comment', 'ID komentar')],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['message'],
              properties: { message: { type: 'string', maxLength: 2200 } },
            }),
          },
          responses: { '201': ok('Balasan dibuat', { type: 'object', properties: { id: { type: 'string' } } }) },
        }),
      },
      '/accounts/{ig}/comments/{comment}/hide': {
        post: operation('comments:write', 'Sembunyikan atau tampilkan komentar', {
          parameters: [ig, path('comment', 'ID komentar')],
          requestBody: { content: json({ type: 'object', properties: { hide: { type: 'boolean', default: true } } }) },
          responses: { '200': ok('Selesai', { type: 'object', properties: { ok: { type: 'boolean' } } }) },
        }),
      },
      '/posts': {
        post: operation('posts:publish', 'Posting gambar atau video Reels (caption maksimal 2.200 karakter)', {
          requestBody: {
            required: true,
            content: json({
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['requestId', 'igUserId', 'imageUrl'],
                  properties: {
                    requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
                    igUserId: { type: 'string' },
                    mediaType: { type: 'string', enum: ['IMAGE'] },
                    imageUrl: { type: 'string', format: 'uri' },
                    caption: { type: 'string', maxLength: 2200 },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['requestId', 'igUserId', 'mediaType', 'videoUrl'],
                  properties: {
                    requestId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
                    igUserId: { type: 'string' },
                    mediaType: { type: 'string', enum: ['REELS'] },
                    videoUrl: {
                      type: 'string',
                      format: 'uri',
                      description: 'MP4 publik, maksimal 64 MiB, unduhan 120 detik (kebijakan NC-WA)',
                    },
                    caption: { type: 'string', maxLength: 2200 },
                  },
                  example: {
                    requestId: 'reels-001',
                    igUserId: '17841400000000000',
                    mediaType: 'REELS',
                    videoUrl: 'https://media.example/video.mp4',
                    caption: 'Video baru',
                  },
                },
              ],
            }),
          },
          responses: {
            '200': ok('Sudah terbit', { $ref: '#/components/schemas/Post' }),
            '202': ok('Diproses Meta; pantau lewat GET /posts/{requestId}', { $ref: '#/components/schemas/Post' }),
          },
        }),
      },
      '/posts/{requestId}': {
        get: operation('posts:publish', 'Status posting; panggil berulang sampai published', {
          parameters: [path('requestId', 'requestId saat membuat posting')],
          responses: { '200': ok('Status', { $ref: '#/components/schemas/Post' }) },
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Key ncig_… dari halaman Integrasi' },
      },
      schemas: {
        Post: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['preparing', 'processing', 'publishing', 'published', 'failed', 'unknown'],
              description: 'unknown: hasil publish belum pasti, periksa akun Instagram sebelum mengirim ulang',
            },
            mediaType: { type: 'string', enum: ['IMAGE', 'REELS'], default: 'IMAGE' },
            mediaId: { type: ['string', 'null'] },
          },
        },
      },
      responses: {
        Error: {
          description:
            'Kesalahan: 400 input tidak valid, 401 key salah, 403 scope kurang, 404 tidak ditemukan, 409 perlu hubungkan ulang Instagram atau konflik, 429 melewati batas, 502 Meta menolak',
          content: json({ type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }),
        },
      },
    },
    'x-scopes': keyScopes,
  };
}

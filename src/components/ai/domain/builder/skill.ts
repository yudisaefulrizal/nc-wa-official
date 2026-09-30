// Skill AI untuk membuat profil dengan bantuan ChatGPT/Claude: SKILL.md (dengan pola inti konteks S-P-O), referensi
// format, panduan routing tugas, dan contoh lengkap, dikemas sebagai ZIP berformat skill Claude. Daftar node, operator, tipe, tier, variabel, dan batas diambil dari
// kontrak di definition.ts; peta deskripsi di bawah bertipe Record atas konstanta itu, jadi node atau operator baru
// tanpa deskripsi gagal di tsc dan skill tidak pernah tertinggal dari validator.
import { createZip } from '../../../../libraries/zip.js';
import { modelTiers, type ModelTier } from '../pipeline/models.js';
import {
  collectionKinds,
  collectionOwners,
  defaultTextChars,
  maxCollectionText,
  maxCollectionSamples,
  computeArity,
  conditionOperators,
  contextVariables,
  defaultFieldTypes,
  extractFieldTypes,
  fieldTypes,
  blankDefinition,
  limits,
  nodeTypes,
  recordOutputs,
  toolOperations,
  uniqueFieldTypes,
  type CollectionKind,
  type ComputeOp,
  type ConditionOperator,
  type FieldType,
  type GraphDefinition,
  type GraphNode,
  type NodeType,
  type ToolOperation,
} from './definition.js';
import { filterOperators, maxToolLimit, type FilterOperator } from './record-query.js';
import { runtimeLimits } from './engine.js';
import { defaultToolLimit } from './record-tools.js';
import { maxMediaPerReply } from './media.js';
import { maxGeneratedBytes } from './generated-files.js';

export const skillName = 'ncwa-profil-ai';

interface NodeDoc {
  name: string;
  purpose: string;
  keys: string;
  ports: string;
  outputs: string;
}
const nodeDocs: Record<NodeType, NodeDoc> = {
  input: {
    name: 'Input',
    purpose: 'Titik awal alur: pesan pelanggan masuk di sini. Wajib tepat satu.',
    keys: 'Tidak ada kunci khusus.',
    ports: '`next`',
    outputs:
      'Pakai `{{input.message}}`, `{{input.context}}`, `{{input.history}}` (bukan `nodes.<id>`). Selama antrean Router: `input.task` berisi tugas aktif, termasuk task, context, attempts, dan exclusions; di luar antrean nilainya null.',
  },
  memory: {
    name: 'Memori percakapan',
    purpose:
      'Riwayat percakapan (pesan pelanggan dan balasan) per akun, sesi WhatsApp, dan pelanggan, untuk node AI yang merujuknya lewat kunci `memory`. Hanya dibaca node; ditulis sistem setiap giliran. Bukan bagian jalur: tidak punya edge.',
    keys: '`memory_limit`: jumlah pesan sebelumnya 0–' + limits.memory + ' (umumnya 20).',
    ports: 'tidak ada',
    outputs: '`history` (hanya untuk node yang `memory`-nya menunjuk node ini).',
  },
  context_memory: {
    name: 'Memori konteks',
    purpose:
      'Ringkasan S-P-O posisi percakapan per pelanggan. Hanya ditulis node Context; dibaca Router, Agent, atau Ekstrak yang merujuknya lewat kunci `context_memory` sebagai `input.context`. Maksimal satu per profil; tidak punya edge.',
    keys: 'Tidak ada kunci khusus.',
    ports: 'tidak ada',
    outputs: '`context` (hanya untuk node yang `context_memory`-nya menunjuk node ini).',
  },
  router: {
    name: 'Router',
    purpose: 'AI memilih satu cabang atau mengarahkan setiap tugas hasil Ekstrak ke Agent yang sesuai.',
    keys: '`branches`: minimal 2 `{ "id", "label", "description" }`; `description` menjelaskan kapan cabang dipilih. `prompt`: instruksi pemilihan. `tier` biasanya `cheap` atau `decision`. `context_memory`: Memori konteks agar Router menerima ringkasan S-P-O (`input.context`); `memory` (riwayat) opsional. `routing_mode: "tasks"` mengaktifkan antrean; `tasks_source` wajib ID Ekstrak mode tugas yang sudah berjalan; `max_attempts` 1–3 (bawaan 3) per tugas. Cabang harus langsung ke Agent. Agent selesai otomatis kembali ke antrean, lalu port `done` menuju Agent penggabung. Pengecualian Agent disimpan per tugas, bukan global.',
    ports:
      'satu port per `branches[].id`; tambahan `done` (Selesai) pada mode tugas. ID done tidak boleh dipakai cabang.',
    outputs:
      '`branch`, `fallback_terkait`; mode tugas: `tasks` dan `results` berisi id, task, context, status (pending/completed/unresolved), attempts, exclusions [{agent,reason}], answer, agent.',
  },
  agent: {
    name: 'Agent',
    purpose: 'AI menyusun jawaban untuk pelanggan.',
    keys: '`prompt` wajib: tugas node ini, data yang dipakai, dan batasannya. Jangan menulis gaya bahasa, nama asisten, atau sapaan; itu diatur klien di Perilaku AI. `tier`, `memory`. `return_to_router: true` mengizinkan Agent tugas mengembalikan JSON `{"return_to_router":"alasan"}` saat di luar kemampuan. Tidak perlu edge balik (graf tetap tanpa siklus). Jangan mengembalikan tugas sesudah tool berhasil menulis. Agent penggabung tetap node Agent biasa: prompt membaca `{{nodes.<router>.results}}`, merangkum completed dan menjelaskan unresolved tanpa mengarang. Hubungkan port done Router serta next Agent tugas ke Agent penggabung; penggabung hanya dijalankan sekali. `tools`: daftar id node Data yang boleh dipanggil Agent. `fallback: true` menambah port `fallback` agar AI bisa meneruskan ke tim bila tidak bisa menjawab.',
    ports: '`next`; ditambah `fallback` bila `fallback: true`',
    outputs: '`answer`, `fallback`, `question`',
  },
  condition: {
    name: 'Kondisi',
    purpose: 'Cabang ya/tidak dari nilai variabel, tanpa AI.',
    keys: '`match`: `all` atau `any`. `rules`: daftar `{ "field", "operator", "compare" }` atau grup `{ "match", "rules": [...] }`. `field` adalah path variabel TANPA kurung kurawal (misalnya `nodes.isian.tanggal`, `system.weekday`); `compare` boleh berisi `{{variabel}}`.',
    ports: '`yes`, `no`',
    outputs: '`matched`',
  },
  data_table: {
    name: 'Data tabel',
    purpose:
      'Membaca atau menulis koleksi tabel (`kind` `list`). Dua cara pakai: (1) di alur, dengan edge masuk dan keluar, nilainya boleh berisi variabel; (2) dipanggil Agent: id-nya masuk `tools` Agent dan node ini TIDAK punya edge sama sekali, Agent yang mengisi kata kunci, filter tambahan, atau data. Nama lama `tool` masih diterima saat impor.',
    keys:
      '`collection` (id koleksi tabel), `operation`, `filters` (`[{ "field", "operator", "value" }]`), `match`, `query` (kata kunci untuk search/count; id record untuk get/delete), `sort_field` (id field atau `created_at`), `sort_direction` (`asc`/`desc`), `limit` 1–' +
      maxToolLimit +
      ', `sum_field` (count, field angka), `value` (string JSON: create `{"data":{...}}`, update `{"id":"…","data":{...}}`).',
    ports: 'search/get: `found`, `empty`; operasi lain: `next`. Tanpa port bila hanya dipanggil Agent.',
    outputs:
      'search/get: ' +
      recordOutputs.search.map(x => '`' + x + '`').join(', ') +
      ' (`first.id`, `first.data.<field>`); count: `count`, `total`; create/update: `id`, `data`, `revision`; delete: `id`, `deleted`',
  },
  data_text: {
    name: 'Data teks',
    purpose:
      'Membaca koleksi teks (`kind` `text`: SOP, syarat, FAQ bebas, profil usaha). Dengan kata kunci hanya paragraf yang memuatnya yang dikirim, jadi hemat untuk teks panjang. Bisa di alur atau dipanggil Agent seperti Data tabel.',
    keys:
      '`collection` (id koleksi teks), `query` (kata kunci opsional, misalnya `{{input.message}}`), `max_chars` 200–' +
      maxCollectionText +
      ' (bawaan ' +
      defaultTextChars +
      ').',
    ports: '`next`',
    outputs: '`text`, `found`',
  },
  data_form: {
    name: 'Data isian',
    purpose:
      'Membaca atau mengubah koleksi isian (`kind` `form`): satu formulir berfield tetap per akun, misalnya alamat, jam buka, nomor rekening.',
    keys: '`collection` (id koleksi isian), `operation`: `get` (baca) atau `update` (ubah, `value` string JSON `{"data":{...}}`).',
    ports: '`next`',
    outputs: '`data` (`data.<field>`), `found`',
  },
  context: {
    name: 'Context',
    purpose:
      "Meringkas posisi percakapan setelah Agent menjawab menjadi ringkasan Subjek-Predikat-Objek dua kalimat (misalnya `Pelanggan menanyakan biaya Ma'had Aly. AI menjelaskan biaya pendaftaran dan SPP.`) dari pesan terakhir pelanggan dan jawaban AI; dibaca Router pada pesan berikutnya sebagai `input.context`. Instruksinya ditanam di sistem dan sudah diuji, jadi node ini tidak punya prompt.",
    keys: '`tier` (umumnya `cheap`) dan `context_memory` (tempat ringkasan ditulis, wajib bila profil punya Memori konteks). Jangan menulis `prompt`, `context_format`, atau `memory`: diabaikan.',
    ports: '`next`',
    outputs: '`context`',
  },
  output: {
    name: 'Output',
    purpose: 'Mengirim jawaban ke pelanggan dan mengakhiri alur.',
    keys: '`value`: teks jawaban, biasanya `{{nodes.<agent>.answer}}`; kosong berarti jawaban Agent terakhir.',
    ports: 'tidak ada',
    outputs: '—',
  },
  fallback: {
    name: 'Fallback',
    purpose: 'Meneruskan percakapan ke tim manusia dan mengakhiri alur; nomor tim diatur tiap akun.',
    keys: '`value`: pesan untuk petugas; kosong berarti pertanyaan pelanggan.',
    ports: 'tidak ada',
    outputs: '—',
  },
  extract: {
    name: 'Ekstrak',
    purpose: 'AI mengubah kalimat pelanggan menjadi isian terstruktur (misalnya nama, tanggal, jumlah).',
    keys: '`fields`: `[{ "id", "label", "type", "required", "hint", "options" }]` dengan tipe Ekstrak; `prompt` opsional; `tier` umumnya `structured`; `memory` opsional agar kalimat sebelumnya ikut dibaca. `extract_mode: "tasks"` menghasilkan beberapa tugas beserta konteks, tanpa fields wajib; `max_tasks` 1–5 (bawaan 5). Model mengembalikan `{"tasks":[{"task":"permintaan","context":"konteks"}]}`; server menambahkan ID task_1 dan seterusnya. Mode bawaan fields mempertahankan perilaku lama.',
    ports: '`next`',
    outputs: 'Mode fields: setiap `fields[].id` dan `missing`; mode tasks: `tasks` berupa daftar `{id,task,context}`.',
  },
  compute: {
    name: 'Set / Hitung',
    purpose: 'Mengolah nilai dengan operasi pasti, tanpa AI dan tanpa rumus bebas.',
    keys: '`steps`: `[{ "name", "op", "args" }]` dijalankan berurutan; langkah berikutnya boleh memakai `{{nodes.<id>.<name>}}` dari langkah sebelumnya.',
    ports: '`next`',
    outputs: 'setiap `steps[].name`',
  },
  media: {
    name: 'Kirim media',
    purpose: 'Mengirim gambar atau dokumen ke pelanggan bersama jawaban.',
    keys: '`value`: variabel field File (misalnya `{{nodes.cari.first.data.brosur}}`) atau URL HTTPS, boleh beberapa; `caption`; `send_when`: `before`/`after`; `media_as`: `auto`/`image`/`document`. Maksimal 3 file per balasan dan tidak dikirim bila diteruskan ke tim. Kanal tujuan mengikuti sesi secara otomatis. Instagram resmi mengirim caption sebagai pesan teks terpisah setelah gambar berhasil (1 kredit pesan tambahan), dan WebP statis dikonversi ke JPEG tanpa mengubah sumber. Batas sumber dan hasil 8 MB. Dokumen, audio, video, serta WebP animasi belum didukung konektor resmi.',
    ports: '`next`',
    outputs: '`files`, `count`, `skipped`',
  },
  receive: {
    name: 'Terima media',
    purpose:
      'Menerima lampiran pelanggan (misalnya bukti transfer) sebagai file data profil. Pesan gambar/dokumen hanya diproses profil yang punya node ini; isi gambar tidak dibaca AI.',
    keys: '`accept`: `["image"]`, `["document"]`, atau keduanya. Simpan ke record lewat node Data, misalnya `{"data":{"bukti":"{{nodes.<id>.file}}"}}`.',
    ports: '`received`, `none`',
    outputs: '`file`, `filename`, `type`, `mimetype`, `caption`',
  },
  file_json: {
    name: 'Buat file JSON',
    purpose: 'Membuat file .json dari template dan variabel alur, tanpa AI dan tanpa kredit.',
    keys: '`filename`: nama file, boleh variabel (ekstensi .json dipasang otomatis). `value`: template JSON yang valid; variabel ditulis di dalam tanda kutip. String yang hanya berisi satu variabel menjadi nilai aslinya, misalnya `{"judul": "{{nodes.penulis.answer}}", "produk": "{{nodes.cari.records}}"}`. Maksimal 1 MB.',
    ports: '`next`',
    outputs: '`file` (ID file), `filename`, `size`',
  },
  file_md: {
    name: 'Buat file Markdown',
    purpose: 'Membuat file .md (teks berformat) dari template dan variabel alur, tanpa AI dan tanpa kredit.',
    keys: '`filename`: nama file, boleh variabel (ekstensi .md dipasang otomatis). `value`: isi Markdown dengan `{{variabel}}`, misalnya `# {{nodes.isian.judul}}\\n\\n{{nodes.penulis.answer}}`. Maksimal 1 MB.',
    ports: '`next`',
    outputs: '`file` (ID file), `filename`, `size`',
  },
};
const kindDocs: Record<CollectionKind, string> = {
  list: 'tabel banyak baris berfield (produk, jadwal, booking)',
  text: 'satu teks panjang, maksimal ' + maxCollectionText.toLocaleString('id-ID') + ' karakter',
  form: 'satu formulir berfield tetap (alamat, jam buka, rekening)',
};
const kindNode: Record<CollectionKind, string> = { list: 'data_table', text: 'data_text', form: 'data_form' };
const tierDocs: Record<ModelTier, string> = {
  cheap: 'Murah: tugas ringan seperti Router sederhana dan Context.',
  medium: 'Sedang: bawaan untuk Agent.',
  smart: 'Cerdas: penalaran berat; lebih mahal, pakai seperlunya.',
  structured: 'Terstruktur: keluaran JSON ketat; disarankan untuk Ekstrak.',
  decision: 'Keputusan: khusus Router.',
};
const fieldDocs: Record<FieldType, string> = {
  text: 'teks',
  number: 'angka (JSON number)',
  boolean: '`true`/`false`',
  date: '`YYYY-MM-DD`',
  time: '`JJ:MM`',
  datetime: '`YYYY-MM-DDTJJ:MM`',
  choice: 'salah satu `options` (wajib punya `options`)',
  multichoice: 'daftar dari `options` (wajib punya `options`)',
  phone: 'nomor telepon; disimpan sebagai digit berawalan 62',
  relation: 'id record koleksi lain; isi `collection` dengan id koleksi tujuan',
  file: 'file unggahan (gambar/dokumen); diisi dari dashboard atau node Terima media',
};
const toolDocs: Record<ToolOperation, string> = {
  search: 'Cari record (filter + kata kunci `query`, urutan, batas).',
  get: 'Ambil satu record berdasarkan id di `query`.',
  create: 'Buat record dari `value` `{"data":{...}}`; field kosong memakai nilai bawaan.',
  update: 'Ubah field yang dikirim di `value` `{"id":"…","data":{...}}`; `null` mengosongkan field.',
  delete: 'Hapus record berdasarkan id di `query`.',
  count: 'Hitung record yang cocok; `sum_field` menjumlahkan field angka ke `total`.',
};
const conditionDocs: Record<ConditionOperator, string> = {
  equals: 'sama dengan (tanpa beda huruf besar/kecil; angka dibandingkan sebagai angka)',
  not_equals: 'tidak sama dengan',
  contains: 'mengandung teks',
  not_contains: 'tidak mengandung teks',
  exists: 'terisi (tanpa `compare`)',
  empty: 'kosong (tanpa `compare`)',
  greater: 'lebih besar (angka)',
  less: 'lebih kecil (angka)',
  date_before: 'tanggal sebelum `compare` (`YYYY-MM-DD` atau `{{system.today}}`)',
  date_on_or_after: 'tanggal sama atau setelah `compare`',
  weekday_is: 'hari adalah salah satu dari `compare`, misalnya `Senin, Selasa`',
  time_between: 'jam di rentang `compare`, misalnya `08.00-16.00` (boleh melewati tengah malam)',
  one_of: 'salah satu dari daftar `compare` yang dipisah koma',
  count_greater: 'jumlah item daftar lebih dari `compare`',
};
const filterDocs: Record<FilterOperator, string> = {
  equals: 'sama dengan',
  not_equals: 'tidak sama dengan',
  contains: 'mengandung',
  not_contains: 'tidak mengandung',
  greater: 'lebih besar dari',
  greater_equal: 'lebih besar atau sama dengan',
  less: 'lebih kecil dari',
  less_equal: 'lebih kecil atau sama dengan',
  exists: 'terisi',
  empty: 'kosong',
};
const computeDocs: Record<ComputeOp, string> = {
  value: 'ambil nilai apa adanya: [nilai]',
  add: 'tambah: [angka, penambah]',
  subtract: 'kurang: [angka, pengurang]',
  multiply: 'kali: [angka, pengali]',
  divide: 'bagi: [angka, pembagi]; pembagi 0 menghentikan alur',
  round: 'bulatkan: [angka, jumlah desimal 0–6]',
  format_rupiah: 'format rupiah, misalnya Rp150.000: [angka]',
  concat: 'gabung teks dari templat: [templat berisi {{variabel}}]',
  truncate: 'potong teks: [teks, maksimal karakter]',
  add_days: 'tambah hari: [tanggal YYYY-MM-DD, jumlah hari (boleh negatif)]',
  days_between: 'selisih hari: [dari tanggal, sampai tanggal]',
  format_date: 'format tanggal Indonesia, misalnya 27 September 2026: [tanggal]',
  length: 'jumlah item daftar atau karakter teks: [daftar atau teks]',
  item_at: 'ambil item ke-n (mulai 1): [daftar, urutan]',
};
const variableDocs: Record<string, string> = {
  'system.today': 'tanggal hari ini (WIB, YYYY-MM-DD)',
  'system.tomorrow': 'tanggal besok (WIB)',
  'system.now': 'tanggal-jam sekarang (WIB)',
  'system.time': 'jam sekarang (WIB, JJ:MM)',
  'system.weekday': 'nama hari ini dalam bahasa Indonesia',
  'customer.phone': 'identitas pelanggan dari sesi: nomor WhatsApp atau ID pengguna Instagram',
  'customer.name': 'nama pelanggan dari kanal sesi',
  'service.name': 'nama data profil (nama usaha/layanan akun)',
};
export const contextVariablePaths = Object.entries(contextVariables).flatMap(([root, keys]) =>
  keys.map(key => root + '.' + key),
);
const code = (values: readonly string[]) => values.map(v => '`' + v + '`').join(', ');
// Contoh lengkap pola S-P-O: Router (memori konteks) → Informasi / Layanan / Sapaan / Penutup → Context S-P-O → Jawaban;
// Layanan boleh meneruskan ke Tim. Diuji lolos validasi dan dijalankan dengan model tiruan di builder-skill.test.ts.
export const spoExampleFile = 'examples/cs-spo.json';
export function spoExample(): GraphDefinition {
  const d = blankDefinition('CS dengan konteks S-P-O');
  d.description =
    'Menjawab info produk, mencatat pesanan, dan meneruskan ke tim; Router memahami balasan pendek lewat S-P-O.';
  // Contoh tanpa posisi: editor menyusun tampilan dengan Rapikan.
  const { x: _x, y: _y, ...base } = d.nodes[1];
  const node = (id: string, label: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode => ({
    ...base,
    id,
    label,
    type,
    prompt: '',
    tools: [],
    branches: [],
    value: '',
    query: '',
    ...extra,
  });
  d.collections = [
    {
      id: 'produk',
      name: 'Produk',
      owner: 'shared',
      fields: [
        { id: 'nama', label: 'Nama', type: 'text', required: true, options: [], collection: '' },
        { id: 'harga', label: 'Harga', type: 'number', required: false, options: [], collection: '' },
        { id: 'deskripsi', label: 'Deskripsi', type: 'text', required: false, options: [], collection: '' },
      ],
    },
    {
      id: 'pesanan',
      name: 'Pesanan',
      owner: 'customer',
      fields: [
        { id: 'produk', label: 'Produk', type: 'relation', required: true, options: [], collection: 'produk' },
        { id: 'jumlah', label: 'Jumlah', type: 'number', required: true, options: [], collection: '' },
        { id: 'catatan', label: 'Catatan', type: 'text', required: false, options: [], collection: '' },
        {
          id: 'status',
          label: 'Status',
          type: 'choice',
          required: true,
          options: ['baru', 'diproses', 'selesai'],
          collection: '',
          default: 'baru',
        },
      ],
    },
  ];
  d.collections.push({ id: 'sop', name: 'SOP', owner: 'shared', kind: 'text', fields: [] });
  // Router dan Agent membaca memori konteks; Layanan juga membaca riwayat; hanya Context menulis konteks (dari pesan terakhir).
  const memory = { memory: 'memori_percakapan' },
    contextMemory = { context_memory: 'memori_konteks' };
  d.nodes = [
    node('pesan_masuk', 'Pesan_masuk', 'input'),
    node('memori_percakapan', 'Memori_percakapan', 'memory', { memory_limit: 20 }),
    node('memori_konteks', 'Memori_konteks', 'context_memory'),
    node('maksud', 'Maksud', 'router', {
      ...contextMemory,
      tier: 'cheap',
      prompt:
        'Pilih cabang dari maksud pesan terbaru. input.context adalah ringkasan S-P-O posisi percakapan sebelumnya: pakai untuk memahami balasan pendek seperti "ya", "1 aja", atau "lanjut". Bila ragu antara informasi dan layanan saat pelanggan sedang memesan, pilih layanan.',
      branches: [
        {
          id: 'informasi',
          label: 'Informasi',
          description: 'Pertanyaan produk, harga, stok, atau cara pemesanan tanpa niat memesan sekarang.',
        },
        {
          id: 'layanan',
          label: 'Layanan',
          description:
            'Memesan, melanjutkan atau mengonfirmasi pesanan, menanyakan status pesanan, atau menyampaikan keluhan.',
        },
        {
          id: 'sapaan',
          label: 'Sapaan',
          description: 'Salam pembuka seperti halo atau assalamualaikum tanpa pertanyaan.',
        },
        {
          id: 'penutup',
          label: 'Penutup',
          description: 'Terima kasih, oke, atau pamit tanpa pertanyaan baru.',
        },
      ],
    }),
    node('informasi', 'Informasi', 'agent', {
      ...contextMemory,
      tools: ['cari_produk'],
      prompt:
        'Jawab pertanyaan tentang produk. Cari data dengan Cari_produk; jangan mengarang harga atau stok. Bila pelanggan tertarik, tawarkan untuk memesan.',
    }),
    node('layanan', 'Layanan', 'agent', {
      ...memory,
      ...contextMemory,
      fallback: true,
      tools: ['cari_produk', 'catat_pesanan', 'baca_sop'],
      prompt:
        'Urus pesanan pelanggan. Ikuti aturan di Baca_SOP (pembayaran, jam, keluhan). Pastikan produk dan jumlah jelas, konfirmasi ke pelanggan, lalu simpan dengan Catat_pesanan. Keluhan atau permintaan di luar kemampuanmu diteruskan ke tim lewat fallback.',
    }),
    node('sapaan', 'Sapaan', 'agent', {
      ...contextMemory,
      tier: 'cheap',
      prompt: 'Balas salam pelanggan, lalu tawarkan bantuan.',
    }),
    node('penutup', 'Penutup', 'agent', {
      ...contextMemory,
      tier: 'cheap',
      prompt:
        'Tutup percakapan dengan satu kalimat singkat. Jangan bertanya, jangan menawarkan bantuan atau produk lain, agar percakapan selesai di sini.',
    }),
    node('cari_produk', 'Cari_produk', 'data_table', { collection: 'produk', operation: 'search', limit: 5 }),
    node('catat_pesanan', 'Catat_pesanan', 'data_table', {
      collection: 'pesanan',
      operation: 'create',
      value: '{"data":{}}',
    }),
    node('baca_sop', 'Baca_SOP', 'data_text', { collection: 'sop', operation: 'get', max_chars: 3000 }),
    node('ringkas_konteks', 'Ringkas_konteks', 'context', {
      ...contextMemory,
      tier: 'cheap',
    }),
    node('jawaban', 'Jawaban', 'output'),
    node('tim', 'Tim', 'fallback'),
  ];
  const edge = (source: string, port: string, target: string) => ({ id: source + '_' + port, source, port, target });
  d.edges = [
    edge('pesan_masuk', 'next', 'maksud'),
    edge('maksud', 'informasi', 'informasi'),
    edge('maksud', 'layanan', 'layanan'),
    edge('maksud', 'sapaan', 'sapaan'),
    edge('informasi', 'next', 'ringkas_konteks'),
    edge('layanan', 'next', 'ringkas_konteks'),
    edge('layanan', 'fallback', 'tim'),
    edge('sapaan', 'next', 'ringkas_konteks'),
    edge('maksud', 'penutup', 'penutup'),
    edge('penutup', 'next', 'ringkas_konteks'),
    edge('ringkas_konteks', 'next', 'jawaban'),
  ];
  return d;
}
// Contoh mode tugas memakai cabang dan tool yang sama dengan contoh S-P-O, ditambah Ekstrak dan Agent penggabung.
export const tasksGuideFile = 'reference/task-routing.md';
export const tasksExampleFile = 'examples/cs-multi-tugas.json';
export function tasksExample(): GraphDefinition {
  const d = spoExample();
  d.name = 'CS beberapa tugas';
  d.description = 'Memisahkan permintaan, mencoba Agent lain bila tidak sesuai, lalu menggabungkan hasil.';
  const router = d.nodes.find(n => n.id === 'maksud')!;
  Object.assign(router, {
    routing_mode: 'tasks',
    tasks_source: 'ekstrak_tugas',
    max_attempts: 2,
    prompt:
      'Pilih Agent yang sesuai untuk input.task.task dan input.task.context. Perhatikan alasan exclusions. Pesan asli hanya konteks.',
  });
  d.nodes.push({
    ...d.nodes.find(n => n.id === 'informasi')!,
    id: 'ekstrak_tugas',
    label: 'Ekstrak_tugas',
    type: 'extract',
    tools: [],
    tier: 'structured',
    extract_mode: 'tasks',
    max_tasks: 3,
    memory: 'memori_percakapan',
    prompt:
      'Pisahkan permintaan yang berbeda, sertakan konteks produk/pesanan dari riwayat. Salam atau terima kasih yang menyertai permintaan cukup menjadi konteks, jangan tugas tambahan.',
  });
  const workers = ['informasi', 'layanan', 'sapaan', 'penutup'];
  for (const n of d.nodes.filter(n => workers.includes(n.id))) {
    n.return_to_router = true;
    n.prompt =
      'Kerjakan hanya tugas aktif dalam input.task. Bila tugas di luar kemampuan, kembalikan ke Router dengan alasan sebelum menulis data. ' +
      n.prompt;
  }
  d.nodes.push({
    ...d.nodes.find(n => n.id === 'informasi')!,
    id: 'gabungkan',
    label: 'Gabungkan',
    tools: [],
    return_to_router: false,
    prompt:
      'Gabungkan {{nodes.maksud.results}} menjadi satu jawaban runtut sesuai urutan tugas. Gunakan answer dari completed tanpa pengulangan; jelaskan unresolved dan informasi yang masih dibutuhkan tanpa mengarang hasil. Alasan exclusions adalah data internal, jangan menampilkan nama Agent atau jumlah percobaan kepada pelanggan. Untuk salam/penutup saja, jangan menambah pertanyaan atau penawaran.',
  });
  d.edges.find(e => e.source === 'pesan_masuk')!.target = 'ekstrak_tugas';
  for (const e of d.edges) if (workers.includes(e.source) && e.port === 'next') e.target = 'gabungkan';
  d.edges.push(
    { id: 'ekstrak_tugas_next', source: 'ekstrak_tugas', port: 'next', target: 'maksud' },
    { id: 'maksud_done', source: 'maksud', port: 'done', target: 'gabungkan' },
    { id: 'gabungkan_next', source: 'gabungkan', port: 'next', target: 'ringkas_konteks' },
  );
  return d;
}
function tasksMarkdown() {
  return `# Ekstrak tugas, Router, dan penggabung jawaban

Ini adalah mode tambahan pada node yang sudah ada, bukan jenis node baru. Jangan membuat tipe task_extractor, loop, return, merger, atau router khusus platform.

## Memilih pola

- Permintaan sederhana: Agent biasa, atau Router mode single untuk satu maksud utama.
- Pesan dengan beberapa permintaan berbeda yang harus dijawab bersama: Ekstrak mode tasks → Router mode tasks → Agent per cabang → Agent penggabung → Context → Output.
- Jangan mengubah profil lama menjadi mode tugas kecuali dibutuhkan permintaan pemilik. Ekstrak tanpa extract_mode tetap field; Router tanpa routing_mode tetap satu cabang.

## Kontrak dan sambungan

1. Ekstrak: \`extract_mode: "tasks"\`, \`max_tasks\` 1–${limits.tasks} (bawaan ${limits.tasks}); fields tidak wajib. Keluaran \`tasks: [{id,task,context}]\`; ID ditambahkan server. Jangan minta model membuat node atau edge untuk setiap tugas. Ekstrak dapat membaca memory dan context_memory yang tersambung.
2. Router: \`routing_mode: "tasks"\`, \`tasks_source: "ekstrak_tugas"\` (ID node, bukan template/path variabel), \`max_attempts\` 1–${limits.taskAttempts} termasuk penugasan pertama. Ekstrak harus tersedia pada semua jalur masuk Router. Tetap minimal dua branches; setiap cabang langsung menuju Agent. ID cabang done dicadangkan.
3. Agent pekerja membaca \`input.task.task\` dan \`input.task.context\`; \`input.message\` tetap pesan asli. Set \`return_to_router: true\` bila boleh menolak tugas di luar kemampuan. Jawab \`{"return_to_router":"alasan"}\` sebelum ada tool yang berhasil menulis. Ini respons Agent saat runtime, bukan JSON definisi profil.
4. Router mengembalikan tugas ke antreannya secara internal dan mengecualikan Agent yang menolak hanya untuk tugas itu. Jangan membuat edge Agent → Router atau port return_to_router; graf tetap tanpa siklus. Agent bisa menerima tugas lain. Tugas diproses berurutan, bukan paralel.
5. Hubungkan \`done\` Router dan \`next\` semua Agent pekerja ke Agent penggabung. Saat menjadi pekerja antrean, next tidak dijalankan per tugas; runtime mengumpulkan jawaban terlebih dahulu. Port done berjalan sekali setelah semua tugas selesai/dihentikan oleh batas per tugas, termasuk daftar kosong.
6. Penggabung adalah \`type: "agent"\` biasa, tanpa tools bila hanya merangkum. Prompt membaca \`{{nodes.maksud.results}}\` (ganti maksud dengan ID Router). Jangan menggabungkan \`nodes.<agent>.answer\` dari masing-masing cabang: tidak semua Agent pasti dijalankan dan Agent yang sama dapat menangani beberapa tugas.
7. Context berada setelah penggabung agar ringkasan S-P-O memakai jawaban gabungan; selanjutnya Output. Jalur fallback yang sudah ada tetap menuju Fallback dan mengakhiri alur, bukan mengembalikan tugas ke antrean.

## Hasil dan batas

Setiap hasil memiliki id, task, context, status, attempts, exclusions [{agent,reason}], answer, agent. Status akhir completed atau unresolved. Penggabung menggunakan answer yang selesai dan menjelaskan kebutuhan informasi tugas unresolved; jangan mengarang keberhasilan atau memperlihatkan detail routing internal. Pengecualian/percobaan berlaku satu eksekusi pesan, bukan memori permanen.

Antrean kosong tetap menuju done; penggabung boleh meminta penjelasan. Bila batas per tugas tercapai atau seluruh Agent sudah menolak, lanjutkan tugas berikutnya dengan status unresolved. Batas global ${runtimeLimits.modelCalls} panggilan model, ${runtimeLimits.steps} langkah, dan ${runtimeLimits.seconds} detik tetap berlaku; batas global dapat menghentikan seluruh alur. Hitung biaya Ekstrak + Router/Agent setiap percobaan + penggabung + Context + panggilan tool. Tidak semua kombinasi batas tugas/percobaan dapat mencapai maksimum sekaligus.

## Media dan tool pada alur tugas

Agent.tools hanya menerima ID node Data yang memang didukung, bukan Router, Ekstrak, Kirim media, atau Agent penggabung. Jangan menaruh Kirim media di antara cabang Router tugas dan Agent. Tempatkan node media pada jalur nyata yang dijalankan setelah done/penggabung, dengan sumber file dari node Data yang pasti tersedia pada jalur itu. Pengembalian ke Router bukan mekanisme retry kirim media.

Gunakan satu node media untuk WhatsApp/Instagram: tujuan ditentukan sesi saat kirim, bukan input model. WhatsApp/Zernio memakai caption inline; Instagram resmi mengirim caption sebagai teks terpisah sesudah gambar berhasil (satu kredit pesan tambahan). send_when menentukan posisi gambar beserta caption terhadap jawaban. WebP statis dikonversi ke JPEG; JPEG/PNG dipertahankan, sumber/hasil maksimal 8 MB. Jangan mengarang node platform, URL sementara Meta, atau dukungan video/dokumen Instagram resmi. Mode auto cocok untuk field File/gambar dan URL berakhiran gambar; gunakan media_as image bila URL gambar tidak memiliki ekstensi. Simulasi tidak mengirim melalui kanal nyata.

Contoh lengkap yang dapat diimpor: [CS beberapa tugas](../${tasksExampleFile}). Contoh ini mempertahankan tool koleksi, Sapaan/Penutup, fallback, dan memori konteks dari pola satu cabang.
`;
}
const table = (head: string[], rows: string[][]) =>
  [
    '| ' + head.join(' | ') + ' |',
    '|' + head.map(() => ' --- |').join(''),
    ...rows.map(r => '| ' + r.join(' | ') + ' |'),
  ].join('\n');

function skillMarkdown() {
  return `---
name: ${skillName}
description: Menyusun dan mengubah profil AI NC-WA untuk WhatsApp/Instagram dalam format JSON ncwa-profile versi 1 (Router, Agent, Data, Kondisi, Ekstrak, routing beberapa tugas, penggabungan jawaban, dan media sesuai kanal, beserta koleksi data) untuk diimpor di Editor profil NC-WA. Gunakan saat pengguna ingin membuat, merancang, memperbaiki, atau mengubah profil atau alur AI NC-WA, atau menyebut JSON ncwa-profile.
---

# Profil AI NC-WA

Profil AI NC-WA adalah graf yang menjawab pelanggan WhatsApp atau Instagram sesuai sesi tujuan. Pesan masuk lewat node Input, diproses node (AI, logika, data, media), lalu berakhir di Output (jawaban) atau Fallback (diteruskan ke tim manusia). Profil juga mendefinisikan **koleksi**: struktur data (misalnya Produk, Booking) yang isinya diisi tiap akun di dashboard, lalu dibaca atau ditulis node Data.

Hasil kerja skill ini adalah satu JSON \`ncwa-profile\` yang diimpor pemilik di **Profil AI → Buat profil → Impor JSON / Tempel JSON**. Profil hasil impor selalu berupa draft baru; pemilik mengujinya lalu menerbitkannya sendiri.

## Tujuan profil

Profil yang baik:

1. **Benar**: menjawab dari data klien, tidak mengarang harga, stok, atau jadwal.
2. **Paham konteks**: mengerti balasan pendek ("ya", "1 aja") sesuai posisi percakapan.
3. **Hemat**: sesedikit mungkin panggilan AI, tier, dan riwayat per pesan.
4. **Tahu batas**: meneruskan ke tim daripada menjawab salah.
5. **Bisa dipakai banyak klien**: isi data dan gaya bahasa diatur tiap klien, bukan ditulis di profil.

Ukur setiap keputusan rancangan dengan lima hal ini. Setiap node harus punya alasan ada; bila dihapus hasilnya sama, hapus.

## Kenapa polanya begini

- **Multi-agent (Router → beberapa Agent)**: setiap Agent punya prompt pendek dan fokus serta hanya tool yang relevan, sehingga lebih akurat, lebih murah, dan tidak salah memakai tool. Bila usaha sederhana (1–2 jenis pertanyaan), satu Agent tanpa Router sudah cukup; jangan memecah tanpa alasan.
- **Agent Sapaan dan Penutup wajib ada bila ada Router**: salam ("assalamualaikum", "halo") dan penutup ("makasih", "oke kak") tidak butuh data apa pun, cukup Perilaku AI klien. Beri cabang sendiri dengan Agent \`cheap\` tanpa tool dan tanpa riwayat, sehingga pesan seperti ini tidak memicu pencarian data atau Agent mahal dan tokennya hemat. Prompt-nya cukup satu kalimat tugas; gaya salamnya diatur klien. **Penutup tidak boleh bertanya atau menawarkan apa pun** ("ada yang lain lagi?", "mau lihat produk lain?"): pertanyaan membuat pelanggan membalas "tidak ada kak", lalu dibalas lagi, dan percakapan berputar tanpa ujung.
- **Konteks S-P-O**: Router tetap paham balasan pendek tanpa membaca seluruh riwayat, sehingga murah, cepat, dan tidak terganggu obrolan lama.
- **Dua memori**: memori konteks untuk arah percakapan, riwayat untuk detail. Pasang riwayat hanya pada node yang butuh detail (misalnya Agent yang mencatat pesanan), karena setiap riwayat menambah biaya.
- **Tier model**: \`cheap\` untuk memilah dan meringkas (Router, Context, Sapaan, Penutup); tier lebih tinggi hanya untuk Agent yang menangani hal rumit.
- **Node data**: jawaban diambil dari koleksi, sehingga tidak ada data karangan dan klien cukup memperbarui datanya tanpa mengubah profil.
- **Fallback**: meneruskan ke tim lebih baik daripada menjawab salah; pasang pada Agent yang menangani hal di luar data (keluhan, pengecualian, pembayaran bermasalah).
- **Terima media**: pasang bila bisnisnya menerima file dari pelanggan (bukti transfer, berkas pendaftaran, foto kerusakan untuk klaim). **Tanpa node ini, pesan gambar dan dokumen pelanggan tidak diproses sama sekali.** Isi gambar tidak dibaca AI: node ini untuk menyimpan berkas lewat node Data, pemeriksaan isinya tetap oleh tim.
- **Buat file (JSON, Markdown)**: pasang bila hasil alur perlu menjadi file, misalnya Agent penulis artikel yang hasilnya dijadikan .md, atau data pesanan yang diekspor sebagai .json. Isi file dibentuk dari variabel (biasanya jawaban Agent atau hasil node Data), jadi AI cukup menulis isinya sekali. Hasilnya (\`{{nodes.<id>.file}}\`) dikirim lewat Kirim media atau disimpan ke field File koleksi lewat node Data; file yang tidak disimpan ke record terhapus setelah sehari.
- **Kirim media**: pasang bila file menjawab lebih baik dari teks (brosur, daftar harga, foto produk, denah, formulir). Simpan file di field File koleksi agar klien bisa menggantinya sendiri; URL tetap hanya untuk file umum. Kirim hanya di jalur yang memang meminta atau menawarkan file, bukan di setiap jawaban.

### Pengiriman gambar ke Instagram resmi

- Profil untuk Instagram Login resmi boleh memakai node **Kirim media** untuk gambar JPG/PNG maksimal 8 MB per gambar. Gunakan \`media_as: "image"\`; file dapat berasal dari field File koleksi atau URL HTTPS.
- Node Kirim media otomatis mengikuti konektor sesi: caption menyatu pada WhatsApp; Instagram resmi mengirim gambar lalu caption sebagai teks terpisah. Setiap pesan memakai kredit sendiri. Atur \`send_when\` untuk menempatkan pasangan gambar/caption sebelum atau sesudah jawaban. Caption tidak dikirim bila gambar gagal atau hasil kirim belum pasti.
- WebP statis otomatis dikonversi ke JPEG (sumber dan hasil maksimal 8 MB); file sumber tetap utuh. Jangan mengirim PDF, dokumen, audio, video, atau WebP animasi melalui konektor Instagram resmi. Jika sumbernya hanya dokumen, berikan tautan publik yang memang boleh dibagikan dalam jawaban atau teruskan ke tim; jangan menjanjikan lampiran berhasil dikirim.
- Aplikasi menyiapkan URL gambar sementara yang berlaku 15 menit untuk diambil Meta. Jangan membuat URL tersebut dalam definisi profil atau membagikannya kepada pelanggan. Alamat publik aplikasi (APP_ORIGIN) harus dapat dijangkau Meta.
- Batas ini khusus konektor Instagram Login resmi, bukan batas semua kanal. Pastikan kanal tujuan saat merancang profil. Pengujian otomatis memakai Meta tiruan; jangan menyatakan pengiriman ke akun Instagram nyata sudah teruji.

## Alur kerja

1. Pahami kebutuhan dulu. Tanyakan bila belum jelas: jenis usaha, pertanyaan yang sering datang, data yang perlu dicari atau dicatat (menjadi koleksi), kapan harus diteruskan ke tim, apakah pelanggan perlu mengirim berkas, dan berkas apa yang sering diminta pelanggan (brosur, katalog, formulir). Gaya bahasa tidak perlu ditanyakan karena diatur tiap klien (lihat bagian Perilaku AI klien).
2. Jelaskan rancangan singkat dalam kata-kata (node, cabang, koleksi) sebelum menulis JSON yang panjang.
3. Tulis JSON lengkap mengikuti [referensi format](reference/format.md). Pilih [contoh S-P-O satu cabang](${spoExampleFile}) atau [contoh beberapa tugas](${tasksExampleFile}) sesuai kebutuhan. Baca [panduan routing tugas](${tasksGuideFile}) untuk mode tasks, pengembalian, penggabung, dan penempatan media. Sesuaikan cabang, prompt, serta koleksi dengan usaha pengguna.
4. Jalankan daftar periksa di bawah, lalu berikan JSON dalam satu blok \`\`\`json tanpa komentar.
5. Minta pemilik mengimpor dan menekan **Uji**. Bila editor menampilkan masalah, minta pemilik menempelkan pesannya lalu perbaiki JSON.

Untuk mengubah profil yang sudah ada, minta pemilik **Ekspor JSON** dari tab Pengaturan, ubah seperlunya dengan mempertahankan id yang tidak perlu berubah, lalu berikan JSON lengkap untuk diimpor sebagai draft baru.

## Perilaku AI klien

Setiap akun klien mengisi **Perilaku AI** di dashboard: gaya bahasa, nama asisten, sapaan, panjang jawaban, hal yang tidak boleh dikatakan. Sistem otomatis menambahkannya ke setiap node AI sebagai "Perilaku layanan", sehingga satu profil bisa dipakai banyak klien dengan gaya masing-masing.

- Prompt node berisi **apa yang dikerjakan** (tugas, data yang dipakai, kapan fallback), bukan **cara bicara**.
- Jangan menulis gaya bahasa, nada, nama asisten, persona ("Kamu CS …"), emoji, atau panjang jawaban di prompt. Prompt yang memuatnya akan bertabrakan dengan Perilaku AI klien.
- Bila pemilik menyebut gaya bahasa, sampaikan bahwa itu diisi di Perilaku AI pada dashboard, bukan di profil.

## Pola inti NC-WA: konteks S-P-O

Pelanggan sering membalas pendek ("ya", "1 aja", "yang itu", "lanjut"). Tanpa konteks, Router tidak tahu maksudnya. NC-WA menyelesaikannya dengan dua memori terpisah:

- **Memori percakapan** (\`type: "memory"\`): riwayat pesan. Hanya dibaca node lewat kunci \`memory\`; ditulis sistem.
- **Memori konteks** (\`type: "context_memory"\`, satu per profil): ringkasan S-P-O (Subjek-Predikat-Objek) posisi percakapan, misalnya \`Pelanggan menunggu konfirmasi pesanan.\`. **Hanya ditulis node Context**; dibaca node lain lewat kunci \`context_memory\` sebagai \`input.context\`.

Pakai pola ini untuk Router satu cabang. Untuk routing beberapa tugas, baca [panduan tugas](${tasksGuideFile}); tambahkan Ekstrak sebelum Router serta Agent penggabung sebelum Context:

\`\`\`
Input → Router (memori konteks) → Agent per cabang (memori konteks) → Context spo → Output
                                        └─ fallback → Fallback
Context: context_memory = memori konteks (ditulis); cukup pesan terakhir, tanpa riwayat
\`\`\`

- **Router: memori konteks + pesan terbaru.** Hubungkan Router hanya ke Memori konteks (\`context_memory\`), tidak ke Memori percakapan. Router cukup tahu posisi percakapan dan pesan terbaru untuk memilih cabang, sehingga hemat dan tidak terganggu riwayat panjang. Ringkasan sudah ada sejak pesan kedua; pesan pertama tidak membutuhkannya.
- **Agent** dihubungkan ke Memori konteks agar nyambung. Tambahkan Memori percakapan (\`memory\`) hanya bila Agent perlu detail dari pesan-pesan sebelumnya, misalnya produk dan jumlah yang sedang dipesan.
- **Context** menjadi satu-satunya penulis Memori konteks. **Semua jalur jawaban melewati Context** sebelum Output, supaya ringkasan selalu diperbarui. Jalur Fallback boleh langsung ke node Fallback.
- **Context tidak punya prompt**: instruksi ringkasannya ditanam di sistem (\`ubah percakapan jadi 1 konteks hanya SPO (subjek objek predikat jelas dan ekplisit) dalam dua kalimat singkat tanpa keterangan tambahan (beserta satu contoh)\`, dari pesan terakhir pelanggan dan jawaban AI). Cukup atur tier (\`cheap\` sudah cukup) dan sambungkan ke Memori konteks; bila ringkasan gagal dibuat, ringkasan lama dipertahankan tanpa menggagalkan balasan.
- **Rancang cabang berdasarkan tool, bukan nuansa.** Maksud yang memakai tool yang sama (misalnya memesan, konfirmasi, status pesanan, dan keluhan) digabung dalam satu cabang dan satu Agent. Router mudah tertukar di antara cabang yang hanya beda nuansa.
- Profil tanpa Router (satu Agent saja) tidak memerlukan Context S-P-O.

## Aturan utama

- Akar JSON: \`"format": "ncwa-profile"\`, \`"version": 1\`, \`name\`, \`description\`, \`collections\`, \`nodes\`, \`edges\`.
- ID (node, koleksi, field, cabang, edge, langkah): huruf kecil, angka, atau \`_\`, diawali huruf, maksimal ${limits.idLength} karakter, unik di lingkupnya.
- Nama node (\`label\`) unik dan tanpa spasi (pakai \`_\`). Untuk node baru, \`id\` dibentuk dari namanya dalam huruf kecil, misalnya label \`Cek_jadwal\` → id \`cek_jadwal\` → variabel \`{{nodes.cek_jadwal.first.data.jam}}\`. Saat mengubah profil, id node yang sudah ada boleh dipertahankan; editor menyamakan id dengan nama ketika nama diganti di sana.
- Tepat satu node \`input\`. Setiap port keluar punya tepat satu edge; node akhir (\`output\`, \`fallback\`) tidak punya port keluar. Tidak boleh ada siklus.
- Semua node harus terjangkau dari Input, kecuali \`memory\`, \`context_memory\`, dan node data yang hanya dipanggil Agent.
- Variabel ditulis \`{{path}}\` dan hanya boleh merujuk node yang pasti sudah berjalan di **setiap** jalur menuju node pemakai.
- Data bisnis (harga, jadwal, stok, alamat) disimpan di koleksi dan dicari dengan node Data; jangan ditulis permanen di prompt.
- Data per pelanggan (booking, pesanan, pendaftaran) memakai koleksi \`"owner": "customer"\`: AI hanya bisa membaca dan mengubah record milik pelanggan yang sedang chat.
- Jangan menulis posisi node (\`x\`/\`y\`): itu urusan tampilan, dan editor menyusunnya dengan **Rapikan**. Fokus pada isi profil (node, prompt, sambungan, koleksi).

## Daftar periksa sebelum menyerahkan JSON

- [ ] \`format\`, \`version\`, \`name\` terisi; JSON valid tanpa komentar atau koma berlebih.
- [ ] Semua id sesuai pola dan unik; nama node unik tanpa spasi; id node baru sama dengan namanya dalam huruf kecil.
- [ ] Tepat satu Input; setiap port punya tepat satu edge dengan \`port\` yang benar (lihat tabel node); tidak ada siklus; semua node terjangkau.
- [ ] Router punya minimal dua cabang dan setiap id cabang dipakai sebagai port satu edge.
- [ ] Bila ada Router: ada satu node \`context_memory\` dan node Context yang \`context_memory\`-nya menunjuk ke sana; Router dan Agent merujuk \`context_memory\`; Router tidak merujuk \`memory\`; setiap jalur jawaban melewati Context sebelum Output.
- [ ] Cabang yang memakai tool yang sama sudah digabung; \`description\` cabang jelas dan tidak tumpang tindih.
- [ ] Agent punya \`prompt\`; Context tidak membutuhkan prompt karena instruksinya ditanam sistem; tier \`decision\` hanya untuk Router.
- [ ] Mode tugas: tasks_source adalah ID Ekstrak tasks yang tersedia; done Router dan next pekerja menuju Agent penggabung; tidak ada edge balik ke Router; Context berjalan setelah penggabung.
- [ ] Penggabung membaca results Router dan menangani unresolved/daftar kosong; jangan bergantung pada answer satu Agent yang mungkin tidak dijalankan.
- [ ] Kirim media mengikuti kanal sesi secara otomatis; caption Instagram resmi menjadi teks terpisah berbayar; WebP statis dikonversi. Tidak ada tipe node platform baru atau URL sementara buatan model.
- [ ] Node Data yang dipanggil Agent ada di \`tools\` Agent dan tidak punya edge; node Data di alur punya edge masuk dan keluar.
- [ ] \`collection\`, field filter, \`sort_field\`, dan \`sum_field\` merujuk id yang ada; \`sum_field\` bertipe angka; \`value\` create/update adalah string JSON valid.
- [ ] Field \`choice\`/\`multichoice\` punya \`options\`; relasi menunjuk koleksi yang ada, dan koleksi umum tidak berelasi ke koleksi milik pelanggan.
- [ ] Setiap node punya alasan ada (lihat Tujuan profil); tidak ada Agent, riwayat, tier tinggi, atau Kirim media yang tidak diperlukan.
- [ ] Bila pelanggan perlu mengirim berkas, ada node Terima media yang hasilnya disimpan lewat node Data.
- [ ] Bila ada Router: ada cabang dan Agent Sapaan serta Penutup, masing-masing \`cheap\`, tanpa \`tools\`, dan tanpa \`memory\`; prompt Penutup melarang bertanya atau menawarkan.
- [ ] Prompt node tidak memuat gaya bahasa, persona, nama asisten, atau panjang jawaban (itu Perilaku AI klien).
- [ ] Setiap \`{{variabel}}\` dikenal (lihat referensi) dan tersedia di semua jalur; \`memory\` hanya menunjuk node Shared Memory.
`;
}

function formatMarkdown() {
  const nodeRows = nodeTypes.map(type => {
    const doc = nodeDocs[type];
    return ['`' + type + '`', doc.name, doc.purpose, doc.keys, doc.ports, doc.outputs];
  });
  return `# Referensi format ncwa-profile versi 1

Dokumen ini dibuat otomatis dari validator NC-WA. Nilai yang tidak tercantum di sini ditolak saat impor.

## Kerangka

\`\`\`json
{
  "format": "ncwa-profile",
  "version": 1,
  "name": "Nama profil",
  "description": "Ditampilkan ke klien saat memilih profil",
  "collections": [],
  "nodes": [],
  "edges": [{ "id": "e1", "source": "input", "port": "next", "target": "layanan" }]
}
\`\`\`

## Koleksi

\`{ "id", "name", "owner", "kind", "fields": [...] }\`. \`owner\`: ${code(collectionOwners)} (\`shared\` = satu isi untuk semua pelanggan, \`customer\` = record terikat ke nomor pengirim).

\`kind\` (boleh dihilangkan = \`list\`):

${table(
  ['kind', 'Isi yang diisi akun', 'Dibaca node'],
  collectionKinds.map(k => ['\`' + k + '\`', kindDocs[k], '\`' + kindNode[k] + '\`']),
)}

Koleksi \`text\` tidak punya field; \`text\` dan \`form\` selalu \`shared\`, tidak bisa bersumber API, dan relasi hanya boleh ke koleksi \`list\`.

\`samples\` (opsional): data contoh untuk Uji di editor, maksimal ${maxCollectionSamples} baris; tidak pernah dipakai di WhatsApp. Koleksi \`list\` berisi beberapa baris \`{ "_id": "<koleksi>_1", "<id field>": nilai }\`, \`form\` satu baris, \`text\` satu baris \`{ "text": "…" }\`. Field relasi diisi \`_id\` baris contoh koleksi tujuan (buat contoh koleksi tujuan lebih dulu; relasi wajib harus terisi), field file diisi nama file contoh seperti \`brosur.pdf\`. Cukup 2–3 baris yang wajar. Baris yang tidak valid dilewati saat Uji.

Field: \`{ "id", "label", "type", "required", "options", "collection" }\`, opsional \`"unique": true\` (tipe ${code(uniqueFieldTypes)}) dan \`"default"\` (tipe ${code(defaultFieldTypes)}; harus sesuai tipe).

${table(
  ['type', 'Nilai'],
  fieldTypes.map(t => ['`' + t + '`', fieldDocs[t]]),
)}

## Node

Kunci umum setiap node: \`id\`, \`type\`, \`label\`, \`x\`, \`y\`, \`prompt\` (string), \`tier\`, \`model\` (kosongkan), \`tools\` (daftar id), \`branches\` (daftar), \`collection\`, \`operation\`, \`value\`, \`query\`. Kunci yang tidak dipakai jenis node boleh diisi nilai kosong (\`""\`, \`[]\`).

${table(['type', 'Nama di editor', 'Fungsi', 'Kunci khusus', 'Port keluar', 'Keluaran `nodes.<id>.*`'], nodeRows)}

Edge: \`{ "id", "source", "port", "target" }\`. Target tidak boleh node \`input\` atau \`memory\`. Sambungan memori tidak memakai edge: isi \`"memory": "<id node Shared Memory>"\` pada Router, Agent, Context, atau Ekstrak.

## Tier model (\`tier\`)

${table(
  ['tier', 'Kegunaan'],
  modelTiers.map(t => ['`' + t + '`', tierDocs[t]]),
)}

## Node Data (\`operation\`)

${table(
  ['operation', 'Fungsi'],
  toolOperations.map(o => ['`' + o + '`', toolDocs[o]]),
)}

Operator \`filters\`:

${table(
  ['operator', 'Arti'],
  filterOperators.map(o => ['`' + o + '`', filterDocs[o]]),
)}

## Node Kondisi (\`rules[].operator\`)

${table(
  ['operator', 'Arti'],
  conditionOperators.map(o => ['`' + o + '`', conditionDocs[o]]),
)}

## Node Set / Hitung (\`steps[].op\`)

${table(
  ['op', 'Jumlah args', 'Arti'],
  (Object.keys(computeArity) as ComputeOp[]).map(o => ['`' + o + '`', String(computeArity[o]), computeDocs[o]]),
)}

## Node Ekstrak (\`fields[].type\`)

${code(extractFieldTypes)}. \`choice\`/\`multichoice\` wajib punya \`options\`. Tanggal relatif seperti "besok" diubah memakai tanggal hari ini (WIB).

## Variabel

- \`{{input.message}}\`, \`{{input.context}}\`, \`{{input.history}}\`: pesan pelanggan, ringkasan konteks, dan riwayat.
- \`{{input.task}}\`: tugas aktif saat Router/Agent memproses antrean, null di luar antrean. Baca \`{{input.task.task}}\` dan \`{{input.task.context}}\` hanya saat menangani tugas; penggabung memakai \`{{nodes.<router>.results}}\`.
${contextVariablePaths.map(p => '- `{{' + p + '}}`: ' + variableDocs[p]).join('\n')}
- \`{{data.<koleksi_teks>}}\` dan \`{{data.<koleksi_isian>.<field>}}\`: isi koleksi teks/isian langsung di prompt atau nilai lain tanpa node, misalnya \`Alamat kami: {{data.info_usaha.alamat}}\`. Cocok untuk isi pendek; teks panjang sebaiknya lewat node Data teks dengan kata kunci.
- \`{{nodes.<id>.<keluaran>}}\`: keluaran node lain sesuai tabel node, misalnya \`{{nodes.layanan.answer}}\`, \`{{nodes.cari_produk.first.data.harga}}\`, \`{{nodes.isian.tanggal}}\`.

## Batas

${table(
  ['Hal', 'Maksimal'],
  [
    ['Koleksi', String(limits.collections)],
    ['Field per koleksi', String(limits.fields)],
    ['Opsi per field', String(limits.options)],
    ['Node', String(limits.nodes)],
    ['Edge', String(limits.edges)],
    ['Cabang Router', String(limits.branches)],
    ['Tool per Agent', String(limits.tools)],
    ['Filter / syarat', limits.filters + ' / ' + limits.rules],
    ['Field Ekstrak', String(limits.extractFields)],
    ['Tugas per pesan', String(limits.tasks)],
    ['Percobaan routing per tugas', String(limits.taskAttempts)],
    ['Langkah Set / Hitung', String(limits.steps)],
    ['Batas hasil node Data (`limit`)', String(maxToolLimit)],
    [
      'Panjang id / label / teks',
      limits.idLength + ' / ' + limits.labelLength + ' / ' + limits.textLength + ' karakter',
    ],
    ['Data contoh per koleksi (\`samples\`)', String(maxCollectionSamples) + ' baris'],
  ],
)}

### Batas saat alur berjalan (per pesan pelanggan)

Dicek setiap pesan masuk. Bila batas panggilan AI, waktu, langkah, atau hasil node terlampaui, pelanggan menerima pesan cadangan dan kredit tidak dipotong; media di atas batas hanya dilewati.

${table(
  ['Hal', 'Batas'],
  [
    ['Panggilan AI (semua node, termasuk pengulangan)', String(runtimeLimits.modelCalls)],
    ['Waktu proses', runtimeLimits.seconds + ' detik'],
    ['Langkah node yang dijalankan', String(runtimeLimits.steps)],
    ['Hasil satu node', runtimeLimits.resultChars.toLocaleString('id-ID') + ' karakter'],
    ['Putaran tool per Agent', String(runtimeLimits.agentToolTurns) + ' (lalu Agent diminta menjawab tanpa tool)'],
    ['Bawaan \`limit\` node Data tabel bila tidak diisi', String(defaultToolLimit)],
    ['Kirim media per balasan', maxMediaPerReply + ' file'],
    ['Isi file Buat file', maxGeneratedBytes / 1024 / 1024 + ' MB'],
  ],
)}

Rancang agar jauh di bawah batas ini:
- Setiap Agent dan Router memakan panggilan AI; Agent yang memakai tool bisa memakai beberapa panggilan per pesan. Hindari rantai banyak Agent berurutan dalam satu jalur.
- Beri \`limit\` secukupnya pada node Data tabel dan hanya field yang perlu; hasil pencarian dengan banyak baris dan teks panjang cepat melewati batas hasil satu node.
- Satu Agent cukup punya tool yang benar-benar dipakai; alur daftar/pesan biasanya cari → catat, bukan cari berulang.
- Data teks (SOP/FAQ) panjang sebaiknya dibaca lewat node Data teks dengan kata kunci, bukan dimasukkan utuh ke prompt.
`;
}

// Isi skill sebagai daftar berkas di dalam folder skillName.
export function profileSkillFiles(): { path: string; content: string }[] {
  return [
    { path: 'SKILL.md', content: skillMarkdown() },
    { path: 'reference/format.md', content: formatMarkdown() },
    { path: tasksGuideFile, content: tasksMarkdown() },
    { path: tasksExampleFile, content: JSON.stringify(tasksExample(), null, 2) + '\n' },
    { path: spoExampleFile, content: JSON.stringify(spoExample(), null, 2) + '\n' },
  ];
}
export function profileSkillZip(): Buffer {
  return createZip(profileSkillFiles().map(f => ({ name: skillName + '/' + f.path, data: f.content })));
}

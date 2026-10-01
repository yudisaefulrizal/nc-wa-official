// Alur kerja dan review skill: selalu ringkas, bersyarat pada lingkup permintaan.
// Kontrak teknis tetap di reference; kebijakan kualitas tetap di principles.
export const requirementsGuideFile = 'workflow/requirements.md';
export const architectureGuideFile = 'workflow/architecture.md';
export const generationGuideFile = 'workflow/generation.md';
export const reviewGuideFile = 'validation/semantic-cx.md';
export const structuralGuideFile = 'validation/structural.md';
export const capabilitiesGuideFile = 'reference/capabilities.md';
export const mediaGuideFile = 'reference/media.md';
export const contextGuideFile = 'reference/context-recovery.md';

export function workflowFiles() {
  return [
    {
      path: requirementsGuideFile,
      content: `# Memahami kebutuhan dan lingkup

Baca untuk permintaan baru atau perubahan. Ringkas Goal → Actor → Information → Action → Constraints dari pesan, draft, dan keputusan yang masih berlaku. Koreksi terbaru menggantikan asumsi lama. Klarifikasi hanya informasi yang memengaruhi hasil dan belum tersedia; jangan meminta persetujuan rutin untuk setiap tahap.

Pilih lingkup kerja:
- Pertanyaan: jelaskan kemampuan/draft; tidak perlu menghasilkan profil baru.
- Revisi terbatas: pertahankan ID, data, dan keputusan yang tidak terkait. Telusuri dampak perubahan pada field, tool, variabel, memori, dan jalur; jangan merancang ulang seluruh profil.
- Profil baru/perubahan arsitektur: tentukan tujuan percakapan utama dan lanjutan, kondisi selesai, fakta wajib, tindakan, serta batas izin dan kanal.

Belum memilih jumlah Agent atau menyalin contoh. Keluaran tahap ini cukup keputusan desain singkat yang diperlukan untuk bekerja, bukan transkrip penalaran atau laporan wajib kepada pemilik. Lanjutkan ke [desain arsitektur](architecture.md) sesuai dampak perubahan.
`,
    },
    {
      path: architectureGuideFile,
      content: `# Desain informasi, capability, dan arsitektur

Ini pertimbangan desain, bukan kewajiban menambah komponen atau panggilan model per tahap. Untuk revisi kecil, tinjau hanya bagian terdampak dan ketergantungannya.

1. Information Requirements ↔ Capability Analysis: tentukan fakta/tindakan yang dibutuhkan dan cek [katalog kemampuan](../reference/capabilities.md) sebelum mengunci skema. Jika perlu mengubah koleksi/tool, baca [desain data](../reference/data-design.md). Tidak ada join otomatis atau operasi arbitrer.
2. Responsibility Design: kelompokkan capability berdasarkan tugas, izin, dan kriteria selesai. NeedSeparateAgent? Jika tidak, pertahankan satu Agent. Tabel dan Agent adalah keputusan terpisah; tool assignment menghubungkan keduanya.
3. Node & Tool Selection: pilih komponen minimum, baca kontrak node terpilih dari [indeks](../reference/nodes.md), lalu petakan Agent → tool Data → koleksi/operasi. Gunakan Kondisi/Compute untuk operasi deterministik yang didukung.
4. Routing/Task Decomposition: NeedTaskSplit? Jika satu Agent mampu menangani kebutuhan, tidak perlu Ekstrak tasks/Router. Mode tasks memerlukan [kontrak antrean](../reference/task-routing.md); cabang dari isi tabel memerlukan [Router tabel](../reference/router-tables.md).
5. Orchestration: NCWA mendukung alur langsung/berurutan, cabang satu jalur, antrean tasks berurutan, pengembalian internal ke Router, dan fallback manusia. Tidak ada eksekusi cabang paralel, fan-out/fan-in, atau handoff arbitrer. Jangan membuat node/port/mode untuk fitur yang belum tersedia.
6. Context/Recovery: jika percakapan lintas giliran atau perlu pemulihan, baca [konteks dan recovery](../reference/context-recovery.md). Tentukan informasi yang harus bertahan, kondisi retry/reroute/fallback, batas percobaan, dan akhir alur. Jangan mengulang transaksi sukses.
7. Synthesis: MultipleResults? Gabungkan hanya bila diperlukan. Pada mode tasks yang didukung, done menuju Agent penggabung walau satu eksekusi hanya menghasilkan satu tugas. Pada jalur langsung, Agent terakhir dapat menjaga jawaban final tanpa synthesizer tambahan.

Tinjau tujuan, informasi, dan kemampuan kembali bila ditemukan keterbatasan. Contoh implementasi baru dipakai setelah batas desain diputuskan, untuk memeriksa representasi; kemiripan contoh saja bukan alasan memilih arsitektur.
`,
    },
    {
      path: generationGuideFile,
      content: `# Generasi, revisi, dan penyederhanaan

Terjemahkan desain ke JSON hanya bila pengguna meminta perubahan. Baca [format](../reference/format.md) serta kontrak node/mode yang dipakai. Susun koleksi → node/tools → edge → konfigurasi. Jangan menambahkan properti perencanaan, prioritas, skor, atau jenis node di luar kontrak.

Pertahankan ID/nama yang tidak berubah; node baru mengikuti aturan ID/label. Posisi x/y disusun editor. Prompt node memuat tugas, sumber data, dan kondisi selesai/fallback; persona, sapaan, nada, serta panjang jawaban diatur melalui Perilaku AI klien. Data bisnis berasal dari koleksi.

Urutan akhir: Generate → [Structural Validation](../validation/structural.md) → [Semantic/CX Review](../validation/semantic-cx.md) → Simplify bila bermanfaat → validasi ulang hasil akhir dan dependensi yang berubah. Menghapus node dapat memutus variabel, relasi tool, memori, atau fallback. Jangan menyerahkan hasil penyederhanaan yang belum diperiksa ulang.

Gunakan contoh opsional untuk sintaks/sambungan setelah desain jelas; jangan menyalin semua node contoh. Di editor, kirim objek reply/definition sesuai kontrak host; draft sudah tersedia dan perubahan hanya usulan Terapkan/Tolak. Di luar editor, berikan JSON profil lengkap untuk impor sebagai draft. Jika memperbaiki profil di luar editor dan definisi belum tersedia, minta ekspor yang diperlukan. Jangan meminta impor/ekspor bila draft sudah tersedia.

Jelaskan hasil, alasan keputusan utama, dan keterbatasan validasi singkat. Validasi struktur otomatis tidak membuktikan kualitas semantik, CX, migrasi record, atau pengiriman kanal nyata.
`,
    },
    {
      path: reviewGuideFile,
      content: `# Review semantik dan pengalaman klien

Lakukan setelah pemeriksaan struktur; skala review mengikuti dampak perubahan. Ini penilaian desain, bukan evaluator semantik otomatis atau skor kualitas terukur.

- Responsibility: setiap Agent punya tujuan, input/output, batas izin, dan kriteria selesai. Pemisahan memberi manfaat; tidak menduplikasi tugas tanpa alasan.
- Information: tujuan klien mendapat fakta cukup; sumber utama, scope, relasi, field wajib, serta tool baca/tulis sesuai kebutuhan. Jumlah tabel tidak menentukan Agent.
- Execution: setiap skenario dapat mencapai jawaban/fallback yang bermakna. Bedakan dead-end struktural (edge hilang) dari jalan buntu fungsional (alur valid tetapi tujuan tak terselesaikan). Antrean kosong/unresolved dan cabang data kosong ditangani.
- Continuity/recovery: balasan pendek tetap jelas; tidak meminta ulang informasi tersedia; pembatalan dan kegagalan tidak menyebabkan transaksi ganda atau loop.
- Final response: jawaban konsisten, relevan, tidak berulang, dan menggabungkan hasil yang diperlukan tanpa mengekspos struktur internal.

Nilai seluruh 12 target dengan [kebijakan CX](../principles/quality-policy.md). Coba skenario normal, lanjutan, ambigu, beberapa kebutuhan, sumber kosong/gagal, dan hasil parsial sesuai perubahan. Bedakan perkiraan, simulasi/model tiruan, dan pengujian nyata. Jangan mengarang skor; threshold yang belum ditetapkan tetap tidak diketahui.

Bandingkan usulan dengan alur lebih sederhana: tujuan selesai, kesalahan/kontradiksi, pertanyaan ulang, langkah klien, latency, token dan tool/model call. Kualitas setara → usaha klien lebih kecil → biaya lebih rendah. Hapus komponen hanya bila kualitas terjaga, kemudian validasi ulang. Laporkan kebutuhan yang belum selesai; jangan menyebut semua target lulus karena JSON valid.
`,
    },
  ];
}

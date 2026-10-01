// Panduan perancangan koleksi untuk skill dan Asisten Builder. Keputusan struktur data
// dipisahkan dari pembentukan Agent; keduanya bertemu pada kebutuhan akses tool.
import { qualityTargets, type QualityTargetId } from './quality-policy.js';

export const dataDesignGuideFile = 'reference/data-design.md';

const dataImplications: Record<QualityTargetId, string> = {
  correctness:
    'Struktur dan identifier membedakan entitas serta fakta; Agent tidak mencampur produk, pelanggan, atau transaksi.',
  relevance: 'Kata kunci dan filter dapat mengambil data yang diperlukan pada giliran ini.',
  goal_fulfillment: 'Sediakan fakta dan tindakan yang dibutuhkan hingga tujuan selesai, bukan hanya jawaban parsial.',
  context_continuity: 'ID record dan relasi mempertahankan identitas objek dalam percakapan lanjutan.',
  conversational_quality:
    'Hasil dapat disusun menjadi jawaban alami tanpa memperlihatkan fragmentasi tabel kepada klien.',
  completeness: 'Informasi satu kesatuan semantik dapat diambil bersama tanpa bagian penting terlewat.',
  responsiveness: 'Kebutuhan sederhana tidak memerlukan rangkaian pencarian yang tidak perlu.',
  consistency: 'Satu fakta mutakhir memiliki sumber utama yang jelas; hindari salinan yang mudah berbeda.',
  effort_reduction:
    'Gunakan data dan konteks yang sudah ada sebelum meminta klien mengulang informasi; jangan menebak identitas ambigu.',
  graceful_recovery:
    'Sediakan cara pencarian alternatif yang relevan ketika hasil utama kosong, tanpa melonggarkan izin atau fakta wajib.',
  adaptation: 'Dukung variasi kebutuhan percakapan yang nyata tanpa membuat skema generik untuk semua kemungkinan.',
  efficiency:
    'Jika pengalaman dan usaha klien setara, pilih lookup, tool call, payload, dan kompleksitas lebih rendah.',
};

export function dataDesignMarkdown() {
  return `# Desain data mengikuti kebutuhan percakapan

Gunakan saat membuat/mengubah koleksi, memilih gabung/pisah tabel, menentukan field/relasi, atau menetapkan tool Agent. Format yang sah ada di [format](format.md); kontrak operasi ada di [nodes](nodes.md). Ini panduan desain, bukan migrasi data otomatis atau field baru pada JSON profil.

## Prinsip dan urutan

**Struktur Data mengikuti kebutuhan percakapan, bukan sebaliknya.**

Client Experience → Information Requirements → Data Quality → Table Structure.
Data Quality Objectives: Integrity → Consistency → Retrievability → Maintainability → Efficiency.

Penuhi batas wajib (izin, scope akun/pelanggan, kontrak format), lalu optimalkan pengalaman klien. Integrity berarti identitas, tipe, nilai wajib, dan hubungan benar; Consistency berarti sumber fakta tidak saling bertentangan; Retrievability berarti fakta dapat ditemukan dengan tool yang tersedia; Maintainability berarti pembaruan tidak menimbulkan salinan usang; Efficiency dipilih saat kualitas setara. Ini kriteria desain pendukung, bukan skor/threshold tambahan yang dikarang.

**Responsibility Design menentukan Agent. Information Design menentukan koleksi. Keduanya bertemu pada tool assignment.** Satu Agent boleh menggunakan banyak tabel; satu tabel dapat dipakai beberapa Agent sesuai kewenangan. Jangan membuat Agent baru hanya karena tabel baru atau memaksa satu tabel per Agent.

## Dampak 12 target CX

| Target | Implikasi struktur data |
| --- | --- |
${qualityTargets.map(t => '| ' + t.label + ' | ' + dataImplications[t.id] + ' |').join('\n')}

## Alur keputusan ringkas

1. Ambil skenario percakapan utama dan lanjutan: tujuan klien, fakta yang diperlukan, tindakan, dan kondisi selesai. Gunakan konteks yang tersedia; tanyakan hanya ketidakjelasan yang mengubah desain.
2. Petakan tiap kebutuhan ke entitas/fakta, sumber utama, pemilik data, frekuensi pembaruan, identifier, dan cara pencarian. Bedakan fakta bersama dari transaksi milik pelanggan.
3. Pilih jenis koleksi; baru nilai batas semantik dan percakapan untuk gabung/pisah.
4. Tentukan field, relasi, serta pola baca/tulis. Uji apakah kebutuhan umum dapat diselesaikan dengan jumlah lookup dan payload yang wajar.
5. Tentukan Agent berdasarkan responsibility, kemudian beri node Data per koleksi/operasi yang diperlukan. Jumlah tabel tidak menentukan jumlah Agent.
6. Bandingkan alternatif menggunakan tujuan selesai, fakta yang terlewat, pertanyaan ulang, lookup/tool call, payload, dan biaya pembaruan. Jelaskan asumsi; perkiraan belum menjadi hasil pengujian.

## Memilih bentuk koleksi

| Kebutuhan | Bentuk |
| --- | --- |
| Banyak entitas/baris, perlu filter, urutan, hitung atau relasi | list + data_table |
| Satu set atribut tetap per akun, misalnya alamat dan jam layanan umum | form + data_form |
| SOP, syarat atau penjelasan naratif yang dibaca sebagai paragraf | text + data_text |

Jangan menjadikan setiap paragraf SOP tabel tersendiri, atau menaruh harga/status/tanggal yang perlu dibandingkan hanya dalam narasi. text/form selalu shared; data pribadi/transaksi per pengirim memakai list dengan owner customer. shared berarti bersama dalam scope akun/data profil, bukan membuka data lintas akun. Relasi hanya menuju koleksi list; koleksi shared tidak boleh berelasi ke koleksi customer.

## Kapan digabung atau dipisah

Gunakan **semantic + conversational boundary**. Tidak ada aturan satu jenis informasi = satu tabel atau sedikit mungkin tabel selalu lebih baik.

| Pertimbangan | Cenderung digabung | Cenderung dipisah |
| --- | --- | --- |
| Identitas dan makna | Atribut dari satu entitas dan satu kebutuhan jawaban | Entitas berbeda dengan identifier dan siklus hidup sendiri |
| Cara dipakai | Umumnya dibaca bersama, pemisahan menambah lookup tanpa manfaat | Dibaca/difilter/diperbarui secara independen dengan manfaat nyata |
| Kardinalitas | Satu nilai per atribut pada tiap entitas | Banyak jadwal, varian, atau kejadian per entitas; hindari kolom tanggal_1, tanggal_2, dst. |
| Scope/izin | Pemilik dan akses sama | Data umum versus transaksi pelanggan; isolasi adalah batas wajib |
| Sumber fakta | Memusatkan fakta yang sama | Menghindari pengulangan fakta induk pada banyak baris turunan |
| Biaya pengambilan | Hasil tetap relevan dan ukurannya terkendali | Gabungan memuat banyak field kosong/tidak relevan atau membingungkan pencarian |

Pisahkan jika **Benefit_separation > Cost_fragmentation**: peningkatan retrieval, correctness, maintainability, atau CX harus material dibanding lookup tambahan, relasi, konteks yang perlu dibawa, dan risiko jawaban parsial. Gabungkan bila pemisahan hanya menambah pencarian. Batas keamanan/izin tetap wajib meskipun pemisahan lebih mahal. Jangan memberi angka manfaat buatan; gunakan contoh percakapan konkret. Perubahan koleksi tidak otomatis memerlukan perubahan Agent.

## Memilih field dan relasi

- Setiap field punya alasan: menjawab kebutuhan, membedakan objek, memfilter, menghubungkan, atau menjalankan tindakan. Gunakan hanya tipe dan properti pada format.md; catatan alasan desain tidak dimasukkan sebagai properti JSON baru.
- Simpan angka sebagai number, status terkontrol sebagai choice, tanggal/waktu sesuai tipenya, lampiran sebagai file, dan rujukan record sebagai relation. Jelaskan satuan pada label, misalnya Harga_IDR; jangan menaruh "Rp 100 ribu" pada field angka.
- Wajibkan hanya informasi yang benar-benar diperlukan untuk record/tindakan itu. Pilih default hanya bila maknanya sah; jangan memakai nol atau status sukses untuk menutupi nilai yang belum diketahui. Terapkan unique hanya pada identifier bisnis yang memang harus unik dan tipe yang didukung.
- ID koleksi/field adalah ID skema; id pada hasil tool adalah ID record. Gunakan ID record yang ditemukan untuk get/update/delete dan relation. Nama bisa berubah atau sama antarobjek; jangan membuat ID record dari tebakan nama. Simpan rujukan objek dalam konteks yang diperlukan agar klien tidak mengulang pilihan.
- relation menyimpan ID record tunggal. Tidak ada join atau perluasan relasi otomatis. Bila butuh rincian induk, berikan tool get koleksi induk; untuk banyak anak, gunakan relation pada koleksi anak lalu search dengan filter relation tersebut. Hitung lookup tambahan sebelum memilih pola ini.
- Fakta mutakhir memiliki satu sumber utama. Salinan historis seperti harga_saat_pesan boleh disimpan untuk kebutuhan transaksi yang jelas; beri nama dan aturan isi agar tidak disalahartikan sebagai harga terbaru. Jangan menggandakan harga aktif di beberapa tabel/prompt.

## Tool assignment dan retrieval

Rancang pemetaan **tujuan → Agent → koleksi → operasi → kunci/filter → hasil yang diperlukan → penanganan kosong/gagal**. Pemetaan adalah catatan rancangan, bukan field tambahan pada profil. Agent.tools berisi ID node Data; collection pada node Data menunjuk ID koleksi. Satu node Data memiliki satu koleksi/operasi. Berikan operasi tulis hanya bila responsibility Agent memerlukannya.

- Gunakan search untuk kandidat, get bila ID sudah diketahui, count/sum untuk jumlah atau total yang sesuai kontrak. Jangan mengambil semua baris untuk menghitung sendiri jika count tersedia. Buat tool per operasi yang diperlukan, bukan menyalin seluruh operasi ke semua Agent.
- Pencarian saat ini memakai kata kunci/filter, bukan embedding atau SQL bebas. Kata kunci dapat cocok sebagian; gunakan filter untuk atribut yang harus tepat seperti status atau relation, lalu periksa kecocokan objek sebelum transaksi. Tidak ada jaminan sinonim otomatis; alias yang benar-benar diperlukan dapat disimpan sebagai field text yang dipelihara.
- Filter tetap pada node tidak dilewati oleh filter tambahan dari Agent. query tool search/count dapat berupa string atau {kata_kunci, filter:[{field,operator,value}]}; jangan mengarang join, projection/select, atau parameter lain yang tidak didukung.
- Gunakan limit secukupnya dan perhatikan has_more. Hasil terbatas bukan bukti seluruh kandidat sudah diperiksa. Jangan meminta klarifikasi jika ID/pilihan sudah jelas dari konteks; bila beberapa objek masih sama-sama cocok, minta pembeda paling kecil yang diperlukan.
- Hasil kosong: gunakan ID dari konteks, alias/kata kunci lain, atau filter yang diperbaiki bila masuk akal. Jangan menghapus batas akun/pelanggan, filter wajib, atau kriteria penting klien agar pencarian tampak berhasil. Error sumber bukan bukti data tidak ada; retry/fallback mengikuti kontrak runtime, bukan janji pencarian tanpa batas.
- Router table memuat seluruh nilai baris sebagai kriteria dan tetap membutuhkan tool search/get pada Agent tujuan; ini berbeda dari pencarian detail. Jangan menambah Router table hanya karena koleksi tersedia atau memecah tabel semata-mata agar punya cabang. Pilih jika kebutuhan routing membenarkannya; pertimbangkan ukuran konteks menurut router-tables.md.

## Contoh keputusan

| Kebutuhan percakapan | Struktur dan alasannya | Akses Agent |
| --- | --- | --- |
| "Paket A berapa, termasuk apa, dan syaratnya?" | Satu list paket: nama, harga, manfaat, syarat per paket; informasi satu kesatuan tidak dipecah menjadi tiga lookup | Satu Agent informasi dengan search/get paket |
| "Kelas A ada jadwal kapan dan berapa kuotanya?" | list kelas dan list jadwal bila satu kelas punya banyak sesi yang berubah sendiri; jadwal merujuk kelas dan menyimpan tanggal/kuota | Agent yang sama dapat mencari kelas lalu jadwal menurut relation; tambahan lookup punya alasan |
| "Pesan paket A, lalu cek status pesanan saya" | list paket shared sebagai sumber produk; list pesanan customer untuk relasi paket, jumlah, dan status. Pisah karena lifecycle serta scope berbeda | Satu Agent pemesanan boleh memiliki search/get paket dan search/create pesanan; update hanya bila perlu |
| "Alamat dan jam buka? Bagaimana ketentuan pengembalian?" | form info_usaha untuk atribut tetap; text kebijakan untuk narasi. Tidak perlu tabel per pertanyaan | Agent layanan memakai data_form get dan data_text sesuai pertanyaan |

Contoh ini merupakan pilihan desain, bukan skema wajib untuk semua usaha. Harga, kebijakan, status, dan aturan bisnis sebenarnya berasal dari pemilik; jangan mengarang nilainya.

## Pemeriksaan sebelum menyerahkan

- Tujuan utama dan lanjutan punya sumber fakta yang cukup untuk selesai; informasi satu kesatuan tidak terputus.
- Gabung/pisah punya alasan semantik/percakapan dan mempertimbangkan biaya fragmentation; responsibility Agent diputuskan terpisah.
- Field, tipe, required/default/unique, relasi, scope, dan sumber fakta utama konsisten; operasi tulis dibatasi sesuai tugas.
- Jalur umum, beberapa kandidat, hasil kosong, relasi kosong, data berubah, dan sumber gagal memiliki penanganan yang masuk akal dengan tool yang tersedia.
- Bandingkan kualitas jawaban, usaha klien, dan lookup sebelum menyebut struktur lebih efisien. Validasi skema tidak membuktikan CX meningkat.
- Saat memperbarui profil, pertahankan ID dan field yang masih dipakai. Jelaskan dampak pemisahan/penggabungan terhadap record, relasi, dan tool; perubahan definisi bukan bukti data lama sudah dipindah. Jangan menghapus/mengganti struktur berisi data di luar permintaan pemilik.

Dalam editor, jelaskan alasan keputusan utama secara singkat pada reply; tetap kirim definition sesuai format editor. Di luar editor, sertakan alasan ringkas bila membantu pemilik menilai rancangan. Jangan menambah laporan panjang atau pertanyaan konfirmasi rutin bila kebutuhan sudah jelas.
`;
}

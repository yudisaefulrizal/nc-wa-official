# Konsep Konten dan Profil Generator Gambar

Status: desain awal untuk ditinjau, belum implementasi fitur. Dibuat 1 Oktober 2026 dengan tool imagegen bawaan. Mockup mengikuti warna dan navigasi NC-WA yang ada.

## Layar

1. **Konten (user)**: tab Buat gambar dan Pustaka; pilih profil generator, isi brief, unggah referensi, pilih rasio dan jumlah; estimasi kredit sebelum membuat; hasil dapat diunduh atau dibuat variasinya.
2. **Profil AI (owner)**: dua jenis profil, Asisten AI dan Generator Gambar; Buat profil memilih jenis terlebih dahulu; status Draft, Terbit, dan Aktif mengikuti lifecycle profil yang ada.
3. **Builder Generator Gambar (owner)**: tab Alur, Formulir, Pengaturan. Contoh alur: Brief → Susun prompt → Generate gambar → Simpan hasil → Output; Data brand memasok konteks ke Susun prompt. Node baru ini adalah usulan kemampuan, belum tersedia di runtime.
4. **Pengaturan AI (owner)**: tier baru bernama Model Gambar, di samping Murah, Sedang, Cerdas, Terstruktur, dan Keputusan. Pemilihan provider/model dan uji kemampuan gambar terpisah dari tier teks.

## Rekomendasi alur produk

- Profil menentukan formulir dan aturan gaya. Data brand milik akun berisi logo, warna, deskripsi, dan referensi; user tidak perlu melihat model atau prompt internal.
- Konten berdiri sebagai halaman user dan tidak mewajibkan pemasangan profil ke sesi WhatsApp. Profil Asisten AI yang ada tetap menjadi jenis asisten.
- Pustaka memuat hasil dan riwayat brief, rasio, profil serta versi yang dipakai. Unduh dan Buat variasi menjadi tindakan utama; penggunaan ke Auto Share dapat menyusul.
- Rasio awal 1:1, 4:5, dan 9:16 serta jumlah 1, 2, dan 4 ditampilkan sesuai kemampuan provider yang dipilih. Owner dapat membatasi pilihan per profil.
- Proses berjalan sebagai pekerjaan dengan status Menunggu, Membuat, Selesai, dan Gagal. Tombol mencegah pengiriman ganda. Kegagalan menyimpan brief agar user dapat mencoba lagi.
- Tampilkan estimasi kredit sebelum mulai. Reservasi kredit mencegah saldo minus; penyelesaian menagih hasil sukses dan melepaskan reservasi untuk keluaran gagal. Angka kredit di mockup hanya contoh.
- Formulir generator mendukung field bertipe teks, pilihan, gambar referensi, rasio, dan jumlah. Pengisian pengguna dipetakan ke variabel builder.
- Publish membuat versi immutable, aktivasi membuatnya tersedia untuk akun, dan setiap pekerjaan menyimpan versi yang dipakai.
- Konfigurasi model memerlukan pemeriksaan kemampuan provider: teks ke gambar, referensi/edit, jumlah, ukuran, kualitas, dan format keluaran. Mockup tidak menetapkan merek atau ID model.

## Lingkup tahap berikutnya

Setelah desain disepakati: tambahkan jenis profil, schema formulir, node gambar, tier/provider gambar, pekerjaan asinkron, penyimpanan hasil per akun, pencatatan kredit, dan halaman Konten. Mockup ini tidak mengubah dashboard atau menambahkan provider ke aplikasi.

Prompt lengkap setiap mockup tersedia di `prompts.md`.

## Mockup tersimpan

- [Konten — user](01-konten-user.png)
- [Profil AI — owner](02-profil-ai-owner.png)
- [Builder Generator Gambar — owner](03-builder-generator-gambar.png)
- [Pengaturan AI / Model Gambar — owner](04-pengaturan-model-gambar.png)

Mockup raster merupakan acuan visual. Nama akun, jumlah pengguna, angka kredit, gambar produk, dan pilihan kualitas adalah contoh. Detail UI dan opsi akhir harus mengikuti kemampuan provider serta perilaku aplikasi yang diimplementasikan.

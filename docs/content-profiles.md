# Konten dan Profil Konten

Konten adalah menu klien untuk membuat gambar dan teks dari formulir, tanpa sesi WhatsApp atau Instagram. Isinya ditentukan **profil Konten**, yaitu profil di Editor profil yang berperan sebagai Konten. Tidak ada lagi builder generator tersendiri: semua profil dibuat di satu Editor profil (`/dashboard/admin/ai-builder`).

## Menyiapkan sebagai owner

1. Buka **Pengaturan AI → Provider → Tambah profil** atau ubah provider yang ada. Isi **Model Gambar**, API key, dan endpoint dasar Chat Completions provider. Model gambar tidak diisi otomatis oleh migrasi.
2. Di bagian Model Gambar pada form provider, atur protokol, kemampuan referensi, maksimum gambar, kualitas, ukuran untuk Images API kompatibel, dan **kredit per gambar**. Nilai 0 berarti gambar belum dapat dibuat. Provider khusus gambar boleh tidak memiliki model teks; provider asisten tanpa model gambar tetap membutuhkan semua tier teks.
3. Buka tab **Model**, pilih provider pada tier **Model Gambar**, lalu **Simpan rute provider**. Tier gambar tidak memakai fallback ke tier teks.
4. **Uji Model Gambar** membuat satu gambar langsung dengan provider terpilih; uji ini memakai biaya provider dan menyimpan hasil privat di akun owner, tanpa mengurangi kredit AI aplikasi.
5. Buka **Profil AI → Buat profil → Mulai profil Konten**. Susun formulir di node **Input**, atur node Buat gambar (dan Agent bila perlu), lalu susun hasilnya di node **Output**. Uji di panel Uji (simulasi, tanpa kredit), **Terbitkan**, dan nyalakan di **Profil AI**. Profil baru selalu draft dan nonaktif.

Peran profil (Asisten chat atau Konten) bisa diganti selagi draft di tab **Pengaturan**, dan terkunci setelah terbit. Profil Konten tidak bisa dipasang ke sesi chat.

## Profil Konten

- **Node yang tersedia:** Input, Output, Agent, Router, Kondisi, Ekstrak, Set / Hitung, dan Buat gambar. Tanpa memori, data, lampiran, file, Kirim media, dan Fallback; tiap permintaan berdiri sendiri.
- **Input (formulir):** daftar isian `form` dengan jenis teks, teks panjang, pilihan, atau gambar referensi (file Pustaka konten klien), maksimal 12. Tiap isian dibaca sebagai `{{input.<id>}}`; `{{input.message}}` berisi ringkasan isian sebagai teks yang dibaca Agent.
- **Output (hasil):** daftar `results` dengan jenis gambar (variabel file, misalnya `{{nodes.gambar.files}}`) atau teks, maksimal 6. Item gambar tanpa file dilewati; minimal satu hasil harus ada. Boleh ada beberapa Output, misalnya satu untuk jalur gagal Buat gambar (port `gagal` wajib tersambung).
- **Buat gambar:** hasil disimpan ke Pustaka konten akun sebagai JPEG. Referensi dari isian gambar dan logo brand ikut dikirim bila model menerima referensi. Batas waktu node 240 detik, dan seluruh alur 300 detik (profil chat: 60 dan 120 detik).

## Menggunakan sebagai klien

Buka **Konten → Buat konten**, pilih jenis konten, isi formulir, lalu periksa estimasi kredit. Gambar referensi bisa diunggah atau dipilih dari pustaka. **Identitas brand** menyimpan nama, deskripsi, warna, dan logo milik akun; profil yang menyalakan brand di node Buat gambar memakainya.

**Buat konten** membuat pekerjaan asinkron: Menunggu → Membuat → Selesai/Gagal. Klien boleh berpindah halaman; pekerjaan tetap berjalan di server. Hasil (gambar dan teks) tampil di panel Hasil dan tersimpan di **Pustaka konten**; gambar bisa diunduh, diposting ke Instagram, atau dijadikan referensi, dan isian pekerjaan bisa dipakai lagi.

## Kredit dan pemulihan

- **Gambar:** node Buat gambar memesan jumlah gambar × tarif Model Gambar saat berjalan, kredit paket lebih dulu, lalu mengembalikan gambar yang tidak jadi ke wadah asalnya.
- **Kata:** hanya profil yang memakai Agent, Router, atau Ekstrak ditagih kredit kata, seperti di chat (kata isian masuk dan kata teks hasil). Reservasinya dibuat saat pekerjaan masuk antrean, dan sisanya dikembalikan setelah selesai.
- ID permintaan unik per akun mencegah debit ganda dari retry. Maksimum tiga pekerjaan terbuka per akun dan dua pekerjaan berjalan bersamaan di satu engine.
- Saat start, pekerjaan yang masih antre atau berjalan ditandai **Terputus** dan kreditnya dikembalikan (`ai.recover()` lalu `recoverContentJobs()`); tidak ada yang dilanjutkan atau dipanggil ulang ke provider. Berhenti normal menunggu pekerjaan aktif selesai.
- Kredit gambar dan kata per pekerjaan dijumlahkan dari `ai_usage` lewat kolom `customer` (berisi ID pekerjaan) untuk sesi `content`.

## Penyimpanan dan akses

File privat disimpan di `storage/files/content/<akun>/<id>` dan ikut backup `storage/`. Hasil generator JPEG kualitas 90 (bagian transparan diisi putih); referensi PNG supaya logo transparan tetap utuh. Semua akses API memakai akun dari sesi login server; file akun lain ditolak, termasuk sebagai referensi atau hasil. PNG/JPG/WebP didekode ulang tanpa metadata asal; SVG, gambar animasi, file invalid, dan gambar berlebihan ditolak. Referensi maksimum 10 MB per unggahan; raster dibatasi 20 juta piksel. Pustaka dibatasi 500 file/512 MB per akun.

## Belum ada

Batas gambar per hari atau per akun, dan pengujian dengan model gambar sungguhan (semua tes memakai provider tiruan).

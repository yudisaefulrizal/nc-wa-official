# Konten dan Profil Generator Gambar

Fitur di `nc-wa-official`: generator gambar terpisah dari profil Asisten AI, memakai kredit AI yang sama dan tidak memerlukan sesi WhatsApp/Instagram.

## Menyiapkan sebagai owner

1. Buka **Pengaturan AI → Provider → Tambah profil** atau ubah provider yang ada. Isi **Model Gambar**, API key, dan endpoint dasar Chat Completions provider. Model gambar tidak diisi otomatis oleh migrasi.
2. Di bagian Model Gambar pada form provider, atur protokol, kemampuan referensi, maksimum gambar, kualitas, ukuran untuk Images API kompatibel, dan **kredit per gambar**. Nilai 0 berarti generator belum dapat dipakai pelanggan. Provider khusus gambar boleh tidak memiliki model teks; provider asisten tanpa model gambar tetap membutuhkan semua tier teks.
3. Buka tab **Model**, pilih provider pada tier **Model Gambar**, lalu **Simpan rute provider**. Tier gambar tidak memakai fallback ke tier teks; konfigurasi gambar saja dapat disimpan tanpa mengubah rute teks.
4. **Uji Model Gambar** membuat satu gambar langsung dengan provider terpilih; uji ini memakai biaya provider dan menyimpan hasil privat di akun owner. Uji koneksi tidak mengurangi kredit AI aplikasi, mengikuti perilaku probe koneksi model teks. Uji generator di builder menggunakan kredit AI akun owner.
5. Buka **Profil AI → Buat profil → Profil Generator Gambar**. Atur nama, deskripsi, template prompt, pilihan rasio, jumlah maksimum dan referensi. Jika diperlukan, tambahkan field formulir di tab **Formulir**.
6. Uji draft di builder, **Terbitkan**, lalu aktifkan di tab **Pengaturan** atau daftar Generator Gambar. Profil baru selalu menjadi draft dan nonaktif.

Sesuaikan konfigurasi dengan kemampuan model sebenarnya. Protokol OpenRouter menggunakan Images API; protokol Images API kompatibel menggunakan generations/edits; Chat multimodal menggunakan Chat Completions dan membatasi keluaran ke satu gambar per pekerjaan. Model yang menolak ukuran, referensi atau kualitas tidak dicoba ulang otomatis.

## Menggunakan sebagai user

Buka **Konten → Buat gambar**, pilih profil, isi brief dan field tambahan, pilih rasio dan jumlah, lalu periksa estimasi kredit. Referensi dapat diunggah atau dipilih dari pustaka referensi. **Identitas brand** menyimpan nama, deskripsi, warna dan logo milik akun.

**Buat gambar** membuat pekerjaan asinkron dengan status Menunggu → Membuat → Selesai/Gagal. User boleh berpindah halaman; pekerjaan tetap berjalan di server. Hasil tersimpan di **Pustaka konten**, dapat diunduh sebagai PNG atau dipakai untuk membuat variasi. Jika provider belum mendukung referensi, brief dapat dipakai kembali untuk gambar baru.

## Builder dan versi

Builder menyediakan alur generator yang tetap: **Brief → Susun prompt → Generate gambar → Simpan hasil → Output**, dengan **Data brand** opsional sebagai sumber konteks. Ini editor tersendiri; graf asisten yang bebas susun tidak menerima tier gambar sebagai tier model teks.

Penyusunan prompt memakai template, atau Model Cerdas bila opsi tersebut dinyalakan. Tarif kredit per gambar yang dipilih owner mencakup langkah penyusunan prompt tersebut. Template mendukung `{{brief}}`, `{{brand}}`, `{{fields}}`, dan `{{fields.id_field}}`. Nilai user diganti sekali, sehingga teks `{{...}}` di dalam brief tidak dieksekusi lagi sebagai template.

Field tambahan mendukung teks, teks panjang, dan pilihan. Maksimum 12 field, 30 pilihan per field, ID unik, dan validasi required di browser maupun server. Brief, referensi, rasio, dan jumlah adalah field inti. Draft tersimpan otomatis; konflik revisi ditolak. Ekspor, impor, salin profil, dan pemulihan riwayat versi tersedia. Publikasi menyimpan versi; aktivasi mengatur ketersediaan ke pelanggan. Setiap pekerjaan membawa snapshot definisi, input, brand, versi, model dan tarif sehingga draft baru tidak mengubah pekerjaan lama.

## Kredit dan pemulihan

Reservasi mengambil kredit paket yang aktif terlebih dahulu, lalu saldo beli. ID permintaan unik per akun mencegah debit ganda dari retry. Maksimum tiga pekerjaan terbuka per akun dan dua pekerjaan provider berjalan di satu engine.

Hanya gambar yang berhasil disimpan ditagihkan. Kegagalan provider atau gambar invalid melepaskan sisa reservasi. Refund kredit paket hanya kembali ke periode paket yang sama dan masih aktif; refund saldo beli tetap kembali ke saldo beli. Ringkasan penggunaan AI mencatat pekerjaan gambar dan tagihannya.

Saat startup di bawah kunci engine, pekerjaan running yang terputus diselesaikan berdasarkan hasil yang telah tersimpan; sisanya direfund. Pekerjaan queued dilanjutkan. Provider tidak dipanggil ulang otomatis untuk pekerjaan yang terputus. Berhenti normal menunggu pekerjaan aktif selesai.

## Penyimpanan dan akses

File privat disimpan di `storage/files/content/<akun>/<id>.png` dan ikut backup `storage/` yang sudah ada. Semua akses API memakai akun dari sesi login server. File tidak dipasang sebagai aset publik; referensi akun lain ditolak. PNG/JPG/WebP di-dekode menjadi PNG tanpa metadata asal; SVG, gambar animasi, file invalid dan gambar berlebihan ditolak. Referensi maksimum 10 MB per unggahan, empat per pekerjaan; raster dibatasi 20 juta piksel. Pustaka dibatasi 500 file/512 MB per akun.

Transport memeriksa alamat publik dan mengunci DNS, membutuhkan HTTPS, menolak redirect dengan kredensial, membatasi waktu provider lima menit dan respons 48 MB. Hasil URL diunduh dengan pemeriksaan alamat dan batas ukuran. API key dan prompt internal tidak masuk katalog profil klien.

## API

Semua endpoint berikut memakai sesi login dan origin aplikasi untuk perubahan data.

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/content/profiles` | Formulir profil yang terbit dan aktif, tanpa prompt internal |
| `GET /api/content/capabilities` | Kesiapan, kemampuan referensi, batas jumlah dan tarif kredit |
| `GET/PUT /api/content/brand` | Identitas brand privat |
| `GET/POST /api/content/references` | Daftar referensi / unggah body biner PNG/JPG/WebP |
| `GET /api/content/files/:id` | File akun; `?download=1` untuk unduhan |
| `GET /api/content/jobs?page=1` | Pustaka dan riwayat dengan pagination |
| `POST /api/content/jobs` | Membuat pekerjaan; body `profileId`, `requestId`, `brief`, `fields`, `ratio`, `count`, `references` |
| `GET /api/content/jobs/:id` | Status, hasil dan kredit pekerjaan |
| `GET/POST /api/admin/ai/image-profiles` | Daftar/create profil owner |
| `GET/PUT/DELETE /api/admin/ai/image-profiles/:id` | Baca/save draft/delete dengan revisi |
| `POST /api/admin/ai/image-profiles/:id/publish` | Publikasi revisi tersimpan |
| `PUT /api/admin/ai/image-profiles/:id/enabled` | Aktivasi profil terbit |
| `GET /api/admin/ai/image-profiles/:id/versions` | Riwayat versi |
| `GET /api/admin/ai/image-profiles/:id/versions/:revision` | Definisi versi untuk dipulihkan ke draft |
| `GET /api/admin/ai/image-profiles/:id/export` | Ekspor JSON draft |
| `POST /api/admin/ai/image-profiles/:id/run` | Uji draft sebagai pekerjaan owner berbayar kredit AI |
| `POST /api/admin/ai/image-test` | Uji satu gambar pada provider terpilih |

## Validasi

`test/components/ai/image-generator.test.ts` menggunakan provider tiruan dan MySQL terisolasi: lifecycle, template, kontrak payload, reservasi, idempotensi, saldo kurang, isolasi akun, snapshot, hasil parsial, invalid image, restart, pergantian periode kredit dan akun suspended. `scripts/checks/browser-image-generator-check.ts` menjalankan API asli dan provider tiruan pada lebar 1280 dan 390 px, termasuk brand, unggah, generate, variasi, formulir tambahan, publikasi/aktivasi dan uji draft. Screenshot berada di `/tmp/ncwa-browser-check/`.

TypeScript, pemeriksaan struktur/format, build dan migrasi dev lulus. Tes generator 17/17, tes kompatibilitas provider, dan pemeriksaan browser desktop/ponsel lulus. Suite penuh lulus 300/301; satu tes `Login limiter stops repeated attempts` masih gagal karena tes mengharapkan blokir dalam 21 percobaan sedangkan konfigurasi login memakai batas 120. Kegagalan yang sama direproduksi pada salinan HEAD sebelum perubahan generator. Integrasi dengan provider/model gambar sungguhan **belum diuji**; owner belum menetapkan model atau tarif. Tidak ada permintaan berbiaya ke provider selama tes otomatis.

Kontrak transport OpenRouter merujuk [dokumentasi resmi Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), diperiksa saat implementasi. Mockup dan prompt desain terdapat di [image-generator-design](image-generator-design/README.md).

## Posting Instagram

Setiap gambar hasil memiliki tombol **Post Instagram** dengan dialog akun tujuan dan caption. Alur, izin akun, API, migrasi, dan validasinya dijelaskan di [Posting Instagram](instagram-posting.md).

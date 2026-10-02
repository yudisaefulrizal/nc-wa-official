# Posting Instagram dari Konten

Pada `/dashboard/konten`, setiap gambar hasil memiliki tombol **Post Instagram**. Buka hasil dari Pustaka konten melalui **Lihat hasil** untuk memposting gambar lama. Dialog menampilkan gambar terpilih, akun tujuan, dan caption (maksimal 2.200 karakter Unicode). Gambar hanya diposting setelah tombol submit ditekan.

Posting ini memakai Instagram Login resmi yang sudah tersedia, bukan akun Zernio. Akun Bisnis/Kreator harus memberikan izin `instagram_business_content_publish`; akun yang masuk sebelum fitur ini perlu dihubungkan ulang. Scope tersebut sekarang diminta bersama izin DM yang sudah ada. App Meta harus mengizinkan scope ini. `APP_ORIGIN` harus dapat dijangkau Meta untuk mengambil salinan gambar sementara.

Gambar hasil PNG disalin menjadi JPEG untuk feed, dengan rasio antara 4:5 dan 1,91:1. Pilihan 1:1 dan 4:5 dari generator didukung; 9:16 ditolak dengan arahan memilih gambar feed. Sumber di pustaka tetap utuh. Batas media sementara mengikuti penyimpanan Instagram yang sudah ada: sumber/hasil maksimum 8 MB, URL acak berlaku 15 menit, maksimum 32 file aktif.

API akun login (identitas akun diambil server, dengan perlindungan Origin yang sudah ada):

- `POST /api/instagram/posts` menerima `requestId`, `igUserId`, `fileId`, dan `caption` opsional. File harus merupakan hasil milik akun login, dan akun Instagram harus milik akun login dengan token serta izin yang valid.
- `GET /api/instagram/posts/:id` membaca status tersimpan.
- `POST /api/instagram/posts/:id/advance` memeriksa container dan menerbitkan ketika Meta mengembalikan `FINISHED`. Dialog memeriksa ulang setiap satu menit ketika masih diproses; tombol **Periksa status** juga tersedia. Jika dialog ditutup, pemeriksaan otomatis berhenti.

Migrasi menambahkan tabel `instagram_posts` melalui `migrateInstagramOfficial()`. Request ID unik per akun dan hash payload mencegah pengiriman duplikat dari klik ganda/percobaan ulang. Klaim atomik `processing` → `publishing` memastikan hanya satu panggilan `media_publish`. Kegagalan yang terjadi setelah panggilan publish menghasilkan status `unknown`; aplikasi tidak menerbitkan ulang secara otomatis. Pengguna perlu memeriksa akun Instagram. Permintaan `preparing`/`publishing` yang terputus ditutup setelah satu menit saat status dibaca; proses container dihentikan setelah lima menit. Request ID tetap digunakan jika respons jaringan hilang.

Pemeriksaan sebelum publish gagal dengan aman tanpa mengambil file akun lain atau mengekspos token. Token hanya dipakai pada header Authorization ke Meta. Log dan respons publik tidak menyertakan token maupun respons mentah Meta.

Referensi alur media/container/publish: [Instagram API — koleksi resmi Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) dan [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing).

Validasi menggunakan MySQL terisolasi dan Meta tiruan:

```sh
npm run check
npm run test:isolated -- test/components/instagram/official-posts.test.ts test/components/instagram/official.test.ts test/components/ai/content-jobs.test.ts scripts/checks/browser-content-check.ts
```

Pemeriksaan browser mencakup 1280 px dan 390 px, dialog, caption, akun kosong, publikasi melalui API, status tersimpan, dan gambar sementara JPEG yang dapat diambil Meta tiruan. Posting ke akun Instagram sungguhan **belum diuji**.

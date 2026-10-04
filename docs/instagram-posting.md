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

## Reels API-first

Reels hanya menerima URL HTTP/HTTPS publik di API v1, bukan upload dashboard atau `fileId` video. Alur menggunakan Instagram Login resmi yang sudah terhubung dan graph `/v23.0`: container dikirim dengan `media_type=REELS`, `video_url` salinan lokal dan caption, dipoll sampai `FINISHED`, lalu `media_publish` dengan klaim SQL atomik. Acuan: [Meta Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing) dan [catatan spesifikasi upstream](META-REELS-SPEC.md). Halaman resmi Meta diperiksa langsung dalam investigasi awal; sebagian akses browsing oleh implementer gagal. Validasi lokal adalah subset konservatif, bukan jaminan diterima Meta. Belum ada pengujian live.

### Kebijakan konservatif NC-WA (bukan maksimum Meta)

- Maksimal 64 MiB per MP4, timeout unduhan 120 detik; gambar tetap memakai default downloader 30 detik.
- Signature `ftyp` dan hasil JSON `ffprobe` wajib valid: satu video H264, paling banyak satu audio AAC (boleh tanpa audio), 23–60 fps, durasi 3–180 detik. Video yuv420p/progressive (field order unknown diperbolehkan), AAC 8–48 kHz mono/stereo.
- Lebar/tinggi 16–1920 piksel, maksimal 3.686.400 piksel. Rasio 0,01:1 sampai 10:1. 1080×1350 (4:5) dan 1080×1920 (9:16) diterima dan dipertahankan. Tidak ada crop atau transcode; byte sumber tidak diubah.
- Maksimal dua persiapan aktif (staging unduhan hingga 128 MiB), salinan diserialkan dengan maksimum dua pekerjaan, delapan video tersimpan (hingga 512 MiB), dan satu `.part` hingga 64 MiB. Anggarkan setidaknya 704 MiB disk khusus pipeline video di luar gambar. Kuota per proses; jalankan satu proses aplikasi untuk satu storage root, jangan berbagi root antar worker.
- Direktori terpisah `storage/files/instagram-outbound-video` mode privat, file 0600; salinan streaming atomik melalui `.part`, token acak 256 bit dengan TTL satu jam. Cleanup ketika gagal, pruning setiap menit dan sebelum salinan baru. File staging selalu dibersihkan. Setelah crash, `.part` dibersihkan ketika waktu token kedaluwarsa.
- URL `APP_ORIGIN/instagram/video/<token>` publik tanpa auth agar dapat diambil Meta, `video/mp4`, `nosniff`, `private, no-store`, mendukung HTTP Range melalui `sendFile`. Token invalid/traversal/kedaluwarsa menghasilkan 404. Jangan membagikan token sementara; jangan mencatat query URL sumber yang mungkin mengandung akses sementara.
- Downloader lama tetap memeriksa IP publik, DNS terkunci, setiap redirect (maksimal tiga), ukuran header maupun stream. Tidak ada bypass keamanan produksi atau plain fetch untuk video.
- `ffprobe` dipanggil dengan `execFile` tanpa shell, protocol whitelist `file,pipe`, timeout 15 detik dan output maksimal 128 KiB. ffprobe hilang menghasilkan 503; malformed/codec/dimensi/ukuran tidak didukung menghasilkan 400; timeout unduhan 504. Kapasitas penuh menghasilkan 503.
- Timeout status REELS: preparing lima menit dan processing 30 menit; gambar tetap satu/lima menit. Publishing yang terputus menjadi `unknown` setelah satu menit dan tidak diterbitkan ulang otomatis. Type tersimpan menentukan timeout setelah restart.

### Penerapan manual oleh operator

Tidak ada deploy/restart/migrasi database layanan selama implementasi. Sebelum mengaktifkan kode ini, operator perlu menyediakan `ffprobe` di PATH (ffmpeg hanya diperlukan untuk fixture pengujian), memastikan disk dan URL APP_ORIGIN dapat diakses Meta serta Range tidak diblokir proxy, lalu menjalankan migrasi resmi dan restart secara manual sesuai prosedur layanan. Migrasi additive idempoten menambahkan `instagram_posts.media_type ENUM('IMAGE','REELS') NOT NULL DEFAULT 'IMAGE'`; baris lama menjadi IMAGE dan payload hash lama tetap sama. Jangan menjalankan kode baru sebelum migrasi selesai.

Tidak ada login/izin tambahan secara otomatis. Akun tanpa izin content publish tetap ditolak. Meta masih dapat menolak video yang memenuhi kebijakan lokal; kualitas playback dan kompatibilitas provider nyata belum diverifikasi. Bukti pengujian lokal: [REELS-TEST-EVIDENCE.md](REELS-TEST-EVIDENCE.md).

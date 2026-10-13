# TikTok Login Kit — tahap koneksi akun

Pengguna memilih Tambah sesi → TikTok → Hubungkan TikTok. Akun terhubung muncul dalam kisi kartu
Integrasi yang sama dengan Instagram; perpanjangan dan putus koneksi tersedia lewat dialog kartu.
Kartu TikTok juga ditampilkan di daftar sesi Asisten AI. Klik kartu untuk mengelola koneksi.
Daftar akun konten dipisahkan dari pilihan sesi chat agar formulir profil dan balasan DM tetap sesuai kemampuan platform. Koneksi TikTok ini untuk konten; tidak dipasang sebagai
sesi chat atau asisten DM. Satu koneksi TikTok memakai satu slot dari kuota sesi paket yang sama dengan WhatsApp dan Instagram.
Koneksi yang sudah ada otomatis dihitung tanpa harus login ulang; reconnect tidak menambah slot.
Saat paket turun, koneksi TikTok terbaru diprioritaskan hingga batas paket; sisa kuota dipakai sesi chat.
Koneksi yang melebihi batas ditandai nonaktif dan penambahan baru ditolak. Harga paket tidak diubah.

Alur: pengguna NC-WA yang login menekan Hubungkan TikTok → memberi izin di TikTok → callback NC-WA
memverifikasi state dan cookie browser → menukar kode di server → membaca profil dasar → menyimpan token
terenkripsi → mengarahkan kembali ke halaman Integrasi.

## Konfigurasi

Isi `TIKTOK_CLIENT_KEY` dan `TIKTOK_CLIENT_SECRET` di `.env` dengan kredensial Sandbox.
Kunci enkripsi `PAYMENT_ENCRYPTION_KEY` yang sudah digunakan aplikasi juga dipakai untuk token TikTok;
jangan mengganti kunci yang sudah dipakai menyimpan data.

Saat domain publik siap, gunakan `APP_ORIGIN=https://ncwa.nuscode.id` tanpa slash penutup.
Redirect URI Login Kit harus persis `https://ncwa.nuscode.id/auth/tiktok/callback`.
URL localhost hanya untuk pengembangan/tes dengan provider tiruan; TikTok Web memerlukan redirect HTTPS.
Jangan mengganti APP_ORIGIN sebelum konfigurasi domain siap karena origin ini juga dipakai integrasi lain.

Jalankan `npm run migrate`, build, dan restart aplikasi sesuai prosedur deploy yang digunakan.
Di TikTok Developer Portal, simpan Login Kit, Content Posting API, dan scopes
`user.info.basic`, `video.publish`, `video.upload`. Akun penguji harus terdaftar di Target Users Sandbox.

## Sandbox melalui Cloudflare Tunnel dev

Tunnel `ncwa-dev.nuscode.id` diteruskan dengan service HTTP ke `127.0.0.1:8069`.
Konfigurasi lokal memakai `APP_ORIGIN=https://ncwa-dev.nuscode.id` dan `TRUST_PROXY_HOPS=1`
untuk satu cloudflared yang langsung mengakses aplikasi. Restart proses dev setelah mengubah `.env`.

Di Sandbox TikTok, sesuaikan Website URL menjadi `https://ncwa-dev.nuscode.id/`, Terms of Service
menjadi `https://ncwa-dev.nuscode.id/terms`, Privacy Policy menjadi `https://ncwa-dev.nuscode.id/privacy`,
dan Login Kit Web Redirect URI menjadi `https://ncwa-dev.nuscode.id/auth/tiktok/callback`.
Simpan dengan Apply changes. Login NC-WA dan mulai koneksi TikTok dari domain dev yang sama.
Pengaturan APP_ORIGIN ini juga mengubah URL callback integrasi lain; saat mengujinya melalui domain dev,
redirect pada portal provider terkait harus sesuai.

## API dashboard

- `POST /api/tiktok/start`: sesi login dan Origin yang valid; mengembalikan URL izin dan memasang cookie HttpOnly.
- `GET /auth/tiktok/callback`: publik, memerlukan state sekali pakai dan cookie browser yang cocok.
- `GET /api/tiktok/connections`: profil, scopes yang benar-benar diberikan, dan status masa berlaku; tanpa token.
- `POST /api/tiktok/connections/:id/refresh`: memperpanjang izin milik akun saat ini dan menyimpan rotasi token.
- `DELETE /api/tiktok/connections/:id`: mencoba revoke TikTok lalu menghapus token lokal. Bila revoke gagal,
  dashboard meminta pengguna mencabut izin melalui pengaturan TikTok.

State berlaku 10 menit dan disimpan sebagai hash. Cookie OAuth khusus memakai SameSite=Lax untuk callback
lintas situs; cookie sesi login NC-WA tetap memakai pengaturan yang sudah ada. Koneksi TikTok yang sudah
dimiliki tenant lain ditolak. Pengguna boleh menolak scope posting; dashboard menampilkan izin yang diberikan.

## Direct Post foto dari Pustaka konten

Tombol **Post TikTok** ada di setiap gambar hasil Konten. Dialognya mengikuti pedoman tampilan Content Sharing TikTok:
info kreator dibaca ulang setiap akun dipilih dan nama akun tujuan ditampilkan; privasi dipilih dari
`privacy_level_options` tanpa nilai bawaan; "Izinkan komentar" tidak dicentang dan dinonaktifkan bila kreator
mematikannya; pengungkapan konten komersial ("Brand Anda" → label *Promotional content*, "Konten bermerek" → label
*Paid partnership*, konten bermerek tidak boleh "Hanya saya"); teks persetujuan Music Usage Confirmation (ditambah
Branded Content Policy untuk konten bermerek); pratinjau foto; dan pemberitahuan bahwa pemrosesan butuh beberapa menit.
Satu posting berisi 1–35 foto dari Pustaka; foto pertama menjadi sampul. Posting tidak memotong kredit.

Alur server (`domain/posts.ts`, tabel `tiktok_posts`):

1. `postingToken` menolak koneksi di luar kuota sesi paket atau tanpa scope `video.publish`, lalu memperpanjang token
   akses bila sisa masa berlakunya kurang dari 10 menit (token TikTok hanya 24 jam).
2. Info kreator dibaca ulang; privasi harus ada di pilihan kreator.
3. Foto diubah ke JPEG maksimal 1080×1920 (tegak) atau 1920×1080 (mendatar) dan disimpan sementara di
   `storage/files/tiktok-outbound` (berlaku 2 jam, maksimum 350 file). TikTok mengambilnya lewat
   `APP_ORIGIN/tiktok/media/<token-acak>` tanpa cookie (PULL_FROM_URL).
4. Status `preparing → publishing` diklaim tepat sebelum `POST /v2/post/publish/content/init/` (`DIRECT_POST`, `PHOTO`).
   Penolakan dengan kode TikTok menjadi `failed`; timeout, koneksi putus, atau 5xx menjadi `unknown` dan tidak pernah
   dikirim ulang otomatis karena init Direct Post bisa sudah menerbitkan.
5. `GET /api/tiktok/posts/:requestId` menanyakan `status/fetch`: `PUBLISH_COMPLETE` → `published`, `FAILED` → `failed`
   dengan `fail_reason`. Dashboard memeriksa ulang setiap 15 detik.

API dashboard tambahan:

- `GET /api/tiktok/connections/:id/creator`: nama, username, avatar, pilihan privasi, dan status komentar kreator.
- `POST /api/tiktok/posts`: `requestId`, `openId`, `fileIds` (1–35), `title` (≤90), `description` (≤4000),
  `privacyLevel`, `allowComment`, `brandOrganic`, `brandContent`. Request ID yang sama dengan isi sama mengembalikan
  status tersimpan; isi berbeda ditolak `idempotency_conflict`.
- `GET /api/tiktok/posts/:requestId`: status (`preparing`, `publishing`, `processing`, `published`, `failed`,
  `unknown`), jumlah foto, serta kode dan pesan error.

**Wajib sebelum mencoba dengan TikTok sungguhan:** di Developer Portal, verifikasi kepemilikan URL Prefix
`https://<domain>/tiktok/media/` (atau Domain) untuk domain `APP_ORIGIN`; tanpa itu init ditolak
`url_ownership_unverified`. Selama aplikasi belum diaudit TikTok: maksimal 5 pengguna per 24 jam, akun TikTok harus
privat, dan posting hanya bisa "Hanya saya" (`unaudited_client_can_only_post_to_private_accounts`). Batas TikTok lain:
6 init per menit per token dan sekitar 15 posting per hari per kreator.

## Direct Post video lewat API v1 (NC Post)

Aplikasi lain memakai API key integrasi yang sama (`ncig_…`, dibuat di Integrasi › API untuk aplikasi lain) dengan
scope `tiktok:accounts:read` dan/atau `tiktok:posts:publish`. Header: `Authorization: Bearer ncig_…`; batas 120
permintaan per menit per key. Akun TikTok yang bukan milik pemilik key dijawab 404.

| Scope | Endpoint |
|---|---|
| `tiktok:accounts:read` | `GET /api/v1/tiktok/accounts` (id = `open_id`, nama, scope, status masa berlaku, `serviceActive`) |
| `tiktok:posts:publish` | `GET /api/v1/tiktok/accounts/:id/creator` (nama, username, avatar, `privacyOptions`, `commentDisabled`, `duetDisabled`, `stitchDisabled`, `maxVideoDurationSec`) |
| `tiktok:posts:publish` | `POST /api/v1/tiktok/posts`, lalu `GET /api/v1/tiktok/posts/:requestId` berulang sampai `published`, `failed`, atau `unknown` |

```http
POST /api/v1/tiktok/posts
Authorization: Bearer ncig_…
Content-Type: application/json

{"requestId":"tt-001","openId":"<id akun>","mediaType":"VIDEO","videoUrl":"https://media.example/video.mp4",
 "title":"Caption #hashtag","privacyLevel":"SELF_ONLY","allowComment":false,"allowDuet":false,"allowStitch":false,
 "brandOrganic":false,"brandContent":false}
```

- Semua pilihan (`privacyLevel`, `allowComment`, `allowDuet`, `allowStitch`, `brandOrganic`, `brandContent`) wajib dikirim
  eksplisit; tidak ada nilai bawaan. `privacyLevel` harus salah satu `privacyOptions` dari info kreator; Duet/Stitch/
  komentar yang dimatikan kreator ditolak 409; konten bermerek tidak boleh `SELF_ONLY`.
- `title` adalah caption video (maks 2.200 karakter). Video: MP4 H.264/AAC, 3–180 detik, maks 64 MB (pemeriksa yang
  sama dengan Reels) dan tidak melebihi `maxVideoDurationSec` akun. Video diunduh dan diperiksa sebelum permintaan
  dicatat; video yang ditolak tidak meninggalkan baris dan boleh dikirim ulang dengan request ID yang sama.
- NC-WA menyalin video ke `APP_ORIGIN/tiktok/media/<acak>.mp4` (prefiks yang sama dengan foto) lalu memanggil
  `POST /v2/post/publish/video/init/` dengan `PULL_FROM_URL`. Status `unknown` berarti hasil init tidak pasti: periksa
  akun TikTok, jangan mengirim ulang dengan request ID baru secara otomatis.
- **Pedoman tampilan TikTok wajib dipenuhi aplikasi pemanggil (NC Post):** tampilkan nama kreator dari info kreator,
  pilihan privasi tanpa nilai bawaan, interaksi tidak dicentang, pengungkapan konten komersial beserta labelnya,
  teks persetujuan Music Usage Confirmation (dan Branded Content Policy untuk konten bermerek), pratinjau video,
  dan pemberitahuan bahwa pemrosesan butuh beberapa menit.

**Test Post TikTok** di Integrasi menguji alur yang sama dari dashboard (`POST /api/tiktok/test-post` dengan
`consent: true`), untuk pemilik akun sebelum NC Post memakainya.

## Batas tahap ini

Unggah video dari perangkat (FILE_UPLOAD), video di atas 64 MB/180 detik, mode kirim ke draf/inbox, refresh token terjadwal, daftar riwayat posting, dan webhook
TikTok belum diimplementasikan. Direct Post video sudah dicoba pemilik ke TikTok sungguhan (Sandbox, akun privat, "Hanya saya") lewat Test Post di Integrasi dan terbit (2026-10-13; MP4 H.264/AAC 960×540, 5 detik). Domain `ncwa-dev.nuscode.id` sudah diverifikasi lewat record TXT DNS. Direct Post foto belum diuji dengan TikTok sungguhan. Tes otomatis memakai TikTok tiruan dan menghapus media sementara buatannya sendiri, karena ditulis ke `storage/` yang sama dengan server dev.

Tes otomatis memakai provider tiruan. Login dengan akun TikTok sungguhan berhasil diuji pemilik
melalui domain dev pada 8 Oktober 2026. Revoke dengan akun TikTok sungguhan belum diuji.

Validasi lokal 8 Oktober 2026: 14 tes TikTok (termasuk kuota bersama dan callback paralel), 14 tes regresi Instagram, pemeriksaan browser TikTok
pada lebar 1280 dan 390 px, build, serta `npm run check` lulus. Migrasi database pengembangan sudah dijalankan.
Pemeriksaan browser Integrasi yang lebih panjang belum lulus: percobaan awal mencapai batas API
120 permintaan per menit (HTTP 429), kemudian langkah berikutnya timeout. Percobaan dengan daftar TikTok
ditirukan di browser melewati bagian Integrasi tetapi timeout saat menunggu tombol putus sesi di Asisten AI.
Perubahan diagnosis pada skrip regresi sudah dibuang; batas API produksi tidak diubah.

Referensi resmi:

- https://developers.tiktok.com/docs/en/login-kit-web
- https://developers.tiktok.com/docs/en/oauth-user-access-token-management
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/add-a-sandbox

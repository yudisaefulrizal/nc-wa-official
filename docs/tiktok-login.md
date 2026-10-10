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

## Batas tahap ini

Login Kit, daftar koneksi, refresh manual, dan putus koneksi sudah diimplementasikan. Refresh terjadwal,
unggah konten, Direct Post, pelacakan status publikasi, serta webhook TikTok belum diimplementasikan.
Kebijakan privasi tetap menyebut fitur posting dalam pengembangan. Publikasi video publik di Sandbox
tidak tersedia. Jangan menganggap Direct Post sudah siap hanya karena scope muncul di portal.

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

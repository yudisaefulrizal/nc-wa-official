# Verifikasi akhir NC-WA Reels

Implementasi API tersedia di working tree; belum diterapkan pada layanan aktif dan belum diuji dengan akun Meta live. Tidak ada commit/push, restart layanan, migrasi database layanan, atau perubahan ncpost-web.

## Hasil eksekusi

- Log focused `/tmp/reels-release-verification.log` dibaca ulang secara programatik: **48 tests, 48 pass, 0 fail, 0 cancelled, 0 skipped**. Enam suite mencakup publisher, API integrasi, gambar lama, penyimpanan video, hardening MP4 dan downloader.
- Parent menjalankan seluruh `npm run test:isolated`: **349 tests, 347 pass, 2 fail, 0 cancelled, 0 skipped**. Log `/tmp/ncwa-reels-full-suite.log`.
- Kedua kegagalan di luar jalur Reels direproduksi pada source **HEAD sebelum perubahan**, yang diekstrak ke direktori temporer privat dengan dependency lokal dan MySQL terisolasi. Direktori temporer dihapus setelah pengujian.
  - `test/components/account/recovery.test.ts:82`: `Login limiter stops repeated attempts`, assertion `false !== true`. Log `/tmp/ncwa-reels-baseline-tests.log`.
  - `test/components/ai/chat.test.ts:114`: urutan IN1/IN2 terbalik. Log `/tmp/ncwa-reels-baseline-chat-1.log` (3 tests, 2 pass, 1 fail). Runner baseline pertama berhenti di kegagalan login; chat kemudian diuji terpisah, bukan diasumsikan telah berjalan.
- `npm run build`, `tsc --noEmit`, dan pemeriksaan struktur: lulus.
- Prettier seluruh source/test yang diubah: lulus. Tes hardening milik parent diformat setelah snapshot laporan implementer.
- `npm run check` keseluruhan masih gagal hanya karena format `public/dashboard/js/pages/ai-sessions.js`. Isi HEAD file tersebut diuji dengan konfigurasi Prettier proyek dan juga gagal; `git diff --exit-code -- public/dashboard/js/pages/ai-sessions.js` membuktikan file tidak diubah. Log `/tmp/ncwa-reels-parent-check.log`.
- `npm audit --omit=dev`: **0 vulnerability produksi**. Log JSON `/tmp/ncwa-reels-prod-audit.json`. Ini bukan audit keamanan lengkap aplikasi.
- `git diff --check`: lulus.
- OpenAPI aktual diekspor dari constructor dan schema POST diuji dengan jsonschema: 3 payload sah (gambar lama, IMAGE eksplisit, REELS) diterima; 4 payload salah (video tanpa tipe, campuran gambar/video, Reels tanpa video, tipe VIDEO) ditolak. Ekspor `/tmp/ncwa-reels-openapi-candidate.json`. Ini validasi schema request, bukan sertifikasi seluruh OpenAPI.
- Parent membuat MP4 asli dengan ffmpeg (H264, yuv420p, AAC mono 48 kHz, 320x400, 30 fps, tiga detik, faststart); validator menerimanya. Fixture HTML ditolak dengan `invalid_video`. Fixture hanya data QA lokal, bukan konten produksi dan bukan respons provider.
- Scan statis perubahan produksi: tidak menemukan assignment kredensial hardcoded atau pola shell/eval. Review statis independen read-only selesai: passed=true, security_concerns=[] dan logic_errors=[]. Tidak ditemukan blocker baru pada diff Reels. Satu saran non-blocking: jika pembaruan status gagal karena DB bermasalah, cleanup video sebaiknya tetap dijalankan melalui finally; saat ini salinan tetap dibatasi kuota dan TTL sampai pruning. Saran ini belum diimplementasikan. Verdict ini bukan sertifikasi keamanan seluruh aplikasi maupun bukti pengujian Meta live.

## Kontrak penggunaan

POST `/api/v1/instagram/posts`, Authorization Bearer key dengan scope `posts:publish`:

```json
{
  "requestId": "ncpost-bab-001-video-v1",
  "igUserId": "ID_AKUN_INSTAGRAM",
  "mediaType": "REELS",
  "videoUrl": "https://media.example/video.mp4",
  "caption": "Caption artikel"
}
```

`videoUrl` contoh di atas adalah placeholder; sediakan URL HTTP/HTTPS publik yang benar-benar dapat diunduh NC-WA tanpa cookie/header tambahan. Input gambar dan video tidak boleh dicampur. Payload gambar lama tanpa mediaType tetap IMAGE. Caption maksimal 2.200 karakter. Status dipoll melalui GET `/api/v1/instagram/posts/<requestId>`; pada `unknown`, periksa akun Instagram sebelum membuat permintaan baru. Tidak ada fallback gambar/carousel atau retry publish otomatis.

Batas awal NC-WA: MP4 maksimal 64 MiB, durasi 3–180 detik, 23–60 fps, H264 yuv420p; audio opsional AAC mono/stereo 8–48 kHz; ukuran frame 16–1920 pada kedua sumbu dan rasio 0,01–10. Video 4:5 maupun 9:16 diterima tanpa transcode/crop. Ini subset kebijakan lokal, bukan seluruh batas Meta atau jaminan publikasi berhasil. Detail kuota disk, protokol, TTL dan timeout ada di [instagram-posting.md](instagram-posting.md).

## Aktivasi oleh operator, tidak dieksekusi dalam pengerjaan ini

1. Backup database dan tinjau prosedur migrasi layanan; pastikan ffprobe tersedia serta APP_ORIGIN publik dan Range dapat dilewati proxy. Gunakan satu proses aplikasi per storage root sesuai batas kuota saat ini.
2. Dari root proyek, jalankan `npm run migrate` sesuai prosedur operator sebelum memakai kode baru. Perintah resmi ini memigrasikan semua komponen, bukan hanya Reels; tambahan Reels adalah `instagram_posts.media_type` dengan default IMAGE dan mempertahankan hash historis.
3. Jalankan `npm run build`, kemudian restart melalui supervisor layanan yang memang dipakai. Tidak ada nama service/supervisor yang diasumsikan di sini.
4. Periksa dokumen OpenAPI dan status akun/key; lakukan smoke live hanya dengan izin eksplisit dan video/akun tujuan yang ditentukan.
5. Integrasi ncpost-web masih tahap terpisah: renderer, sumber video publik, konfigurasi key dan pemakaian kontrak Reels belum diubah oleh tugas ini.

Bukti TDD implementer: [REELS-TEST-EVIDENCE.md](REELS-TEST-EVIDENCE.md). Laporan tersebut adalah snapshot sebelum verifikasi parent ini dan tidak diganti dengan angka yang terlihat lebih baik.

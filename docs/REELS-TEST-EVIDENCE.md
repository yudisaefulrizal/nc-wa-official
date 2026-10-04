# Bukti pengujian Instagram Reels

Tanggal: 5 Oktober 2026. Seluruh pekerjaan kode berada di repo `nc-wa-official`. Semua tes database memakai `npm run test:isolated` dengan MySQL temporer milik runner. Runner diizinkan memuat config melalui `--env-file=.env`; tidak ada pembacaan/cetak `.env`, file auth atau kredensial. Tidak memakai `npm test`, database layanan, provider internet nyata atau panggilan berbayar. MP4 dibuat dengan ffmpeg di tmpdir, H264/AAC tiga detik; file sumber tidak ditranscode dalam pipeline produksi.

## Perintah aktual dan RED/GREEN

Perintah berikut dijalankan berulang sesuai slice; stdout/stderr diarahkan ke berkas log `/tmp` yang disebut di tabel (`> /tmp/<nama>.log 2>&1`). Angka di tabel berasal dari TAP aktual, bukan estimasi. Runner berhenti pada suite pertama yang gagal.

```bash
# P
npm run test:isolated -- test/components/instagram/official-posts.test.ts
# V
npm run test:isolated -- test/components/instagram/outbound-video.test.ts
# D
npm run test:isolated -- test/libraries/download.test.ts
# H (tes independen yang muncul di workspace, tidak diedit oleh implementasi ini)
npm run test:isolated -- test/components/instagram/reels-hardening.test.ts
# VD/P
npm run test:isolated -- test/components/instagram/outbound-video.test.ts test/components/instagram/official-posts.test.ts
# VPD
npm run test:isolated -- test/components/instagram/outbound-video.test.ts test/components/instagram/official-posts.test.ts test/libraries/download.test.ts
```

| Slice / perintah | RED aktual | Implementasi / GREEN aktual | Log `/tmp` |
|---|---|---|---|
| Tipe dan kombinasi, P | 7 pass, 1 fail: unsupported type mendapat 200, expected 400 | Validasi eksplisit: 8/8 pass | `reels-red1.log`, `reels-green1.log` |
| MP4/store, V | File test gagal dimuat: 0 pass, 1 fail, modul video belum ada. Ini RED pemuatan modul, bukan assertion perilaku | Store streaming dan ffprobe: 2/2 pass | `reels-red2.log`, `reels-green2.log` |
| Timeout configurable, D | 4 pass, 1 fail: unduhan berjalan 30.018 ms, expected <1.000 ms | `timeoutMs`, default tetap 30 detik: 5/5 pass, timeout fixture sekitar 22 ms | `reels-red3b.log`, `reels-green3.log` |
| API Reels, P | 8 pass, 1 fail: expected 202, actual 400 ketika jalur Reels belum diaktifkan | Reels, Range 206, SQL type, hash, polling/publish: 9/9 pass | `reels-red4c.log`, `reels-green4b.log` |
| MOV disguised MP4, VD/P | V: 2 pass, 1 fail, MOV diterima; P belum dijalankan karena runner berhenti | Cek major brand MP4: V 3/3 pass | `reels-red5.log`, `reels-green567.log` |
| Null type / dashboard, P | 9 pass, 1 fail: null mendapat 200, expected 400 | Null ditolak, dashboard gambar saja; P 10/10 pass setelah koreksi tes ownership ke API v1 | `reels-red6.log`, `reels-green567.log` |
| DNS deadline, D | 5 pass, 1 fail: koneksi dibuka setelah DNS 200 ms walau deadline 20 ms, error fixture bukan TimeoutError | Deadline juga membatasi DNS/open: 6/6 pass | `reels-red7b.log`, `reels-green567.log` |
| Hardening independen, H | 0 pass, 4 fail: chroma 4:4:4, AAC 96 kHz, 6 kanal, rasio >10:1 tidak ditolak | Probe pix_fmt/field_order/sample_rate/channels dan rasio: 4/4 pass | `reels-red8.log`, `reels-green8.log` |
| Type array API, P | 12 pass, 1 fail: expected 400, actual 500 untuk `mediaType:["IMAGE"]` | Perbandingan tipe ketat, hash IMAGE historis diverifikasi: 13/13 pass | `reels-red9b.log`, `reels-green911.log` |
| Symlink token, V | 5 pass, 1 fail: symlink mengikuti file lain | `lstat` pada akses token: 8/8 pass termasuk coverage timeout probe 15 detik dan queue | `reels-red10.log`, `reels-green10.log` |
| Cleanup setelah salinan sukses, V | 10 pass, 1 fail: cleanup staging gagal meninggalkan token publik | Token dihapus sebelum propagasi error; hasil GREEN ada pada suite final | `reels-red12.log`, `reels-release-verification.log` |
| Range di luar file, P | 12 pass, 1 fail: expected 416, actual 500 | Penanganan 416 hanya di rute video: 13/13 pass | `reels-red11.log`, `reels-green911.log` |

Koreksi harness yang tidak dihitung sebagai RED fitur:

- `reels-red3.log`: D, empat pass dan satu cancelled karena stream tiruan tanpa handle hidup; ditambah keepalive sebelum mengukur timeout aktual di RED berikutnya.
- `reels-red4.log`: P, gagal pemuatan export `postMediaSource`; `reels-red4b.log` dan `reels-green4.log`: P, delapan pass/satu fail karena fixture mengharapkan key creation 200 padahal kontrak lama 201. Setelah koreksi fixture, jalur posting dikembalikan sementara ke tahap gambar untuk mendapatkan assertion RED `202 vs 400` (`reels-red4c.log`), lalu implementasi Reels diaktifkan kembali. RED tersebut bukan kegagalan pada revisi final.
- `reels-green56.log`: V 3/3 pass, P 9 pass/1 fail karena tes ownership video masih memakai endpoint dashboard yang kini memang menolak video 400; tes dipindahkan ke API v1 dan GREEN di `reels-green567.log` (V 3/3, P 10/10, D 6/6).
- `timeout 8s npm run test:isolated -- test/libraries/download.test.ts` (`reels-red7.log`) terhenti exit 124 sebelum assertion DNS; tidak dianggap RED fitur. Diganti fixture DNS tertunda 200 ms agar runner bisa selesai dan membersihkan MySQL temporer normal.
- `reels-red9.log`: P 13/13 pass, menunjukkan penolakan array di dashboard saja belum menguji API v1. Assertion API ditambahkan, lalu RED aktual pada `reels-red9b.log`.

## Verifikasi keseluruhan

Run awal dengan tiga suite yang diminta dan video/download:

```bash
npm run test:isolated -- test/components/instagram/official-posts.test.ts test/components/instagram/integration-api.test.ts test/components/instagram/outbound-media.test.ts test/components/instagram/outbound-video.test.ts test/libraries/download.test.ts > /tmp/reels-targeted.log 2>&1
```

Hasil aktual: official-posts 12/12, integration-api 11/11, outbound-media 3/3, outbound-video 5/5, download 6/6; total **37 pass, 0 fail**.

Run berikutnya menambahkan hardening, probe timeout/output bounds dan regresi tambahan (`/tmp/reels-final-targeted.log`): official-posts 13/13, integration-api 11/11, outbound-media 3/3, outbound-video 8/8, hardening 4/4, download 6/6; total **45 pass, 0 fail**.

Run coverage batas staging/cleanup (`/tmp/reels-verified.log`): official-posts 13/13, integration-api 11/11, outbound-media 3/3, outbound-video 10/10, hardening 4/4, download 6/6; total **47 pass, 0 fail**.

Perintah final setelah perbaikan cleanup pasca-salinan:

```bash
npm run test:isolated -- test/components/instagram/official-posts.test.ts test/components/instagram/integration-api.test.ts test/components/instagram/outbound-media.test.ts test/components/instagram/outbound-video.test.ts test/components/instagram/reels-hardening.test.ts test/libraries/download.test.ts > /tmp/reels-release-verification.log 2>&1
npm run check > /tmp/reels-release-check.log 2>&1
npm run build > /tmp/reels-release-build.log 2>&1
git diff --check
```

Hasil final: **48 pass, 0 fail, 0 cancelled/skipped**; runner exit 0.

| Suite | Pass | Fail |
|---|---:|---:|
| official-posts | 13 | 0 |
| integration-api | 11 | 0 |
| outbound-media (gambar lama) | 3 | 0 |
| outbound-video | 11 | 0 |
| reels-hardening | 4 | 0 |
| download | 6 | 0 |

`npm run build`: exit 0. `git diff --check`: tidak ada error. `npm run check`: exit 1; TypeScript dan pemeriksaan struktur lulus, Prettier memperingatkan hanya `test/components/instagram/reels-hardening.test.ts` (tes independen) dan `public/dashboard/js/pages/ai-sessions.js` (di luar scope perubahan). Keduanya tidak ditulis ulang. Perintah check/build juga telah dijalankan sebelumnya dengan hasil sama (`/tmp/reels-check.log`, `/tmp/reels-build.log`, `/tmp/reels-final-check.log`, `/tmp/reels-final-build.log`). `npx tsc --noEmit` juga lulus sebelum tahap hardening; build/check final memverifikasi TypeScript setelah perubahan produksi terakhir.

## Cakupan dan batas bukti

Teruji: API v1 → downloader dengan resolver/open fixture yang tetap menjalankan validasi IP/DNS/redirect/size → MP4 nyata → token publik Range 206/416 → payload Meta REELS tanpa image_url → IN_PROGRESS → FINISHED → klaim publish sekali; repeat/conflict URL/tipe/caption; scope/ownership/permission; hash/default gambar historis; invalid input/media/oversize/timeout tanpa reservasi; sumber tetap utuh; container failure menghapus salinan; respons publish gagal menjadi unknown tanpa retry; timeout status persisten IMAGE/REELS; codec/fps/dimensi/chroma/audio; ffprobe hilang 503, malformed/large output/hang; token expiry/traversal/symlink; kapasitas storage/copy/staging; regression suite gambar/API.

Fixture DNS/open hanya dependency injection di test, bukan flag bypass produksi. `ffprobe` produksi memakai execFile tanpa shell, whitelist file/pipe, timeout/output bound. Batas 64 MiB/120 detik/180 detik adalah kebijakan produk NC-WA, bukan maksimum Meta. Kuota proses tunggal dan penerapan manual dijelaskan di instagram-posting.md.

Belum teruji: Meta live, unduhan provider internet nyata, playback Instagram/proxy produksi, deployment multiworker, seluruh test repository, dashboard browser. Tidak ada commit/push, restart, deploy, publish live, login baru, atau perubahan `ncpost-web`. Migrasi hanya dijalankan oleh runner pada MySQL temporer; operator harus migrasi additive/restart manual saat penerapan.

## Berkas implementasi

- `src/components/instagram/domain/official-posts.ts`, `official-video.ts`: kontrak, hash/status, pipeline dan payload Meta.
- `src/components/instagram/data-access/posts-queries.ts`, `schema.ts`, `outbound-video-store.ts`: tipe persisten/migrasi additive dan store video terpisah.
- `src/components/instagram/entry-points/integration-routes.ts`, `routes.ts`: API URL-only, dashboard gambar, publik video/Range.
- `src/libraries/download.ts`: timeout configurable termasuk DNS/open.
- `src/components/instagram/domain/integration-openapi.ts`: oneOf IMAGE/REELS, contoh, response mediaType.
- `test/components/instagram/official-posts.test.ts`, `outbound-video.test.ts`, `test/libraries/download.test.ts`: fixture dan pengujian.
- `docs/instagram-api.md`, `instagram-posting.md`, `REELS-TEST-EVIDENCE.md`: dokumentasi penggunaan, kebijakan, penerapan dan bukti.

`docs/META-REELS-SPEC.md` dan `test/components/instagram/reels-hardening.test.ts` muncul sebagai artefak independen di workspace selama pengerjaan; implementasi tidak mengubah keduanya, tetapi menjalankan tes hardening dan menutup RED yang ditemukannya.

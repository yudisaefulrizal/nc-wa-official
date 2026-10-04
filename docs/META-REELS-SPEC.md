# Referensi spesifikasi Reels Meta

Diperiksa langsung dari dokumentasi resmi pada pengerjaan ekstensi Reels. Ini referensi upstream, bukan klaim pengujian akun live.

- Instagram Login publishing: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
- Media endpoint reference: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media

Dokumentasi publishing menyatakan Reels memakai `media_type=REELS` dan `video_url`, dilanjutkan pemeriksaan container dan `media_publish`. Respons media dapat memiliki `media_type=VIDEO`; `media_product_type` membedakan Reels.

Referensi endpoint yang diperiksa menyebut:
- MOV atau MP4, tanpa edit lists, moov atom di depan.
- Audio AAC, sample rate maksimum 48 kHz, mono/stereo.
- Video HEVC atau H264, progressive, closed GOP, chroma 4:2:0.
- Frame rate 23–60 FPS, lebar maksimum 1920 px.
- Aspek antara 0.01:1 dan 10:1; 9:16 disarankan, bukan satu-satunya rasio yang diterima.
- Video bitrate VBR maksimum 25 Mbps; audio bitrate 128 kbps.
- Durasi 3 detik sampai 15 menit; ukuran maksimum 300 MB.

Ekstensi NC-WA boleh menerapkan subset konservatif (MP4 H264, 64 MiB, maksimum 180 detik) untuk menjaga resource lokal; dokumentasi API harus membedakan kebijakan produk itu dari batas Meta. Validasi lokal tidak otomatis membuktikan semua ketentuan Meta terpenuhi; pemrosesan container Meta tetap menjadi gate terakhir. Untuk generator yang dikendalikan aplikasi, gunakan H264 yuv420p progressive, AAC <=48kHz mono/stereo <=128kbps, faststart dan hindari edit list.

Graph version NC-WA saat pemeriksaan v23.0; contoh dokumen terbaru memakai v25.0. Jangan mengubah versi global tanpa tes kompatibilitas DM/komentar/insight. Tidak ada migrasi, perubahan kredensial, atau posting live dilakukan dalam riset ini.

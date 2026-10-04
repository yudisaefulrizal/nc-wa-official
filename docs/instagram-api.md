# API Instagram untuk aplikasi lain

NC-WA menyimpan login Instagram resmi; aplikasi lain memakainya lewat API key tanpa login ke Meta sendiri.

**Key:** Dashboard › Integrasi › "API untuk aplikasi lain" › Generate API key. Pilih izin (scope) per key. Key `ncig_…` tampil sekali; hanya hash yang disimpan. Mencabut key langsung menghentikan aksesnya.

**Autentikasi:** `Authorization: Bearer ncig_…` di setiap permintaan ke `/api/v1/instagram`. Batas 120 permintaan/menit per key.

| Scope | Endpoint |
|---|---|
| `accounts:read` | `GET /accounts` (id akun Instagram, username, status, izin, sisa hari token) |
| `messages:read` | `GET /accounts/:ig/conversations`, `GET /accounts/:ig/conversations/:customer/messages?before=` |
| `messages:send` | `POST /messages` `{ igUserId, to, text }` atau `{ igUserId, to, imageUrl }`; header `Idempotency-Key` opsional. Memotong kredit pesan seperti pengiriman lewat API key akun. |
| `comments:read` | `GET /accounts/:ig/media`, `GET /accounts/:ig/media/:media/comments` (`limit`, `after`) |
| `comments:write` | `POST /accounts/:ig/comments/:comment/replies` `{ message }`, `POST /accounts/:ig/comments/:comment/hide` `{ hide }` |
| `insights:read` | `GET /accounts/:ig/summary` (follower, following, jumlah postingan, dan total bulan ini: views, reach, accounts_engaged, total_interactions, likes, comments, shares, saves, profile_views). Hanya kondisi saat ini: simpan hasilnya tiap pengecekan dan bandingkan untuk melihat perkembangan. Perlu `INSTAGRAM_INSIGHTS=1` di server dan hubungkan ulang akun untuk izin `instagram_business_manage_insights`. |
| `posts:publish` | `POST /posts` `{ requestId, igUserId, imageUrl, caption }` (feed, satu gambar, rasio 1:1–4:5); `GET /posts/:requestId` dipanggil berulang sampai `published` |

`:ig` adalah `id` dari `GET /accounts`. Akun yang bukan milik pemilik key dijawab 404.

**Batas Meta:** balasan DM hanya dalam 24 jam setelah pesan pelanggan. Komentar butuh izin `instagram_business_manage_comments`, posting butuh `instagram_business_content_publish`; akun yang belum memberi izin dijawab 409 dan harus dihubungkan ulang.

**Belum ada:** push pesan/komentar masuk ke aplikasi lain (saat ini lewat membaca percakapan), posting reel/story/carousel, dan balasan DM yang melewati AI agent untuk akun yang diserahkan ke aplikasi lain.

## Video Instagram Reels melalui API v1

Gunakan akun Instagram resmi yang sudah terhubung; scope key tetap `posts:publish` dan izin Meta tetap `instagram_business_content_publish`. Tidak perlu Zernio maupun login baru.

```http
POST /api/v1/instagram/posts
Authorization: Bearer <key-aplikasi>
Content-Type: application/json

{"requestId":"reels-001","igUserId":"17841400000000000","mediaType":"REELS","videoUrl":"https://media.example/video.mp4","caption":"Video baru"}
```

Balasan 200 bila terbit atau 202 bila masih diproses, dengan `requestId`, `status`, `mediaId` dan field tambahan `mediaType`. Poll `GET /api/v1/instagram/posts/reels-001`; GET melanjutkan container yang siap secara aman. Status `unknown` berarti respons publish belum pasti: periksa akun Instagram secara manual, jangan membuat request ID baru untuk mencoba ulang otomatis.

Payload gambar lama `{requestId,igUserId,imageUrl,caption?}` tetap berlaku; `mediaType:"IMAGE"` opsional dan hash idempotensi gambar historis dipertahankan. Reels wajib `mediaType:"REELS"` dan hanya `videoUrl`. Kombinasi video/image/file, tipe lain, serta `fileId` melalui API v1 ditolak 400 tanpa fallback foto. Dashboard tetap menggunakan gambar `fileId`, tanpa upload video.

Request ID identik dengan tipe, sumber dan caption identik mengembalikan posting yang sama. Perubahan tipe/URL/caption dengan request ID yang sama menghasilkan 409. Validasi/unduhan video dilakukan sebelum reservasi posting dan pembuatan container; unduhan invalid dapat dicoba kembali setelah sumber diperbaiki. URL sumber tidak disimpan di tabel posting atau dicetak oleh pipeline.

Batas dan kebutuhan server video ada di [instagram-posting.md](instagram-posting.md). Pengujian menggunakan MP4 nyata lokal dan Meta tiruan; belum diuji publish ke Instagram live.

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

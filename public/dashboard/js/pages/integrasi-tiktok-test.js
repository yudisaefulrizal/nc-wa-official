// Test Post TikTok di Integrasi: Direct Post video dari URL publik lewat alur yang sama dengan API v1 untuk NC Post.
// Pilihan privasi dan interaksi tanpa nilai bawaan sesuai pedoman TikTok; hasil tidak pasti tidak pernah dikirim ulang.
let tiktokTestRequest = '',
  tiktokTestCreator = null;
const tiktokTestPrivacy = {
  PUBLIC_TO_EVERYONE: 'Semua orang',
  MUTUAL_FOLLOW_FRIENDS: 'Teman (saling mengikuti)',
  FOLLOWER_OF_CREATOR: 'Pengikut',
  SELF_ONLY: 'Hanya saya',
};
const tiktokTestStates = {
  preparing: 'Menyiapkan video…',
  publishing: 'Mengirim ke TikTok…',
  processing: 'TikTok sedang memproses video. Tekan Periksa status beberapa saat lagi.',
  published: 'Video sudah terbit di TikTok.',
  failed: 'Posting gagal.',
  unknown: 'Hasil posting belum pasti. Periksa akun TikTok sebelum mengirim ulang.',
};
function loadTiktokTestAccounts() {
  const ready = integrations.tiktok.filter(
    c => c.serviceActive && c.status !== 'expired' && c.scopes.includes('video.publish'),
  );
  const selected = $('tiktok-test-account').value;
  $('tiktok-test-account').replaceChildren(
    new Option(ready.length ? 'Pilih akun TikTok' : 'Belum ada akun TikTok yang siap posting', ''),
    ...ready.map(c => new Option(c.name, c.id)),
  );
  if (ready.some(c => c.id === selected)) $('tiktok-test-account').value = selected;
  else if (ready.length === 1) $('tiktok-test-account').value = ready[0].id;
  if ($('tiktok-test-account').value !== selected) void run(loadTiktokTestCreator);
  updateTiktokTestSubmit();
}
// Info kreator dibaca ulang setiap akun dipilih, karena privasi akun dan batas harian bisa berubah.
async function loadTiktokTestCreator() {
  const id = $('tiktok-test-account').value;
  tiktokTestCreator = null;
  $('tiktok-test-creator').textContent = '';
  $('tiktok-test-privacy').replaceChildren(new Option(id ? 'Memuat pilihan privasi…' : 'Pilih akun TikTok dulu', ''));
  updateTiktokTestSubmit();
  if (!id) return;
  try {
    const creator = await api('/api/tiktok/connections/' + encodeURIComponent(id) + '/creator');
    if ($('tiktok-test-account').value !== id) return;
    tiktokTestCreator = creator;
    $('tiktok-test-creator').textContent =
      'Diposting ke ' +
      creator.nickname +
      (creator.username ? ' (@' + creator.username + ')' : '') +
      (creator.maxVideoDurationSec ? ' · durasi maksimum ' + creator.maxVideoDurationSec + ' detik' : '');
    const placeholder = new Option('Pilih siapa yang dapat melihat', '');
    placeholder.disabled = true;
    $('tiktok-test-privacy').replaceChildren(
      placeholder,
      ...creator.privacyOptions.map(level => new Option(tiktokTestPrivacy[level] ?? level, level)),
    );
    $('tiktok-test-privacy').value = '';
    for (const [id, disabled] of [
      ['tiktok-test-comment', creator.commentDisabled],
      ['tiktok-test-duet', creator.duetDisabled],
      ['tiktok-test-stitch', creator.stitchDisabled],
    ]) {
      $(id).checked = false;
      $(id).disabled = disabled;
      $(id).parentElement.title = disabled ? 'Dimatikan di pengaturan akun TikTok ini.' : '';
    }
  } catch (error) {
    $('tiktok-test-privacy').replaceChildren(new Option('Akun ini belum dapat posting', ''));
    $('tiktok-test-creator').textContent = error.message;
  }
  updateTiktokTestSubmit();
}
// Konten bermerek tidak boleh privat, dan persetujuannya menambah Branded Content Policy.
function updateTiktokTestSubmit() {
  const branded = $('tiktok-test-brand-content').checked;
  const selfOnly = [...$('tiktok-test-privacy').options].find(o => o.value === 'SELF_ONLY');
  if (selfOnly) selfOnly.disabled = branded;
  $('tiktok-test-brand-content').disabled = $('tiktok-test-privacy').value === 'SELF_ONLY';
  const music = document.createElement('a'),
    policy = document.createElement('a');
  music.textContent = 'Music Usage Confirmation';
  music.href = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
  policy.textContent = 'Branded Content Policy';
  policy.href = 'https://www.tiktok.com/legal/page/global/bc-policy/en';
  for (const a of [music, policy]) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  $('tiktok-test-consent').replaceChildren(
    'Dengan memposting, Anda menyetujui ',
    ...(branded ? [policy, ' dan ', music] : [music]),
    ' TikTok.',
  );
  $('tiktok-test-submit').disabled = !tiktokTestCreator || !$('tiktok-test-privacy').value || !!tiktokTestRequest;
}
function showTiktokTestStatus(post) {
  $('tiktok-test-status').textContent =
    (post.errorMessage && ['failed', 'unknown'].includes(post.status)
      ? post.errorMessage
      : (tiktokTestStates[post.status] ?? post.status)) +
    ' ID: ' +
    post.requestId;
  // Selama TikTok memproses, permintaan yang sama hanya diperiksa; posting baru baru boleh setelah selesai.
  if (['published', 'failed'].includes(post.status)) tiktokTestRequest = '';
  $('tiktok-test-check').hidden = !tiktokTestRequest;
  updateTiktokTestSubmit();
}
$('tiktok-test-account').onchange = () => run(loadTiktokTestCreator);
for (const id of ['tiktok-test-privacy', 'tiktok-test-brand-content']) $(id).onchange = updateTiktokTestSubmit;
$('tiktok-test-form').onsubmit = event => {
  event.preventDefault();
  if (tiktokTestRequest) return;
  void run(async () => {
    const url = new URL($('tiktok-test-video').value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw Error('URL video harus HTTP/HTTPS publik tanpa kredensial.');
    if (!$('tiktok-test-agree').checked || !confirm('Terbitkan video sungguhan ke akun TikTok yang dipilih?')) return;
    tiktokTestRequest = 'test_' + crypto.randomUUID().replaceAll('-', '');
    $('tiktok-test-submit').disabled = true;
    $('tiktok-test-status').textContent = 'Mengunduh dan memeriksa video…';
    try {
      showTiktokTestStatus(
        await api('/api/tiktok/test-post', 'POST', {
          requestId: tiktokTestRequest,
          openId: $('tiktok-test-account').value,
          mediaType: 'VIDEO',
          videoUrl: url.href,
          title: $('tiktok-test-caption').value,
          privacyLevel: $('tiktok-test-privacy').value,
          allowComment: $('tiktok-test-comment').checked,
          allowDuet: $('tiktok-test-duet').checked,
          allowStitch: $('tiktok-test-stitch').checked,
          brandOrganic: $('tiktok-test-brand-organic').checked,
          brandContent: $('tiktok-test-brand-content').checked,
          consent: true,
        }),
      );
    } catch (error) {
      // Penolakan sebelum posting dicatat (misalnya video tidak valid) aman diulang dengan permintaan baru.
      const saved = await api('/api/tiktok/posts/' + tiktokTestRequest).catch(() => null);
      if (saved) showTiktokTestStatus(saved);
      else {
        tiktokTestRequest = '';
        $('tiktok-test-check').hidden = true;
        $('tiktok-test-status').textContent = error.message;
        updateTiktokTestSubmit();
      }
    }
  });
};
$('tiktok-test-check').onclick = () =>
  run(async () => {
    if (!tiktokTestRequest) return;
    $('tiktok-test-check').disabled = true;
    try {
      showTiktokTestStatus(await api('/api/tiktok/posts/' + tiktokTestRequest));
    } finally {
      $('tiktok-test-check').disabled = false;
    }
  });

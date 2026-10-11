function youtubeIntegrationItems() {
  return youtubeAccounts.map(youtubeIntegrationItem);
}
function youtubeIntegrationItem(account) {
  return {
    kind: 'youtube',
    youtube: account,
    platform: 'youtube',
    name: account.name,
    connected: true,
    label: 'Terhubung',
    method: 'YouTube · akun Google',
    ai: '',
  };
}
function youtubeActions(account) {
  const actions = element('div', 'row-actions');
  actions.append(button('Hubungkan ulang', startYouTubeLogin));
  const remove = button('Putuskan', async () => {
    if (
      !confirm(
        'Cabut akses YouTube dan hapus data koneksi serta log publikasinya dari NC-WA? Video di YouTube tetap tersedia.',
      )
    )
      return;
    await api('/api/youtube/connections/' + encodeURIComponent(account.id), 'DELETE');
    await loadIntegrations();
    if (!$('ai').hidden) await loadAI();
  });
  remove.className = 'danger';
  actions.append(remove);
  return actions;
}
// Koneksi dan uji publikasi YouTube di Integrasi; kredensial Google tidak pernah dikirim ke browser.
let youtubeAccounts = [];
async function startYouTubeLogin() {
  if (
    !confirm(
      'Hubungkan YouTube untuk membaca identitas channel dan mengunggah video yang Anda setujui? Dengan melanjutkan, Anda menyetujui Kebijakan Privasi NC-WA dan Ketentuan YouTube yang ditautkan di bagian ini.',
    )
  )
    return;
  const { url } = await api('/api/youtube/start', 'POST');
  location.assign(url);
}
function showYouTubeResult() {
  const params = new URLSearchParams(location.search),
    result = params.get('youtube');
  if (!result) return;
  const messages = {
    connected: 'YouTube terhubung.',
    cancelled: 'Izin YouTube dibatalkan.',
    permissions: 'Berikan izin baca channel dan upload video.',
    no_channel: 'Akun Google belum memiliki channel YouTube.',
    offline: 'Izin posting otomatis belum diperoleh; hubungkan ulang.',
    in_use: 'Channel sudah terhubung ke akun NC-WA lain.',
    error: 'YouTube gagal dihubungkan; coba lagi.',
  };
  $('message').textContent = messages[result] || messages.error;
  params.delete('youtube');
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
}
async function loadYouTube() {
  youtubeAccounts = await api('/api/youtube/connections');
  const select = $('youtube-test-account'),
    previous = select.value;
  select.replaceChildren(
    ...youtubeAccounts.map(account => {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.name;
      return option;
    }),
  );
  if (youtubeAccounts.some(a => a.id === previous)) select.value = previous;
  $('youtube-test-submit').disabled = !youtubeAccounts.length;
  await loadYouTubePosts();
}
async function loadYouTubePosts() {
  const rows = await api('/api/youtube/posts');
  const labels = {
    queued: 'Antre',
    uploading: 'Mengunggah',
    processing: 'Diproses YouTube',
    published: 'Terbit',
    failed: 'Gagal',
    unknown: 'Belum pasti',
  };
  $('youtube-post-rows').replaceChildren(
    ...rows.map(post => {
      const row = document.createElement('tr');
      for (const text of [
        post.name || post.channelId,
        post.title,
        new Date(post.createdAt).toLocaleString('id-ID'),
        labels[post.status] || post.status,
        post.error || post.videoId || '—',
      ])
        row.append(element('td', '', text));
      const actions = document.createElement('td');
      actions.append(
        button('Periksa status', async () => {
          await api('/api/youtube/posts/' + encodeURIComponent(post.requestId));
          await loadYouTubePosts();
        }),
      );
      if (post.url) {
        const link = element('a', '', 'Buka video');
        link.href = post.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
      }
      row.append(actions);
      return row;
    }),
  );
  $('youtube-post-empty').hidden = !!rows.length;
}
$('youtube-post-refresh').onclick = () => run(loadYouTubePosts);
let youtubeRequest = null;
$('youtube-test-form').addEventListener('input', () => {
  youtubeRequest = null;
});
$('youtube-test-form').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const button = $('youtube-test-submit');
    button.disabled = true;
    try {
      youtubeRequest ||= crypto.randomUUID();
      const post = await api('/api/youtube/posts', 'POST', {
        requestId: youtubeRequest,
        channelId: $('youtube-test-account').value,
        videoUrl: $('youtube-test-url').value.trim(),
        title: $('youtube-test-title').value.trim(),
        description: $('youtube-test-description').value,
        privacyStatus: $('youtube-test-privacy').value,
        madeForKids: $('youtube-test-kids').value === 'yes',
        containsSyntheticMedia: $('youtube-test-synthetic').value === 'yes',
      });
      $('youtube-test-status').textContent =
        'Permintaan tersimpan: ' + post.requestId + '. Periksa perkembangan di log.';
      await loadYouTubePosts();
    } finally {
      button.disabled = !youtubeAccounts.length;
    }
  });
};

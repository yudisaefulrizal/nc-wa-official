// Dialog posting gambar hasil: akun Instagram resmi, caption, dan status tersimpan di server.
// Request ID tetap dipakai setelah gangguan jaringan, sehingga pemeriksaan ulang tidak mengirim duplikat.
let contentInstagramImage = null,
  contentInstagramRequest = '',
  contentInstagramBody = null,
  contentInstagramBusy = false,
  contentInstagramStatus = '',
  contentInstagramTimer;

function contentInstagramButton(result) {
  const post = button('Post Instagram', () => openContentInstagram(result));
  post.className = 'content-instagram-button';
  post.prepend(contentActionIcon('instagram'));
  return post;
}
function contentActionIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shapes =
    kind === 'instagram'
      ? [
          ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 5 }],
          ['circle', { cx: 12, cy: 12, r: 4 }],
          ['circle', { cx: 17.5, cy: 6.5, r: 0.8, fill: 'currentColor', stroke: 'none' }],
        ]
      : kind === 'download'
        ? [['path', { d: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4' }]]
        : [
            [
              'path',
              {
                d: 'M9 4H5a1 1 0 0 0-1 1v4m11-5h4a1 1 0 0 1 1 1v4M4 15v4a1 1 0 0 0 1 1h4m6 0h4a1 1 0 0 0 1-1v-4M9 15l6-6m-6 0h6v6',
              },
            ],
          ];
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, String(value));
    svg.append(shape);
  }
  return svg;
}
async function openContentInstagram(result) {
  contentInstagramImage = result;
  contentInstagramRequest = '';
  contentInstagramBody = null;
  contentInstagramStatus = '';
  clearTimeout(contentInstagramTimer);
  $('content-instagram-form').reset();
  $('content-instagram-preview').src = result.url;
  $('content-instagram-status').textContent = '';
  $('content-instagram-account').replaceChildren(new Option('Memuat akun Instagram…', ''));
  $('content-instagram-submit').disabled = true;
  $('content-instagram-submit').textContent = 'Post Instagram';
  $('content-instagram-caption').disabled = false;
  $('content-instagram-account').disabled = false;
  $('content-instagram-connect').hidden = true;
  $('content-instagram-dialog').showModal();
  updateContentInstagramCount();
  try {
    const accounts = await api('/api/instagram/official');
    // Dialog bisa ditutup sebelum daftar akun selesai dimuat.
    if (!$('content-instagram-dialog').open || contentInstagramImage !== result) return;
    const available = accounts.filter(
      a => ['active', 'expiring'].includes(a.status) && a.permissions.includes('instagram_business_content_publish'),
    );
    $('content-instagram-account').replaceChildren(
      new Option(available.length ? 'Pilih akun Instagram' : 'Belum ada akun yang siap posting', ''),
      ...accounts.map(a => {
        const enabled = available.some(v => v.id === a.id);
        const option = new Option('@' + a.username + (enabled ? '' : ' · hubungkan ulang'), a.id);
        option.disabled = !enabled;
        return option;
      }),
    );
    if (available.length === 1) $('content-instagram-account').value = available[0].id;
    $('content-instagram-submit').disabled = !available.length;
    $('content-instagram-connect').hidden =
      !accounts.some(a => !available.some(v => v.id === a.id)) && available.length > 0;
    $('content-instagram-connect').textContent = accounts.length ? 'Hubungkan ulang Instagram' : 'Hubungkan Instagram';
    if (!available.length)
      $('content-instagram-status').textContent =
        'Hubungkan akun Instagram Bisnis atau Kreator dan berikan izin posting.';
  } catch (error) {
    $('content-instagram-status').textContent = error.message;
  }
}
function updateContentInstagramCount() {
  const count = [...$('content-instagram-caption').value].length;
  $('content-instagram-count').textContent = count.toLocaleString('id-ID') + ' / 2.200';
  $('content-instagram-caption').setCustomValidity(count > 2200 ? 'Caption maksimal 2.200 karakter.' : '');
}
$('content-instagram-caption').oninput = updateContentInstagramCount;
$('content-instagram-close').onclick = () => {
  if (!contentInstagramBusy) $('content-instagram-dialog').close();
};
$('content-instagram-dialog').addEventListener('cancel', event => {
  if (contentInstagramBusy) event.preventDefault();
});
$('content-instagram-dialog').addEventListener('close', () => clearTimeout(contentInstagramTimer));
$('content-instagram-connect').onclick = () =>
  run(async () => {
    $('content-instagram-connect').disabled = true;
    try {
      const result = await api('/api/instagram/official/start', 'POST');
      window.location.assign(result.url);
    } finally {
      $('content-instagram-connect').disabled = false;
    }
  });
$('content-instagram-form').onsubmit = event => {
  event.preventDefault();
  if (contentInstagramBusy || ['published', 'unknown'].includes(contentInstagramStatus)) return;
  void submitContentInstagram();
};
async function submitContentInstagram() {
  if (contentInstagramBusy) return;
  clearTimeout(contentInstagramTimer);
  contentInstagramBusy = true;
  $('content-instagram-submit').disabled = true;
  $('content-instagram-close').disabled = true;
  $('content-instagram-account').disabled = true;
  $('content-instagram-caption').disabled = true;
  $('content-instagram-connect').disabled = true;
  $('content-instagram-status').textContent = 'Menyiapkan posting Instagram…';
  try {
    let post;
    if (contentInstagramRequest) {
      try {
        post = await api('/api/instagram/posts/' + contentInstagramRequest);
      } catch (error) {
        if (error.status !== 404) throw error;
        post = await api('/api/instagram/posts', 'POST', contentInstagramBody);
      }
      if (post.status === 'processing')
        post = await api('/api/instagram/posts/' + contentInstagramRequest + '/advance', 'POST');
    } else {
      contentInstagramRequest = crypto.randomUUID();
      contentInstagramBody = {
        requestId: contentInstagramRequest,
        igUserId: $('content-instagram-account').value,
        fileId: contentInstagramImage.id,
        caption: $('content-instagram-caption').value,
      };
      post = await api('/api/instagram/posts', 'POST', contentInstagramBody);
    }
    contentInstagramStatus = post.status;
    const messages = {
      published: 'Gambar berhasil diposting ke Instagram.',
      preparing: 'Sedang menyiapkan gambar…',
      processing: 'Instagram sedang memproses gambar. Status akan diperiksa kembali dalam satu menit.',
      publishing: 'Sedang menerbitkan posting…',
      failed: 'Posting gagal sebelum diterbitkan. Anda dapat mencoba lagi.',
      unknown: 'Hasil posting belum dapat dipastikan. Periksa akun Instagram Anda sebelum membuat posting baru.',
    };
    $('content-instagram-status').textContent = messages[post.status] ?? 'Status posting belum diketahui.';
    if (post.status === 'failed') {
      contentInstagramRequest = '';
      contentInstagramBody = null;
      $('content-instagram-account').disabled = false;
      $('content-instagram-caption').disabled = false;
    }
    if (['preparing', 'processing', 'publishing'].includes(post.status)) {
      contentInstagramTimer = setTimeout(() => {
        if ($('content-instagram-dialog').open) void submitContentInstagram();
      }, 60000);
    }
  } catch (error) {
    let retry = true;
    try {
      const saved = await api('/api/instagram/posts/' + contentInstagramRequest);
      contentInstagramStatus = saved.status;
      retry = saved.status !== 'failed';
    } catch (checkError) {
      if (checkError.status === 404) retry = false;
    }
    if (!retry) {
      contentInstagramRequest = '';
      contentInstagramBody = null;
      $('content-instagram-account').disabled = false;
      $('content-instagram-caption').disabled = false;
    }
    $('content-instagram-status').textContent =
      contentInstagramStatus === 'published'
        ? 'Gambar berhasil diposting ke Instagram.'
        : contentInstagramStatus === 'unknown'
          ? 'Hasil posting belum dapat dipastikan. Periksa akun Instagram Anda sebelum membuat posting baru.'
          : error.message +
            (retry
              ? ' Tekan Periksa status untuk memeriksa permintaan yang sama.'
              : ' Perbaiki isian sebelum mencoba lagi.');
  } finally {
    contentInstagramBusy = false;
    $('content-instagram-close').disabled = false;
    $('content-instagram-connect').disabled = false;
    $('content-instagram-submit').disabled = ['published', 'unknown'].includes(contentInstagramStatus);
    $('content-instagram-submit').textContent =
      contentInstagramStatus === 'published'
        ? 'Sudah diposting'
        : contentInstagramStatus === 'unknown'
          ? 'Periksa akun Instagram'
          : contentInstagramRequest
            ? 'Periksa status'
            : 'Post Instagram';
  }
}

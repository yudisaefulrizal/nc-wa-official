// Test Post uses the same publication flow as external API clients. Unknown outcomes are checked, never resent automatically.
let integrationPostPage = 1,
  integrationTestRequest = '',
  integrationPostLoading = false;
function loadIntegrationPostAccounts() {
  const accounts = integrations.official.filter(
    a => ['active', 'expiring'].includes(a.status) && a.permissions.includes('instagram_business_content_publish'),
  );
  $('ig-test-account').replaceChildren(
    new Option(accounts.length ? 'Pilih akun Instagram' : 'Belum ada akun yang siap posting', ''),
    ...accounts.map(a => new Option('@' + a.username, a.id)),
  );
  if (accounts.length === 1) $('ig-test-account').value = accounts[0].id;
  $('ig-test-submit').disabled = !accounts.length || !!integrationTestRequest;
}
const integrationPostLabels = {
  preparing: 'Menyiapkan',
  processing: 'Diproses Instagram',
  publishing: 'Menerbitkan',
  published: 'Terbit',
  failed: 'Gagal',
  unknown: 'Belum pasti',
};
async function loadIntegrationPosts() {
  if (integrationPostLoading) return;
  integrationPostLoading = true;
  $('ig-post-log-reload').disabled = true;
  try {
    const data = await api('/api/instagram/posts?page=' + integrationPostPage);
    integrationPostPage = data.page;
    $('ig-post-log-message').textContent = '';
    $('ig-post-log-page').textContent = data.page + ' / ' + data.pages + ' · ' + data.total + ' posting';
    $('ig-post-log-prev').disabled = data.page <= 1;
    $('ig-post-log-next').disabled = data.page >= data.pages;
    const rows = data.items.map(post => {
      const row = document.createElement('tr');
      for (const text of [
        post.username ? '@' + post.username : post.ig_user_id,
        { IMAGE: 'Gambar', CAROUSEL: 'Carousel', REELS: 'Reels' }[post.media_type] || post.media_type,
        new Date(post.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        integrationPostLabels[post.status] || post.status,
        post.request_id,
        post.error_message ||
          (post.status === 'unknown' ? 'Periksa akun Instagram sebelum mengirim ulang.' : post.media_id || '—'),
      ])
        row.append(element('td', '', text));
      const actions = document.createElement('td');
      const refresh = button('Periksa status', () =>
        run(async () => {
          refresh.disabled = true;
          try {
            const result = await api(
              '/api/instagram/posts/' + encodeURIComponent(post.request_id) + '/refresh-log',
              'POST',
              {},
            );
            if (post.request_id === integrationTestRequest && ['published', 'failed'].includes(result.status)) {
              integrationTestRequest = '';
              $('ig-test-submit').disabled = false;
            }
            await loadIntegrationPosts();
          } finally {
            refresh.disabled = false;
          }
        }),
      );
      actions.append(refresh);
      if (post.permalink) {
        try {
          const url = new URL(post.permalink);
          if (url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname)) {
            const link = element('a', '', 'Lihat posting');
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            actions.append(link);
          }
        } catch {
          /* Invalid historical links are not clickable. */
        }
      }
      row.append(actions);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr'),
        cell = element('td', '', 'Belum ada posting.');
      cell.colSpan = 7;
      row.append(cell);
      rows.push(row);
    }
    $('ig-post-log').replaceChildren(...rows);
  } finally {
    integrationPostLoading = false;
    $('ig-post-log-reload').disabled = false;
  }
}
$('ig-test-type').onchange = () => {
  $('ig-test-media-hint').textContent = {
    IMAGE: 'Satu URL gambar publik.',
    CAROUSEL: '2–10 URL gambar publik, satu URL per baris.',
    REELS: 'Satu URL video MP4 publik.',
  }[$('ig-test-type').value];
};
$('ig-test-form').onsubmit = event => {
  event.preventDefault();
  if (integrationTestRequest) return;
  void run(async () => {
    const mediaType = $('ig-test-type').value;
    const urls = $('ig-test-media')
      .value.split('\n')
      .map(v => v.trim())
      .filter(Boolean);
    if (mediaType === 'CAROUSEL' ? urls.length < 2 || urls.length > 10 : urls.length !== 1)
      throw Error('Periksa jumlah URL media.');
    for (const value of urls) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw Error('URL media harus HTTP/HTTPS publik tanpa kredensial.');
    }
    const caption = $('ig-test-caption').value;
    if ([...caption].length > 2200) throw Error('Caption maksimal 2.200 karakter.');
    if (!$('ig-test-consent').checked || !confirm('Terbitkan posting sungguhan ke akun Instagram yang dipilih?'))
      return;
    integrationTestRequest = 'test_' + crypto.randomUUID().replaceAll('-', '');
    $('ig-test-submit').disabled = true;
    $('ig-test-status').textContent = 'Mengirim posting…';
    const body = {
      requestId: integrationTestRequest,
      igUserId: $('ig-test-account').value,
      mediaType,
      caption,
      consent: true,
      ...(mediaType === 'REELS'
        ? { videoUrl: urls[0] }
        : mediaType === 'CAROUSEL'
          ? { imageUrls: urls }
          : { imageUrl: urls[0] }),
    };
    try {
      const result = await api('/api/instagram/test-post', 'POST', body);
      $('ig-test-status').textContent =
        (integrationPostLabels[result.status] || result.status) + '. ID: ' + result.requestId;
      if (['published', 'failed'].includes(result.status)) {
        integrationTestRequest = '';
        $('ig-test-submit').disabled = false;
      }
    } catch (error) {
      $('ig-test-status').textContent =
        error.message + ' Periksa Log Post dan akun Instagram sebelum mengirim ulang. ID: ' + integrationTestRequest;
      throw error;
    } finally {
      integrationPostPage = 1;
      await loadIntegrationPosts().catch(error => {
        $('ig-post-log-message').textContent = error.message;
      });
    }
  });
};
$('ig-post-log-reload').onclick = () => run(loadIntegrationPosts);
$('ig-post-log-prev').onclick = () =>
  run(async () => {
    integrationPostPage--;
    await loadIntegrationPosts();
  });
$('ig-post-log-next').onclick = () =>
  run(async () => {
    integrationPostPage++;
    await loadIntegrationPosts();
  });

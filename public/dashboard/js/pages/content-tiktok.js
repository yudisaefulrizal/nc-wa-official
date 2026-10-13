// Dialog Direct Post foto TikTok dari Pustaka konten, mengikuti pedoman tampilan TikTok: info kreator dibaca ulang,
// privasi tanpa pilihan bawaan, interaksi tidak dicentang, pengungkapan konten komersial, dan persetujuan musik.
// Request ID tetap dipakai setelah gangguan jaringan, sehingga pemeriksaan ulang tidak menerbitkan posting ganda.
let contentTiktokPhotos = [],
  contentTiktokCreator = null,
  contentTiktokRequest = '',
  contentTiktokBody = null,
  contentTiktokBusy = false,
  contentTiktokStatus = '',
  contentTiktokTimer,
  contentTiktokLibraryPage = 0,
  contentTiktokLibraryPages = 1;

const tiktokPrivacyLabels = {
  PUBLIC_TO_EVERYONE: 'Semua orang',
  MUTUAL_FOLLOW_FRIENDS: 'Teman (saling mengikuti)',
  FOLLOWER_OF_CREATOR: 'Pengikut',
  SELF_ONLY: 'Hanya saya',
};
const tiktokMessages = {
  published: 'Posting sudah terbit di TikTok.',
  preparing: 'Sedang menyiapkan foto…',
  publishing: 'Sedang mengirim ke TikTok…',
  processing: 'TikTok sedang memproses posting. Status diperiksa otomatis setiap 15 detik.',
  failed: 'Posting gagal. Anda dapat memperbaiki isian lalu mencoba lagi.',
  unknown: 'Hasil posting belum pasti. Periksa akun TikTok Anda sebelum membuat posting baru.',
};

function contentTiktokButton(result) {
  const post = button('Post TikTok', () => openContentTiktok(result));
  post.className = 'content-tiktok-button';
  post.prepend(tiktokIcon());
  return post;
}
async function openContentTiktok(result) {
  contentTiktokPhotos = [result];
  contentTiktokCreator = null;
  contentTiktokRequest = '';
  contentTiktokBody = null;
  contentTiktokStatus = '';
  contentTiktokLibraryPage = 0;
  contentTiktokLibraryPages = 1;
  clearTimeout(contentTiktokTimer);
  $('content-tiktok-form').reset();
  $('content-tiktok-picker').hidden = true;
  $('content-tiktok-library').replaceChildren();
  $('content-tiktok-commercial-options').hidden = true;
  $('content-tiktok-creator').hidden = true;
  $('content-tiktok-status').textContent = '';
  $('content-tiktok-account').replaceChildren(new Option('Memuat akun TikTok…', ''));
  $('content-tiktok-privacy').replaceChildren(new Option('Pilih akun TikTok dulu', ''));
  setTiktokFormDisabled(false);
  renderTiktokPhotos();
  updateTiktokCounts();
  updateTiktokCommercial();
  $('content-tiktok-dialog').showModal();
  try {
    const connections = await api('/api/tiktok/connections');
    if (!$('content-tiktok-dialog').open || contentTiktokPhotos[0] !== result) return;
    const ready = connections.filter(
      c => c.serviceActive && c.status !== 'expired' && c.scopes.includes('video.publish'),
    );
    $('content-tiktok-account').replaceChildren(
      new Option(ready.length ? 'Pilih akun TikTok' : 'Belum ada akun TikTok yang siap posting', ''),
      ...connections.map(c => {
        const option = new Option(
          c.name +
            (!c.serviceActive
              ? ' · melebihi kuota sesi'
              : c.status === 'expired' || !c.scopes.includes('video.publish')
                ? ' · hubungkan ulang'
                : ''),
          c.id,
        );
        option.disabled = !ready.includes(c);
        return option;
      }),
    );
    if (!ready.length)
      $('content-tiktok-status').textContent = 'Hubungkan akun TikTok di halaman Integrasi dan izinkan posting konten.';
    if (ready.length === 1) {
      $('content-tiktok-account').value = ready[0].id;
      await loadTiktokCreator();
    }
  } catch (error) {
    $('content-tiktok-status').textContent = error.message;
  }
  updateTiktokSubmit();
}
// Info kreator dibaca setiap kali akun dipilih: privasi akun dan batas posting harian bisa berubah kapan saja.
async function loadTiktokCreator() {
  const id = $('content-tiktok-account').value;
  contentTiktokCreator = null;
  $('content-tiktok-creator').hidden = true;
  $('content-tiktok-privacy').replaceChildren(
    new Option(id ? 'Memuat pilihan privasi…' : 'Pilih akun TikTok dulu', ''),
  );
  updateTiktokSubmit();
  if (!id) return;
  try {
    const creator = await api('/api/tiktok/connections/' + encodeURIComponent(id) + '/creator');
    if ($('content-tiktok-account').value !== id) return;
    contentTiktokCreator = creator;
    $('content-tiktok-creator-name').textContent =
      'Diposting ke ' + creator.nickname + (creator.username ? ' (@' + creator.username + ')' : '');
    $('content-tiktok-avatar').hidden = !creator.avatarUrl;
    if (creator.avatarUrl) $('content-tiktok-avatar').src = creator.avatarUrl;
    $('content-tiktok-creator').hidden = false;
    // Tanpa pilihan bawaan: pengguna wajib memilih sendiri siapa yang dapat melihat.
    const placeholder = new Option('Pilih siapa yang dapat melihat', '');
    placeholder.disabled = true;
    $('content-tiktok-privacy').replaceChildren(
      placeholder,
      ...creator.privacyOptions.map(level => new Option(tiktokPrivacyLabels[level] ?? level, level)),
    );
    $('content-tiktok-privacy').value = '';
    $('content-tiktok-comment').checked = false;
    $('content-tiktok-comment').disabled = creator.commentDisabled;
    $('content-tiktok-comment').parentElement.title = creator.commentDisabled
      ? 'Komentar dimatikan di pengaturan akun TikTok ini.'
      : '';
    $('content-tiktok-status').textContent = '';
    updateTiktokCommercial();
  } catch (error) {
    $('content-tiktok-privacy').replaceChildren(new Option('Akun ini belum dapat posting', ''));
    $('content-tiktok-status').textContent = error.message;
  }
  updateTiktokSubmit();
}
function renderTiktokPhotos() {
  $('content-tiktok-photos').replaceChildren(
    ...contentTiktokPhotos.map((photo, index) => {
      const item = element('li', 'content-tiktok-photo'),
        image = document.createElement('img');
      image.src = photo.url;
      image.alt = 'Foto ' + (index + 1);
      item.append(image, element('span', 'badge', index === 0 ? 'Sampul' : String(index + 1)));
      if (contentTiktokPhotos.length > 1) {
        const remove = button('Lepas', async () => toggleTiktokPhoto(photo));
        remove.className = 'secondary';
        remove.setAttribute('aria-label', 'Lepas foto ' + (index + 1));
        item.append(remove);
      }
      return item;
    }),
  );
  for (const tile of $('content-tiktok-library').children)
    tile.setAttribute('aria-pressed', String(contentTiktokPhotos.some(p => p.id === tile.dataset.id)));
  $('content-tiktok-add').disabled = contentTiktokBusy || contentTiktokRequest !== '';
  updateTiktokSubmit();
}
function toggleTiktokPhoto(photo) {
  if (contentTiktokBusy || contentTiktokRequest) return;
  const index = contentTiktokPhotos.findIndex(p => p.id === photo.id);
  if (index >= 0) {
    if (contentTiktokPhotos.length > 1) contentTiktokPhotos.splice(index, 1);
  } else if (contentTiktokPhotos.length < 35) contentTiktokPhotos.push(photo);
  else $('content-tiktok-status').textContent = 'Satu posting TikTok berisi maksimal 35 foto.';
  renderTiktokPhotos();
}
async function loadTiktokLibrary() {
  if (contentTiktokLibraryPage >= contentTiktokLibraryPages) return;
  const response = await api('/api/content/jobs?page=' + (contentTiktokLibraryPage + 1));
  contentTiktokLibraryPage = response.page;
  contentTiktokLibraryPages = response.pages;
  const known = new Set([...$('content-tiktok-library').children].map(tile => tile.dataset.id));
  for (const file of response.items.flatMap(contentImageFiles)) {
    if (known.has(file.id)) continue;
    const tile = document.createElement('button'),
      image = document.createElement('img');
    tile.type = 'button';
    tile.className = 'content-tiktok-tile';
    tile.dataset.id = file.id;
    image.src = file.url;
    image.alt = 'Gambar pustaka';
    image.loading = 'lazy';
    tile.append(image);
    tile.onclick = () => toggleTiktokPhoto(file);
    $('content-tiktok-library').append(tile);
  }
  $('content-tiktok-more').hidden = contentTiktokLibraryPage >= contentTiktokLibraryPages;
  renderTiktokPhotos();
}
// Aturan TikTok: konten bermerek tidak boleh privat, label mengikuti pilihan, dan persetujuan menyesuaikan.
function updateTiktokCommercial() {
  const enabled = $('content-tiktok-commercial').checked,
    organic = enabled && $('content-tiktok-brand-organic').checked,
    branded = enabled && $('content-tiktok-brand-content').checked,
    privateLevel = $('content-tiktok-privacy').value === 'SELF_ONLY';
  $('content-tiktok-commercial-options').hidden = !enabled;
  const selfOnly = [...$('content-tiktok-privacy').options].find(o => o.value === 'SELF_ONLY');
  if (selfOnly) {
    selfOnly.disabled = branded;
    selfOnly.title = branded ? 'Konten bermerek tidak dapat diposting dengan privasi "Hanya saya".' : '';
  }
  $('content-tiktok-brand-content').disabled = privateLevel;
  $('content-tiktok-brand-content').parentElement.title = privateLevel
    ? 'Konten bermerek tidak dapat diposting dengan privasi "Hanya saya". Ubah privasi terlebih dahulu.'
    : '';
  $('content-tiktok-commercial-label').textContent = branded
    ? 'Foto akan diberi label "Paid partnership".'
    : organic
      ? 'Foto akan diberi label "Promotional content".'
      : '';
  const music = tiktokLink(
    'Music Usage Confirmation',
    'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en',
  );
  $('content-tiktok-consent').replaceChildren(
    'Dengan memposting, Anda menyetujui ',
    ...(branded
      ? [tiktokLink('Branded Content Policy', 'https://www.tiktok.com/legal/page/global/bc-policy/en'), ' dan ', music]
      : [music]),
    ' TikTok.',
  );
  updateTiktokSubmit();
}
function updateTiktokSubmit() {
  const commercialMissing =
    $('content-tiktok-commercial').checked &&
    !$('content-tiktok-brand-organic').checked &&
    !$('content-tiktok-brand-content').checked;
  $('content-tiktok-submit-wrap').title = commercialMissing
    ? 'Tunjukkan apakah konten Anda mempromosikan diri sendiri, pihak ketiga, atau keduanya.'
    : '';
  if (contentTiktokRequest || contentTiktokBusy) return;
  $('content-tiktok-submit').disabled =
    !contentTiktokCreator || !$('content-tiktok-privacy').value || !contentTiktokPhotos.length || commercialMissing;
}
function updateTiktokCounts() {
  $('content-tiktok-title-count').textContent = $('content-tiktok-title-input').value.length + ' / 90';
  $('content-tiktok-description-count').textContent =
    $('content-tiktok-description').value.length.toLocaleString('id-ID') + ' / 4.000';
}
function setTiktokFormDisabled(disabled) {
  for (const id of [
    'content-tiktok-account',
    'content-tiktok-title-input',
    'content-tiktok-description',
    'content-tiktok-privacy',
    'content-tiktok-commercial',
    'content-tiktok-brand-organic',
  ])
    $(id).disabled = disabled;
  $('content-tiktok-comment').disabled = disabled || !!contentTiktokCreator?.commentDisabled;
  if (disabled) $('content-tiktok-brand-content').disabled = true;
  $('content-tiktok-add').disabled = disabled;
}
function tiktokLink(text, href) {
  const a = element('a', '', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function tiktokIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.6 2.3 4.4 5 4.6');
  svg.append(path);
  return svg;
}

$('content-tiktok-account').onchange = () => run(loadTiktokCreator);
$('content-tiktok-privacy').onchange = updateTiktokCommercial;
for (const id of ['content-tiktok-commercial', 'content-tiktok-brand-organic', 'content-tiktok-brand-content'])
  $(id).onchange = updateTiktokCommercial;
$('content-tiktok-title-input').oninput = updateTiktokCounts;
$('content-tiktok-description').oninput = updateTiktokCounts;
$('content-tiktok-add').onclick = () =>
  run(async () => {
    $('content-tiktok-picker').hidden = false;
    if (!contentTiktokLibraryPage) await loadTiktokLibrary();
  });
$('content-tiktok-more').onclick = () => run(loadTiktokLibrary);
$('content-tiktok-close').onclick = () => {
  if (!contentTiktokBusy) $('content-tiktok-dialog').close();
};
$('content-tiktok-dialog').addEventListener('cancel', event => {
  if (contentTiktokBusy) event.preventDefault();
});
$('content-tiktok-dialog').addEventListener('close', () => clearTimeout(contentTiktokTimer));
$('content-tiktok-form').onsubmit = event => {
  event.preventDefault();
  if (contentTiktokBusy || ['published', 'unknown'].includes(contentTiktokStatus)) return;
  void submitContentTiktok();
};
async function submitContentTiktok() {
  if (contentTiktokBusy) return;
  clearTimeout(contentTiktokTimer);
  contentTiktokBusy = true;
  setTiktokFormDisabled(true);
  $('content-tiktok-submit').disabled = true;
  $('content-tiktok-close').disabled = true;
  $('content-tiktok-status').textContent = contentTiktokRequest
    ? 'Memeriksa status posting…'
    : 'Menyiapkan posting TikTok…';
  try {
    let post;
    if (contentTiktokRequest) {
      try {
        post = await api('/api/tiktok/posts/' + contentTiktokRequest);
      } catch (error) {
        if (error.status !== 404) throw error;
        post = await api('/api/tiktok/posts', 'POST', contentTiktokBody);
      }
    } else {
      const commercial = $('content-tiktok-commercial').checked;
      contentTiktokRequest = crypto.randomUUID();
      contentTiktokBody = {
        requestId: contentTiktokRequest,
        openId: $('content-tiktok-account').value,
        fileIds: contentTiktokPhotos.map(p => p.id),
        title: $('content-tiktok-title-input').value,
        description: $('content-tiktok-description').value,
        privacyLevel: $('content-tiktok-privacy').value,
        allowComment: $('content-tiktok-comment').checked,
        brandOrganic: commercial && $('content-tiktok-brand-organic').checked,
        brandContent: commercial && $('content-tiktok-brand-content').checked,
      };
      post = await api('/api/tiktok/posts', 'POST', contentTiktokBody);
    }
    contentTiktokStatus = post.status;
    $('content-tiktok-status').textContent =
      post.status === 'failed' && post.errorMessage
        ? post.errorMessage + ' Anda dapat memperbaiki isian lalu mencoba lagi.'
        : post.status === 'unknown' && post.errorMessage
          ? post.errorMessage
          : (tiktokMessages[post.status] ?? 'Status posting belum diketahui.');
    if (post.status === 'failed') {
      contentTiktokRequest = '';
      contentTiktokBody = null;
    }
    if (['preparing', 'publishing', 'processing'].includes(post.status))
      contentTiktokTimer = setTimeout(() => {
        if ($('content-tiktok-dialog').open) void submitContentTiktok();
      }, 15000);
  } catch (error) {
    // Permintaan mungkin sudah sampai ke server; periksa dulu sebelum mengizinkan isian diubah.
    let retry = true;
    try {
      const saved = await api('/api/tiktok/posts/' + contentTiktokRequest);
      contentTiktokStatus = saved.status;
      retry = saved.status !== 'failed';
    } catch (checkError) {
      if (checkError.status === 404) retry = false;
    }
    if (!retry) {
      contentTiktokRequest = '';
      contentTiktokBody = null;
    }
    $('content-tiktok-status').textContent = ['published', 'unknown'].includes(contentTiktokStatus)
      ? tiktokMessages[contentTiktokStatus]
      : error.message +
        (retry
          ? ' Tekan Periksa status untuk memeriksa permintaan yang sama.'
          : ' Perbaiki isian sebelum mencoba lagi.');
  } finally {
    contentTiktokBusy = false;
    $('content-tiktok-close').disabled = false;
    const locked = contentTiktokRequest !== '';
    setTiktokFormDisabled(locked);
    if (!locked) updateTiktokCommercial();
    $('content-tiktok-add').disabled = locked;
    $('content-tiktok-submit').textContent =
      contentTiktokStatus === 'published'
        ? 'Sudah diposting'
        : contentTiktokStatus === 'unknown'
          ? 'Periksa akun TikTok'
          : locked
            ? 'Periksa status'
            : 'Post TikTok';
    $('content-tiktok-submit').disabled = ['published', 'unknown'].includes(contentTiktokStatus);
    if (!locked) updateTiktokSubmit();
    renderTiktokPhotos();
  }
}

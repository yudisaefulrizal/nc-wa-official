// Page Konten: profil Konten dari Editor profil (formulir dinamis), pekerjaan asinkron, pustaka hasil, dan identitas brand.
let contentProfiles = [],
  contentCapabilities = {},
  contentBrandData = {},
  contentSelectedJob = null,
  // Isian jenis gambar: id isian → {id, url} file Pustaka konten.
  contentImages = {};
let contentLibraryPage = 1,
  contentTimer,
  contentLoading = false,
  contentRequestId = '',
  contentRequestBody = '',
  contentUploading = false;
const contentStates = {
  queued: 'Menunggu',
  running: 'Membuat',
  completed: 'Selesai',
  failed: 'Gagal',
  interrupted: 'Terputus',
};
const contentStages = {
  queued: 'Pekerjaan masuk antrean.',
  running: 'Memproses… Pembuatan gambar dapat memerlukan beberapa menit.',
};
const selectedContentProfile = () => contentProfiles.find(p => p.id === $('content-profile').value);
const contentFileUrl = id => '/api/content/files/' + id;
const showContentBalance = async () => {
  const balance = await api('/api/ai/wallet');
  $('content-balance').textContent = 'Kredit AI ' + Number(balance.balance).toLocaleString('id-ID');
};
async function loadContent() {
  if (contentLoading) return;
  contentLoading = true;
  try {
    const previous = $('content-profile').value;
    const [profiles, capabilities, brand] = await Promise.all([
      api('/api/content/profiles'),
      api('/api/content/capabilities'),
      api('/api/content/brand'),
    ]);
    contentProfiles = profiles;
    contentCapabilities = capabilities;
    contentBrandData = brand;
    await showContentBalance();
    $('content-profile').replaceChildren(
      new Option('Pilih jenis konten', ''),
      ...profiles.map(p => new Option(p.name, p.id)),
    );
    $('content-profile').value = profiles.some(p => p.id === previous) ? previous : (profiles[0]?.id ?? '');
    renderContentProfile();
    await loadContentLibrary();
    if (contentSelectedJob) await refreshContentJob();
    else {
      const current = await api('/api/content/jobs');
      const running = current.items.find(j => ['queued', 'running'].includes(j.status));
      if (running) {
        contentSelectedJob = running;
        renderContentJob(running);
      }
    }
    startContentPolling();
  } finally {
    contentLoading = false;
  }
}
// Nilai isian formulir saat ini; isian gambar berisi ID file yang dipilih.
function contentValues() {
  const profile = selectedContentProfile();
  return Object.fromEntries(
    (profile?.fields ?? []).map(field => [
      field.id,
      field.type === 'image'
        ? (contentImages[field.id]?.id ?? '')
        : ($('content-fields').querySelector(`[name="${field.id}"]`)?.value ?? ''),
    ]),
  );
}
function renderContentProfile() {
  const profile = selectedContentProfile();
  const values = contentValues();
  $('content-profile-description').textContent = profile?.description ?? '';
  contentImages = Object.fromEntries(
    Object.entries(contentImages).filter(([id]) => profile?.fields.some(f => f.id === id)),
  );
  $('content-fields').replaceChildren(
    ...(profile?.fields ?? []).map(field => contentField(field, values[field.id] ?? '')),
  );
  $('content-notice').textContent = !contentProfiles.length
    ? 'Belum ada profil Konten aktif. Pemilik layanan perlu menerbitkan dan mengaktifkan profil.'
    : needsImages() && !contentCapabilities.configured
      ? 'Model Gambar belum dikonfigurasi oleh owner.'
      : needsImages() && !contentCapabilities.creditsPerImage
        ? 'Tarif kredit gambar belum diatur oleh owner.'
        : '';
  updateContentEstimate();
}
const needsImages = () => (selectedContentProfile()?.maxImages ?? 0) > 0;
function contentField(field, value) {
  if (field.type === 'image') return contentImageField(field);
  const label = element('label', '', field.label + (field.required ? ' *' : ''));
  const control = document.createElement(
    field.type === 'choice' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input',
  );
  control.name = field.id;
  control.required = field.required;
  control.maxLength = field.type === 'textarea' ? 4000 : 500;
  if (field.type === 'textarea') control.rows = 4;
  if (field.type === 'choice') control.append(new Option('Pilih…', ''), ...field.options.map(v => new Option(v, v)));
  control.value = value;
  label.append(control);
  return label;
}
function contentImageField(field) {
  const box = element('div', 'content-image-field'),
    thumbs = element('div', 'content-references'),
    input = document.createElement('input');
  const render = () =>
    thumbs.replaceChildren(
      ...(contentImages[field.id]
        ? [
            contentThumb(contentImages[field.id], () => {
              delete contentImages[field.id];
              render();
            }),
          ]
        : []),
    );
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.setAttribute('aria-label', 'Unggah ' + field.label);
  input.onchange = () =>
    run(async () => {
      if (!input.files[0]) return;
      contentUploading = true;
      updateContentEstimate();
      try {
        contentImages[field.id] = await uploadContentImage(input.files[0]);
        render();
      } finally {
        contentUploading = false;
        input.value = '';
        updateContentEstimate();
      }
    });
  const pick = button('Dari pustaka', () =>
    pickContentReference(ref => {
      contentImages[field.id] = ref;
      render();
    }),
  );
  pick.className = 'secondary';
  box.append(element('span', 'content-field-label', field.label + (field.required ? ' *' : '')), thumbs, input, pick);
  render();
  return box;
}
function contentThumb(ref, onRemove) {
  const box = element('div', 'content-reference-thumb'),
    image = document.createElement('img'),
    remove = button('×', onRemove);
  image.src = ref.url;
  image.alt = 'Gambar referensi';
  remove.setAttribute('aria-label', 'Lepas referensi');
  box.append(image, remove);
  return box;
}
function updateContentEstimate() {
  const profile = selectedContentProfile();
  const images = profile?.maxImages ?? 0;
  const cost = images * (contentCapabilities.creditsPerImage ?? 0);
  $('content-estimate').textContent = !profile
    ? ''
    : images
      ? 'Estimasi hingga ' +
        images +
        ' gambar · ' +
        cost.toLocaleString('id-ID') +
        ' kredit. Hanya gambar yang jadi yang ditagihkan.'
      : 'Memakai kredit AI sesuai panjang teks.';
  $('content-generate').disabled =
    !profile || contentUploading || (images > 0 && (!contentCapabilities.configured || !cost));
}
async function uploadContentImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
    throw Error('Gunakan PNG, JPG, atau WebP maksimum 10 MB.');
  const response = await fetch('/api/content/references', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.message ?? 'Unggah referensi gagal.');
  return result;
}
$('content-profile').onchange = renderContentProfile;
$('content-form').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const body = { profileId: $('content-profile').value, values: contentValues() };
    const serialized = JSON.stringify(body);
    if (!contentRequestId || serialized !== contentRequestBody) {
      contentRequestId = crypto.randomUUID();
      contentRequestBody = serialized;
    }
    $('content-generate').disabled = true;
    try {
      const job = await api('/api/content/jobs', 'POST', { ...body, requestId: contentRequestId });
      contentRequestId = '';
      contentSelectedJob = job;
      renderContentJob(job);
      startContentPolling();
      await loadContentLibrary();
      await showContentBalance();
    } finally {
      updateContentEstimate();
    }
  });
};
const contentImageFiles = job => job.results.filter(r => r.kind === 'image').flatMap(r => r.files);
function renderContentJob(job) {
  $('content-job-state').textContent = contentStates[job.status] ?? job.status;
  const pending = ['queued', 'running'].includes(job.status);
  $('content-job-info').textContent = pending
    ? (contentStages[job.stage] ?? 'Sedang diproses…')
    : (job.error ??
      contentImageFiles(job).length + ' gambar tersimpan · ' + job.charged.toLocaleString('id-ID') + ' kredit');
  $('content-retry').hidden = !['failed', 'interrupted'].includes(job.status);
  if (pending) {
    const placeholder = element('div', 'content-placeholder is-generating');
    placeholder.append(
      element('span', '', '✦'),
      element('strong', '', 'Ide Anda sedang dibuat'),
      element('p', '', 'Anda boleh berpindah halaman. Hasil akan tersimpan di pustaka.'),
    );
    $('content-results').replaceChildren(placeholder);
  } else
    $('content-results').replaceChildren(
      ...job.results.flatMap(result =>
        result.kind === 'image'
          ? result.files.map(file => contentImageCard(file, job, result.label))
          : [contentTextCard(result)],
      ),
    );
}
function contentTextCard(result) {
  const card = element('div', 'content-text-card');
  const copy = button('Salin', async () => {
    await navigator.clipboard.writeText(result.text);
    $('message').textContent = result.label + ' disalin.';
  });
  copy.className = 'secondary';
  card.append(element('strong', '', result.label), element('p', '', result.text), copy);
  return card;
}
function contentImageCard(file, job, label) {
  const card = element('div', 'content-image-card'),
    image = document.createElement('img');
  image.src = file.url;
  image.alt = label;
  image.loading = 'lazy';
  const actions = element('div', 'content-image-actions'),
    download = element('a', 'button secondary', 'Unduh');
  download.href = file.url + '?download=1';
  download.prepend(contentActionIcon('download'));
  const reference = button('Jadikan referensi', () => reuseContentJob(job, file.id));
  reference.className = 'secondary';
  reference.prepend(contentActionIcon('reference'));
  actions.append(download, reference);
  const footer = element('div', 'content-image-footer');
  footer.append(contentInstagramButton(file), actions);
  card.append(image, footer);
  return card;
}
// Memuat isian pekerjaan ke formulir; gambar hasil yang dipilih menjadi referensi di isian gambar pertama.
async function reuseContentJob(job, reference) {
  if (!contentProfiles.some(p => p.id === job.profile_id))
    throw Error('Profil asal sudah tidak tersedia. Pilih jenis konten lain.');
  $('content-profile').value = job.profile_id;
  contentImages = {};
  const profile = selectedContentProfile();
  for (const field of profile.fields.filter(f => f.type === 'image'))
    if (job.values[field.id])
      contentImages[field.id] = { id: job.values[field.id], url: contentFileUrl(job.values[field.id]) };
  const target = profile.fields.find(f => f.type === 'image');
  if (reference && target) contentImages[target.id] = { id: reference, url: contentFileUrl(reference) };
  else if (reference) $('message').textContent = 'Jenis konten ini tidak punya isian gambar referensi.';
  renderContentProfile();
  for (const control of $('content-fields').querySelectorAll('[name]')) control.value = job.values[control.name] ?? '';
  contentRequestId = '';
  contentTab('create');
  $('content-fields').querySelector('[name]')?.focus();
}
$('content-retry').onclick = () => run(() => reuseContentJob(contentSelectedJob));
function contentTab(tab) {
  $('content-create').hidden = tab !== 'create';
  $('content-library').hidden = tab !== 'library';
  document
    .querySelectorAll('[data-content-tab]')
    .forEach(button => button.setAttribute('aria-pressed', String(button.dataset.contentTab === tab)));
  if (tab === 'library') void run(loadContentLibrary);
}
document
  .querySelectorAll('[data-content-tab]')
  .forEach(button => (button.onclick = () => contentTab(button.dataset.contentTab)));
async function loadContentLibrary() {
  const response = await api('/api/content/jobs?page=' + contentLibraryPage);
  contentLibraryPage = response.page;
  $('content-prev').disabled = response.page <= 1;
  $('content-next').disabled = response.page >= response.pages;
  $('content-page').textContent = response.page + ' / ' + response.pages;
  $('content-library-items').replaceChildren(
    ...response.items.map(job => {
      const card = element('article', 'content-card content-library-card');
      card.append(
        element('h3', '', job.profile_name),
        element('span', 'badge', contentStates[job.status] ?? job.status),
      );
      const first = contentImageFiles(job)[0];
      if (first) {
        const image = document.createElement('img');
        image.src = first.url;
        image.alt = job.profile_name;
        image.loading = 'lazy';
        card.append(image);
      }
      card.append(
        element('p', '', job.summary.split('\n')[0]),
        element(
          'small',
          'content-helper',
          new Date(job.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) +
            ' · ' +
            job.charged +
            ' kredit',
        ),
      );
      const actions = element('div', 'row-actions');
      actions.append(
        button('Lihat hasil', () => {
          contentSelectedJob = job;
          renderContentJob(job);
          contentTab('create');
          startContentPolling();
        }),
        button(['failed', 'interrupted'].includes(job.status) ? 'Coba lagi' : 'Gunakan isian', () =>
          reuseContentJob(job),
        ),
      );
      card.append(actions);
      return card;
    }),
  );
  if (!response.items.length)
    $('content-library-items').append(
      element('p', 'empty', 'Belum ada konten. Buat konten pertama Anda di tab Buat konten.'),
    );
}
$('content-prev').onclick = () =>
  run(async () => {
    contentLibraryPage--;
    await loadContentLibrary();
  });
$('content-next').onclick = () =>
  run(async () => {
    contentLibraryPage++;
    await loadContentLibrary();
  });
$('content-refresh').onclick = () => run(loadContentLibrary);
async function refreshContentJob() {
  if (!contentSelectedJob) return;
  const old = contentSelectedJob.status;
  contentSelectedJob = await api('/api/content/jobs/' + contentSelectedJob.id);
  renderContentJob(contentSelectedJob);
  if (old !== contentSelectedJob.status && !['queued', 'running'].includes(contentSelectedJob.status)) {
    await showContentBalance();
    await loadContentLibrary();
  }
}
function stopContentPolling() {
  clearTimeout(contentTimer);
  contentTimer = undefined;
}
function startContentPolling() {
  stopContentPolling();
  if ($('konten').hidden || !contentSelectedJob || !['queued', 'running'].includes(contentSelectedJob.status)) return;
  contentTimer = setTimeout(async () => {
    try {
      await refreshContentJob();
    } catch (e) {
      $('content-job-info').textContent = 'Koneksi terputus. Pekerjaan tetap berjalan; mencoba memuat kembali…';
    } finally {
      startContentPolling();
    }
  }, 3500);
}
$('content-brand-open').onclick = () =>
  run(async () => {
    contentBrandData = await api('/api/content/brand');
    for (const name of ['name', 'description', 'colors'])
      $('content-brand-form').elements[name].value = contentBrandData[name] ?? '';
    renderContentBrandLogo();
    $('content-brand-dialog').showModal();
  });
function renderContentBrandLogo() {
  $('content-brand-preview').replaceChildren();
  if (contentBrandData.logo) {
    const image = document.createElement('img');
    image.src = '/api/content/files/' + contentBrandData.logo;
    image.alt = 'Logo brand';
    $('content-brand-preview').append(image);
  }
}
$('content-brand-logo').onchange = () =>
  run(async () => {
    const file = $('content-brand-logo').files[0];
    const submit = $('content-brand-form').querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      if (file) {
        contentBrandData.logo = (await uploadContentImage(file)).id;
        renderContentBrandLogo();
      }
    } finally {
      $('content-brand-logo').value = '';
      submit.disabled = false;
    }
  });
$('content-brand-remove-logo').onclick = () => {
  contentBrandData.logo = '';
  renderContentBrandLogo();
};
form('content-brand-form', async data => {
  await api('/api/content/brand', 'PUT', { ...data, logo: contentBrandData.logo ?? '' });
  $('content-brand-dialog').close();
  $('message').textContent = 'Identitas brand tersimpan.';
});
// Memilih gambar dari pustaka referensi akun; onPick menerima {id, url}.
function pickContentReference(onPick) {
  return run(async () => {
    const references = await api('/api/content/references');
    $('content-reference-library').replaceChildren(
      ...references.map(ref => {
        const choice = button('Pilih', () => {
          onPick(ref);
          $('content-reference-dialog').close();
        });
        const image = document.createElement('img');
        image.src = ref.url;
        image.alt = 'Referensi tersimpan';
        choice.prepend(image);
        return choice;
      }),
    );
    if (!references.length) $('content-reference-library').append(element('p', '', 'Belum ada referensi tersimpan.'));
    $('content-reference-dialog').showModal();
  });
}

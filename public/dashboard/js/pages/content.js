// Page Konten: profil generator, referensi, brand, pekerjaan asinkron dan pustaka hasil milik akun.
let contentProfiles = [],
  contentCapabilities = {},
  contentReferences = [],
  contentBrandData = {},
  contentSelectedJob = null;
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
  prompt: 'Menyusun prompt gambar…',
  generating: 'Membuat gambar… Proses ini dapat memerlukan beberapa menit.',
  saving: 'Menyimpan hasil ke pustaka…',
};
const selectedContentProfile = () => contentProfiles.find(p => p.id === $('content-profile').value);
async function loadContent() {
  if (contentLoading) return;
  contentLoading = true;
  try {
    const previous = $('content-profile').value;
    const [profiles, capabilities, balance, brand] = await Promise.all([
      api('/api/content/profiles'),
      api('/api/content/capabilities'),
      api('/api/ai/wallet'),
      api('/api/content/brand'),
    ]);
    contentProfiles = profiles;
    contentCapabilities = capabilities;
    contentBrandData = brand;
    $('content-balance').textContent = 'Kredit AI ' + Number(balance.balance).toLocaleString('id-ID');
    $('content-profile').replaceChildren(
      new Option('Pilih profil generator', ''),
      ...profiles.map(p => new Option(p.name, p.id)),
    );
    $('content-profile').value = profiles.some(p => p.id === previous) ? previous : (profiles[0]?.id ?? '');
    renderContentProfile();
    $('content-notice').textContent = !profiles.length
      ? 'Belum ada profil generator aktif. Owner perlu menerbitkan dan mengaktifkan profil.'
      : !capabilities.configured
        ? 'Model Gambar belum dikonfigurasi oleh owner.'
        : !capabilities.creditsPerImage
          ? 'Tarif kredit gambar belum diatur oleh owner.'
          : '';
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
function renderContentProfile() {
  const profile = selectedContentProfile();
  const values = Object.fromEntries(
    [...$('content-custom-fields').querySelectorAll('[name]')].map(el => [el.name, el.value]),
  );
  $('content-profile-description').textContent = profile?.description ?? '';
  $('content-custom-fields').replaceChildren(
    ...(profile?.fields ?? []).map(field => {
      const label = element('label', '', field.label + (field.required ? ' *' : ''));
      const control = document.createElement(
        field.type === 'choice' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input',
      );
      control.name = field.id;
      control.required = field.required;
      control.maxLength = field.type === 'textarea' ? 2000 : 500;
      if (field.type === 'textarea') control.rows = 3;
      if (field.type === 'choice')
        control.append(new Option('Pilih…', ''), ...field.options.map(v => new Option(v, v)));
      control.value = values[field.id] ?? '';
      label.append(control);
      return label;
    }),
  );
  const oldRatio = $('content-ratios').querySelector('input:checked')?.value;
  $('content-ratios').replaceChildren(
    ...(profile?.ratios ?? []).map((ratio, i) => {
      const label = element('label'),
        input = document.createElement('input');
      input.type = 'radio';
      input.name = 'content-ratio';
      input.value = ratio;
      input.checked = oldRatio ? oldRatio === ratio : i === 0;
      label.append(input, document.createTextNode(ratio));
      return label;
    }),
  );
  if (!$('content-ratios').querySelector('input:checked')) $('content-ratios').querySelector('input')?.click();
  const oldCount = $('content-count').value,
    max = Math.min(profile?.maxImages ?? 1, contentCapabilities.maxImages ?? 1);
  $('content-count').replaceChildren(
    ...Array.from({ length: max }, (_, i) => new Option(i + 1 + ' gambar', String(i + 1))),
  );
  if (Number(oldCount) <= max) $('content-count').value = oldCount;
  $('content-reference-field').hidden = !(profile?.references && contentCapabilities.references);
  if ($('content-reference-field').hidden) contentReferences = [];
  renderContentReferences();
  updateContentEstimate();
}
function updateContentEstimate() {
  const count = Number($('content-count').value) || 1;
  const cost = count * (contentCapabilities.creditsPerImage ?? 0);
  $('content-estimate').textContent =
    'Estimasi ' +
    cost.toLocaleString('id-ID') +
    ' kredit · ' +
    count +
    ' gambar. Hanya hasil tersimpan yang ditagihkan.';
  $('content-generate').disabled =
    !selectedContentProfile() || !contentCapabilities.configured || !cost || contentUploading;
}
function renderContentReferences() {
  $('content-references').replaceChildren(
    ...contentReferences.map(ref => {
      const box = element('div', 'content-reference-thumb'),
        image = document.createElement('img');
      image.src = ref.url;
      image.alt = 'Referensi produk';
      const remove = button('×', () => {
        contentReferences = contentReferences.filter(r => r.id !== ref.id);
        renderContentReferences();
      });
      remove.setAttribute('aria-label', 'Lepas referensi');
      box.append(image, remove);
      return box;
    }),
  );
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
$('content-upload').onchange = () =>
  run(async () => {
    const files = [...$('content-upload').files];
    if (files.length + contentReferences.length > 4) throw Error('Maksimum empat referensi gambar.');
    contentUploading = true;
    $('content-generate').disabled = true;
    try {
      for (const file of files) contentReferences.push(await uploadContentImage(file));
      renderContentReferences();
    } finally {
      contentUploading = false;
      $('content-upload').value = '';
      renderContentReferences();
      updateContentEstimate();
    }
  });
$('content-profile').onchange = renderContentProfile;
$('content-count').onchange = updateContentEstimate;
$('content-form').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const body = {
      profileId: $('content-profile').value,
      brief: $('content-brief').value,
      fields: Object.fromEntries(
        [...$('content-custom-fields').querySelectorAll('[name]')].map(el => [el.name, el.value]),
      ),
      ratio: $('content-ratios').querySelector('input:checked')?.value,
      count: Number($('content-count').value),
      references: contentReferences.map(r => r.id),
    };
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
      const balance = await api('/api/ai/wallet');
      $('content-balance').textContent = 'Kredit AI ' + Number(balance.balance).toLocaleString('id-ID');
    } finally {
      updateContentEstimate();
    }
  });
};
function renderContentJob(job) {
  $('content-job-state').textContent = contentStates[job.status] ?? job.status;
  const pending = ['queued', 'running'].includes(job.status);
  $('content-job-info').textContent = pending
    ? (contentStages[job.stage] ?? 'Sedang diproses…')
    : (job.error ?? job.results.length + ' gambar tersimpan · ' + job.charged.toLocaleString('id-ID') + ' kredit');
  $('content-retry').hidden = !['failed', 'interrupted'].includes(job.status);
  if (pending) {
    const placeholder = element('div', 'content-placeholder is-generating');
    placeholder.append(
      element('span', '', '✦'),
      element('strong', '', 'Ide Anda sedang dibuat'),
      element('p', '', 'Anda boleh berpindah halaman. Hasil akan tersimpan di pustaka.'),
    );
    $('content-results').replaceChildren(placeholder);
  } else $('content-results').replaceChildren(...job.results.map(result => contentImageCard(result, job)));
}
function contentImageCard(result, job) {
  const card = element('div', 'content-image-card'),
    image = document.createElement('img');
  image.src = result.url;
  image.alt = job.brief;
  image.loading = 'lazy';
  const actions = element('div', 'content-image-actions'),
    download = element('a', 'button secondary', 'Unduh');
  download.href = result.url + '?download=1';
  download.prepend(contentActionIcon('download'));
  const reference = button('Jadikan referensi', () => reuseContentJob(job, result.id));
  reference.className = 'secondary';
  reference.prepend(contentActionIcon('reference'));
  actions.append(download, reference);
  const footer = element('div', 'content-image-footer');
  footer.append(contentInstagramButton(result), actions);
  card.append(image, footer);
  return card;
}
async function reuseContentJob(job, reference) {
  if (!contentProfiles.some(p => p.id === job.profile_id))
    throw Error('Profil asal sudah tidak tersedia. Pilih profil generator lain.');
  $('content-profile').value = job.profile_id;
  renderContentProfile();
  $('content-brief').value = job.brief;
  for (const field of $('content-custom-fields').querySelectorAll('[name]'))
    field.value = job.fields?.[field.name] ?? '';
  const ratio = [...$('content-ratios').querySelectorAll('input')].find(el => el.value === job.ratio);
  if (ratio) ratio.checked = true;
  contentReferences = [];
  const profile = selectedContentProfile();
  if (profile?.references && contentCapabilities.references)
    contentReferences = (reference ? [reference] : (job.references ?? [])).map(id => ({
      id,
      url: '/api/content/files/' + id,
    }));
  else if (reference)
    $('message').textContent = 'Ditambahkan sebagai brief; provider ini belum mendukung referensi untuk variasi.';
  renderContentReferences();
  contentRequestId = '';
  contentTab('create');
  $('content-brief').focus();
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
      if (job.results[0]) {
        const image = document.createElement('img');
        image.src = job.results[0].url;
        image.alt = job.brief;
        image.loading = 'lazy';
        card.append(image);
      }
      card.append(
        element('p', '', job.brief),
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
        button(['failed', 'interrupted'].includes(job.status) ? 'Coba lagi' : 'Gunakan brief', () =>
          reuseContentJob(job),
        ),
      );
      card.append(actions);
      return card;
    }),
  );
  if (!response.items.length)
    $('content-library-items').append(
      element('p', 'empty', 'Belum ada konten. Buat gambar pertama Anda di tab Buat gambar.'),
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
    const balance = await api('/api/ai/wallet');
    $('content-balance').textContent = 'Kredit AI ' + Number(balance.balance).toLocaleString('id-ID');
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
$('content-reference-picker').onclick = () =>
  run(async () => {
    const references = await api('/api/content/references');
    $('content-reference-library').replaceChildren(
      ...references.map(ref => {
        const choice = button('Pilih', () => {
          if (contentReferences.length >= 4) throw Error('Maksimum empat referensi.');
          if (!contentReferences.some(r => r.id === ref.id)) contentReferences.push(ref);
          renderContentReferences();
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

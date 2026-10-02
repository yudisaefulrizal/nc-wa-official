// Profil AI owner: pilihan Asisten AI/Generator Gambar dan konfigurasi kemampuan provider gambar.
// Dimuat setelah ai-admin.js agar editor provider dan pemuatan admin sudah tersedia.
let imageAdminProfiles = [];
{
  const page = $('admin-profiles'),
    create = page.querySelector('a.button'),
    tabs = element('nav', 'content-tabs image-profile-tabs');
  const assistant = button('Asisten AI', () => imageProfileTab('assistant'));
  assistant.id = 'image-profile-assistant-tab';
  assistant.setAttribute('aria-pressed', 'true');
  const generator = button('Generator Gambar', () => imageProfileTab('image'));
  generator.id = 'image-profile-generator-tab';
  generator.setAttribute('aria-pressed', 'false');
  tabs.append(assistant, generator);
  const list = element('div', 'image-profile-cards');
  list.id = 'admin-image-profiles';
  list.hidden = true;
  page.querySelector('p').after(tabs);
  $('admin-profiles-list').after(list);
  const dialog = document.createElement('dialog');
  dialog.id = 'image-profile-create-dialog';
  const heading = element('div', 'content-result-heading');
  heading.append(
    element('h2', '', 'Pilih jenis profil'),
    button('Tutup', () => dialog.close()),
  );
  const options = element('div', 'image-profile-type-options');
  for (const [title, description, href] of [
    ['Profil Asisten AI', 'Percakapan dan layanan pelanggan', '/dashboard/admin/ai-builder'],
    ['Profil Generator Gambar', 'Visual dari brief dan referensi', '/dashboard/admin/image-builder'],
  ]) {
    const link = element('a', 'button secondary');
    link.href = href;
    link.append(element('strong', '', title), element('small', '', description));
    options.append(link);
  }
  dialog.append(heading, options);
  page.append(dialog);
  create.replaceWith(button('Buat profil', () => dialog.showModal()));
}
function imageProfileTab(kind) {
  $('admin-profiles-list').hidden = kind !== 'assistant';
  $('admin-image-profiles').hidden = kind !== 'image';
  $('image-profile-assistant-tab').setAttribute('aria-pressed', String(kind === 'assistant'));
  $('image-profile-generator-tab').setAttribute('aria-pressed', String(kind === 'image'));
  $('admin-profiles')
    .querySelectorAll('.ai-warning,.empty')
    .forEach(el => (el.hidden = kind !== 'assistant'));
}
const loadAssistantAdminProfiles = loadAdminProfiles;
loadAdminProfiles = async () => {
  await loadAssistantAdminProfiles();
  imageAdminProfiles = await api('/api/admin/ai/image-profiles');
  $('admin-image-profiles').replaceChildren(
    ...imageAdminProfiles.map(profile => {
      const card = element('article', 'image-profile-card'),
        symbol = element('div', 'image-profile-symbol', '▧');
      card.append(
        symbol,
        element('h3', '', profile.draft.name),
        element('p', '', profile.draft.description),
        element('span', 'badge', profile.enabled ? 'Aktif' : profile.active ? 'Terbit · nonaktif' : 'Draft'),
      );
      card.append(
        element(
          'p',
          'content-helper',
          profile.active
            ? 'Versi ' +
                profile.published_revision +
                (profile.revision > profile.published_revision ? ' · draft berubah' : '')
            : 'Belum diterbitkan',
        ),
      );
      const toggle = element('label', 'ai-toggle'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = profile.enabled;
      check.disabled = !profile.active;
      check.setAttribute('aria-label', 'Aktifkan ' + profile.draft.name);
      check.onchange = () =>
        run(async () => {
          try {
            await api('/api/admin/ai/image-profiles/' + profile.id + '/enabled', 'PUT', { enabled: check.checked });
          } finally {
            await loadAdminProfiles();
          }
        });
      toggle.append(check, element('span'), document.createTextNode('Tersedia untuk pelanggan'));
      card.append(toggle);
      const actions = element('div', 'row-actions'),
        editor = element('a', 'button secondary', 'Buka builder');
      editor.href = '/dashboard/admin/image-builder?profile=' + profile.id;
      actions.append(
        editor,
        button('Hapus', async () => {
          if (!confirm('Hapus profil ' + profile.draft.name + '? Hasil gambar pelanggan tetap tersimpan.')) return;
          await api('/api/admin/ai/image-profiles/' + profile.id, 'DELETE', { revision: profile.revision });
          await loadAdminProfiles();
        }),
      );
      card.append(actions);
      return card;
    }),
  );
  if (!imageAdminProfiles.length)
    $('admin-image-profiles').append(
      element('p', '', 'Belum ada generator. Pilih Buat profil → Profil Generator Gambar.'),
    );
};
{
  const form = window.__providerUi.dialog.querySelector('form'),
    fieldset = document.createElement('fieldset');
  fieldset.id = 'image-provider-settings';
  fieldset.innerHTML =
    '<legend>Model Gambar</legend><p class="content-helper">Isi model gambar di atas. Sesuaikan kemampuan dengan model/provider yang dipilih; model teks boleh dikosongkan untuk provider khusus gambar.</p><label>Protokol<select name="image_protocol"><option value="auto">Otomatis sesuai provider</option><option value="openrouter">OpenRouter Images</option><option value="compatible">Images API kompatibel</option><option value="chat">Chat multimodal</option></select></label><label><input type="checkbox" name="image_references"> Mendukung referensi gambar</label><label>Maksimum gambar per permintaan<input name="image_max" type="number" min="1" max="4" value="1"></label><label>Kredit per gambar<input name="image_credits" type="number" min="0" max="1000000" value="0"></label><p class="content-helper">0 berarti belum tersedia untuk pelanggan. Tarif mencakup penyusunan prompt bila profil memakainya.</p><label>Kualitas<select name="image_quality"><option value="auto">Otomatis</option><option value="low">Rendah</option><option value="medium">Sedang</option><option value="high">Tinggi</option></select></label><details><summary>Ukuran untuk Images API kompatibel</summary><p>Isi ukuran yang benar-benar didukung model. OpenRouter dan Chat multimodal memakai rasio.</p><label>1:1<input name="image_size_square" placeholder="1024x1024"></label><label>4:5<input name="image_size_portrait" placeholder="1024x1280"></label><label>9:16<input name="image_size_story" placeholder="1024x1792"></label></details>';
  form.elements.active.closest('label').before(fieldset);
  const openWithoutImage = openProviderProfile;
  openProviderProfile = profile => {
    openWithoutImage(profile);
    const options =
      typeof profile?.image_options === 'string' ? JSON.parse(profile.image_options) : (profile?.image_options ?? {});
    form.elements.image_protocol.value = options.protocol ?? 'auto';
    form.elements.image_references.checked = options.references === true;
    form.elements.image_max.value = options.maxImages ?? 1;
    form.elements.image_credits.value = options.creditsPerImage ?? 0;
    form.elements.image_quality.value = options.quality ?? 'auto';
    form.elements.image_size_square.value = options.sizes?.['1:1'] ?? '1024x1024';
    form.elements.image_size_portrait.value = options.sizes?.['4:5'] ?? '1024x1280';
    form.elements.image_size_story.value = options.sizes?.['9:16'] ?? '1024x1792';
  };
  const row = window.__providerUi.routes.elements.imageProfile.closest('label');
  const hint = element(
    'p',
    'content-helper',
    'Khusus profil Generator Gambar. Pilih provider dengan model gambar; tidak memakai fallback ke model teks.',
  );
  const test = button('Uji Model Gambar', async () => {
    const id = window.__providerUi.routes.elements.imageProfile.value;
    if (!id) throw Error('Pilih provider gambar dahulu.');
    const result = await api('/api/admin/ai/image-test', 'POST', { id });
    $('image-provider-test-result').replaceChildren();
    const image = document.createElement('img');
    image.src = result.url;
    image.alt = 'Hasil uji Model Gambar';
    image.style.maxWidth = '240px';
    $('image-provider-test-result').append(image);
    $('message').textContent = 'Model Gambar berhasil diuji. Simpan rute provider untuk menggunakannya.';
  });
  test.className = 'secondary';
  const result = element('div');
  result.id = 'image-provider-test-result';
  row.append(
    hint,
    element('small', 'content-helper', 'Uji menghasilkan satu gambar dan memakai biaya provider.'),
    test,
    result,
  );
}
function collectImageProviderOptions(form) {
  return {
    protocol: form.elements.image_protocol.value,
    references: form.elements.image_references.checked,
    maxImages: Number(form.elements.image_max.value),
    creditsPerImage: Number(form.elements.image_credits.value),
    quality: form.elements.image_quality.value,
    sizes: {
      '1:1': form.elements.image_size_square.value,
      '4:5': form.elements.image_size_portrait.value,
      '9:16': form.elements.image_size_story.value,
    },
  };
}

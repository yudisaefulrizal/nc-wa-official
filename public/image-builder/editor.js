// Editor generator owner: autosave draft, konfigurasi alur/formulir, publikasi versi dan uji asinkron.
const gen = id => document.getElementById(id);
let generatorState = null,
  generatorDefinition = null,
  generatorChange = 0,
  generatorSavedChange = 0,
  generatorSaving = null,
  generatorSaveTimer,
  generatorTestTimer;
let generatorNode = 'image',
  generatorTestJob = null,
  generatorTestCapabilities = {},
  generatorTestPending = null;
const generatorApiBase = '/api/admin/ai/image-profiles';
async function generatorApi(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = Error(data.message ?? data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}
function generatorError(error) {
  gen('generator-message').textContent = error.message;
  gen('generator-message').hidden = false;
}
async function generatorRun(action) {
  gen('generator-message').hidden = true;
  try {
    await action();
  } catch (error) {
    generatorError(error);
  }
}
function generatorElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
function generatorButton(text, action) {
  const button = generatorElement('button', '', text);
  button.type = 'button';
  button.onclick = () =>
    generatorRun(async () => {
      button.disabled = true;
      try {
        await action();
      } finally {
        button.disabled = false;
      }
    });
  return button;
}
function generatorBlank(name = 'Generator baru') {
  return {
    kind: 'image_generator',
    name,
    description: '',
    prompt:
      'Buat gambar berdasarkan brief berikut: {{brief}}.\nIdentitas brand: {{brand}}.\nDetail tambahan: {{fields}}.',
    refine: false,
    useBrand: true,
    references: true,
    ratios: ['1:1', '4:5', '9:16'],
    maxImages: 4,
    fields: [],
  };
}
async function initializeGenerator() {
  const account = await generatorApi('/api/me');
  if (account.role !== 'owner') {
    location.assign('/dashboard');
    return;
  }
  const id = new URLSearchParams(location.search).get('profile');
  if (!id) {
    gen('generator-library').hidden = false;
    gen('generator-status').hidden = true;
    return;
  }
  await openGenerator(id);
}
async function openGenerator(id) {
  generatorState = await generatorApi(generatorApiBase + '/' + encodeURIComponent(id));
  generatorDefinition = structuredClone(generatorState.draft);
  generatorChange = generatorSavedChange = 0;
  gen('generator-library').hidden = true;
  gen('generator-editor').hidden = gen('generator-tabs').hidden = gen('generator-actions').hidden = false;
  history.replaceState(null, '', '/dashboard/admin/image-builder?profile=' + encodeURIComponent(id));
  renderGenerator();
  await loadGeneratorVersions();
}
function renderGenerator() {
  document.querySelectorAll('[data-definition]').forEach(control => {
    const value = generatorDefinition[control.dataset.definition];
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  });
  document
    .querySelectorAll('[data-ratio]')
    .forEach(control => (control.checked = generatorDefinition.ratios.includes(control.value)));
  renderGeneratorFields();
  renderGeneratorSummary();
  selectGeneratorNode(generatorNode);
}
function renderGeneratorSummary() {
  gen('generator-title').textContent = generatorDefinition.name || 'Generator baru';
  gen('generator-status').textContent = generatorState.active ? (generatorState.enabled ? 'Aktif' : 'Terbit') : 'Draft';
  gen('generator-prompt-badge').textContent = generatorDefinition.refine ? 'Cerdas' : 'Template';
  gen('generator-image-summary').textContent =
    generatorDefinition.maxImages + ' gambar · ' + generatorDefinition.ratios.join(', ');
  gen('generator-brand-node').hidden = !generatorDefinition.useBrand;
  gen('generator-enable').checked = generatorState.enabled;
  gen('generator-enable').disabled = !generatorState.active;
  gen('generator-publication-info').textContent = generatorState.active
    ? 'Versi terbit ' + generatorState.published_revision + ' · Draft revisi ' + generatorState.revision
    : 'Draft belum diterbitkan';
  gen('generator-publish').disabled =
    generatorChange !== generatorSavedChange ||
    Boolean(generatorSaving) ||
    generatorState.revision === generatorState.published_revision;
}
function generatorChanged() {
  generatorChange++;
  gen('generator-save-state').textContent = 'Belum tersimpan';
  clearTimeout(generatorSaveTimer);
  generatorSaveTimer = setTimeout(() => generatorRun(saveGenerator), 800);
  renderGeneratorSummary();
}
async function saveGenerator() {
  clearTimeout(generatorSaveTimer);
  if (generatorSaving) {
    await generatorSaving;
    if (generatorChange !== generatorSavedChange) return saveGenerator();
    return;
  }
  if (generatorChange === generatorSavedChange) return;
  const change = generatorChange,
    definition = structuredClone(generatorDefinition);
  gen('generator-save-state').textContent = 'Menyimpan…';
  generatorSaving = (async () => {
    const response = await generatorApi(generatorApiBase + '/' + generatorState.id, 'PUT', {
      revision: generatorState.revision,
      definition,
    });
    generatorState = response;
    generatorSavedChange = change;
    gen('generator-save-state').textContent =
      generatorSavedChange === generatorChange ? 'Tersimpan' : 'Belum tersimpan';
  })();
  try {
    await generatorSaving;
  } catch (error) {
    gen('generator-save-state').textContent = 'Gagal menyimpan';
    throw error;
  } finally {
    generatorSaving = null;
    renderGeneratorSummary();
  }
  if (generatorChange !== generatorSavedChange) return saveGenerator();
}
for (const control of document.querySelectorAll('[data-definition]'))
  control.addEventListener(control.type === 'checkbox' ? 'change' : 'input', () => {
    const key = control.dataset.definition;
    generatorDefinition[key] =
      control.type === 'checkbox' ? control.checked : key === 'maxImages' ? Number(control.value) : control.value;
    document.querySelectorAll('[data-definition="' + key + '"]').forEach(other => {
      if (other !== control) {
        if (other.type === 'checkbox') other.checked = control.checked;
        else other.value = control.value;
      }
    });
    generatorChanged();
  });
document.querySelectorAll('[data-ratio]').forEach(
  control =>
    (control.onchange = () => {
      generatorDefinition.ratios = [...document.querySelectorAll('[data-ratio]:checked')].map(input => input.value);
      generatorChanged();
    }),
);
function generatorTab(tab) {
  for (const id of ['flow', 'form', 'settings']) gen('generator-' + id).hidden = id !== tab;
  document
    .querySelectorAll('[data-tab]')
    .forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
  if (tab === 'form') renderGeneratorFormPreview();
}
document.querySelectorAll('[data-tab]').forEach(button => (button.onclick = () => generatorTab(button.dataset.tab)));
function selectGeneratorNode(node) {
  generatorNode = node;
  document
    .querySelectorAll('[data-node]')
    .forEach(button => button.classList.toggle('selected', button.dataset.node === node));
  document.querySelectorAll('[data-inspector]').forEach(panel => (panel.hidden = panel.dataset.inspector !== node));
  gen('generator-inspector-title').textContent = {
    brief: 'Brief',
    prompt: 'Susun prompt',
    image: 'Generate gambar',
    brand: 'Data brand',
    save: 'Simpan hasil',
    output: 'Output',
  }[node];
  gen('generator-inspector-description').textContent = 'Pengaturan langkah generator';
}
document
  .querySelectorAll('[data-node]')
  .forEach(button => (button.onclick = () => selectGeneratorNode(button.dataset.node)));
gen('generator-open-form').onclick = () => generatorTab('form');
gen('generator-save').onclick = () => generatorRun(saveGenerator);
gen('generator-create-form').onsubmit = event => {
  event.preventDefault();
  void generatorRun(async () => {
    const state = await generatorApi(generatorApiBase, 'POST', generatorBlank(gen('generator-create-name').value));
    await openGenerator(state.id);
  });
};
gen('generator-import').onchange = () =>
  generatorRun(async () => {
    const file = gen('generator-import').files[0];
    if (!file) return;
    if (file.size > 128 * 1024) throw Error('File JSON maksimum 128 KB.');
    const state = await generatorApi(generatorApiBase, 'POST', JSON.parse(await file.text()));
    await openGenerator(state.id);
  });
gen('generator-publish').onclick = () =>
  generatorRun(async () => {
    gen('generator-editor').inert = true;
    try {
      await saveGenerator();
      generatorState = await generatorApi(generatorApiBase + '/' + generatorState.id + '/publish', 'POST', {
        revision: generatorState.revision,
      });
      renderGeneratorSummary();
      await loadGeneratorVersions();
    } finally {
      gen('generator-editor').inert = false;
    }
  });
gen('generator-enable').onchange = () =>
  generatorRun(async () => {
    try {
      await saveGenerator();
      generatorState = await generatorApi(generatorApiBase + '/' + generatorState.id + '/enabled', 'PUT', {
        enabled: gen('generator-enable').checked,
      });
    } finally {
      renderGeneratorSummary();
    }
  });
gen('generator-export').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(generatorDefinition, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'generator.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
gen('generator-copy').onclick = () =>
  generatorRun(async () => {
    await saveGenerator();
    const copy = structuredClone(generatorDefinition);
    copy.name = (copy.name + ' (salinan)').slice(0, 100);
    const state = await generatorApi(generatorApiBase, 'POST', copy);
    await openGenerator(state.id);
  });
async function loadGeneratorVersions() {
  const versions = await generatorApi(generatorApiBase + '/' + generatorState.id + '/versions');
  gen('generator-versions').replaceChildren(
    ...versions.map(version => {
      const row = generatorElement('div', 'version-row');
      row.append(
        generatorElement(
          'span',
          '',
          'Versi ' +
            version.revision +
            ' · ' +
            new Date(version.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        ),
        generatorButton('Pulihkan', async () => {
          if (
            !confirm(
              'Pulihkan versi ' +
                version.revision +
                ' ke draft? Versi terbit tetap dipakai pelanggan sampai diterbitkan lagi.',
            )
          )
            return;
          const definition = await generatorApi(
            generatorApiBase + '/' + generatorState.id + '/versions/' + version.revision,
          );
          generatorDefinition = definition;
          generatorChanged();
          renderGenerator();
          await saveGenerator();
        }),
      );
      return row;
    }),
  );
  if (!versions.length)
    gen('generator-versions').append(generatorElement('p', '', 'Riwayat muncul setelah profil diterbitkan.'));
}
function renderGeneratorFields() {
  gen('generator-fields').replaceChildren(
    ...generatorDefinition.fields.map((field, index) => {
      const row = generatorElement('div', 'field-editor');
      for (const [key, title] of [
        ['label', 'Label'],
        ['id', 'ID variabel'],
      ]) {
        const label = generatorElement('label', '', title),
          input = document.createElement('input');
        input.value = field[key];
        input.maxLength = key === 'id' ? 50 : 100;
        input.oninput = () => {
          field[key] = input.value;
          generatorChanged();
        };
        label.append(input);
        row.append(label);
      }
      const typeLabel = generatorElement('label', '', 'Tipe'),
        select = document.createElement('select');
      for (const [value, title] of [
        ['text', 'Teks'],
        ['textarea', 'Teks panjang'],
        ['choice', 'Pilihan'],
      ])
        select.append(new Option(title, value));
      select.value = field.type;
      select.onchange = () => {
        field.type = select.value;
        if (field.type === 'choice' && !field.options.length) field.options = ['Pilihan pertama'];
        generatorChanged();
        renderGeneratorFields();
      };
      typeLabel.append(select);
      row.append(typeLabel);
      row.append(
        generatorButton('Hapus', () => {
          generatorDefinition.fields.splice(index, 1);
          generatorChanged();
          renderGeneratorFields();
        }),
      );
      const extra = generatorElement('div', 'field-extra'),
        required = generatorElement('label', 'toggle-label'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = field.required;
      check.onchange = () => {
        field.required = check.checked;
        generatorChanged();
      };
      required.append(check, document.createTextNode('Wajib diisi'));
      extra.append(required);
      if (field.type === 'choice') {
        const label = generatorElement('label', '', 'Pilihan (satu per baris)'),
          textarea = document.createElement('textarea');
        textarea.rows = 3;
        textarea.value = field.options.join('\n');
        textarea.oninput = () => {
          field.options = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(Boolean);
          generatorChanged();
        };
        label.append(textarea);
        extra.append(label);
      }
      row.append(extra);
      return row;
    }),
  );
  renderGeneratorFormPreview();
}
gen('generator-add-field').onclick = () => {
  if (generatorDefinition.fields.length >= 12) {
    generatorError(Error('Maksimum 12 field.'));
    return;
  }
  let number = generatorDefinition.fields.length + 1;
  while (generatorDefinition.fields.some(field => field.id === 'field_' + number)) number++;
  generatorDefinition.fields.push({
    id: 'field_' + number,
    label: 'Detail ' + number,
    type: 'text',
    required: false,
    options: [],
  });
  generatorChanged();
  renderGeneratorFields();
};
function generatorFieldControl(field, prefix) {
  const label = generatorElement('label', '', field.label + (field.required ? ' *' : ''));
  const control = document.createElement(
    field.type === 'choice' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input',
  );
  control.name = field.id;
  control.required = field.required;
  control.maxLength = field.type === 'textarea' ? 2000 : 500;
  control.dataset.testField = field.id;
  if (field.type === 'textarea') control.rows = 3;
  if (field.type === 'choice')
    control.append(new Option('Pilih…', ''), ...field.options.map(value => new Option(value, value)));
  if (prefix) control.disabled = true;
  label.append(control);
  return label;
}
function renderGeneratorFormPreview() {
  const brief = generatorElement('label', '', 'Brief gambar *'),
    textarea = document.createElement('textarea');
  textarea.disabled = true;
  textarea.placeholder = 'Ceritakan gambar yang ingin dibuat.';
  brief.append(textarea);
  gen('generator-form-preview').replaceChildren(
    brief,
    ...generatorDefinition.fields.map(field => generatorFieldControl(field, true)),
  );
}
gen('generator-test').onclick = () =>
  generatorRun(async () => {
    await saveGenerator();
    generatorTestCapabilities = await generatorApi('/api/content/capabilities');
    const wallet = await generatorApi('/api/ai/wallet');
    gen('generator-test-fields').replaceChildren(
      ...generatorDefinition.fields.map(field => generatorFieldControl(field, false)),
    );
    gen('generator-test-ratio').replaceChildren(...generatorDefinition.ratios.map(ratio => new Option(ratio, ratio)));
    gen('generator-test-count').replaceChildren(
      ...Array.from(
        { length: Math.min(generatorDefinition.maxImages, generatorTestCapabilities.maxImages ?? 1) },
        (_, i) => new Option(String(i + 1), String(i + 1)),
      ),
    );
    gen('generator-test-upload').closest('label').hidden = !(
      generatorDefinition.references && generatorTestCapabilities.references
    );
    updateGeneratorTestEstimate();
    gen('generator-test-progress').textContent =
      'Saldo owner: ' + Number(wallet.balance).toLocaleString('id-ID') + ' kredit AI.';
    gen('generator-test-dialog').showModal();
  });
function updateGeneratorTestEstimate() {
  const cost = Number(gen('generator-test-count').value) * (generatorTestCapabilities.creditsPerImage ?? 0);
  gen('generator-test-estimate').textContent = !generatorTestCapabilities.configured
    ? 'Atur tier Model Gambar terlebih dahulu.'
    : !cost
      ? 'Atur tarif kredit gambar di provider terlebih dahulu.'
      : 'Estimasi ' + cost.toLocaleString('id-ID') + ' kredit.';
  gen('generator-test-submit').disabled = !cost || !generatorTestCapabilities.configured;
}
gen('generator-test-count').onchange = updateGeneratorTestEstimate;
gen('generator-test-close').onclick = () => gen('generator-test-dialog').close();
gen('generator-test-dialog').onclose = () => clearTimeout(generatorTestTimer);
gen('generator-test-form').addEventListener('input', () => {
  generatorTestPending = null;
});
gen('generator-test-form').onsubmit = event => {
  event.preventDefault();
  void generatorRun(async () => {
    gen('generator-test-submit').disabled = true;
    try {
      await saveGenerator();
      if (!generatorTestPending) {
        const references = [];
        const files = [...gen('generator-test-upload').files];
        if (files.length > 4) throw Error('Maksimum empat referensi.');
        for (const file of files) {
          if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
            throw Error('Referensi harus JPG/PNG/WebP maksimum 10 MB.');
          const response = await fetch('/api/content/references', {
            method: 'POST',
            headers: { 'Content-Type': file.type },
            body: file,
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.message ?? 'Unggah gagal.');
          references.push(data.id);
        }
        generatorTestPending = {
          requestId: crypto.randomUUID(),
          brief: gen('generator-test-brief').value,
          fields: Object.fromEntries(
            [...gen('generator-test-fields').querySelectorAll('[name]')].map(control => [control.name, control.value]),
          ),
          ratio: gen('generator-test-ratio').value,
          count: Number(gen('generator-test-count').value),
          references,
        };
      }
      generatorTestJob = await generatorApi(
        generatorApiBase + '/' + generatorState.id + '/run',
        'POST',
        generatorTestPending,
      );
      generatorTestPending = null;
      gen('generator-test-results').replaceChildren();
      await pollGeneratorTest();
    } finally {
      updateGeneratorTestEstimate();
    }
  });
};
async function pollGeneratorTest() {
  clearTimeout(generatorTestTimer);
  if (!generatorTestJob) return;
  generatorTestJob = await generatorApi('/api/content/jobs/' + generatorTestJob.id);
  gen('generator-test-progress').textContent =
    generatorTestJob.error ??
    {
      queued: 'Menunggu antrean…',
      running: 'Membuat gambar…',
      completed: 'Selesai · ' + generatorTestJob.charged + ' kredit',
      failed: 'Gagal',
      interrupted: 'Terputus',
    }[generatorTestJob.status];
  gen('generator-test-results').replaceChildren(
    ...generatorTestJob.results.map(result => {
      const card = generatorElement('div'),
        image = document.createElement('img');
      image.src = result.url;
      image.alt = 'Hasil uji generator';
      const download = generatorElement('a', '', 'Unduh PNG');
      download.href = result.url + '?download=1';
      card.append(image, download);
      return card;
    }),
  );
  if (['queued', 'running'].includes(generatorTestJob.status) && gen('generator-test-dialog').open)
    generatorTestTimer = setTimeout(() => generatorRun(pollGeneratorTest), 2500);
}
window.addEventListener('beforeunload', event => {
  if (generatorChange !== generatorSavedChange) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    if (generatorState) void generatorRun(saveGenerator);
  }
});
void generatorRun(initializeGenerator);

// Pengaturan node dan pemetaan variabel; perubahan dicatat agar dapat diurungkan.
function removeNode(id) {
  if (!confirm('Hapus node beserta koneksinya?')) return;
  mutate(() => {
    state.document.nodes = state.document.nodes.filter(n => n.id !== id);
    state.document.edges = state.document.edges.filter(e => e.source !== id && e.target !== id);
    for (const n of state.document.nodes) {
      n.tools = n.tools.filter(t => t !== id);
      if (n.memory === id) n.memory = '';
      if (n.context_memory === id) n.context_memory = '';
    }
  });
  state.selected = null;
  renderInspector();
}
function section(title) {
  const box = el('section', undefined, 'sec');
  if (title) box.append(el('h3', title));
  return box;
}
// Tombol pilihan tunggal (role radio), misalnya tier model atau operasi node Data.
function segmented(label, choices, current, onpick, className = 'segmented') {
  // Lebih dari empat pilihan dibungkus tiga kolom supaya label tidak terpotong.
  const group = el('div', undefined, className + (choices.length > 4 ? ' operations' : ''));
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const b = btn(text, () => onpick(value));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(current === value));
    if (current === value) b.classList.add('active');
    group.append(b);
  }
  return group;
}
function renderInspector() {
  const host = $('inspector'),
    n = state.document?.nodes.find(n => n.id === state.selected),
    sameNode = n && host.dataset.node === n.id,
    scrollPositions = sameNode ? [...host.querySelectorAll('.inspector-scroll')].map(box => box.scrollTop) : [],
    panelScroll = sameNode ? host.scrollTop : 0;
  host.dataset.node = n?.id ?? '';
  $('node-panel-selection').hidden = !n;
  $('node-panel-selection').textContent = n?.label ?? '';
  host.replaceChildren();
  if (!n) {
    const empty = el('div', undefined, 'inspector-empty');
    empty.append(
      svgIcon('condition'),
      el('h3', 'Pilih node untuk diatur'),
      el('p', 'Klik node di kanvas, atau tambahkan langkah baru ke alur.'),
      btn('Tambah node', openPalette, 'btn small'),
    );
    host.append(empty);
    return;
  }
  const identity = section(),
    nameError = el('small', 'Nama sudah dipakai node lain. Gunakan nama yang berbeda.', 'name-error'),
    name = field('Nama node', n.label, v => {
      // Spasi langsung menjadi _ saat diketik; panjang teks tetap, jadi posisi kursor dipertahankan.
      const value = nodeName(v);
      if (value !== v) {
        const at = input.selectionStart;
        input.value = value;
        input.setSelectionRange(at, at);
      }
      mutate(() => renameNode(n, value));
      showName();
    }),
    input = name.querySelector('input');
  // Penanda di bilah panel mengikuti nama tanpa menambah baris identitas di atas pengaturan.
  const showName = () => {
    $('node-panel-selection').textContent = n.label;
    const dup = duplicateLabel(n) || !n.label.trim();
    nameError.textContent = n.label.trim()
      ? 'Nama sudah dipakai node lain. Gunakan nama yang berbeda.'
      : 'Nama node wajib diisi.';
    nameError.hidden = !dup;
    input.setAttribute('aria-invalid', String(dup));
  };
  name.append(nameError);
  showName();
  identity.classList.add('inspector-option');
  const row = el('div', undefined, 'node-name-row'),
    actions = el('div', undefined, 'node-name-actions');
  actions.append(
    iconButton('copy', 'Salin node', () => {
      const copy = structuredClone(n);
      copy.label = uniqueLabel(n.label, state.document.nodes);
      copy.id = nodeIdFor(copy.label, n.type, state.document.nodes);
      const spot = freeSpot(n.x + 40, n.y + 140);
      copy.x = spot.x;
      copy.y = spot.y;
      mutate(() => state.document.nodes.push(copy));
      selectNode(copy.id);
    }),
    iconButton('trash', 'Hapus node', () => removeNode(n.id)),
  );
  row.append(name, actions);
  identity.append(row);
  host.append(identity);
  const issues = state.issues.filter(i => i.node === n.id);
  if (issues.length) {
    const box = section();
    box.classList.add('inspector-option');
    for (const issue of issues) {
      const row = el('div', undefined, 'issue');
      row.append(svgIcon('alert'), el('span', issue.message));
      box.append(row);
    }
    host.append(box);
  }
  const edit = (key, label, type = 'text', options = []) =>
    field(label, n[key], v => mutate(() => (n[key] = v)), type, options);
  if (memoryConsumers.includes(n.type)) {
    const prompt = section();
    // Instruksi Context ditanam di sistem (sudah diuji); isinya terlihat di jejak Uji, bukan diatur per profil.
    if (n.type === 'context')
      prompt.append(
        el(
          'p',
          'Instruksi ringkasan ditanam di sistem: "ubah percakapan jadi 1 konteks hanya SPO (subjek objek predikat jelas dan ekplisit) dalam dua kalimat singkat tanpa keterangan tambahan (beserta satu contoh)", dari pesan terakhir pelanggan dan jawaban AI. Isinya bisa dilihat di jejak Uji. Bila ringkasan gagal dibuat, ringkasan lama dipakai dan balasan tetap terkirim.',
          'hint',
        ),
      );
    else
      prompt.append(
        varEditor(
          n.type === 'extract' ? 'Instruksi tambahan (opsional)' : 'Instruksi',
          n.prompt,
          v => mutate(() => (n.prompt = v)),
          n,
          7,
        ),
      );
    const tiers = [
      ['cheap', 'Murah'],
      ['medium', 'Sedang'],
      ['smart', 'Cerdas'],
      ['structured', 'Terstruktur'],
      ...(n.type === 'router' ? [['decision', 'Keputusan']] : []),
    ];
    prompt.classList.add('inspector-prompt');
    const model = section('Tier model');
    model.classList.add('inspector-option');
    model.append(
      segmented('Tier model', tiers, n.tier, value => {
        mutate(() => (n.tier = value));
        renderInspector();
      }),
      edit('model', 'Model khusus (opsional)'),
    );
    const contextMemory = section();
    const contextNodes = state.document.nodes.filter(m => m.type === 'context_memory');
    contextMemory.append(
      field(
        'Memori konteks',
        n.context_memory ?? '',
        id => {
          mutate(() => (n.context_memory = id));
          renderInspector();
        },
        'select',
        [{ value: '', label: 'Tidak terhubung' }, ...contextNodes.map(m => ({ value: m.id, label: m.label }))],
      ),
      el(
        'p',
        n.type === 'context'
          ? 'Context menulis ringkasan S-P-O ke memori ini; hanya Context yang bisa menulisnya.'
          : contextNodes.length
            ? 'Node membaca ringkasan S-P-O sebagai input.context tanpa perlu riwayat.'
            : 'Profil ini belum punya Memori konteks; ringkasan masih ikut Memori percakapan (cara lama).',
        'hint',
      ),
    );
    const memory = section();
    memory.append(
      field(
        'Memori percakapan',
        n.memory ?? '',
        id => {
          mutate(() => (n.memory = id));
          renderInspector();
        },
        'select',
        [
          { value: '', label: 'Tidak terhubung' },
          ...state.document.nodes
            .filter(m => m.type === 'memory')
            .map(m => ({ value: m.id, label: m.label + ' · ' + (m.memory_limit ?? 20) + ' pesan' })),
        ],
      ),
      el('p', 'Riwayat pesan sebelumnya yang dikirim ke model. Kosongkan bila node cukup memakai konteks.', 'hint'),
    );
    // Context cukup pesan terakhir; riwayat hanya relevan di profil lama tanpa Memori konteks (ringkasan ikut memori).
    host.append(prompt, model, contextMemory, ...(n.type === 'context' && contextNodes.length ? [] : [memory]));
  }
  if (n.type === 'extract') renderExtract(host.appendChild(section()), n);
  if (n.type === 'compute') renderCompute(host.appendChild(section()), n);
  if (n.type === 'media') renderMedia(host.appendChild(section()), n);
  if (n.type === 'receive') renderReceive(host.appendChild(section()), n);
  if (n.type === 'image_gen') renderImage(host.appendChild(section()), n);
  if (n.type === 'file_json' || n.type === 'file_md') renderFile(host.appendChild(section()), n);
  if (n.type === 'context_memory') {
    const box = section();
    box.append(
      el(
        'p',
        'Ringkasan S-P-O posisi percakapan per pelanggan. Hanya ditulis node Context; dibaca Router, Agent, atau Ekstrak yang terhubung sebagai input.context.',
        'hint',
      ),
    );
    const users = section('Node yang memakai konteks');
    for (const consumer of state.document.nodes.filter(x => memoryConsumers.includes(x.type)))
      users.append(
        field(
          consumer.label + (consumer.type === 'context' ? ' (menulis)' : ''),
          consumer.context_memory === n.id,
          on => {
            mutate(() => (consumer.context_memory = on ? n.id : ''));
            renderInspector();
          },
          'checkbox',
        ),
      );
    host.append(box, users);
  }
  if (n.type === 'memory') {
    const box = section();
    box.append(
      field('Pesan sebelumnya (0–60)', n.memory_limit ?? 20, v => mutate(() => (n.memory_limit = v)), 'number'),
      el(
        'p',
        '0 hanya meneruskan pesan terbaru dan ringkasan. Data tetap terpisah per akun, sesi WhatsApp, dan pelanggan; Context yang terhubung memperbarui ringkasan.',
        'hint',
      ),
    );
    const limit = box.querySelector('input[type=number]');
    limit.min = '0';
    limit.max = '60';
    limit.step = '1';
    const users = section('Node yang memakai memori');
    for (const consumer of state.document.nodes.filter(x => memoryConsumers.includes(x.type)))
      users.append(
        field(
          consumer.label,
          consumer.memory === n.id,
          on => {
            mutate(() => (consumer.memory = on ? n.id : ''));
            renderInspector();
          },
          'checkbox',
        ),
      );
    host.append(box, users);
  }
  if (n.type === 'router') {
    const routing = section('Routing tugas');
    routing.append(
      field(
        'Mode routing',
        n.routing_mode ?? 'single',
        v => {
          mutate(() => {
            n.routing_mode = v;
            if (v === 'tasks')
              n.tasks_source ??=
                state.document.nodes.find(x => x.type === 'extract' && x.extract_mode === 'tasks')?.id ?? '';
            else state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === 'done'));
          });
          renderInspector();
        },
        'select',
        [
          { value: 'single', label: 'Satu cabang' },
          { value: 'tasks', label: 'Setiap tugas ke Agent' },
        ],
      ),
    );
    if (n.routing_mode === 'tasks')
      routing.append(
        field('Sumber tugas', n.tasks_source ?? '', v => mutate(() => (n.tasks_source = v)), 'select', [
          { value: '', label: 'Pilih Ekstrak tugas…' },
          ...state.document.nodes
            .filter(x => x.type === 'extract' && x.extract_mode === 'tasks')
            .map(x => ({ value: x.id, label: x.label })),
        ]),
        field(
          'Maksimal percobaan per tugas (1–3)',
          n.max_attempts ?? 3,
          v => mutate(() => (n.max_attempts = v)),
          'number',
        ),
        el(
          'p',
          'Hubungkan setiap cabang langsung ke Agent. Hasil Agent otomatis dikumpulkan; port Selesai berjalan setelah seluruh tugas selesai atau batas tercapai. Hubungkan Selesai ke Agent penggabung.',
          'hint',
        ),
        el(
          'p',
          'Pengecualian Agent dan alasan pengembalian disimpan per tugas. Hasil lengkap: {{nodes.' +
            n.id +
            '.results}}.',
          'hint',
        ),
      );
    host.append(routing);
    const box = section('Cabang keputusan');
    for (const b of n.branches) {
      const item = el('div', undefined, 'branch');
      item.append(
        field('Label', b.label, v => mutate(() => (b.label = v))),
        field(
          'Sumber “Kapan dipilih?”',
          b.source ?? 'manual',
          v => {
            mutate(() => {
              b.source = v;
            });
            renderInspector();
          },
          'select',
          [
            { value: 'manual', label: 'Teks manual' },
            { value: 'table', label: 'Isi tabel' },
          ],
        ),
        ...(b.source === 'table'
          ? [
              field(
                'Tabel untuk pemilihan Agent',
                b.collection ?? '',
                v => mutate(() => (b.collection = v)),
                'select',
                [
                  { value: '', label: 'Pilih tabel…' },
                  ...state.document.collections
                    .filter(c => kindOf(c) === 'list')
                    .map(c => ({ value: c.id, label: c.name })),
                  ...(b.collection &&
                  !state.document.collections.some(c => c.id === b.collection && kindOf(c) === 'list')
                    ? [{ value: b.collection, label: 'Tabel tidak tersedia: ' + b.collection }]
                    : []),
                ],
              ),
              el(
                'p',
                'Seluruh baris dan field terbaru milik akun menjadi konteks Router. Data milik pelanggan dibatasi ke pengirim pesan. Agent tujuan harus memiliki tool Baca/Cari tabel ini; pencarian detail dilakukan oleh Agent.',
                'hint',
              ),
              el(
                'p',
                'Tabel kosong tidak dipilih. Total konteks pilihan dibatasi 240.000 karakter; jika terlalu besar, routing dihentikan dengan pesan error tanpa memotong data. Simulasi memakai data contoh.',
                'hint',
              ),
            ]
          : [field('Kapan dipilih?', b.description, v => mutate(() => (b.description = v)), 'textarea')]),
        field('ID port', b.id, v =>
          mutate(() => {
            for (const e of state.document.edges.filter(e => e.source === n.id && e.port === b.id)) e.port = v;
            b.id = v;
          }),
        ),
        btn(
          'Hapus cabang',
          () => {
            mutate(() => {
              n.branches = n.branches.filter(x => x !== b);
              state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === b.id));
            });
            renderInspector();
          },
          'btn small danger',
        ),
      );
      box.append(item);
    }
    box.append(
      btn(
        '＋ Cabang',
        () => {
          mutate(() => n.branches.push({ id: uid('branch'), label: 'Cabang baru', description: '' }));
          renderInspector();
        },
        'btn small',
      ),
    );
    host.append(box);
  }
  if (n.type === 'agent') {
    const box = section('Tool yang boleh dipakai'),
      tools = state.document.nodes.filter(isDataNode);
    for (const id of n.tools.filter(id => !tools.some(t => t.id === id))) {
      const row = el('div', undefined, 'issue');
      row.append(svgIcon('alert'), el('span', 'Tool belum tersedia: ' + id));
      box.append(row);
    }
    for (const t of tools.filter(t => n.tools.includes(t.id))) {
      const card = el('div', undefined, 'item-card'),
        text = el('div');
      text.append(el('strong', t.label), el('small', nodeSummary(t)));
      card.append(
        nodeIcon(t.type),
        text,
        iconButton('close', 'Lepas tool ' + t.label, () => {
          mutate(() => (n.tools = n.tools.filter(id => id !== t.id)));
          renderInspector();
        }),
      );
      box.append(card);
    }
    const available = tools.filter(t => !n.tools.includes(t.id));
    if (!tools.length) box.append(el('p', 'Tambahkan node Data, lalu hubungkan di sini.', 'hint'));
    else if (available.length)
      box.append(
        field(
          'Hubungkan node Data',
          '',
          id => {
            if (!id) return;
            mutate(() => (n.tools = [...new Set([...n.tools, id])]));
            renderInspector();
          },
          'select',
          [{ value: '', label: 'Pilih node Data…' }, ...available.map(t => ({ value: t.id, label: t.label }))],
        ),
      );
    const fallback = section(),
      row = el('div', undefined, 'sec-row'),
      text = el('div'),
      toggle = el('input', undefined, 'switch');
    text.append(
      el('div', 'Teruskan ke tim', 'sec-title'),
      el('p', 'Tambah jalur Fallback saat AI tidak bisa menjawab.', 'hint'),
    );
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', 'Teruskan ke tim');
    toggle.checked = Boolean(n.fallback);
    toggle.onchange = () => {
      mutate(() => {
        n.fallback = toggle.checked;
        if (!toggle.checked)
          state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === 'fallback'));
      });
      renderInspector();
    };
    row.append(text, toggle);
    fallback.append(row);
    const returning = section('Kembali ke Router');
    returning.append(
      field(
        'Izinkan mengembalikan tugas',
        n.return_to_router ?? false,
        v => mutate(() => (n.return_to_router = v)),
        'checkbox',
      ),
      el(
        'p',
        'Dalam routing beberapa tugas, Agent dapat mengembalikan tugas di luar kemampuannya dengan alasan. Router memilih Agent lain sampai batas percobaan.',
        'hint',
      ),
    );
    host.append(box, fallback, returning);
    const routers = state.document.nodes.filter(x => x.type === 'router' && x.routing_mode === 'tasks');
    if (routers.length) {
      const merge = section('Penggabung jawaban');
      merge.append(
        el(
          'p',
          'Gunakan Agent ini setelah port Selesai Router. Instruksi dapat disesuaikan setelah diterapkan.',
          'hint',
        ),
      );
      for (const router of routers)
        merge.append(
          btn(
            'Gabungkan hasil ' + router.label,
            () => {
              mutate(
                () =>
                  (n.prompt =
                    'Gabungkan hasil tugas berikut menjadi satu jawaban yang runtut untuk pelanggan: {{nodes.' +
                    router.id +
                    '.results}}. Gunakan jawaban tugas completed, hindari pengulangan, dan jelaskan tugas unresolved beserta informasi yang masih diperlukan. Jangan mengarang hasil atau mengklaim tugas yang belum selesai sudah berhasil.'),
              );
              renderInspector();
            },
            'btn small',
          ),
        );
      host.append(merge);
    }
  }
  if (n.type === 'condition') renderRules(host.appendChild(section('Syarat')), n);
  if (n.type === 'data_table') renderRecordTool(host.appendChild(section()), n);
  if (n.type === 'data_text') renderTextTool(host.appendChild(section()), n);
  if (n.type === 'data_form') renderFormTool(host.appendChild(section()), n);
  if (n.type === 'output' && isContent()) renderResults(host.appendChild(section()), n);
  else if (['output', 'fallback'].includes(n.type)) {
    const box = section();
    box.append(
      varEditor(
        n.type === 'output' ? 'Jawaban / variabel hasil' : 'Pesan untuk petugas',
        n.value,
        v => mutate(() => (n.value = v)),
        n,
        4,
      ),
    );
    host.append(box);
  }
  if (n.type === 'input' && isContent()) renderForm(host.appendChild(section()), n);
  else if (n.type === 'input') {
    const box = section();
    box.append(el('p', 'Menyediakan input.message, input.context, dan input.history dari percakapan.', 'hint'));
    host.append(box);
  }
  host.append(connectionsSection(n));
  // Judul kolom tetap terlihat; masing-masing isi kolom punya area gulir sendiri.
  const form = el('div', undefined, 'inspector-form'),
    column = (title, className) => {
      const box = el('section', undefined, 'inspector-column ' + className),
        heading = el('h3', title, 'inspector-column-title'),
        body = el('div', undefined, 'inspector-scroll');
      body.tabIndex = 0;
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', 'Kolom ' + title);
      box.append(heading, body);
      form.append(box);
      return body;
    },
    options = column('Umum', 'inspector-options'),
    content = column(host.querySelector('.inspector-prompt') ? 'Instruksi' : 'Pengaturan node', 'inspector-content'),
    details = column('Pengaturan lanjutan', 'inspector-details'),
    primary =
      host.querySelector('.inspector-prompt') ??
      [...host.children].find(child => !child.classList.contains('inspector-option'));
  for (const child of [...host.children]) {
    (child.classList.contains('inspector-option') ? options : child === primary ? content : details).append(child);
  }
  host.append(form);
  [options, content, details].forEach((box, index) => (box.scrollTop = scrollPositions[index] ?? 0));
  host.scrollTop = panelScroll;
}
// Koneksi masuk sebagai ringkasan, koneksi keluar bisa diubah per port.
function connectionsSection(n) {
  const box = section('Koneksi'),
    incoming = state.document.edges.filter(e => e.target === n.id),
    list = el('div', undefined, 'link-list');
  box.classList.add('inspector-option');
  if (n.type !== 'input' && n.type !== 'memory') {
    list.append(el('span', 'Masuk'));
    const sources = incoming.map(e => {
      const source = state.document.nodes.find(x => x.id === e.source);
      return source ? source.label + (e.port === 'next' ? '' : ' › ' + portLabel(source, e.port)) : e.source;
    });
    list.append(el('span', sources.join(', ') || 'Belum ada'));
  }
  if (list.childElementCount) box.append(list);
  for (const port of nodePorts(n)) {
    const current = state.document.edges.find(e => e.source === n.id && e.port === port);
    box.append(
      field(
        portLabel(n, port),
        current?.target || '',
        target => {
          if (!target) {
            mutate(
              () => (state.document.edges = state.document.edges.filter(e => !(e.source === n.id && e.port === port))),
            );
            return;
          }
          state.pending = { source: n.id, port };
          connect(target);
        },
        'select',
        [
          { value: '', label: 'Belum terhubung' },
          ...state.document.nodes
            .filter(t => t.id !== n.id && !['input', 'memory'].includes(t.type))
            .map(t => ({ value: t.id, label: t.label })),
        ],
      ),
    );
  }
  if (!box.querySelector('select') && !list.childElementCount)
    box.append(el('p', 'Node ini tidak punya koneksi alur.', 'hint'));
  return box;
}

// Variabel yang bisa dipakai node: pesan, konteks runtime, dan keluaran node lain.
function availableVariables(n) {
  const groups = [
    [
      'Pesan',
      ['input.message', 'input.context', 'input.history', 'input.task', 'input.task.task', 'input.task.context'],
    ],
    ...(isContent()
      ? [['Formulir', (state.document.nodes.find(x => x.type === 'input')?.form ?? []).map(f => 'input.' + f.id)]]
      : []),
    ...Object.entries(contextVariables).map(([root, keys]) => [
      { system: 'Sistem', customer: 'Pelanggan', service: 'Layanan' }[root],
      keys.map(key => root + '.' + key),
    ]),
  ];
  // Isi koleksi teks dan isian bisa ditempel langsung lewat {{data.<koleksi>}} / {{data.<koleksi>.<field>}}.
  const dataPaths = state.document.collections.flatMap(c =>
    kindOf(c) === 'text'
      ? ['data.' + c.id]
      : kindOf(c) === 'form'
        ? c.fields.map(f => 'data.' + c.id + '.' + f.id)
        : [],
  );
  if (dataPaths.length) groups.push(['Data profil', dataPaths]);
  for (const x of state.document.nodes) {
    if (x.id === n?.id) continue;
    if (x.type === 'memory' && x.id !== n?.memory) continue;
    if (x.type === 'context_memory' && x.id !== n?.context_memory) continue;
    if (
      ![
        'memory',
        'context_memory',
        'agent',
        'context',
        'router',
        'extract',
        'compute',
        'media',
        'receive',
        'file_json',
        'file_md',
        'image_gen',
      ].includes(x.type) &&
      !isDataNode(x)
    )
      continue;
    const keys =
      x.type === 'memory'
        ? ['history', 'context']
        : x.type === 'context_memory'
          ? ['context']
          : isDataNode(x)
            ? dataOutputs(x)
            : x.type === 'extract'
              ? x.extract_mode === 'tasks'
                ? ['tasks']
                : [...(x.fields ?? []).map(f => f.id), 'missing']
              : x.type === 'compute'
                ? (x.steps ?? []).map(step => step.name)
                : x.type === 'media'
                  ? ['files', 'count', 'skipped']
                  : x.type === 'receive'
                    ? ['file', 'filename', 'type', 'mimetype', 'caption']
                    : x.type === 'image_gen'
                      ? ['file', 'files', 'count', 'reason']
                      : x.type === 'file_json' || x.type === 'file_md'
                        ? ['file', 'filename', 'size']
                        : x.type === 'router' && x.routing_mode === 'tasks'
                          ? ['branch', 'tasks', 'results']
                          : [{ agent: 'answer', context: 'context', router: 'branch' }[x.type]];
    groups.push([x.label, keys.map(key => 'nodes.' + x.id + '.' + key)]);
  }
  return groups;
}
const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
// Isian dengan penanda variabel: textarea transparan di atas lapisan yang mewarnai setiap {{variabel}}; variabel
// yang tidak dikenal ditandai oranye supaya salah ketik terlihat sebelum diuji.
function varEditor(label, value, onchange, n, rows = 5) {
  const wrap = el('label', label),
    box = el('div', undefined, 'var-editor'),
    backdrop = el('div', undefined, 'var-backdrop'),
    input = el('textarea'),
    tools = el('div', undefined, 'var-tools'),
    info = el('span', '', 'count');
  backdrop.setAttribute('aria-hidden', 'true');
  input.rows = rows;
  input.value = value ?? '';
  input.setAttribute('aria-label', label);
  const known = availableVariables(n).flatMap(([, paths]) => paths);
  const isKnown = path => known.some(k => path === k || path.startsWith(k + '.') || k.startsWith(path + '.'));
  const paint = () => {
    backdrop.replaceChildren();
    let last = 0,
      unknown = 0;
    for (const match of input.value.matchAll(variablePattern)) {
      backdrop.append(input.value.slice(last, match.index));
      const mark = el('mark', match[0]);
      if (!isKnown(match[1])) {
        mark.className = 'unknown';
        unknown++;
      }
      backdrop.append(mark);
      last = match.index + match[0].length;
    }
    backdrop.append(input.value.slice(last) + '\n');
    backdrop.scrollTop = input.scrollTop;
    info.textContent = unknown
      ? unknown + ' variabel tidak dikenal'
      : input.value.length.toLocaleString('id-ID') + ' karakter';
    info.className = unknown ? 'warn-text' : 'count';
  };
  input.oninput = () => {
    paint();
    task(() => onchange(input.value));
  };
  input.onscroll = () => (backdrop.scrollTop = input.scrollTop);
  const insert = btn('Sisipkan variabel', () => openVariableMenu(insert, input, n), 'btn small');
  insert.prepend(svgIcon('braces'));
  tools.append(insert, info);
  box.append(backdrop, input);
  wrap.append(box, tools);
  paint();
  return wrap;
}
let variableTarget;
function openVariableMenu(anchor, input, n) {
  variableTarget = input;
  const menu = $('variable-menu'),
    box = anchor.getBoundingClientRect();
  $('variable-search').value = '';
  renderVariableList(n);
  $('variable-search').oninput = () => renderVariableList(n);
  menu.showPopover();
  const left = Math.min(box.left, innerWidth - menu.offsetWidth - 8),
    below = box.bottom + 6 + menu.offsetHeight < innerHeight;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = (below ? box.bottom + 6 : Math.max(8, box.top - menu.offsetHeight - 6)) + 'px';
  menu.style.maxHeight = '360px';
  $('variable-search').focus();
}
function renderVariableList(n) {
  const q = $('variable-search').value.trim().toLowerCase(),
    list = $('variable-list');
  list.replaceChildren();
  for (const [group, paths] of availableVariables(n)) {
    const shown = paths.filter(p => !q || p.toLowerCase().includes(q) || group.toLowerCase().includes(q));
    if (!shown.length) continue;
    list.append(el('div', group, 'group'));
    for (const path of shown) {
      const b = el('button', '{{' + path + '}}');
      b.type = 'button';
      b.onclick = () => {
        const input = variableTarget;
        $('variable-menu').hidePopover();
        input.focus();
        input.setRangeText('{{' + path + '}}', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input'));
      };
      list.append(b);
    }
  }
  if (!list.childElementCount) list.append(el('div', 'Tidak ada variabel yang cocok.', 'group'));
}

// Variabel yang disediakan runtime; sama dengan contextVariables di definition.ts.
const contextVariables = {
  system: ['today', 'tomorrow', 'now', 'time', 'weekday'],
  customer: ['name', 'phone'],
  service: ['name'],
};
const operations = [
  ['search', 'Cari'],
  ['get', 'Ambil'],
  ['create', 'Buat'],
  ['update', 'Ubah'],
  ['delete', 'Hapus'],
  ['count', 'Hitung'],
];
const operationLabel = op => operations.find(([value]) => value === op)?.[1] ?? op;
const filterOperators = [
  ['equals', 'sama dengan'],
  ['not_equals', 'tidak sama dengan'],
  ['contains', 'mengandung'],
  ['not_contains', 'tidak mengandung'],
  ['greater', 'lebih besar dari'],
  ['greater_equal', 'lebih besar/sama'],
  ['less', 'lebih kecil dari'],
  ['less_equal', 'lebih kecil/sama'],
  ['exists', 'terisi'],
  ['empty', 'kosong'],
];
const conditionOperators = [
  ['equals', 'sama dengan'],
  ['not_equals', 'tidak sama dengan'],
  ['contains', 'mengandung'],
  ['not_contains', 'tidak mengandung'],
  ['exists', 'terisi'],
  ['empty', 'kosong'],
  ['greater', 'lebih besar'],
  ['less', 'lebih kecil'],
  ['date_before', 'tanggal sebelum'],
  ['date_on_or_after', 'tanggal sama/setelah'],
  ['weekday_is', 'hari adalah'],
  ['time_between', 'jam antara'],
  ['one_of', 'salah satu dari'],
  ['count_greater', 'jumlah item lebih dari'],
];
const noCompare = ['exists', 'empty'];
const comparePlaceholder = {
  weekday_is: 'Senin, Selasa',
  time_between: '08.00-16.00',
  one_of: 'nilai1, nilai2',
  date_before: '{{system.today}}',
  date_on_or_after: '{{system.today}}',
};
function recordOutputs(x) {
  if (['search', 'get'].includes(x.operation)) {
    const c = state.document.collections.find(c => c.id === x.collection);
    return ['records', 'count', 'first.id', ...(c?.fields.map(f => 'first.data.' + f.id) ?? []), 'has_more'];
  }
  if (x.operation === 'count') return ['count', 'total'];
  if (x.operation === 'delete') return ['id', 'deleted'];
  return ['id', 'data', 'revision'];
}
function options(pairs) {
  return pairs.map(([value, label]) => ({ value, label }));
}
// Mengganti operasi mengubah daftar port; koneksi lama dipindah ke port yang setara supaya alur tidak putus.
function syncPorts(n, before) {
  const after = nodePorts(n);
  const edges = state.document.edges.filter(e => e.source === n.id);
  if (before.includes('next') && after.includes('found')) {
    const old = edges.find(e => e.port === 'next');
    if (old) {
      old.port = 'found';
      state.document.edges.push({ id: uid('edge'), source: n.id, port: 'empty', target: old.target });
    }
  } else if (before.includes('found') && after.includes('next')) {
    const found = edges.find(e => e.port === 'found');
    if (found) found.port = 'next';
  }
  state.document.edges = state.document.edges.filter(e => e.source !== n.id || after.includes(e.port));
}
function dataOutputs(x) {
  if (x.type === 'data_text') return ['text', 'found'];
  if (x.type === 'data_form') {
    const c = state.document.collections.find(c => c.id === x.collection);
    return ['found', 'data', ...(c?.fields.map(f => 'data.' + f.id) ?? [])];
  }
  return recordOutputs(x);
}
// Pilihan koleksi node data, hanya jenis yang cocok dengan node.
function collectionField(n, onpick) {
  const kind = dataKinds[n.type];
  return field(
    'Koleksi',
    n.collection,
    v => {
      mutate(() => {
        n.collection = v;
        onpick?.();
      });
      renderInspector();
    },
    'select',
    [
      { value: '', label: 'Pilih koleksi ' + kindLabels[kind].toLowerCase() },
      ...state.document.collections
        .filter(c => kindOf(c) === kind)
        .map(c => ({
          value: c.id,
          label: c.name + (kind === 'list' ? (c.owner === 'customer' ? ' · milik pelanggan' : ' · umum') : ''),
        })),
    ],
  );
}
// Di alur (edge masuk/keluar) atau dipanggil Agent (masuk daftar tools Agent, tanpa edge).
function toolModeSection(host, n, agentHint) {
  const agents = state.document.nodes.filter(a => a.type === 'agent');
  const inFlow = state.document.edges.some(e => e.source === n.id || e.target === n.id);
  const byAgent = agents.some(a => a.tools.includes(n.id)) && !inFlow;
  host.append(
    el('h3', 'Cara dijalankan'),
    segmented(
      'Cara dijalankan',
      [
        ['flow', 'Di alur'],
        ['agent', 'Dipanggil Agent'],
      ],
      byAgent ? 'agent' : 'flow',
      value => {
        mutate(() => {
          if (value === 'flow') for (const a of agents) a.tools = a.tools.filter(id => id !== n.id);
          else {
            state.document.edges = state.document.edges.filter(e => e.source !== n.id && e.target !== n.id);
            if (!agents.some(a => a.tools.includes(n.id)) && agents[0]) agents[0].tools.push(n.id);
          }
        });
        renderInspector();
      },
    ),
    el(
      'p',
      byAgent ? agentHint : 'Selalu dijalankan saat alur melewati node ini. Nilai boleh memakai variabel.',
      'hint',
    ),
  );
  if (byAgent)
    for (const a of agents)
      host.append(
        field(
          'Dipakai ' + a.label,
          a.tools.includes(n.id),
          v => {
            mutate(() => (a.tools = v ? [...new Set([...a.tools, n.id])] : a.tools.filter(id => id !== n.id)));
            renderInspector();
          },
          'checkbox',
        ),
      );
  return byAgent;
}
function renderTextTool(host, n) {
  host.append(collectionField(n));
  const byAgent = toolModeSection(
    host,
    n,
    'Agent memanggil node ini saat butuh isi teks dan boleh mengirim kata kunci; hanya paragraf yang relevan yang dikirim ke model.',
  );
  host.append(
    nodeField(n, 'query', byAgent ? 'Kata kunci awal (diganti Agent)' : 'Kata kunci (opsional)'),
    el(
      'p',
      'Dengan kata kunci hanya paragraf yang memuatnya yang dikirim; tanpa kata kunci teks dipotong di batas.',
      'hint',
    ),
    field(
      'Maksimal karakter yang dikirim',
      n.max_chars ?? 4000,
      v => mutate(() => (n.max_chars = Math.min(20000, Math.max(200, Math.round(v) || 200)))),
      'number',
    ),
    el(
      'p',
      'Keluaran: text, found. Isi pendek juga bisa ditempel langsung dengan {{data.' +
        (n.collection || '<koleksi>') +
        '}}.',
      'hint',
    ),
  );
}
function renderFormTool(host, n) {
  const collection = state.document.collections.find(c => c.id === n.collection);
  host.append(
    collectionField(n),
    el('h3', 'Operasi'),
    segmented(
      'Operasi',
      [
        ['get', 'Baca'],
        ['update', 'Ubah'],
      ],
      n.operation === 'update' ? 'update' : 'get',
      value => {
        mutate(() => {
          n.operation = value;
          if (value === 'update' && !n.value.trim().startsWith('{')) n.value = '{"data":{}}';
        });
        renderInspector();
      },
    ),
  );
  const byAgent = toolModeSection(
    host,
    n,
    n.operation === 'update' ? 'Agent mengisi field yang diubah.' : 'Agent memanggil node ini saat butuh isi formulir.',
  );
  if (n.operation === 'update' && !byAgent)
    host.append(nodeField(n, 'value', 'Perubahan: {"data":{"field":"nilai"}}', 'textarea'));
  if (collection)
    host.append(
      el(
        'p',
        'Field: ' +
          collection.fields.map(f => f.id).join(', ') +
          '. Isi juga bisa ditempel langsung dengan {{data.' +
          collection.id +
          '.<field>}}.',
        'hint',
      ),
    );
}
function renderRecordTool(host, n) {
  const collection = state.document.collections.find(c => c.id === n.collection);
  const agents = state.document.nodes.filter(a => a.type === 'agent');
  const users = agents.filter(a => a.tools.includes(n.id));
  const inFlow = state.document.edges.some(e => e.source === n.id || e.target === n.id);
  const byAgent = users.length > 0 && !inFlow;
  host.append(
    field(
      'Koleksi',
      n.collection,
      v => {
        mutate(() => {
          n.collection = v;
          n.filters = [];
          n.sort_field = '';
          n.sum_field = '';
        });
        renderInspector();
      },
      'select',
      [
        { value: '', label: 'Pilih koleksi tabel' },
        ...state.document.collections
          .filter(c => kindOf(c) === 'list')
          .map(c => ({
            value: c.id,
            label: c.name + (c.owner === 'customer' ? ' · milik pelanggan' : ' · umum'),
          })),
      ],
    ),
  );
  if (collection?.owner === 'customer')
    host.append(
      el('p', 'Milik pelanggan: otomatis hanya membaca dan mengubah record pelanggan yang sedang chat.', 'hint'),
    );
  const ops = el('div', undefined, 'segmented operations');
  ops.setAttribute('role', 'radiogroup');
  ops.setAttribute('aria-label', 'Operasi');
  for (const [value, label] of operations) {
    const b = btn(label, () => {
      const before = nodePorts(n);
      mutate(() => {
        n.operation = value;
        syncPorts(n, before);
        if (['create', 'update'].includes(value) && !n.value.trim().startsWith('{')) n.value = '{"data":{}}';
        if (value === 'update' && n.value === '{"data":{}}') n.value = '{"id":"","data":{}}';
      });
      renderInspector();
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(n.operation === value));
    if (n.operation === value) b.classList.add('active');
    ops.append(b);
  }
  host.append(el('h3', 'Operasi'), ops);

  const mode = el('div', undefined, 'segmented');
  mode.setAttribute('role', 'radiogroup');
  mode.setAttribute('aria-label', 'Cara dijalankan');
  for (const [value, label] of [
    ['flow', 'Di alur'],
    ['agent', 'Dipanggil Agent'],
  ]) {
    const b = btn(label, () => {
      mutate(() => {
        if (value === 'flow') for (const a of agents) a.tools = a.tools.filter(id => id !== n.id);
        else {
          state.document.edges = state.document.edges.filter(e => e.source !== n.id && e.target !== n.id);
          if (!agents.some(a => a.tools.includes(n.id)) && agents[0]) agents[0].tools.push(n.id);
        }
      });
      renderInspector();
    });
    const on = (value === 'agent') === byAgent;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    if (on) b.classList.add('active');
    mode.append(b);
  }
  host.append(
    el('h3', 'Cara dijalankan'),
    mode,
    el(
      'p',
      byAgent
        ? 'Agent memutuskan kapan memakai node ini dan mengisi kata kunci, filter tambahan, atau data yang ditulis.'
        : 'Selalu dijalankan saat alur melewati node ini. Nilai boleh memakai variabel.',
      'hint',
    ),
  );
  if (byAgent)
    for (const a of agents)
      host.append(
        field(
          'Dipakai ' + a.label,
          a.tools.includes(n.id),
          v => {
            mutate(() => (a.tools = v ? [...new Set([...a.tools, n.id])] : a.tools.filter(id => id !== n.id)));
            renderInspector();
          },
          'checkbox',
        ),
      );
  if (!collection) return;
  const fieldOptions = collection.fields.map(f => ({ value: f.id, label: f.label + ' (' + f.id + ')' }));
  if (['search', 'count'].includes(n.operation)) {
    host.append(el('h3', 'Filter'));
    const filters = n.filters ?? [];
    if (filters.length > 1)
      host.append(
        field('Cocok bila', n.match || 'all', v => mutate(() => (n.match = v)), 'select', [
          { value: 'all', label: 'semua filter terpenuhi' },
          { value: 'any', label: 'salah satu filter terpenuhi' },
        ]),
      );
    filters.forEach((f, i) => {
      const row = el('div', undefined, 'rule-row');
      row.append(
        field('Field', f.field, v => mutate(() => (f.field = v)), 'select', fieldOptions),
        field(
          'Operator',
          f.operator,
          v => {
            mutate(() => (f.operator = v));
            renderInspector();
          },
          'select',
          options(filterOperators),
        ),
      );
      if (!noCompare.includes(f.operator)) row.append(field('Nilai', f.value, v => mutate(() => (f.value = v))));
      const remove = btn('×', () => {
        mutate(() => n.filters.splice(i, 1));
        renderInspector();
      });
      remove.setAttribute('aria-label', 'Hapus filter');
      row.append(remove);
      host.append(row);
    });
    host.append(
      btn('＋ Filter', () => {
        mutate(() => {
          n.filters ??= [];
          n.filters.push({ field: collection.fields[0]?.id ?? '', operator: 'equals', value: '' });
        });
        renderInspector();
      }),
      nodeField(n, 'query', byAgent ? 'Kata kunci awal (diganti Agent)' : 'Kata kunci (opsional)'),
      el('p', 'Record yang memuat salah satu kata ditampilkan, paling cocok lebih dulu.', 'hint'),
    );
  }
  if (n.operation === 'search') {
    const sort = el('div', undefined, 'rule-row');
    sort.append(
      field('Urutkan', n.sort_field || 'created_at', v => mutate(() => (n.sort_field = v)), 'select', [
        { value: 'created_at', label: 'Waktu dibuat' },
        ...fieldOptions,
      ]),
      field('Arah', n.sort_direction || 'asc', v => mutate(() => (n.sort_direction = v)), 'select', [
        { value: 'asc', label: 'Naik' },
        { value: 'desc', label: 'Turun' },
      ]),
      field(
        'Batas',
        n.limit ?? 10,
        v => mutate(() => (n.limit = Math.min(100, Math.max(1, Math.round(v) || 1)))),
        'number',
      ),
    );
    host.append(sort);
  }
  if (n.operation === 'count')
    host.append(
      field('Jumlahkan field (opsional)', n.sum_field || '', v => mutate(() => (n.sum_field = v)), 'select', [
        { value: '', label: 'Hanya hitung jumlah record' },
        ...collection.fields.filter(f => f.type === 'number').map(f => ({ value: f.id, label: f.label })),
      ]),
    );
  if (['get', 'delete'].includes(n.operation))
    host.append(
      nodeField(n, 'query', byAgent ? 'ID record (diisi Agent)' : 'ID record, misalnya {{nodes.cari.first.id}}'),
    );
  if (['create', 'update'].includes(n.operation))
    host.append(
      nodeField(
        n,
        'value',
        n.operation === 'create'
          ? 'Data record: {"data":{"field":"nilai"}}'
          : 'Perubahan: {"id":"…","data":{"field":"nilai"}}',
        'textarea',
      ),
      el(
        'p',
        (n.operation === 'update' ? 'Hanya field yang dikirim yang diubah; null mengosongkan field. ' : '') +
          'Field: ' +
          collection.fields.map(f => f.id + (f.required ? '*' : '')).join(', '),
        'hint',
      ),
    );
  if (nodePorts(n).includes('found'))
    host.append(el('p', 'Jalur Ditemukan bila ada hasil, Kosong bila tidak ada.', 'hint'));
}
function nodeField(n, key, label, type = 'text') {
  if (type === 'textarea') return varEditor(label, n[key], v => mutate(() => (n[key] = v)), n, 4);
  return field(label, n[key], v => mutate(() => (n[key] = v)), type);
}
function renderRules(host, n) {
  n.rules ??= [{ field: n.field, operator: n.operator, compare: n.compare }];
  host.append(
    field('Cocok bila', n.match || 'all', v => mutate(() => (n.match = v)), 'select', [
      { value: 'all', label: 'semua syarat terpenuhi' },
      { value: 'any', label: 'salah satu syarat terpenuhi' },
    ]),
  );
  const leaf = (list, r, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nilai yang diperiksa', r.field, v => mutate(() => (r.field = v))),
      field(
        'Operator',
        r.operator,
        v => {
          mutate(() => (r.operator = v));
          renderInspector();
        },
        'select',
        options(conditionOperators),
      ),
    );
    if (!noCompare.includes(r.operator)) {
      const compare = field('Pembanding', r.compare, v => mutate(() => (r.compare = v)));
      compare.querySelector('input').placeholder = comparePlaceholder[r.operator] ?? '';
      box.append(compare);
    }
    const remove = btn('Hapus syarat', () => {
      mutate(() => list.splice(i, 1));
      renderInspector();
    });
    box.append(remove);
    return box;
  };
  n.rules.forEach((r, i) => {
    if (!r.rules) {
      host.append(leaf(n.rules, r, i));
      return;
    }
    const group = el('div', undefined, 'rule-group');
    group.append(
      field('Grup cocok bila', r.match, v => mutate(() => (r.match = v)), 'select', [
        { value: 'all', label: 'semua syarat grup' },
        { value: 'any', label: 'salah satu syarat grup' },
      ]),
    );
    r.rules.forEach((x, j) => group.append(leaf(r.rules, x, j)));
    group.append(
      btn('＋ Syarat grup', () => {
        mutate(() => r.rules.push({ field: 'input.message', operator: 'contains', compare: '' }));
        renderInspector();
      }),
      btn(
        'Hapus grup',
        () => {
          mutate(() => n.rules.splice(i, 1));
          renderInspector();
        },
        'btn small danger',
      ),
    );
    host.append(group);
  });
  host.append(
    btn('＋ Syarat', () => {
      mutate(() => n.rules.push({ field: 'input.message', operator: 'contains', compare: '' }));
      renderInspector();
    }),
    btn('＋ Grup DAN/ATAU', () => {
      mutate(() =>
        n.rules.push({ match: 'any', rules: [{ field: 'input.message', operator: 'contains', compare: '' }] }),
      );
      renderInspector();
    }),
    el(
      'p',
      'Nilai yang diperiksa berupa path variabel, misalnya nodes.isian.tanggal atau system.weekday. Pembanding boleh memakai {{variabel}}.',
      'hint',
    ),
  );
}

const extractTypes = ['text', 'number', 'boolean', 'date', 'time', 'datetime', 'choice', 'multichoice', 'phone'];
function renderExtract(host, n) {
  host.append(
    field(
      'Mode ekstraksi',
      n.extract_mode ?? 'fields',
      v => {
        mutate(() => (n.extract_mode = v));
        renderInspector();
      },
      'select',
      [
        { value: 'fields', label: 'Field terstruktur' },
        { value: 'tasks', label: 'Tugas dan konteks' },
      ],
    ),
  );
  if (n.extract_mode === 'tasks') {
    host.append(
      field('Maksimal tugas (1–5)', n.max_tasks ?? 5, v => mutate(() => (n.max_tasks = v)), 'number'),
      el(
        'p',
        'Menghasilkan tasks berisi id, task, dan context. Hubungkan ke Router dengan mode Setiap tugas ke Agent. Permintaan terkait digabung bila mencapai batas.',
        'hint',
      ),
    );
    return;
  }
  n.fields ??= [];
  host.append(
    el('h3', 'Field yang diambil'),
    el(
      'p',
      'Model mengisi null bila pelanggan tidak menyebutkannya. Field wajib yang kosong masuk ke missing. Tanggal relatif seperti "besok" diubah memakai tanggal hari ini (WIB).',
      'hint',
    ),
  );
  n.fields.forEach((f, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nama field', f.label, v =>
        mutate(() => {
          // ID keluaran Ekstrak mengikuti nama; rujukan {{nodes.<node>.<id>}} di node lain ikut diganti.
          f.label = v;
          const next = slugId(v, ['missing', ...n.fields.filter(x => x !== f).map(x => x.id)], 'field');
          if (next === f.id) return;
          rewriteVariables(new RegExp('(nodes\\.' + n.id + '\\.)' + f.id + '\\b', 'g'), '$1' + next);
          f.id = next;
        }),
      ),
      field(
        'Tipe',
        f.type,
        v => {
          mutate(() => {
            f.type = v;
            if (['choice', 'multichoice'].includes(v) && !f.options.length) f.options = ['Pilihan 1'];
          });
          renderInspector();
        },
        'select',
        extractTypes.map(t => ({ value: t, label: fieldTypeLabels[t] })),
      ),
      field('Wajib', f.required, v => mutate(() => (f.required = v)), 'checkbox'),
      field('Petunjuk untuk AI', f.hint, v => mutate(() => (f.hint = v))),
    );
    if (['choice', 'multichoice'].includes(f.type))
      box.append(
        field('Opsi (pisahkan koma)', f.options.join(', '), v =>
          mutate(
            () =>
              (f.options = v
                .split(',')
                .map(x => x.trim())
                .filter(Boolean)),
          ),
        ),
      );
    box.append(
      btn('Hapus field', () => {
        mutate(() => n.fields.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  host.append(
    btn('＋ Field', () => {
      mutate(() =>
        n.fields.push({
          id: slugId('Field baru', ['missing', ...n.fields.map(x => x.id)], 'field'),
          label: 'Field baru',
          type: 'text',
          required: false,
          hint: '',
          options: [],
        }),
      );
      renderInspector();
    }),
  );
  // Menyalin field koleksi yang bisa diambil dari teks; relasi dan file dilewati.
  const collections = state.document.collections.filter(c => c.fields.some(f => extractTypes.includes(f.type)));
  if (collections.length)
    host.append(
      field(
        'Salin field dari koleksi',
        '',
        id => {
          const c = state.document.collections.find(c => c.id === id);
          if (!c) return;
          mutate(() => {
            for (const f of c.fields.filter(f => extractTypes.includes(f.type) && !n.fields.some(x => x.id === f.id)))
              n.fields.push({
                id: f.id,
                label: f.label,
                type: f.type,
                required: f.required,
                hint: '',
                options: [...f.options],
              });
          });
          renderInspector();
        },
        'select',
        [{ value: '', label: 'Pilih koleksi' }, ...collections.map(c => ({ value: c.id, label: c.name }))],
      ),
    );
}
const computeOps = [
  ['value', 'Ambil nilai', ['Nilai']],
  ['add', 'Tambah', ['Angka', 'Ditambah']],
  ['subtract', 'Kurang', ['Angka', 'Dikurangi']],
  ['multiply', 'Kali', ['Angka', 'Dikali']],
  ['divide', 'Bagi', ['Angka', 'Dibagi']],
  ['round', 'Bulatkan', ['Angka', 'Jumlah desimal (0–6)']],
  ['format_rupiah', 'Format rupiah', ['Angka']],
  ['concat', 'Gabung teks', ['Templat teks']],
  ['truncate', 'Potong teks', ['Teks', 'Maksimal karakter']],
  ['add_days', 'Tambah hari', ['Tanggal', 'Jumlah hari (boleh negatif)']],
  ['days_between', 'Selisih hari', ['Dari tanggal', 'Sampai tanggal']],
  ['format_date', 'Format tanggal', ['Tanggal']],
  ['length', 'Jumlah item', ['Daftar atau teks']],
  ['item_at', 'Ambil item ke-', ['Daftar', 'Urutan (mulai 1)']],
];
function renderCompute(host, n) {
  n.steps ??= [];
  host.append(
    el('h3', 'Langkah · dijalankan berurutan'),
    el(
      'p',
      'Setiap hasil dibaca sebagai {{nodes.' +
        n.id +
        '.nama_hasil}} dan boleh dipakai langkah sesudahnya. Nilai yang tidak sesuai menghentikan alur dan tercatat di jejak.',
      'hint',
    ),
  );
  n.steps.forEach((step, i) => {
    const [, , labels] = computeOps.find(([op]) => op === step.op) ?? computeOps[0];
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nama hasil', step.name, v => mutate(() => (step.name = v))),
      field(
        'Operasi',
        step.op,
        v => {
          const arity = computeOps.find(([op]) => op === v)[2].length;
          mutate(() => {
            step.op = v;
            step.args = [...step.args, '', ''].slice(0, arity);
          });
          renderInspector();
        },
        'select',
        computeOps.map(([value, label]) => ({ value, label })),
      ),
      ...labels.map((label, j) => field(label, step.args[j] ?? '', v => mutate(() => (step.args[j] = v)))),
      btn('Hapus langkah', () => {
        mutate(() => n.steps.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  host.append(
    btn('＋ Langkah', () => {
      mutate(() => n.steps.push({ name: 'hasil_' + (n.steps.length + 1), op: 'value', args: [''] }));
      renderInspector();
    }),
  );
}
function renderMedia(host, n) {
  host.append(
    nodeField(n, 'value', 'File yang dikirim', 'textarea'),
    el(
      'p',
      'Isi dengan variabel field File/gambar, misalnya {{nodes.cari.first.data.brosur}}, URL HTTPS dari koleksi API, atau daftar keduanya. Nilai kosong berarti tidak ada file yang dikirim.',
      'hint',
    ),
    nodeField(n, 'caption', 'Keterangan (opsional)'),
    field('Waktu kirim', n.send_when || 'before', v => mutate(() => (n.send_when = v)), 'select', [
      { value: 'before', label: 'Sebelum jawaban teks' },
      { value: 'after', label: 'Sesudah jawaban teks' },
    ]),
    field('Kirim sebagai', n.media_as || 'auto', v => mutate(() => (n.media_as = v)), 'select', [
      { value: 'auto', label: 'Otomatis (gambar tampil sebagai foto)' },
      { value: 'image', label: 'Gambar' },
      { value: 'document', label: 'Dokumen' },
    ]),
    el(
      'p',
      'Dikirim setelah alur selesai, kecuali saat diteruskan ke tim. Maksimal 3 file per balasan, 1 kredit pesan per file. Simulasi dan Uji Coba hanya menampilkan daftarnya.',
      'hint',
    ),
    el(
      'p',
      'Kanal mengikuti sesi tujuan. WhatsApp: gambar beserta caption. Instagram resmi: gambar lalu caption terpisah (1 kredit pesan tambahan); WebP statis otomatis menjadi JPEG. Batas gambar Instagram 8 MB; dokumen belum didukung konektor resmi.',
      'hint',
    ),
  );
}
// Profil Konten, node Input: isian yang klien lihat di menu Konten. Setiap isian menjadi {{input.<id>}}.
function renderForm(host, n) {
  n.form ??= [];
  host.append(
    el('h3', 'Isian formulir'),
    el(
      'p',
      'Klien mengisi formulir ini di menu Konten. Isiannya juga dibaca node Agent sebagai pesan pelanggan, dan tiap isian bisa dipakai sebagai {{input.<id>}}. Gambar referensi berisi file dari Pustaka konten klien.',
      'hint',
    ),
  );
  n.form.forEach((f, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('Label untuk klien', f.label, v =>
        mutate(() => {
          // ID isian mengikuti label; rujukan {{input.<id>}} di node lain ikut diganti.
          f.label = v;
          const next = slugId(v, [...reservedInputKeys, ...n.form.filter(x => x !== f).map(x => x.id)], 'isian');
          if (next === f.id) return;
          rewriteVariables(new RegExp('(input\\.)' + f.id + '\\b', 'g'), '$1' + next);
          f.id = next;
        }),
      ),
      field(
        'Jenis',
        f.type,
        v => {
          mutate(() => {
            f.type = v;
            if (v === 'choice' && !f.options.length) f.options = ['Pilihan 1'];
          });
          renderInspector();
        },
        'select',
        Object.entries(formFieldLabels).map(([value, label]) => ({ value, label })),
      ),
      field('Wajib', f.required, v => mutate(() => (f.required = v)), 'checkbox'),
    );
    if (f.type === 'choice')
      box.append(
        field('Opsi (pisahkan koma)', f.options.join(', '), v =>
          mutate(
            () =>
              (f.options = v
                .split(',')
                .map(x => x.trim())
                .filter(Boolean)),
          ),
        ),
      );
    box.append(
      el('small', 'Variabel: {{input.' + f.id + '}}', 'hint'),
      btn('Hapus isian', () => {
        mutate(() => n.form.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  if (n.form.length < 12)
    host.append(
      btn('＋ Isian', () => {
        mutate(() =>
          n.form.push({
            id: slugId('Isian baru', [...reservedInputKeys, ...n.form.map(x => x.id)], 'isian'),
            label: 'Isian baru',
            type: 'text',
            required: false,
            options: [],
          }),
        );
        renderInspector();
      }),
    );
}
// Profil Konten, node Output: gambar dan teks yang tampil serta tersimpan untuk klien. Item gambar tanpa file dilewati.
function renderResults(host, n) {
  n.results ??= [];
  host.append(
    el('h3', 'Hasil untuk klien'),
    el(
      'p',
      'Gambar diisi variabel file dari Buat gambar, misalnya {{nodes.gambar.files}}. Teks boleh berisi variabel. Gambar masuk Pustaka konten klien sebagai JPEG.',
      'hint',
    ),
  );
  n.results.forEach((r, i) => {
    const box = el('div', undefined, 'rule');
    box.append(
      field('Nama hasil', r.label, v => mutate(() => (r.label = v))),
      field('Jenis', r.kind, v => mutate(() => (r.kind = v)), 'select', [
        { value: 'image', label: 'Gambar' },
        { value: 'text', label: 'Teks' },
      ]),
      varEditor('Nilai', r.value, v => mutate(() => (r.value = v)), n, 2),
      btn('Hapus hasil', () => {
        mutate(() => n.results.splice(i, 1));
        renderInspector();
      }),
    );
    host.append(box);
  });
  if (n.results.length < 6)
    host.append(
      btn('＋ Hasil', () => {
        mutate(() => n.results.push({ label: 'Hasil ' + (n.results.length + 1), kind: 'text', value: '' }));
        renderInspector();
      }),
    );
}
// Node Buat gambar: prompt, rasio, jumlah, brand, dan referensi. Biaya per gambar mengikuti tarif Model Gambar owner.
function renderImage(host, n) {
  n.image_ratio ??= '1:1';
  n.image_count ??= 1;
  n.image_brand ??= true;
  n.image_refs ??= '';
  host.append(
    nodeField(n, 'value', 'Prompt gambar', 'textarea'),
    el(
      'p',
      'Tulis dengan {{variabel}} dari node sebelumnya. Teks yang harus tampil di gambar tulis lengkap di prompt; model gambar sering salah mengeja bila hanya diberi petunjuk. Maksimal 4000 karakter.',
      'hint',
    ),
    field('Rasio', n.image_ratio, v => mutate(() => (n.image_ratio = v)), 'select', [
      { value: '1:1', label: '1:1 (persegi)' },
      { value: '4:5', label: '4:5 (feed Instagram)' },
      { value: '9:16', label: '9:16 (story)' },
    ]),
    field(
      'Jumlah gambar (1–3)',
      n.image_count,
      v => mutate(() => (n.image_count = Math.min(3, Math.max(1, Math.trunc(v) || 1)))),
      'number',
    ),
    field('Pakai identitas brand akun', n.image_brand, v => mutate(() => (n.image_brand = v)), 'checkbox'),
    el(
      'p',
      'Nama, deskripsi, warna, dan logo dari Identitas brand klien di menu Konten. Bila klien belum mengisinya, bagian ini dilewati.',
      'hint',
    ),
    nodeField(n, 'image_refs', 'Gambar referensi (opsional)', 'textarea'),
    el(
      'p',
      'Variabel file gambar, misalnya {{nodes.lampiran.file}} dari Terima media. Maksimal 3, hanya bila model gambar diatur menerima referensi. Kosong berarti tanpa referensi.',
      'hint',
    ),
    el(
      'p',
      'Memakai kredit AI klien: jumlah gambar × tarif Model Gambar yang diatur owner. Kredit dipesan sebelum dibuat dan gambar yang tidak jadi dikembalikan. Batas waktu 60 detik. Hasil otomatis JPEG; kirim lewat Kirim media dengan {{nodes.' +
        n.id +
        '.files}}. Port Berhasil dan Gagal wajib tersambung. Simulasi tidak membuat gambar dan tanpa kredit; Uji Coba membuat gambar sungguhan dan memotong kredit.',
      'hint',
    ),
  );
}
// Node Buat file: nama file dan template isi; hasilnya file data profil yang bisa dikirim atau disimpan.
function renderFile(host, n) {
  n.filename ??= '';
  const json = n.type === 'file_json';
  host.append(
    nodeField(n, 'filename', 'Nama file'),
    el(
      'p',
      'Boleh berisi variabel, misalnya artikel-{{system.today}}. Kosong berarti memakai nama node. Ekstensi ' +
        (json ? '.json' : '.md') +
        ' dipasang otomatis.',
      'hint',
    ),
    nodeField(n, 'value', json ? 'Template JSON' : 'Isi Markdown', 'textarea'),
    el(
      'p',
      json
        ? 'Harus JSON valid; tulis variabel di dalam tanda kutip. Kutipan yang hanya berisi satu variabel menjadi nilai aslinya (angka, daftar, objek), misalnya "{{nodes.cari.records}}".'
        : 'Teks Markdown dengan {{variabel}}, misalnya jawaban Agent penulis: {{nodes.penulis.answer}}.',
      'hint',
    ),
    el(
      'p',
      'Tanpa AI dan tanpa kredit, maksimal 1 MB. Kirim hasilnya lewat Kirim media ({{nodes.' +
        n.id +
        '.file}}) atau simpan ke field File lewat node Data; file yang tidak disimpan ke record terhapus setelah sehari.',
      'hint',
    ),
  );
}
function renderReceive(host, n) {
  n.accept ??= ['image', 'document'];
  host.append(el('h3', 'Jenis yang diterima'));
  for (const [type, label] of [
    ['image', 'Gambar (JPG, PNG, WebP; maks. 5 MB)'],
    ['document', 'Dokumen (PDF, Word, Excel, PowerPoint; maks. 10 MB)'],
  ])
    host.append(
      field(
        label,
        n.accept.includes(type),
        v => mutate(() => (n.accept = v ? [...new Set([...n.accept, type])] : n.accept.filter(t => t !== type))),
        'checkbox',
      ),
    );
  host.append(
    el(
      'p',
      'Lampiran pelanggan disimpan sebagai file data profil dan keluar lewat Diterima; pesan tanpa lampiran atau jenis lain lewat Tidak ada. Simpan ke record dengan node Data, misalnya {"data":{"bukti":"{{nodes.' +
        n.id +
        '.file}}"}}. File yang tidak dipakai record dibersihkan setelah sehari.',
      'hint',
    ),
    el(
      'p',
      'Pesan gambar/dokumen hanya diproses profil yang punya node ini. Isi gambar tidak dibaca AI; keterangan foto tersedia di caption dan input.message.',
      'hint',
    ),
  );
}

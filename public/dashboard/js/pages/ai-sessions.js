// Asisten AI, daftar sesi: kartu WhatsApp, Instagram, dan koneksi konten TikTok; tambah sesi dan tingkatkan paket.
// Mengeklik kartu memilih sesi yang disunting di bawahnya; saklar AI tiap kartu bisa dipakai langsung.
const addIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const moreIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const platformIcons = {
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  whatsapp:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8z"/><path d="M9 9.5c.3 2.2 2.3 4.2 4.5 4.5l1.2-1.2-1.8-1-.8.6c-.8-.4-1.5-1.1-1.9-1.9l.6-.8-1-1.8z" fill="currentColor" stroke="none"/></svg>',
};
const sessionStatusText = {
  connected: 'Terhubung',
  connecting: 'Menghubungkan…',
  qr_required: 'Scan QR',
  logged_out: 'Terputus',
};
function selectSession(id) {
  if ($('ai-session').value === id) return;
  $('ai-session').value = id;
  clearReceivedTest();
  renderSessionCards();
  renderAISessionFilters();
  run(async () => {
    aiTab('knowledge');
    aiFallbacksPage = 1;
    await loadAssistant();
  });
}
function goToPlans() {
  history.pushState(null, '', '/dashboard/paket');
  navigate();
  window.scrollTo(0, 0);
}
// Kartu tambah sesi saat kuota masih tersisa; saat kuota penuh berubah menjadi ajakan tingkatkan paket. Tautan
// "Tingkatkan paket" di bawahnya hanya ditampilkan bila kartunya masih berupa kartu tambah.
function buildAddCard(remaining) {
  const wrap = element('div', 'ai-session-add-wrap');
  const full = remaining <= 0;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ai-session-add' + (full ? ' full' : '');
  const icon = element('span', 'ai-session-add-icon');
  icon.innerHTML = full ? arrowIcon : addIcon;
  card.append(
    icon,
    element('strong', '', full ? 'Tingkatkan paket' : 'Tambah sesi'),
    element(
      'small',
      '',
      full
        ? 'Slot sesi di paket kamu sudah penuh.'
        : 'WhatsApp, Instagram, atau TikTok. Sisa ' + remaining + ' slot di paket kamu.',
    ),
  );
  card.onclick = () => {
    if (full) return goToPlans();
    $('sessionform').reset();
    $('addconnection').showModal();
  };
  wrap.append(card);
  if (!full) {
    const upgrade = button('Butuh lebih banyak? Tingkatkan paket', goToPlans);
    upgrade.classList.add('ai-session-upgrade-link');
    wrap.append(upgrade);
  }
  return wrap;
}
document.addEventListener('click', () =>
  document.querySelectorAll('.ai-session-menu.open').forEach(m => m.classList.remove('open')),
);
function buildSessionCard(s) {
  const card = document.createElement('article');
  card.className = 'ai-session-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const active = s.id === $('ai-session').value;
  card.setAttribute('aria-pressed', String(active));
  if (active) card.classList.add('selected');
  const ig = s.channel === 'instagram';
  const meta = sessionStatusMeta[s.status] ?? sessionStatusMeta.logged_out;
  const head = element('div', 'ai-session-card-head');
  const avatar = element('span', 'ai-session-avatar ' + (ig ? 'instagram' : 'whatsapp'));
  avatar.innerHTML = platformIcons[ig ? 'instagram' : 'whatsapp'];
  const nameBlock = element('div', 'ai-session-card-name');
  const name = element('strong', '', s.id);
  name.title = s.id;
  nameBlock.append(name, element('small', '', s.phone || (ig ? 'Instagram' : '—')));
  head.append(avatar, nameBlock);
  // Putuskan sesi lewat menu ⋯ (tersembunyi bila sudah terputus); riwayat chat dan data AI tetap tersimpan.
  if (s.status !== 'logged_out') {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ai-session-more';
    more.setAttribute('aria-label', 'Menu sesi ' + s.id);
    more.setAttribute('aria-haspopup', 'menu');
    more.innerHTML = moreIcon;
    const menu = element('div', 'ai-session-menu');
    menu.setAttribute('role', 'menu');
    const disconnect = button('Putuskan sesi', async () => {
      const how = ig
        ? 'AI berhenti membalas DM ' + sessionAccountLabel(s) + '.'
        : 'Perangkat WhatsApp ' + sessionAccountLabel(s) + ' dikeluarkan; memasang ulang butuh scan QR.';
      if (!confirm('Putuskan ' + s.id + '?\n' + how + '\nRiwayat chat dan data profil tetap tersimpan.')) return;
      await api('/sessions/' + encodeURIComponent(s.id) + '/logout', 'POST');
      await refreshIntegrations();
    });
    disconnect.classList.add('secondary');
    disconnect.setAttribute('role', 'menuitem');
    menu.append(disconnect);
    more.onclick = e => {
      e.stopPropagation();
      const open = !menu.classList.contains('open');
      document.querySelectorAll('.ai-session-menu.open').forEach(m => m.classList.remove('open'));
      menu.classList.toggle('open', open);
    };
    menu.onclick = e => e.stopPropagation();
    head.append(more, menu);
  }
  const chips = element('div', 'ai-session-chips-row');
  chips.append(element('span', 'ai-session-chip-plain', ig ? 'Instagram' : 'WhatsApp'));
  const status = document.createElement(meta.clickable ? 'button' : 'span');
  status.className = 'ai-session-chip-status ' + meta.cls;
  status.textContent = sessionStatusText[s.status] ?? sessionStatusText.logged_out;
  status.title = meta.label;
  if (meta.clickable) {
    status.type = 'button';
    status.setAttribute('aria-label', meta.label);
    status.onclick = e => {
      e.stopPropagation();
      run(async () => {
        // Sesi Instagram tidak memakai QR: lewat Zernio dihubungkan ulang di Zernio, lewat login resmi dari sini.
        if (ig) {
          if (s.status === 'logged_out') await reconnectInstagram(s);
          return;
        }
        if (s.status === 'logged_out') await api('/sessions/' + encodeURIComponent(s.id) + '/reconnect', 'POST');
        await pair(s.id);
      });
    };
  }
  chips.append(status);
  const foot = element('div', 'ai-session-card-foot');
  // Kartu menunjukkan data profil yang dijalankan sesi; tanpa data profil tidak ada saklar AI, hanya "Pasang profil".
  if (s.aiProfile) {
    const agent = element('div', 'ai-session-profile');
    agent.append(element('small', '', 'Agen yang menjawab'), element('strong', '', s.aiProfile.name));
    const toggle = document.createElement('label');
    toggle.className = 'ai-toggle' + (s.aiEnabled ? ' active' : '');
    // Bukan <span> untuk teks: selektor global .ai-toggle span mewarnai pil saklar, jadi teks di sini akan ikut
    // tergambar seperti saklar kedua di samping saklar aslinya.
    const text = element('div', 'ai-session-robot');
    text.append(
      element('strong', '', 'AI Asisten'),
      element('small', '', s.aiEnabled ? 'Aktif, membalas otomatis' : 'Nonaktif, dibalas manual'),
    );
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(s.aiEnabled);
    input.setAttribute('aria-label', 'AI Asisten ' + s.id);
    input.onclick = e => e.stopPropagation();
    input.onchange = () =>
      run(async () => {
        const desired = input.checked;
        input.disabled = true;
        try {
          await api('/sessions/' + encodeURIComponent(s.id) + '/ai/enabled', 'PATCH', { enabled: desired });
          s.aiEnabled = desired;
          if (s.id === $('ai-session').value) $('ai-session-enabled-field').value = desired ? 'on' : '';
        } catch (e) {
          input.disabled = false;
          throw e;
        }
        // Render ulang mengganti `input` di DOM, jadi mengaktifkannya lagi di sini berarti menyentuh elemen yang
        // sudah terlepas.
        renderSessionCards();
      });
    toggle.onclick = e => e.stopPropagation();
    toggle.append(text, input, document.createElement('span'));
    foot.append(agent, toggle);
  } else {
    const attach = button('Pasang profil', async () => {
      selectSession(s.id);
      await openAttach(s);
    });
    attach.classList.add('ai-session-attach');
    attach.addEventListener('click', e => e.stopPropagation());
    foot.append(element('span', 'ai-session-noprofile', 'Belum ada profil AI'), attach);
  }
  card.append(head, chips, foot);
  card.onclick = () => selectSession(s.id);
  card.onkeydown = e => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectSession(s.id);
    }
  };
  return card;
}
function renderSessionCards() {
  const limit = Math.max(0, aiSessionLimit - hiddenSessionCount);
  $('ai-session-cards').replaceChildren(
    ...aiSessions.map(buildSessionCard),
    ...aiTikTokConnections.map(buildTikTokSessionCard),
    buildAddCard(limit - aiSessions.length),
  );
}

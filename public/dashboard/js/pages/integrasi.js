// Halaman Integrasi: semua koneksi (sesi WhatsApp, Instagram lewat Zernio, dan Instagram Login resmi) sebagai kisi
// kartu. Rantai hijau menyatu = terhubung, rantai abu-abu terputus = terputus. Kartu dibuka untuk melihat dan
// menjalankan tindakan; akun penyedia (Zernio) ada di bawah kisi.
const integrations = { sessions: [], official: [], limit: 0 };
const chainPaths = {
  on: 'M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M8 12h8',
  off: 'M8 17H7A5 5 0 017 7h1M16 7h1a5 5 0 010 10h-1',
};
const integrationIcons = {
  whatsapp:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4.1-1.1z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/></svg>',
};
function chainIcon(connected, label) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'chain ' + (connected ? 'on' : 'off'));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', connected ? chainPaths.on : chainPaths.off);
  svg.append(path);
  return svg;
}
const instagramResults = {
  connected: 'Instagram terhubung.',
  cancelled: 'Izin Instagram dibatalkan.',
  no_slot: 'Instagram terhubung, tetapi jatah sesi paket penuh. Kosongkan satu sesi lalu pasang lagi.',
  in_use: 'Akun Instagram itu sudah dipakai akun NC-WA lain.',
  error: 'Instagram gagal dihubungkan; coba lagi.',
};
// Hasil callback Instagram Login datang lewat ?instagram=…; ditampilkan sekali lalu dihapus dari alamat.
function showInstagramResult() {
  const params = new URLSearchParams(location.search),
    result = params.get('instagram');
  if (!result) return;
  $('message').textContent = instagramResults[result] ?? instagramResults.error;
  params.delete('instagram');
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
}
async function loadIntegrations() {
  const [rows, wallet, official] = await Promise.all([
    fetchSessions(),
    api('/api/wallet'),
    api('/api/instagram/official'),
    loadZernio(),
    // Daftar key hanya pelengkap: gagal memuatnya tidak boleh menahan kisi koneksi dan tombol tambah sesi.
    loadInstagramKeys().catch(() => {}),
  ]);
  integrations.sessions = rows;
  integrations.official = official;
  integrations.limit = wallet.session_limit;
  renderIntegrations();
}
function platformOf(s) {
  return s.channel === 'instagram' ? 'instagram' : 'whatsapp';
}
// Satu bentuk untuk semua jenis koneksi supaya kisi dan dialognya tidak perlu tahu asalnya.
function integrationItems() {
  const linked = new Set(integrations.official.map(o => o.session).filter(Boolean));
  const sessions = integrations.sessions
    .filter(s => !linked.has(s.id))
    .map(s => {
      const platform = platformOf(s),
        inactive = s.serviceActive === false;
      const connected = !inactive && s.status === 'connected';
      const label = inactive
        ? 'Nonaktif (batas paket)'
        : ({ connected: 'Terhubung', qr_required: 'Menunggu QR', connecting: 'Menghubungkan' }[s.status] ?? 'Terputus');
      const owner = zernioAccounts.find(z => z.instagram.some(i => i.session === s.id));
      const zernio = owner?.instagram.find(i => i.session === s.id);
      return {
        kind: 'session',
        session: s,
        platform,
        name: s.phone || (zernio ? '@' + zernio.username : s.id),
        connected,
        label,
        method:
          platform === 'instagram'
            ? 'Instagram lewat Zernio' + (owner ? ' · ' + owner.name : '')
            : 'WhatsApp · scan QR',
        ai: aiLine(s),
      };
    });
  // Instagram Login resmi diperlakukan seperti nomor WhatsApp: satu kartu, dan sesinya ada di Asisten AI.
  const official = integrations.official.map(o => {
    const s = integrations.sessions.find(x => x.id === o.session);
    const tokenOk = o.status === 'active' || o.status === 'expiring';
    let label = { expired: 'Izin berakhir', revoked: 'Izin dicabut' }[o.status];
    if (tokenOk) {
      if (!s) label = 'Belum jadi sesi';
      else if (s.serviceActive === false) label = 'Nonaktif (batas paket)';
      else if (s.status !== 'connected') label = 'Terputus';
      else label = o.status === 'expiring' ? 'Token ' + o.daysLeft + ' hari lagi' : 'Terhubung';
    }
    return {
      kind: 'official',
      official: o,
      session: s,
      platform: 'instagram',
      name: '@' + o.username,
      connected: tokenOk && s?.serviceActive !== false && s?.status === 'connected',
      label,
      method: 'Instagram Login resmi' + (o.session ? ' · sesi ' + o.session : ''),
      ai: s ? aiLine(s) : '',
    };
  });
  return [...sessions, ...official];
}
function aiLine(s) {
  return s.aiProfile ? s.aiProfile.name + (s.aiEnabled ? ' · AI aktif' : ' · AI mati') : 'Profil AI belum dipasang';
}
const addCardIcons = {
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  upgrade:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
function openPlans() {
  history.pushState(null, '', '/dashboard/paket');
  navigate();
  window.scrollTo(0, 0);
}
// Kartu tambah sesi, sama dengan di Asisten AI (kelas dan teksnya sama): sisa slot paket, dan saat penuh berubah
// menjadi ajakan tingkatkan paket.
function integrationAddCard(remaining) {
  const full = remaining <= 0;
  const wrap = element('div', 'ai-session-add-wrap');
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ai-session-add' + (full ? ' full' : '');
  const icon = element('span', 'ai-session-add-icon');
  icon.innerHTML = full ? addCardIcons.upgrade : addCardIcons.add;
  card.append(
    icon,
    element('strong', '', full ? 'Tingkatkan paket' : 'Tambah sesi'),
    element(
      'small',
      '',
      full
        ? 'Slot sesi di paket kamu sudah penuh.'
        : 'WhatsApp atau Instagram. Sisa ' + remaining + ' slot di paket kamu.',
    ),
  );
  card.onclick = () => {
    if (full) return openPlans();
    $('integration-dialog').close();
    $('sessionform').reset();
    $('addconnection').showModal();
  };
  wrap.append(card);
  if (!full) {
    const upgrade = button('Butuh lebih banyak? Tingkatkan paket', openPlans);
    upgrade.classList.add('ai-session-upgrade-link');
    wrap.append(upgrade);
  }
  return wrap;
}
function renderIntegrations() {
  const active = integrations.sessions.filter(s => s.serviceActive !== false).length + hiddenSessionCount;
  $('integrations-quota').textContent = active + ' dari ' + integrations.limit + ' sesi';
  const items = integrationItems();
  const tiles = items.map(item => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'integration-tile ' + (item.connected ? 'connected' : 'disconnected');
    const icon = element('span', 'integration-icon ' + item.platform);
    icon.innerHTML = integrationIcons[item.platform];
    tile.append(
      icon,
      element('strong', '', item.name),
      chainIcon(item.connected, item.label),
      element('small', '', item.label),
    );
    tile.onclick = () => openIntegration(item);
    return tile;
  });
  // Kartu tambah sesi sama dengan di Asisten AI: sisa slot, dan berubah jadi ajakan tingkatkan paket saat penuh.
  $('integrations-grid').replaceChildren(...tiles, integrationAddCard(integrations.limit - active));
  renderProviders();
  if (!$('integration-dialog').open) return;
  // Dialog yang sedang terbuka mengikuti data terbaru; koneksi yang sudah hilang menutupnya.
  const key = $('integration-dialog').dataset.key,
    same = items.find(i => integrationKey(i) === key);
  if (same) openIntegration(same);
  else $('integration-dialog').close();
}
function integrationKey(item) {
  return item.kind === 'official' ? 'official:' + item.official.id : 'session:' + item.session.id;
}
async function refreshIntegrations() {
  await Promise.all([loadIntegrations(), sessions()]);
  if (!$('ai').hidden) await loadAI();
}
async function startInstagramLogin() {
  const { url } = await api('/api/instagram/official/start', 'POST');
  location.assign(url);
}
function openIntegration(item) {
  const dialog = $('integration-dialog');
  dialog.dataset.key = integrationKey(item);
  $('integration-dialog-title').textContent = item.name;
  const status = element('p', 'integration-status ' + (item.connected ? 'connected' : 'disconnected'));
  status.append(chainIcon(item.connected, item.label), element('span', '', item.label));
  const lines = [item.method, item.ai].filter(Boolean).map(text => element('p', 'hint', text));
  const actions =
    item.kind === 'official' ? officialActions(item.official) : integrationActions(item.session, item.platform);
  $('integration-dialog-body').replaceChildren(status, ...lines, actions);
  if (!dialog.open) dialog.showModal();
}
function officialActions(o) {
  const actions = element('div', 'row-actions');
  const tokenOk = o.status === 'active' || o.status === 'expiring';
  if (tokenOk && !o.session)
    actions.append(
      button('Pasang sebagai sesi', async () => {
        await api('/api/instagram/official/' + encodeURIComponent(o.id) + '/session', 'POST');
        await refreshIntegrations();
      }),
    );
  const down = integrations.sessions.find(x => x.id === o.session)?.status === 'logged_out';
  if (tokenOk && down)
    actions.append(
      button('Sambungkan ulang', async () => {
        await api('/api/instagram/sessions/' + encodeURIComponent(o.session) + '/reconnect', 'POST');
        await refreshIntegrations();
      }),
    );
  if (tokenOk)
    actions.append(
      button('Perpanjang', async () => {
        const result = await api('/api/instagram/official/' + encodeURIComponent(o.id) + '/refresh', 'POST');
        await refreshIntegrations();
        $('message').textContent = result.message;
      }),
    );
  else actions.append(button('Hubungkan ulang', startInstagramLogin));
  const remove = button('Putuskan', async () => {
    const note = o.session ? ' Sesi ' + o.session + ' ikut dihapus, termasuk riwayat chat dan data AI-nya.' : '';
    if (
      !confirm('Putuskan @' + o.username + '?' + note + ' Izin di Instagram tetap ada sampai Anda mencabutnya di sana.')
    )
      return;
    await api('/api/instagram/official/' + encodeURIComponent(o.id), 'DELETE');
    $('integration-dialog').close();
    await refreshIntegrations();
  });
  remove.className = 'danger';
  actions.append(remove);
  return actions;
}
function integrationActions(s, platform) {
  const actions = element('div', 'row-actions');
  const refresh = refreshIntegrations;
  if (s.serviceActive !== false && s.status === 'logged_out')
    actions.append(
      button('Hubungkan ulang', async () => {
        if (platform === 'instagram') await reconnectInstagram(s);
        else {
          await api('/sessions/' + encodeURIComponent(s.id) + '/reconnect', 'POST');
          await pair(s.id);
        }
        await refresh();
      }),
    );
  else if (platform === 'whatsapp' && s.serviceActive !== false && s.status !== 'connected')
    actions.append(button('Lihat QR', () => pair(s.id)));
  if (s.status !== 'logged_out')
    actions.append(
      button('Putuskan', async () => {
        const note =
          platform === 'instagram'
            ? 'AI berhenti membalas DM ' + (s.phone || s.id) + '. Akun di Zernio tidak dihapus.'
            : 'Perangkat WhatsApp ' + (s.phone || s.id) + ' dikeluarkan; memasang ulang butuh scan QR.';
        if (!confirm('Putuskan ' + s.id + '?\n' + note + '\nRiwayat chat dan data profil tetap tersimpan.')) return;
        await api('/sessions/' + encodeURIComponent(s.id) + '/logout', 'POST');
        await refresh();
      }),
    );
  const remove = button('Hapus', async () => {
    if (!confirm('Hapus sesi ' + s.id + '? Riwayat chat, memori AI, dan tiket fallback sesi ini ikut dihapus.')) return;
    await api('/sessions/' + encodeURIComponent(s.id), 'DELETE');
    await refresh();
  });
  remove.className = 'danger';
  actions.append(remove);
  return actions;
}
function renderProviders() {
  const host = $('integrations-providers');
  const add = button('+ Tambah akun Zernio', () => $('open-zernio').click());
  add.className = 'secondary';
  add.dataset.openZernio = '';
  if (!zernioAccounts.length) {
    host.replaceChildren(element('span', 'hint', 'Zernio · belum ada akun'), add);
    return;
  }
  host.replaceChildren(
    ...zernioAccounts.map(z => {
      const ok = z.status === 'active' && z.webhook;
      const label = z.status === 'active' ? (z.webhook ? 'Terhubung' : 'Webhook belum ada') : 'Kunci tidak berlaku';
      const card = element('article', 'integration-provider ' + (ok ? 'connected' : 'disconnected'));
      const text = element('div', 'integration-provider-text');
      text.append(
        element('strong', '', 'Zernio · ' + z.name),
        element('small', '', 'sk_••••' + z.key_hint + ' · webhook terakhir ' + zernioTime(z.last_event_at)),
      );
      const actions = element('div', 'row-actions');
      const refresh = async () => {
        await loadIntegrations();
        await sessions();
      };
      actions.append(
        button('Periksa ulang', async () => {
          await api('/api/instagram/zernio/' + z.id + '/check', 'POST');
          await refresh();
          $('message').textContent = 'Akun Zernio "' + z.name + '" siap dipakai.';
        }),
        button('Ganti kunci', async () => {
          const apiKey = prompt('Kunci API baru untuk "' + z.name + '" (harus dari akun Zernio yang sama):');
          if (!apiKey) return;
          await api('/api/instagram/zernio/' + z.id + '/key', 'PUT', { apiKey: apiKey.trim() });
          await refresh();
          $('message').textContent = 'Kunci API diganti.';
        }),
      );
      const remove = button('Hapus', async () => {
        const note = z.instagram.length
          ? ' Sesi Instagram ' + z.instagram.map(i => i.session).join(', ') + ' ikut dihapus dari NC-WA.'
          : '';
        if (!confirm('Hapus akun Zernio "' + z.name + '"?' + note + ' Akun di Zernio tidak dihapus.')) return;
        await api('/api/instagram/zernio/' + z.id, 'DELETE');
        await refresh();
      });
      remove.className = 'danger';
      actions.append(remove);
      card.append(element('span', 'provider-mark', 'Z'), text, chainIcon(ok, label), actions);
      return card;
    }),
    add,
  );
}

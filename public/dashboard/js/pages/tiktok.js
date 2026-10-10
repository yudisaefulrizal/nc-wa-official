// Koneksi TikTok untuk konten di halaman Integrasi: Login Kit, perpanjangan izin, dan putus koneksi.
// Nama profil ditampilkan sebagai teks; token provider tidak diterima browser.
async function startTikTokLogin() {
  const { url } = await api('/api/tiktok/start', 'POST');
  location.assign(url);
}
function showTikTokResult() {
  const params = new URLSearchParams(location.search),
    result = params.get('tiktok');
  if (!result) return;
  const messages = {
    connected: 'TikTok terhubung.',
    no_slot: 'Slot sesi paket sudah penuh. Kosongkan satu sesi atau tingkatkan paket, lalu hubungkan TikTok lagi.',
    cancelled: 'Izin TikTok dibatalkan.',
    in_use: 'Akun TikTok tersebut sudah terhubung ke akun NC-WA lain.',
    error: 'TikTok gagal dihubungkan. Coba lagi dan pastikan akun terdaftar sebagai penguji Sandbox.',
  };
  $('message').textContent = messages[result] ?? messages.error;
  params.delete('tiktok');
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
}
// Kartu TikTok menggunakan kisi dan dialog Integrasi yang sama dengan Instagram.
function tiktokIntegrationItems() {
  return integrations.tiktok.map(tiktokIntegrationItem);
}
function tiktokIntegrationItem(account) {
  return {
    kind: 'tiktok',
    tiktok: account,
    platform: 'tiktok',
    name: account.name,
    connected: account.serviceActive !== false && account.status === 'active',
    label:
      account.serviceActive === false
        ? 'Nonaktif (batas paket)'
        : { active: 'Terhubung', needs_refresh: 'Izin perlu diperpanjang', expired: 'Hubungkan ulang' }[account.status],
    method: 'TikTok',
    ai: '',
  };
}
// Akun TikTok ditampilkan di pemilih sesi AI, sementara formulir AI chat hanya menerima sesi berkemampuan pesan.
function buildTikTokSessionCard(account) {
  const item = tiktokIntegrationItem(account);
  const card = element('article', 'ai-session-card ai-tiktok-card');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'TikTok ' + account.name);
  card.tabIndex = 0;
  const head = element('div', 'ai-session-card-head');
  const avatar = element('span', 'ai-session-avatar tiktok');
  avatar.innerHTML = integrationIcons.tiktok;
  const name = element('div', 'ai-session-card-name');
  const title = element('strong', '', account.name);
  title.title = account.name;
  name.append(title, element('small', '', 'TikTok'));
  head.append(avatar, name);
  const chips = element('div', 'ai-session-chips-row');
  chips.append(
    element('span', 'ai-session-chip-plain', 'TikTok'),
    element('span', 'ai-session-chip-status ' + (item.connected ? 'online' : 'offline'), item.label),
  );
  const foot = element('div', 'ai-session-card-foot');
  foot.append(element('span', 'ai-session-noprofile', 'Konten TikTok'), element('span', 'hint', 'Kelola koneksi'));
  card.append(head, chips, foot);
  card.onclick = () => openIntegration(item);
  card.onkeydown = event => {
    if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openIntegration(item);
    }
  };
  return card;
}
function tiktokActions(account) {
  const actions = element('div', 'row-actions');
  if (account.status === 'expired') actions.append(button('Hubungkan ulang', startTikTokLogin));
  else
    actions.append(
      button('Perpanjang izin', async () => {
        await api('/api/tiktok/connections/' + encodeURIComponent(account.id) + '/refresh', 'POST');
        await loadIntegrations();
        if (!$('ai').hidden) await loadAI();
        $('message').textContent = 'Izin TikTok diperpanjang.';
      }),
    );
  const remove = button('Putuskan', async () => {
    if (!confirm('Putuskan koneksi TikTok ' + account.name + '? Konten yang sudah terbit di TikTok tetap ada.')) return;
    const result = await api('/api/tiktok/connections/' + encodeURIComponent(account.id), 'DELETE');
    $('integration-dialog').close();
    await loadIntegrations();
    if (!$('ai').hidden) await loadAI();
    $('message').textContent = result.revoked
      ? 'Koneksi dan izin TikTok diputus.'
      : 'Koneksi di NC-WA dihapus. Cabut juga izin NC-WA melalui pengaturan aplikasi TikTok.';
  });
  remove.className = 'danger';
  actions.append(remove);
  const grants = [
    account.scopes.includes('video.publish') ? 'Publikasi langsung' : '',
    account.scopes.includes('video.upload') ? 'Unggah ke TikTok' : '',
  ].filter(Boolean);
  const wrap = element('div');
  wrap.append(
    element('p', 'hint', grants.length ? 'Izin: ' + grants.join(', ') : 'Izin posting belum diberikan.'),
    actions,
  );
  return wrap;
}

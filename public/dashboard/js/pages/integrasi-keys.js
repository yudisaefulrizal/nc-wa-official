// Bagian "API untuk aplikasi lain" di halaman Integrasi: membuat, menampilkan, dan mencabut key yang memberi
// aplikasi lain akses ke akun Instagram yang terhubung. Key hanya tampil sekali, saat dibuat.
const keyScopeLabels = {
  'accounts:read': 'Lihat akun',
  'messages:read': 'Baca pesan',
  'messages:send': 'Kirim pesan',
  'comments:read': 'Baca komentar',
  'comments:write': 'Balas komentar',
  'posts:publish': 'Posting',
};
async function loadInstagramKeys() {
  const { keys } = await api('/api/instagram/keys');
  const host = $('ig-keys');
  if (!keys.length) {
    host.replaceChildren(element('span', 'hint', 'Belum ada key'));
    return;
  }
  host.replaceChildren(
    ...keys.map(key => {
      const card = element('article', 'integration-provider');
      const text = element('div', 'integration-provider-text');
      const used = key.lastUsedAt ? 'dipakai ' + new Date(key.lastUsedAt).toLocaleString('id-ID') : 'belum dipakai';
      text.append(
        element('strong', '', key.name),
        element('small', '', 'ncig_••••' + key.hint + ' · ' + used),
        element('small', '', key.scopes.map(s => keyScopeLabels[s] ?? s).join(', ')),
      );
      const revoke = button('Cabut', async () => {
        if (!confirm('Cabut key "' + key.name + '"? Aplikasi yang memakainya langsung berhenti bekerja.')) return;
        await api('/api/instagram/keys/' + key.id, 'DELETE');
        await loadInstagramKeys();
      });
      revoke.className = 'danger';
      card.append(text, revoke);
      return card;
    }),
  );
}
$('ig-key-new').onclick = () =>
  run(async () => {
    const { scopes } = await api('/api/instagram/keys');
    // Reset lebih dulu: form.reset() juga mengembalikan kotak centang ke keadaan awal (tidak tercentang).
    $('ig-key-form').reset();
    $('ig-key-scopes').replaceChildren(
      element('legend', '', 'Izin'),
      ...scopes.map(scope => {
        const label = element('label', 'ig-key-scope');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = scope;
        box.checked = true;
        label.append(box, ' ' + (keyScopeLabels[scope] ?? scope));
        return label;
      }),
    );
    $('ig-key-form').hidden = false;
    $('ig-key-result').hidden = true;
    $('ig-key-dialog').showModal();
  });
$('ig-key-form').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const scopes = [...$('ig-key-scopes').querySelectorAll('input:checked')].map(box => box.value);
    const created = await api('/api/instagram/keys', 'POST', {
      name: String(new FormData(event.target).get('name')).trim(),
      scopes,
    });
    $('ig-key-value').textContent = created.key;
    $('ig-key-form').hidden = true;
    $('ig-key-result').hidden = false;
    await loadInstagramKeys();
  });
};
$('ig-key-copy').onclick = () =>
  run(async () => {
    await navigator.clipboard.writeText($('ig-key-value').textContent);
    $('message').textContent = 'Key disalin.';
  });

// Tes rute provider yang profilnya nonaktif: profil yang masih dipakai rute tidak boleh dinonaktifkan, dan tingkat yang
// profilnya mati memakai profil aktif lain, bukan pengaturan lama (yang bisa berisi provider dan model lama).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../../src/libraries/db.js';
import { encrypt } from '../../../src/libraries/crypto.js';
import { AIService } from '../../../src/components/ai/domain/service.js';

const assistant = new AIService();
after(async () => {
  await db.end();
});
test('profil yang dipakai rute tidak bisa dinonaktifkan dan tingkat yang profilnya mati tidak jatuh ke pengaturan lama', async () => {
  const [settings] = await db.query<any[]>('SELECT id FROM ai_settings WHERE id=1'),
    createdSettings = !settings.length;
  if (createdSettings)
    await db.execute(
      "INSERT INTO ai_settings(id,endpoint,model,secret) VALUES (1,'https://openrouter.ai/api/v1/chat/completions','legacy-model',?)",
      [encrypt('legacy-key')],
    );
  // Pengaturan asli dikembalikan di akhir supaya tes lain tidak ikut terpengaruh.
  const [before] = await db.query<any[]>('SELECT model_smart, profile_routing_enabled FROM ai_settings WHERE id=1');
  await db.execute("UPDATE ai_settings SET model_smart='legacy-deepseek' WHERE id=1");
  const profile = (name: string, model: string) => ({
    name,
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: 'key-' + name,
    model_cheap: model + '-cheap',
    model_medium: model + '-medium',
    model_smart: model + '-smart',
    model_structured: model + '-structured',
    model_decision: model + '-decision',
  });
  const a = (await assistant.saveProviderProfile(profile('Aktif', 'aktif'))).id;
  const b = (await assistant.saveProviderProfile(profile('Lama', 'lama'))).id;
  try {
    const route = (smart: string) => ({
      cheap: { profileId: a },
      medium: { profileId: a },
      smart: { profileId: smart },
      structured: { profileId: a },
      decision: { profileId: a },
    });
    await assistant.setProviderRoutes(route(b));
    assert.equal((await assistant.config()).tier_profiles?.smart?.model, 'lama-smart');
    // Menonaktifkan profil yang masih dipakai rute ditolak dengan pesan yang jelas.
    await assert.rejects(
      assistant.saveProviderProfile({ ...profile('Lama', 'lama'), id: b, apiKey: '', active: false }),
      {
        code: 'profile_in_use',
      },
    );
    // Profil mati lewat jalur lain (misalnya data lama): tingkat itu memakai profil aktif, bukan "legacy-deepseek".
    await db.execute('UPDATE ai_provider_profiles SET active=FALSE WHERE id=?', [b]);
    const config = await assistant.config();
    assert.equal(config.tier_profiles?.smart?.id, a);
    assert.notEqual(config.tier_profiles?.smart?.model, 'legacy-deepseek');
    // Dashboard diberi tahu tingkat mana yang rutenya mati.
    assert.deepEqual((await assistant.providerProfiles()).inactive_tiers, ['smart']);
    // Setelah dipindah ke profil aktif dan disimpan, tidak ada lagi tingkat yang mati.
    await assistant.setProviderRoutes(route(a));
    assert.deepEqual((await assistant.providerProfiles()).inactive_tiers, []);
  } finally {
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id IN (?,?)', [a, b]);
    await db.execute('DELETE FROM ai_provider_profiles WHERE id IN (?,?)', [a, b]);
    // Baris pengaturan yang dibuat tes ini dihapus; yang sudah ada dikembalikan seperti semula.
    if (createdSettings) await db.execute('DELETE FROM ai_settings WHERE id=1');
    else
      await db.execute('UPDATE ai_settings SET model_smart=?, profile_routing_enabled=? WHERE id=1', [
        before[0].model_smart,
        before[0].profile_routing_enabled,
      ]);
  }
});

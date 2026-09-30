// Tes server baru: tabel ai_settings kosong (pengaturan lama tidak pernah disimpan). Menyimpan rute profil harus membuat
// baris pengaturan dan mengaktifkan rute, supaya AI memakai profil, bukan nilai bawaan kode (deepseek dan key kosong).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../../src/libraries/db.js';
import { AIService } from '../../../src/components/ai/domain/service.js';

const assistant = new AIService();
after(async () => {
  await db.end();
});
test('menyimpan rute profil tanpa baris ai_settings membuat baris itu dan mengaktifkan rute', async () => {
  const [saved] = await db.query<any[]>('SELECT * FROM ai_settings WHERE id=1');
  await db.query('DELETE FROM ai_settings');
  const profile = {
    name: 'Server baru',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: 'kunci-server-baru',
    model_cheap: 'baru-cheap',
    model_medium: 'baru-medium',
    model_smart: 'baru-smart',
    model_structured: 'baru-structured',
    model_decision: 'baru-decision',
  };
  const id = (await assistant.saveProviderProfile(profile)).id;
  try {
    const route = { profileId: id };
    await assistant.setProviderRoutes({
      cheap: route,
      medium: route,
      smart: route,
      structured: route,
      decision: route,
    });
    const config = await assistant.config();
    // Rute berlaku: model dan kunci dari profil, bukan bawaan kode.
    assert.equal(config.tier_profiles?.cheap?.model, 'baru-cheap');
    assert.equal(config.tier_profiles?.smart?.id, id);
    assert.ok(config.tier_profiles?.cheap?.secret);
    assert.equal(config.secret, config.tier_profiles?.medium?.secret);
    assert.equal((await assistant.configuration()).configured, true);
    assert.equal((await assistant.configuration()).tier_profiles, undefined);
    // Nilai lain tetap bawaan kode, bukan bawaan tabel.
    assert.equal(config.memory_limit, 60);
    // Tarif dan memori bisa disimpan walau API key lama kosong, karena key ada di profil.
    await assistant.configure('admin', {
      provider: 'compatible',
      endpoint: 'https://ai.sumopod.com/v1/chat/completions',
      model_medium: 'baru-medium',
      input_rate: 3,
      output_rate: 4,
      memory_limit: 20,
      context_memory_limit: 6,
      trace_enabled: false,
      credit_price: 0,
    });
    assert.equal((await assistant.config()).input_rate, 3);
    assert.ok((await assistant.config()).tier_profiles?.cheap);
    await db.query(
      "UPDATE ai_settings SET secret='ignored-legacy',model='ignored-model',profile_routing_enabled=FALSE WHERE id=1",
    );
    assert.equal((await assistant.config()).model, 'baru-medium');
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id=?', [id]);
    assert.equal((await assistant.config()).secret, '');
    assert.equal((await assistant.configuration()).configured, false);
  } finally {
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id=?', [id]);
    await db.execute('DELETE FROM ai_provider_profiles WHERE id=?', [id]);
    await db.query('DELETE FROM ai_settings');
    if (saved.length) {
      const columns = Object.keys(saved[0]);
      await db.query(
        `INSERT INTO ai_settings(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map(c => saved[0][c]),
      );
    }
  }
});

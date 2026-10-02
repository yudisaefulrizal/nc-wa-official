// Provider teks dan gambar tiruan untuk tes node Buat gambar dan pekerjaan Konten: tarif 25 kredit per gambar.
// Pengaturan AI dan rute provider asli dipulihkan oleh removeImageProviders.
import { db } from '../../../src/libraries/db.js';
import { ai } from '../../../src/components/ai/domain/service.js';
import { modelTiers } from '../../../src/components/ai/domain/pipeline/models.js';

export interface ImageProviders {
  ids: string[];
  settings: Record<string, unknown> | undefined;
  routes: Record<string, unknown>[];
}
export const creditsPerImage = 25;
export async function installImageProviders(): Promise<ImageProviders> {
  const [settings] = await db.query<any[]>('SELECT * FROM ai_settings WHERE id=1');
  const [routes] = await db.query<any[]>('SELECT * FROM ai_provider_routes');
  const text = await ai.saveProviderProfile({
    name: 'Text fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture-only',
    model_cheap: 'fixture-cheap',
    model_medium: 'fixture-medium',
    model_smart: 'fixture-smart',
    model_structured: 'fixture-structured',
    model_decision: 'fixture-decision',
  });
  const image = await ai.saveProviderProfile({
    name: 'Image fixture',
    provider: 'compatible',
    endpoint: 'https://example.com/v1/chat/completions',
    apiKey: 'fixture-only',
    model_image: 'fixture-image',
    image_options: { protocol: 'compatible', references: true, maxImages: 4, creditsPerImage },
  });
  await ai.setProviderRoutes({
    ...Object.fromEntries(modelTiers.map(tier => [tier, { profileId: text.id }])),
    image: { profileId: image.id },
  });
  return { ids: [text.id, image.id], settings: settings[0], routes };
}
export async function removeImageProviders(state: ImageProviders) {
  for (const id of state.ids) {
    await db.execute('DELETE FROM ai_provider_routes WHERE profile_id=?', [id]);
    await db.execute('DELETE FROM ai_provider_profiles WHERE id=?', [id]);
  }
  await db.query('DELETE FROM ai_settings WHERE id=1');
  if (state.settings) await db.query('INSERT INTO ai_settings SET ?', [state.settings]);
  await db.query('DELETE FROM ai_provider_routes');
  for (const route of state.routes) await db.query('INSERT INTO ai_provider_routes SET ?', [route]);
}

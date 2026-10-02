// Tier model per node (Murah, Sedang, Cerdas, Terstruktur, Keputusan) dan model router JEV.
import type { AIConfig } from '../provider.js';
// "structured" berisi model yang mendukung JSON Schema ketat, untuk sedikit node yang butuh keluaran persis.
export const modelTiers = ['cheap', 'medium', 'smart', 'structured', 'decision'] as const;
export type ModelTier = (typeof modelTiers)[number];
// Tier gambar hanya untuk generator; tidak boleh dipilih oleh node model teks.
export const providerTiers = [...modelTiers, 'image'] as const;
export type ProviderTier = (typeof providerTiers)[number];
// Id node graf yang memanggil model; dicatat di jejak dan riwayat pemakaian.
export type ModelRole = string;
export interface AITraceEvent {
  node: string;
  state: string;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
  model?: string;
  attempt?: number;
  error?: string;
  // Prompt lengkap yang dikirim ke model pada satu panggilan (Uji di editor), per peran.
  prompt?: { role: string; content: string }[];
  // Pemakaian satu panggilan model (Uji di editor); estimated = dihitung dari panjang teks karena penyedia tidak menyebut.
  usage?: { input: number; output: number; reasoning: number; cost: number | null; estimated?: boolean };
}
// Model JEV hanya menjawab lewat Decisions API OpenRouter, jadi hanya bisa dipakai node Router.
export const isJevModel = (model: string) => /^~?typesafe\/jev-/.test(model);
export function tierConfig(config: AIConfig, tier: ProviderTier): AIConfig {
  const profile = config.tier_profiles?.[tier];
  return profile
    ? {
        ...config,
        provider: profile.provider,
        endpoint: profile.endpoint,
        secret: profile.secret,
        model: profile.model,
      }
    : config.tier_profiles
      ? { ...config, secret: '', model: '' }
      : { ...config, model: config[`model_${tier}`] || config.model };
}

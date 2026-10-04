// Ringkasan angka akun saat ini: follower dan total bulan ini (views, reach, like, dll.). Sengaja hanya kondisi saat
// ini tanpa riwayat: aplikasi pemanggil membandingkan dua kali pengecekan untuk melihat perkembangan.
import { ApiError } from '../../../libraries/errors.js';
import { graphRequest } from './official-graph.js';
import { officialToken } from './official-token.js';

export const insightsPermission = 'instagram_business_manage_insights';
const metrics = [
  'views',
  'reach',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'profile_views',
] as const;
const day = 86400;

// Nilai total tiap metrik dalam rentang; satu permintaan, atau satu per metrik bila Meta menolak gabungannya
// (satu metrik yang tidak didukung akun membuat seluruh permintaan gagal). Metrik yang gagal dikembalikan null.
async function totals(igUserId: string, token: string, since: number, until: number) {
  const query = (names: readonly string[]) =>
    igUserId +
    '/insights?metric=' +
    names.join(',') +
    '&metric_type=total_value&period=day&since=' +
    since +
    '&until=' +
    until;
  const read = (data: Record<string, unknown>) => {
    const out: Record<string, number> = {};
    for (const item of Array.isArray(data.data) ? (data.data as Record<string, any>[]) : []) {
      const value = item.total_value?.value;
      if (typeof item.name === 'string' && typeof value === 'number') out[item.name] = value;
    }
    return out;
  };
  try {
    return read(await graphRequest(query(metrics), token));
  } catch {
    const parts = await Promise.all(
      metrics.map(name =>
        graphRequest(query([name]), token)
          .then(read)
          .catch(() => ({})),
      ),
    );
    return Object.assign({}, ...parts) as Record<string, number>;
  }
}
export async function officialSummary(account: string, igUserId: string, now = new Date()) {
  const token = await officialToken(account, igUserId, insightsPermission);
  const profile = await graphRequest(igUserId + '?fields=username,followers_count,follows_count,media_count', token);
  if (typeof profile.followers_count !== 'number')
    throw new ApiError(502, 'instagram_request_failed', 'Instagram tidak mengembalikan jumlah follower');
  // Bulan berjalan menurut UTC. Meta membatasi rentang total maksimal 30 hari, jadi awal rentang dimajukan bila lebih.
  const until = Math.floor(now.getTime() / 1000);
  const monthStart = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  const since = Math.max(monthStart, until - 30 * day);
  const found = await totals(igUserId, token, since, until);
  const month: Record<string, number | null | string[] | string> = {
    from: new Date(since * 1000).toISOString(),
    to: now.toISOString(),
  };
  for (const name of metrics) month[name] = found[name] ?? null;
  month.unavailable = metrics.filter(name => found[name] === undefined);
  return {
    id: igUserId,
    username: String(profile.username ?? ''),
    followers: profile.followers_count,
    following: typeof profile.follows_count === 'number' ? profile.follows_count : null,
    mediaCount: typeof profile.media_count === 'number' ? profile.media_count : null,
    month,
    fetchedAt: now.toISOString(),
  };
}

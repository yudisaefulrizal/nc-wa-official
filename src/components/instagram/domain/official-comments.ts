// Media, komentar, dan balasan komentar lewat Instagram Graph API resmi. Token dikirim lewat header Authorization,
// dan ID dari klien divalidasi sebagai angka sebelum masuk ke URL.
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { officialToken } from './official-token.js';

const graph = () => (process.env.INSTAGRAM_GRAPH_URL ?? 'https://graph.instagram.com') + '/v23.0';
const commentsPermission = 'instagram_business_manage_comments';

function numericId(value: unknown, name: string) {
  if (typeof value !== 'string' || !/^[0-9]{1,30}$/.test(value))
    throw new ApiError(400, 'invalid_request', name + ' tidak valid');
  return value;
}
async function graphRequest(path: string, token: string, body?: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(graph() + '/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token },
      body: body ? new URLSearchParams(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(502, 'instagram_request_failed', 'Instagram tidak dapat dihubungi');
  }
  if (!response.ok) {
    log('instagram-official', 'Permintaan komentar ditolak Meta (' + response.status + ')');
    throw new ApiError(502, 'instagram_request_failed', 'Instagram menolak permintaan; periksa izin dan ID-nya');
  }
  return (await response.json()) as Record<string, unknown>;
}
const page = (value: unknown) => {
  const limit = Number(value ?? 25);
  return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 25;
};
const cursor = (value: unknown) => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]{1,300}$/.test(value))
    throw new ApiError(400, 'invalid_request', 'Cursor tidak valid');
  return '&after=' + value;
};
function paged(data: Record<string, unknown>) {
  const paging = data.paging as { cursors?: { after?: string }; next?: string } | undefined;
  return {
    data: Array.isArray(data.data) ? data.data : [],
    next: paging?.next ? (paging.cursors?.after ?? null) : null,
  };
}
export async function listOfficialMedia(account: string, igUserId: string, query: Record<string, unknown>) {
  const token = await officialToken(account, igUserId);
  const fields = 'id,caption,media_type,media_url,permalink,timestamp,comments_count,like_count';
  return paged(
    await graphRequest(
      numericId(igUserId, 'Akun Instagram') +
        '/media?fields=' +
        fields +
        '&limit=' +
        page(query.limit) +
        cursor(query.after),
      token,
    ),
  );
}
export async function listOfficialComments(
  account: string,
  igUserId: string,
  mediaId: unknown,
  query: Record<string, unknown>,
) {
  const token = await officialToken(account, igUserId, commentsPermission);
  const fields = 'id,text,username,timestamp,like_count,hidden,parent_id';
  return paged(
    await graphRequest(
      numericId(mediaId, 'ID media') +
        '/comments?fields=' +
        fields +
        '&limit=' +
        page(query.limit) +
        cursor(query.after),
      token,
    ),
  );
}
export async function replyOfficialComment(account: string, igUserId: string, commentId: unknown, body: unknown) {
  const message = requiredString(object(body).message, 'Balasan', 2200);
  const token = await officialToken(account, igUserId, commentsPermission);
  const data = await graphRequest(numericId(commentId, 'ID komentar') + '/replies', token, { message });
  if (typeof data.id !== 'string')
    throw new ApiError(502, 'instagram_request_failed', 'Instagram tidak mengembalikan ID balasan');
  return { id: data.id };
}
export async function hideOfficialComment(account: string, igUserId: string, commentId: unknown, hide: boolean) {
  const token = await officialToken(account, igUserId, commentsPermission);
  await graphRequest(numericId(commentId, 'ID komentar'), token, { hide: String(hide) });
  return { ok: true };
}

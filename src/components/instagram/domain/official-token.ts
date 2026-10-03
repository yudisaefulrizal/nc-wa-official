// Token akun Instagram resmi milik sebuah akun NC-WA, dipakai pemanggilan Graph API (posting, komentar).
import { db } from '../../../libraries/db.js';
import { decrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import * as officialSql from '../data-access/official-queries.js';

// `permission` wajib dimiliki akun; akun yang izinnya belum diberikan diminta menghubungkan ulang dengan kode
// kesalahan `code` (kode lama posting dipertahankan karena dipakai dashboard).
export async function officialToken(
  account: string,
  igUserId: string,
  permission?: string,
  code = 'instagram_permission',
) {
  const [rows] = await officialSql.findOwned(db, [account, igUserId]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ditemukan.');
  if (row.status !== 'active' || !row.token || !row.expires_at || new Date(row.expires_at).getTime() <= Date.now())
    throw new ApiError(409, 'instagram_reauth', 'Hubungkan ulang akun Instagram.');
  if (permission && !String(row.permissions).split(',').includes(permission))
    throw new ApiError(409, code, 'Hubungkan ulang Instagram dan berikan izin yang diperlukan.');
  return decrypt(row.token);
}

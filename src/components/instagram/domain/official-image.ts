// Menyesuaikan gambar untuk konektor Instagram resmi tanpa mengubah file milik pelanggan.
// JPEG/PNG tetap utuh; WebP statis dikonversi menjadi JPEG sebelum salinan sementara dipublikasikan.
import sharp from 'sharp';
import { ApiError } from '../../../libraries/errors.js';
import { sniffMediaType } from '../../../libraries/media-type.js';

export async function prepareOfficialImage(data: Buffer): Promise<Buffer> {
  if (sniffMediaType(data, '')?.mimetype !== 'image/webp') return data;
  try {
    const image = sharp(data, { limitInputPixels: 25_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) throw Error('animated_image');
    return await image.rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new ApiError(400, 'unsupported_media', 'Gambar WebP tidak valid, terlalu besar, atau berupa animasi');
  }
}

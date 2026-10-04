// Kebijakan video NC-WA: MP4 asli diperiksa lokal tanpa shell, jaringan atau transcode.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open } from 'node:fs/promises';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { outboundVideo } from '../data-access/outbound-video-store.js';
import { log } from '../../../libraries/log.js';
import { ApiError } from '../../../libraries/errors.js';
const probe = promisify(execFile);
export const maxVideoBytes = 64 * 1024 * 1024;
const invalid = () =>
  new ApiError(
    400,
    'invalid_video',
    'Video harus MP4 H264/AAC, 23–60 fps, durasi 3–180 detik dan dimensi yang didukung.',
  );
export async function validatePostVideo(path: string) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat(),
      head = Buffer.alloc(12);
    if (!stat.isFile() || stat.size < 12 || stat.size > maxVideoBytes) throw invalid();
    await file.read(head, 0, 12, 0);
    if (
      head.toString('ascii', 4, 8) !== 'ftyp' ||
      head.readUInt32BE(0) < 16 ||
      !['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '].includes(
        head.toString('ascii', 8, 12),
      )
    )
      throw invalid();
  } finally {
    await file.close();
  }
  let output: string;
  try {
    ({ stdout: output } = await probe(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,field_order,sample_rate,channels',
        '-of',
        'json',
        path,
      ],
      { timeout: 15000, maxBuffer: 128 * 1024, encoding: 'utf8' },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new ApiError(503, 'video_probe_unavailable', 'ffprobe belum tersedia di server.');
    throw invalid();
  }
  try {
    const data = JSON.parse(output),
      streams = data.streams as Array<Record<string, any>>;
    const videos = streams.filter(s => s.codec_type === 'video'),
      audios = streams.filter(s => s.codec_type === 'audio');
    if (videos.length !== 1 || audios.length > 1 || streams.length !== videos.length + audios.length) throw invalid();
    const video = videos[0],
      [n, d] = String(video.avg_frame_rate).split('/').map(Number),
      fps = n / d;
    const duration = Number(data.format?.duration),
      width = Number(video.width),
      height = Number(video.height);
    if (
      !String(data.format?.format_name).split(',').includes('mp4') ||
      video.codec_name !== 'h264' ||
      video.pix_fmt !== 'yuv420p' ||
      !['progressive', 'unknown'].includes(video.field_order) ||
      width / height > 10 ||
      width / height < 0.01 ||
      audios.some(
        s =>
          s.codec_name !== 'aac' ||
          !Number.isFinite(Number(s.sample_rate)) ||
          Number(s.sample_rate) < 8000 ||
          Number(s.sample_rate) > 48000 ||
          ![1, 2].includes(Number(s.channels)),
      ) ||
      !Number.isFinite(fps) ||
      fps < 23 ||
      fps > 60 ||
      !Number.isFinite(duration) ||
      duration < 3 ||
      duration > 180 ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width > 1920 ||
      height > 1920 ||
      width * height > 3686400
    )
      throw invalid();
  } catch {
    throw invalid();
  }
}

// Dua unduhan aktif membatasi staging hingga 128 MiB; tidak ada antrean unduhan tak terbatas.
let preparing = 0;
export async function prepareReel(url: string, download: typeof downloadPublicMedia = downloadPublicMedia) {
  if (preparing >= 2) throw new ApiError(503, 'media_queue_full', 'Antrean persiapan video penuh.');
  preparing++;
  let source: Awaited<ReturnType<typeof downloadPublicMedia>> | undefined;
  let published: string | undefined;
  try {
    try {
      source = await download(url, { maxBytes: maxVideoBytes, timeoutMs: 120000 });
    } catch (error) {
      if (['AbortError', 'TimeoutError'].includes((error as Error).name))
        throw new ApiError(504, 'video_download_timeout', 'Unduhan video melewati batas waktu.');
      throw error;
    }
    await validatePostVideo(source.path);
    published = await outboundVideo.publish(source.path);
    return published;
  } finally {
    try {
      await source?.cleanup();
    } catch (error) {
      if (published) await outboundVideo.remove(published);
      throw error;
    } finally {
      preparing--;
    }
  }
}

export const getOfficialVideo = (token: string) => outboundVideo.get(token);
setInterval(() => {
  void outboundVideo.prune().catch(() => log('instagram-official', 'Pembersihan video sementara gagal'));
}, 60000).unref();

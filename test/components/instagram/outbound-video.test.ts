// MP4 nyata dibuat di direktori sementara; validasi dan salinan tidak mengubah sumber.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile, truncate, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OutboundVideoStore,
  outboundVideo,
} from '../../../src/components/instagram/data-access/outbound-video-store.js';
import { validatePostVideo, prepareReel } from '../../../src/components/instagram/domain/official-video.js';
import { storageRoot } from '../../../src/libraries/storage.js';
const exec = promisify(execFile);
export async function fixture(path: string, extra: string[] = []) {
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x200:r=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    ...extra,
    '-y',
    path,
  ]);
}
test('MP4 H264 AAC disalin utuh, token aman/kedaluwarsa dan kuota dibatasi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-'));
  let now = 1800000000000;
  const store = new OutboundVideoStore(join(root, 'public'), () => now, 3600000, 1);
  try {
    const path = join(root, 'source.mp4');
    await fixture(path);
    await validatePostVideo(path);
    const token = await store.publish(path);
    const saved = await store.get(token);
    assert.equal(saved.mimetype, 'video/mp4');
    assert.deepEqual(await readFile(saved.path), await readFile(path));
    await assert.rejects(store.publish(path), { code: 'media_storage_full' });
    await assert.rejects(store.get('../source.mp4'), { code: 'media_not_found' });
    now += 3600000;
    await assert.rejects(store.get(token), { code: 'media_not_found' });
    await store.prune();
    assert.deepEqual(await readdir(join(root, 'public')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('signature palsu, codec/durasi salah, file kosong dan >64MiB ditolak', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-invalid-'));
  try {
    const path = join(root, 'source.mp4');
    await writeFile(path, 'not mp4');
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    await fixture(path, ['-t', '1']);
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    await fixture(path, ['-c:v', 'mpeg4']);
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    await writeFile(path, '');
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    await truncate(path, 64 * 1024 * 1024 + 1);
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('QuickTime MOV bukan MP4 meski memiliki box ftyp dan codec H264', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-mov-'));
  try {
    const path = join(root, 'video.mp4');
    await fixture(path, ['-f', 'mov']);
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('4:5 dan 9:16 dipertahankan; audio opsional, fps/dimensi/audio di luar policy ditolak', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-dimensions-'));
  try {
    const path = join(root, 'video.mp4');
    for (const size of ['1080:1350', '1080:1920']) {
      await fixture(path, ['-vf', 'scale=' + size, '-an']);
      const before = await readFile(path);
      await validatePostVideo(path);
      assert.deepEqual(await readFile(path), before);
    }
    for (const options of [
      ['-r', '22'],
      ['-r', '61'],
      ['-vf', 'scale=1922:200'],
      ['-vf', 'scale=160:1922'],
      ['-c:a', 'libmp3lame'],
    ]) {
      await fixture(path, options);
      await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ffprobe hilang jelas 503 dan MP4 rusak ditolak tanpa file publik', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-probe-'));
  const oldPath = process.env.PATH;
  try {
    const path = join(root, 'video.mp4');
    await fixture(path);
    process.env.PATH = root;
    await assert.rejects(validatePostVideo(path), { code: 'video_probe_unavailable', status: 503 });
    process.env.PATH = oldPath;
    await writeFile(path, Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex'));
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  } finally {
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('token tidak mengikuti symlink ke file lain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-symlink-'));
  try {
    const target = join(root, 'private');
    await writeFile(target, 'private fixture');
    const token = String(Date.now() + 3600000) + '-' + 'a'.repeat(64);
    await symlink(target, join(root, token));
    await assert.rejects(new OutboundVideoStore(root).get(token), { code: 'media_not_found' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ffprobe output tak terbatas dan proses macet dibatasi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-probe-bounds-'));
  const oldPath = process.env.PATH;
  try {
    const path = join(root, 'video.mp4');
    await fixture(path);
    const executable = join(root, 'ffprobe');
    await writeFile(executable, '#!' + process.execPath + '\nprocess.stdout.write("x".repeat(256 * 1024));\n');
    await chmod(executable, 0o700);
    process.env.PATH = root;
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    await writeFile(executable, '#!' + process.execPath + '\nsetInterval(() => {}, 1000);\n');
    const started = Date.now();
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    assert.ok(Date.now() - started < 20000);
  } finally {
    process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('jumlah salinan bersamaan dibatasi dan kegagalan tidak meninggalkan part', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-copy-bounds-'));
  try {
    const path = join(root, 'video.mp4'),
      store = new OutboundVideoStore(join(root, 'public'));
    await fixture(path);
    const jobs = await Promise.allSettled([store.publish(path), store.publish(path), store.publish(path)]);
    assert.equal(jobs.filter(j => j.status === 'fulfilled').length, 2);
    const rejected = jobs.find(j => j.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.code, 'media_queue_full');
    await truncate(path, 64 * 1024 * 1024 + 1);
    await assert.rejects(store.publish(path), { code: 'invalid_video' });
    assert.equal((await readdir(join(root, 'public'))).length, 2);
    assert.ok((await readdir(join(root, 'public'))).every(name => !name.endsWith('.part')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persiapan membatasi dua unduhan aktif dan slot dilepas setelah kegagalan', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const downloader = async () => {
    await blocked;
    throw Error('fixture_download_failed');
  };
  const jobs = [
    prepareReel('https://fixture.example/a', downloader),
    prepareReel('https://fixture.example/b', downloader),
  ];
  const finished = Promise.allSettled(jobs);
  await assert.rejects(prepareReel('https://fixture.example/c', downloader), { code: 'media_queue_full' });
  release();
  assert.ok((await finished).every(result => result.status === 'rejected'));
  await assert.rejects(prepareReel('https://fixture.example/d', downloader), /fixture_download_failed/);
});

test('cleanup yang gagal tidak mengunci slot persiapan selamanya', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-cleanup-'));
  try {
    const path = join(root, 'invalid.mp4');
    await writeFile(path, 'invalid fixture');
    let downloads = 0;
    const downloader = async () => {
      downloads++;
      return {
        path,
        mimetype: 'video/mp4',
        cleanup: async () => {
          throw Error('fixture_cleanup_failed');
        },
      };
    };
    for (let i = 0; i < 3; i++)
      await assert.rejects(prepareReel('https://fixture.example/a', downloader), /fixture_cleanup_failed/);
    assert.equal(downloads, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup staging gagal setelah salinan sukses tidak meninggalkan token publik', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reels-cleanup-copy-'));
  const publicRoot = join(storageRoot, 'files', 'instagram-outbound-video');
  const before = await readdir(publicRoot).catch(() => [] as string[]);
  try {
    const path = join(root, 'video.mp4');
    await fixture(path);
    await assert.rejects(
      prepareReel('https://fixture.example/a', async () => ({
        path,
        mimetype: 'video/mp4',
        cleanup: async () => {
          throw Error('fixture_cleanup_failed');
        },
      })),
      /fixture_cleanup_failed/,
    );
    assert.deepEqual(await readdir(publicRoot), before);
  } finally {
    for (const token of await readdir(publicRoot).catch(() => [] as string[]))
      if (!before.includes(token)) await outboundVideo.remove(token);
    await rm(root, { recursive: true, force: true });
  }
});

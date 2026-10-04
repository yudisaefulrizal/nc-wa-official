// Pemeriksaan independen: MP4/H264 saja belum cukup untuk memenuhi spesifikasi Reels Meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePostVideo } from '../../../src/components/instagram/domain/official-video.js';

const execute = promisify(execFile);
async function fixture(args: string[], check: (path: string) => Promise<void>, size = '320x400') {
  const directory = await mkdtemp(join(tmpdir(), 'ncwa-video-hardening-'));
  const path = join(directory, 'fixture.mp4');
  try {
    await execute(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=navy:s=${size}:r=30:d=3`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=3',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        '-use_editlist',
        '0',
        '-shortest',
        ...args,
        path,
      ],
      { timeout: 30000 },
    );
    await check(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function streams(path: string) {
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path]);
  return JSON.parse(stdout).streams;
}

test('Reels menolak H264 chroma 4:4:4 walaupun container MP4 sah', async () => {
  await fixture(['-pix_fmt', 'yuv444p'], async path => {
    assert.equal((await streams(path))[0].pix_fmt, 'yuv444p');
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  });
});
test('Reels menolak AAC sample rate di atas 48 kHz', async () => {
  await fixture(['-ar', '96000'], async path => {
    assert.equal((await streams(path))[1].sample_rate, '96000');
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  });
});
test('Reels menolak AAC lebih dari dua kanal', async () => {
  await fixture(['-ac', '6'], async path => {
    assert.equal((await streams(path))[1].channels, 6);
    await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
  });
});
test('Reels menolak aspek melebihi maksimum Meta 10:1', async () => {
  await fixture(
    [],
    async path => {
      const video = (await streams(path))[0];
      assert(video.width / video.height > 10);
      await assert.rejects(validatePostVideo(path), { code: 'invalid_video' });
    },
    '1920x16',
  );
});

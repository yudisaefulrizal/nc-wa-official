// Penolakan validasi media harus diteruskan; gangguan transport tetap dianggap hasil kirim tidak pasti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../../../src/components/whatsapp/domain/sessions.js';
import { ApiError } from '../../../src/libraries/errors.js';

test('validasi konektor diteruskan tanpa mengubah gangguan jaringan menjadi kegagalan pasti', async () => {
  let failure: Error = new ApiError(400, 'unsupported_caption', 'Kirim caption terpisah');
  const manager = new SessionManager(
    async (_id, update) => {
      update({ status: 'connected' });
      return {
        close() {},
        async logout() {},
        async send() {
          throw failure;
        },
      };
    },
    undefined,
    1000,
    0,
  );
  try {
    await manager.create('image-test');
    await assert.rejects(manager.send('image-test', '17841400000000001@s.whatsapp.net', { text: 'uji' }), {
      code: 'unsupported_caption',
    });
    failure = new Error('connection reset');
    await assert.rejects(manager.send('image-test', '17841400000000001@s.whatsapp.net', { text: 'uji' }), {
      code: 'send_unknown',
    });
  } finally {
    await manager.stop();
  }
});

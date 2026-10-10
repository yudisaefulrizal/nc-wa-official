// Tes slot sesi tambahan dari pemilik: menambah batas sesi paket, bertahan saat reset bulanan dan aktivasi paket,
// dan ditetapkan (bukan ditambahkan) sehingga permintaan berulang aman.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../../src/libraries/db.js';
import { activatePackage, basicWallet } from '../../../src/components/billing/domain/plans.js';
import { setSessionBonus } from '../../../src/components/billing/domain/session-slots.js';

const ids: string[] = [];
after(async () => {
  for (const id of ids) {
    await db.execute('DELETE FROM audit_events WHERE account_id=?', [id]);
    await db.execute('DELETE FROM accounts WHERE id=?', [id]);
  }
  await db.end();
});
async function account() {
  const id = randomUUID();
  ids.push(id);
  await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)', [id, id + '@test.invalid', 'unused']);
  return id;
}

test('Owner bonus slots add to the plan limit and survive the monthly reset and package activation', async () => {
  const now = new Date('2026-08-10T00:00:00Z'),
    id = await account(),
    [plans] = await db.query<RowDataPacket[]>("SELECT session_limit FROM plans WHERE id='basic'"),
    basic = plans[0].session_limit;
  assert.equal((await basicWallet(id, now)).session_limit, basic);
  await setSessionBonus(id, 3, id);
  await setSessionBonus(id, 3, id);
  let wallet = await basicWallet(id, now);
  assert.equal(wallet.session_limit, basic + 3, 'nilai ditetapkan, bukan ditambah dua kali');
  assert.equal(wallet.bonus_sessions, 3);
  wallet = await basicWallet(id, new Date('2026-08-31T17:00:00Z'));
  assert.equal(wallet.session_limit, basic + 3, 'bonus tetap setelah reset bulanan');
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await activatePackage(c, id, 'bonus-' + id, { id: 'pro-test', credits: 10, session_limit: 5 }, new Date());
    await c.commit();
  } finally {
    c.release();
  }
  assert.equal((await basicWallet(id)).session_limit, 8, 'bonus ikut paket berbayar');
  await setSessionBonus(id, 0, id);
  assert.equal((await basicWallet(id)).session_limit, 5);
});

test('Setting bonus slots for an unknown account fails', async () => {
  await assert.rejects(setSessionBonus(randomUUID(), 1, randomUUID()), { message: 'account_not_found' });
});

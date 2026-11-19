// DESIGN §16.2: an average player (the noisy bot) falls — in the first
// 15 nights of a campaign from a fresh save it falls at least twice, and it still gets past Night II with its upgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign } from '../tools/qa/campaign.mjs';

test('DESIGN §16: the noisy bot falls at least twice in its first 15 nights and still clears Night III', () => {
  const c = campaign(4, { save: 'fresh', shop: true, maxNights: 15, policy: 'noisy' });
  console.log(`noisy bot: ${c.seq.join(' ')}`);
  assert.ok(c.falls >= 2, c.seq.join(' '));
  assert.ok(c.firstClear[3], c.seq.join(' '));
});

// DESIGN §16.2: the perfect bot with the shop progresses — a campaign from
// a fresh save (consecutive nights, gold banked, upgrades bought at the camp, a fall restarts at Night I) clears Night V
// within 25 nights. The full tables: docs/CORE.md "Balance campaigns" (`tools/qa/campaign.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign } from '../tools/qa/campaign.mjs';

test('DESIGN §16: the perfect bot\'s campaign from a fresh save clears Night V within 25 nights', () => {
  const c = campaign(1, { save: 'fresh', shop: true, maxNights: 25, policy: 'bot', stopAt: 5 });
  console.log(`perfect bot: ${c.seq.join(' ')}`);
  assert.ok(c.firstClear[5] && c.firstClear[5] <= 25, c.seq.join(' '));
});

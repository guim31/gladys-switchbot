// -----------------------------------------------------------------------------
// The daily call count: per local day, saved under /data, read back after a
// restart the same day only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAUSE_THRESHOLD, createQuota, localDay } from '../src/quota.js';

test('counts per day and resets at midnight', () => {
  let at = new Date(2026, 9, 13, 23, 59).getTime();
  const quota = createQuota({ now: () => at });
  quota.record();
  quota.record();
  assert.equal(quota.used(), 2);
  at = new Date(2026, 9, 14, 0, 1).getTime();
  assert.equal(quota.used(), 0);
  assert.equal(localDay(at), '2026-10-14');
});

test('polling is allowed below 90 % of the quota', () => {
  const quota = createQuota();
  for (let i = 0; i < PAUSE_THRESHOLD - 1; i += 1) {
    quota.record();
  }
  assert.equal(quota.pollingAllowed(), true);
  quota.record();
  assert.equal(quota.pollingAllowed(), false);
});

test('the count is saved under the data folder and read back the same day', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'switchbot-quota-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const at = new Date(2026, 9, 13, 12, 0).getTime();
  const first = createQuota({ dataDir: dir, now: () => at });
  await first.load();
  first.record();
  first.record();
  first.record();
  await first.save();
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'quota.json'), 'utf8')), {
    day: '2026-10-13',
    count: 3,
  });
  const second = createQuota({ dataDir: dir, now: () => at });
  await second.load();
  assert.equal(second.used(), 3);
  const nextDay = createQuota({ dataDir: dir, now: () => at + 86_400_000 });
  await nextDay.load();
  assert.equal(nextDay.used(), 0);
  // A corrupt file is ignored.
  await writeFile(join(dir, 'quota.json'), '{nope');
  const fresh = createQuota({ dataDir: dir, now: () => at });
  await fresh.load();
  assert.equal(fresh.used(), 0);
});

test('an unwritable data folder never breaks the integration', async () => {
  const quota = createQuota({ dataDir: '/nonexistent/readonly', logger: { debug() {} } });
  quota.record();
  await quota.save();
  assert.equal(quota.used(), 1);
});

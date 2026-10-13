// -----------------------------------------------------------------------------
// The container's own polling (src/poller.js) and the quota it keeps to.
//
// The core does not poll external devices reliably (Gladys#3198, still in
// 5.2.1): the states must refresh with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { HEARTBEAT_MS, RETRY_AUTH_MS } from '../src/hub.js';
import { RESTART_BURST } from '../src/poller.js';
import { PAUSE_THRESHOLD, pollPeriodMs } from '../src/quota.js';
import { createWorld } from './helpers/world.js';

const METER = 'F0000000000D';

function clock(start = Date.UTC(2026, 9, 13, 10, 0, 0)) {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

test('states refresh on the container timer, without any onPoll from the core', async (t) => {
  const time = clock();
  const world = await createWorld({ now: time.now, timers: true, tickMs: 5 });
  try {
    const onPoll = t.mock.method(world.hub, 'onPoll');
    assert.equal(world.state(METER, 'temperature'), 21.8);
    world.cloud.statuses[METER].temperature = 23.4;
    // Not due yet: nothing is read.
    await sleep(40);
    assert.equal(world.state(METER, 'temperature'), 21.8);
    time.advance(world.hub.periodFor(world.hub.entries.get(METER)));
    for (let i = 0; i < 100 && world.state(METER, 'temperature') !== 23.4; i += 1) {
      await sleep(10);
    }
    assert.equal(world.state(METER, 'temperature'), 23.4);
    assert.equal(onPoll.mock.callCount(), 0);
  } finally {
    await world.app.stop();
  }
});

test('the pace keeps polling within half of the daily quota', () => {
  assert.equal(pollPeriodMs({ count: 1, chosenMs: null }), 120_000);
  assert.equal(pollPeriodMs({ count: 26, chosenMs: null }), 450_000);
  assert.equal(pollPeriodMs({ count: 26, chosenMs: 60_000 }), 450_000);
  assert.equal(pollPeriodMs({ count: 2, chosenMs: 60_000 }), 60_000);
  assert.equal(pollPeriodMs({ count: 2, chosenMs: 3_600_000 }), 3_600_000);
  for (const count of [1, 5, 26, 80, 300]) {
    const perDay = (86_400_000 / pollPeriodMs({ count, chosenMs: 60_000 })) * count;
    assert.ok(perDay <= 5_000, `${count} devices: ${perDay} calls a day`);
  }
});

test('one tick reads at most two due devices, the longest waiting first', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const before = world.cloud.count('status');
  time.advance(world.hub.basePeriodMs());
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('status') - before, 2);
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('status') - before, 4);
});

test('the core onPoll is skipped while the timer runs, used when it stalls', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const device = world.discovered(METER);
  const before = world.cloud.count('status');
  assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
  assert.equal(world.cloud.count('status'), before);
  time.advance(world.hub.periodFor(world.hub.entries.get(METER)));
  await world.gladys.fake.poll(device);
  assert.equal(world.cloud.count('status'), before + 1);
});

test('only the devices added to Gladys are read', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now, addAll: false });
  assert.equal(world.cloud.count('status'), 0);
  time.advance(3_600_000);
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('status'), 0);
  await world.add(world.discovered(METER));
  assert.equal(world.cloud.count('status'), 1);
  assert.equal(world.state(METER, 'temperature'), 21.8);
});

test('polling pauses near the quota; commands keep going', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  for (let i = world.hub.quota.used(); i < PAUSE_THRESHOLD; i += 1) {
    world.hub.quota.record();
  }
  const before = world.cloud.count('status');
  time.advance(3_600_000);
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('status'), before);
  const plug = world.discovered('F00000000007');
  const ack = await world.gladys.fake.setValue(plug, world.feature('F00000000007', 'power'), 1);
  assert.equal(ack.success, true);
  // The next day, polling resumes.
  time.advance(24 * 3_600_000);
  await world.hub.poller.tick();
  assert.ok(world.cloud.count('status') > before);
});

test('an offline device shows as unreachable, then back to cloud', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const entry = world.hub.entries.get(METER);
  const id = world.discovered(METER).external_id;
  const last = () => world.gladys.fake.transports.filter((t) => t.device_external_id === id).at(-1);
  assert.deepEqual(last(), { device_external_id: id, transport: 'cloud' });
  world.cloud.offline.add(METER);
  await world.hub.refresh(entry);
  assert.equal(last().transport, 'unreachable');
  world.cloud.offline.delete(METER);
  await world.hub.refresh(entry);
  assert.equal(last().transport, 'cloud');
});

test('credentials refused while polling: polling stops, retried later', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  world.cloud.refuseAll = true;
  time.advance(world.hub.basePeriodMs());
  await world.hub.poller.tick();
  assert.equal(world.hub.connection, 'auth');
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  const refused = world.cloud.count('refused');
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('refused'), refused, 'no call before the retry delay');
  world.cloud.refuseAll = false;
  time.advance(RETRY_AUTH_MS);
  await world.hub.poller.tick();
  assert.equal(world.hub.connection, 'ok');
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('only changed values are published, with a heartbeat under 12 hours', async (t) => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const sent = t.mock.method(world.gladys, 'publishChangedStates');
  const count = world.gladys.fake.states.length;
  await world.hub.refresh(world.hub.entries.get(METER));
  assert.equal(world.gladys.fake.states.length, count, 'nothing changed, nothing sent');
  assert.ok(sent.mock.calls.length > 0);
  for (const call of sent.mock.calls) {
    assert.ok(call.arguments[1].heartbeat <= 12 * 3_600_000);
  }
  assert.equal(HEARTBEAT_MS, 6 * 3_600_000);
});

test('a restart reads a first batch at once, the ticks read the others', async () => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const before = world.cloud.count('status');
  await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, poll_interval: '5' });
  assert.equal(world.cloud.count('status') - before, RESTART_BURST);
  for (let i = 0; i < 8; i += 1) {
    await world.hub.poller.tick();
  }
  assert.equal(world.cloud.count('status') - before, 26);
  // Then nothing until the period is over.
  await world.hub.poller.tick();
  assert.equal(world.cloud.count('status') - before, 26);
});

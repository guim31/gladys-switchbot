// -----------------------------------------------------------------------------
// Quiet logs: a normal cycle (reads, states, webhook events, widget) writes
// nothing at info level; a repeated failure writes one line when it starts
// and one when it ends; no credential ever reaches a log line, at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECRET, TOKEN } from './helpers/fakeSwitchBot.js';
import { PLUS_URL, createWorld } from './helpers/world.js';

function captureLogs(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record = (...args) =>
    lines.push(
      args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '),
    );
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.mock.method(console, 'info', record);
  return lines;
}

const clock = () => {
  let at = Date.UTC(2026, 9, 13, 10, 0, 0);
  return { now: () => at, advance: (ms) => (at += ms) };
};

test('a normal cycle writes nothing at info level', async (t) => {
  const time = clock();
  const world = await createWorld({
    now: time.now,
    config: { webhook: true, ir_remotes: true },
    webhooks: {
      available: true,
      webhooks: [{ key: 'events', mode: 'fire_and_forget', url: PLUS_URL }],
    },
  });
  const lines = captureLogs(t, 'info');
  for (let round = 0; round < 3; round += 1) {
    world.cloud.statuses.F0000000000D.temperature += 1;
    world.cloud.statuses.F00000000010.openState = round % 2 ? 'close' : 'open';
    time.advance(world.hub.basePeriodMs());
    for (let tick = 0; tick < 14; tick += 1) {
      await world.hub.poller.tick();
    }
    await world.gladys.fake.webhook('events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'changeReport',
        eventVersion: '1',
        context: { deviceType: 'WoContact', deviceMac: 'F00000000010', openState: 'open' },
      }),
      contentType: 'application/json',
    });
    await world.runDelayed();
    await world.gladys.fake.widgetGet('overview', { language: 'fr' });
    await world.gladys.fake.poll(world.discovered('F0000000000D'));
  }
  assert.ok(world.cloud.count('status') > 30);
  assert.deepEqual(lines, []);
});

test('a repeated failure logs once, then once more when it ends', async (t) => {
  const time = clock();
  const world = await createWorld({ now: time.now });
  const lines = captureLogs(t, 'info');
  const entry = world.hub.entries.get('F0000000000D');
  world.cloud.offline.add('F0000000000D');
  for (let i = 0; i < 5; i += 1) {
    await world.hub.refresh(entry);
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[WARN\].*Thermomètre chambre: the device is offline/);
  world.cloud.offline.delete('F0000000000D');
  await world.hub.refresh(entry);
  await world.hub.refresh(entry);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /\[INFO\].*Thermomètre chambre: answers again/);
});

test('no credential appears in the logs, at any level, whatever happens', async (t) => {
  const lines = captureLogs(t, 'debug');
  const time = clock();
  const world = await createWorld({
    now: time.now,
    config: { webhook: true, ir_remotes: true, lock_control: true },
    webhooks: {
      available: true,
      webhooks: [{ key: 'events', mode: 'fire_and_forget', url: PLUS_URL }],
    },
  });
  // Commands, scene actions, a webhook event, a failing device, refused
  // credentials, a new configuration, a network outage.
  await world.gladys.fake.setValue(
    world.discovered('F00000000013'),
    world.feature('F00000000013', 'power'),
    0,
  );
  await world.gladys.fake.sceneAction('press_bot', {
    device: world.discovered('F00000000003').external_id,
  });
  await world.gladys.fake.sceneAction('send_ir_command', {
    device: 'ext:test-integration:remote:02-202301010000-01',
    command: 'volumeAdd',
  });
  await world.gladys.fake.webhook('events', {
    method: 'POST',
    body: '{"eventType":"changeReport","context":{"deviceMac":"F00000000011"}}',
  });
  await world.runDelayed();
  world.cloud.offline.add('F00000000011');
  await world.hub.refresh(world.hub.entries.get('F00000000011'));
  world.cloud.refuseAll = true;
  await world.gladys.fake.action('check_connection');
  world.cloud.refuseAll = false;
  await world.gladys.fake.configUpdated({
    token: TOKEN,
    secret: SECRET,
    webhook: false,
    language: 'en',
  });
  world.cloud.down = true;
  time.advance(3_600_000);
  await world.hub.poller.tick();
  await world.gladys.fake.action('check_connection');
  await world.app.stop();

  assert.ok(lines.length > 20, `only ${lines.length} log lines`);
  const leaks = lines.filter(
    (line) => line.includes(TOKEN) || line.includes(SECRET) || line.includes('open-api-key-secret'),
  );
  assert.deepEqual(leaks, []);
});

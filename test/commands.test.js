// -----------------------------------------------------------------------------
// Commands from Gladys: the API call, the expected state published at once
// (the core does not save the value of a feature with feedback), the read a
// few seconds later, and a clear failure when SwitchBot refuses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_REFRESH_MS, COVER_REFRESH_MS } from '../src/hub.js';
import { createWorld } from './helpers/world.js';

test('turning a light off: command, expected state, read again later', async () => {
  const world = await createWorld();
  const id = 'F00000000013';
  const reads = world.cloud.count('status');
  const ack = await world.gladys.fake.setValue(world.discovered(id), world.feature(id, 'power'), 0);
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(world.cloud.commands.at(-1), {
    id,
    command: 'turnOff',
    parameter: 'default',
    commandType: 'command',
  });
  assert.equal(world.state(id, 'power'), 0);
  assert.equal(world.delayed.length, 1);
  assert.equal(world.delayed[0].ms, COMMAND_REFRESH_MS);
  world.cloud.statuses[id].power = 'off';
  await world.runDelayed();
  assert.equal(world.cloud.count('status'), reads + 1);
  assert.equal(world.state(id, 'power'), 0);
});

test('a curtain is read again later than other devices (it takes time to move)', async () => {
  const world = await createWorld();
  const id = 'F00000000008';
  await world.gladys.fake.setValue(world.discovered(id), world.feature(id, 'position'), 40);
  assert.deepEqual(world.cloud.commands.at(-1), {
    id,
    command: 'setPosition',
    parameter: '0,ff,60',
    commandType: 'command',
  });
  assert.equal(world.state(id, 'position'), 40);
  assert.equal(world.delayed[0].ms, COVER_REFRESH_MS);
});

test('a fan speed in another mode switches it to direct first', async () => {
  const world = await createWorld();
  const id = 'F0000000001A';
  world.cloud.statuses[id].mode = 'sleep';
  await world.hub.refresh(world.hub.entries.get(id));
  await world.gladys.fake.setValue(world.discovered(id), world.feature(id, 'fan-speed'), 60);
  assert.deepEqual(
    world.cloud.commands.slice(-2).map((c) => [c.command, c.parameter]),
    [
      ['setWindMode', 'direct'],
      ['setWindSpeed', 60],
    ],
  );
});

test('a refused command fails the ack with the reason, and marks an offline device', async () => {
  const world = await createWorld();
  const id = 'F00000000007';
  world.cloud.offline.add(id);
  const ack = await world.gladys.fake.setValue(world.discovered(id), world.feature(id, 'power'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Prise lampe: the device is offline/);
  const transport = world.gladys.fake.transports
    .filter((t) => t.device_external_id.endsWith(id))
    .at(-1);
  assert.equal(transport.transport, 'unreachable');
  assert.equal(world.delayed.length, 0);
});

test('a read-only feature cannot be controlled', async () => {
  const world = await createWorld();
  const id = 'F0000000000D';
  const ack = await world.gladys.fake.setValue(
    world.discovered(id),
    world.feature(id, 'temperature'),
    3,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /cannot be controlled/);
  assert.equal(world.cloud.count('command'), 0);
});

test('a lock cannot be unlocked when the option is off', async () => {
  const on = await createWorld({ config: { lock_control: true } });
  const id = 'F0000000000B';
  const lockFeature = on.feature(id, 'lock');
  assert.equal(lockFeature.read_only, false);
  assert.deepEqual(await on.gladys.fake.setValue(on.discovered(id), lockFeature, 1), {
    success: true,
  });
  assert.equal(on.cloud.commands.at(-1).command, 'lock');

  // The option turned off after the lock was added: the feature still
  // exists in Gladys, the command is refused.
  await on.gladys.fake.configUpdated({ ...on.gladys.fake.config, lock_control: false });
  const ack = await on.gladys.fake.setValue(on.discovered(id), lockFeature, 0);
  assert.equal(ack.success, false);
  assert.equal(on.cloud.commands.at(-1).command, 'lock');
});

test('an IR remote power button sends the standard command', async () => {
  const world = await createWorld({ config: { ir_remotes: true } });
  const device = world.gladys.fake.discoveredDevices.find((d) =>
    d.external_id.endsWith(':02-202301010000-01'),
  );
  const feature = device.features.find((f) => f.external_id.endsWith(':power'));
  assert.equal(feature.has_feedback, false);
  assert.deepEqual(await world.gladys.fake.setValue(device, feature, 1), { success: true });
  assert.deepEqual(world.cloud.commands.at(-1), {
    id: '02-202301010000-01',
    command: 'turnOn',
    parameter: 'default',
    commandType: 'command',
  });
  // An "Others" remote has no power button.
  const others = world.gladys.fake.discoveredDevices.find((d) =>
    d.external_id.endsWith(':02-202301010000-03'),
  );
  assert.deepEqual(
    others.features.map((f) => f.external_id.split(':').pop()),
    ['last-command'],
  );
});

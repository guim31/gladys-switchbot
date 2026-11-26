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

test('the deadbolt button retracts the deadbolt only, and needs the option', async () => {
  const on = await createWorld({ config: { lock_control: true } });
  const id = 'F0000000000B';
  const deadbolt = on.feature(id, 'deadbolt');
  assert.equal(deadbolt.category, 'button');
  assert.equal(deadbolt.type, 'push');
  assert.equal(deadbolt.read_only, false);
  // The fixture lock reads unlocked: the deadbolt is already retracted, and
  // `deadbolt` sent then made an Ultra Max try to lock. Nothing is sent, and
  // nothing fails either: the lock is where it was asked to be.
  const already = await on.gladys.fake.setValue(on.discovered(id), deadbolt, 1);
  assert.equal(already.success, true);
  assert.equal(on.cloud.count('command'), 0);
  // Locked (read again after a lock command): the deadbolt retracts.
  await on.gladys.fake.setValue(on.discovered(id), on.feature(id, 'lock'), 1);
  on.cloud.statuses[id].lockState = 'lock';
  await on.runDelayed();
  const ack = await on.gladys.fake.setValue(on.discovered(id), deadbolt, 1);
  assert.equal(ack.success, true);
  assert.equal(on.cloud.commands.at(-1).command, 'deadbolt');
  await on.gladys.fake.configUpdated({ ...on.gladys.fake.config, lock_control: false });
  const refused = await on.gladys.fake.setValue(on.discovered(id), deadbolt, 1);
  assert.equal(refused.success, false);
  assert.equal(on.cloud.count('command'), 2);
});

test('a lock command refused with a device error (190) is sent once more, then fails in red', async () => {
  const on = await createWorld({ config: { lock_control: true } });
  const id = 'F0000000000B';
  const lockFeature = on.feature(id, 'lock');
  // Accepted as a request, refused by the lock: the result is in the items.
  on.cloud.commandItemCodes.push(190);
  const ack = await on.gladys.fake.setValue(on.discovered(id), lockFeature, 1);
  assert.equal(ack.success, true);
  assert.equal(on.cloud.count('command'), 2);

  on.cloud.commandItemCodes.push(190, 190);
  const failed = await on.gladys.fake.setValue(on.discovered(id), lockFeature, 1);
  assert.equal(failed.success, false);
  assert.match(String(failed.error?.en ?? failed.error), /190/);
  assert.equal(on.cloud.count('command'), 4);
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

test('a device error is never retried on a non-idempotent command (deadbolt)', async () => {
  const on = await createWorld({ config: { lock_control: true } });
  const id = 'F0000000000B';
  on.cloud.statuses[id].lockState = 'lock';
  on.cloud.commandItemCodes.push(190);
  const ack = await on.gladys.fake.setValue(on.discovered(id), on.feature(id, 'deadbolt'), 1);
  assert.equal(ack.success, false);
  assert.equal(on.cloud.count('command'), 1);
});

/** The fixture lock turned into a Lock Ultra Max, deadbolt thrown, door sensor wrong. */
function ultraMax(lockState = 'locked') {
  return (cloud) => {
    const device = cloud.deviceList.deviceList.find((d) => d.deviceId === 'F0000000000B');
    device.deviceType = 'Smart Lock Ultra Max';
    Object.assign(cloud.statuses.F0000000000B, {
      deviceType: 'Smart Lock Ultra Max',
      lockState,
      // The app shows the door open while it is closed (forum, 26/11/2026).
      doorState: 'opened',
    });
  };
}

test('Lock Ultra Max: unlocking never opens the door (deadbolt, not unlock)', async () => {
  const on = await createWorld({ config: { lock_control: true }, prepare: ultraMax() });
  const id = 'F0000000000B';
  const lockFeature = on.feature(id, 'lock');
  assert.ok(!on.discovered(id).features.some((f) => f.external_id.endsWith(':open-door')));
  const ack = await on.gladys.fake.setValue(on.discovered(id), lockFeature, 0);
  assert.equal(ack.success, true);
  assert.deepEqual(
    on.cloud.commands.map((c) => c.command),
    ['deadbolt'],
  );
  assert.equal(on.state(id, 'lock'), 0);

  // Unlocked now (deadbolt retracted, latch holding): pressing "unlock" or
  // the deadbolt button again sends nothing and shows no error.
  on.cloud.statuses[id].lockState = 'latchBoltLocked';
  await on.runDelayed();
  for (const feature of [lockFeature, on.feature(id, 'deadbolt')]) {
    const again = await on.gladys.fake.setValue(on.discovered(id), feature, 0);
    assert.equal(again.success, true);
  }
  assert.equal(on.cloud.count('command'), 1);

  // Locking goes through, door sensor "open" or not.
  const locked = await on.gladys.fake.setValue(on.discovered(id), lockFeature, 1);
  assert.equal(locked.success, true);
  assert.equal(on.cloud.commands.at(-1).command, 'lock');
});

test('Lock Ultra Max: a deadbolt refused on the lock is not sent again (it toggles)', async () => {
  const on = await createWorld({ config: { lock_control: true }, prepare: ultraMax() });
  const id = 'F0000000000B';
  on.cloud.commandItemCodes.push(190);
  const ack = await on.gladys.fake.setValue(on.discovered(id), on.feature(id, 'lock'), 0);
  assert.equal(ack.success, false);
  assert.equal(on.cloud.count('command'), 1);
});

test('Lock Ultra Max: a refused lock says the door may be open', async () => {
  const on = await createWorld({
    config: { lock_control: true },
    prepare: ultraMax('latchBoltLocked'),
  });
  const id = 'F0000000000B';
  on.cloud.commandItemCodes.push(190, 190);
  const ack = await on.gladys.fake.setValue(on.discovered(id), on.feature(id, 'lock'), 1);
  assert.equal(ack.success, false);
  assert.match(String(ack.error?.en ?? ack.error), /door may be open/);
  assert.equal(on.cloud.count('command'), 2);
});

test('Lock Ultra Max: "Open the door" sends unlock, only with its own option', async () => {
  const off = await createWorld({ config: { lock_control: true }, prepare: ultraMax() });
  assert.equal(off.feature('F0000000000B', 'open-door'), undefined);

  const on = await createWorld({
    config: { lock_control: true, lock_open: true },
    prepare: ultraMax(),
  });
  const id = 'F0000000000B';
  const open = on.feature(id, 'open-door');
  assert.equal(open.category, 'button');
  assert.equal(open.type, 'push');
  const ack = await on.gladys.fake.setValue(on.discovered(id), open, 1);
  assert.equal(ack.success, true);
  assert.equal(on.cloud.commands.at(-1).command, 'unlock');

  // The option turned off afterwards: the button stays in Gladys, refused.
  await on.gladys.fake.configUpdated({ ...on.gladys.fake.config, lock_open: false });
  const refused = await on.gladys.fake.setValue(on.discovered(id), open, 1);
  assert.equal(refused.success, false);
  assert.equal(on.cloud.count('command'), 1);
});

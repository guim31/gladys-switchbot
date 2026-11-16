// -----------------------------------------------------------------------------
// The "Device diagnostics" action: raw statuses, identifiers masked, names
// and credentials never shown, failures thrown (red in Gladys).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEVICES, maskIds } from '../src/diagnostic.js';
import { SECRET, TOKEN } from './helpers/fakeSwitchBot.js';
import { createWorld } from './helpers/world.js';

const ULTRA_MAX = {
  deviceId: 'F000000000F1',
  deviceName: 'Porte de Jean',
  deviceType: 'Smart Lock Ultra Max',
  enableCloudService: true,
  hubDeviceId: 'F00000000001',
  group: false,
  master: true,
  groupName: 'Jean',
  lockDevicesIds: ['F000000000F1'],
};

test('identifiers become aliases, the same id the same alias, names dropped', () => {
  const aliases = new Map();
  const entry = maskIds(ULTRA_MAX, aliases);
  assert.deepEqual(entry, {
    deviceId: '#1',
    deviceType: 'Smart Lock Ultra Max',
    enableCloudService: true,
    hubDeviceId: '#2',
    group: false,
    master: true,
    lockDevicesIds: ['#1'],
  });
  const status = maskIds(
    { deviceId: 'F000000000F1', deviceMac: 'f0:00:00:00:00:f1', lockState: 'latchBoltLocked' },
    aliases,
  );
  assert.deepEqual(status, { deviceId: '#1', deviceMac: '#1', lockState: 'latchBoltLocked' });
});

test('the raw status of every device, read only, nothing private', async () => {
  const world = await createWorld();
  world.cloud.deviceList.deviceList.unshift(ULTRA_MAX);
  world.cloud.statuses.F000000000F1 = {
    deviceId: 'F000000000F1',
    deviceType: 'Smart Lock Ultra Max',
    hubDeviceId: 'F00000000001',
    battery: 90,
    version: 'V1.2',
    lockState: 'latchBoltLocked',
    doorState: 'close',
    calibrate: true,
  };
  world.cloud.offline.add(world.cloud.deviceList.deviceList[1].deviceId);
  const total = world.cloud.deviceList.deviceList.length;
  const lists = world.cloud.count('list');
  const statuses = world.cloud.count('status');
  const commands = world.cloud.count('command');

  const ack = await world.gladys.fake.action('device_diagnostics');
  assert.equal(ack.success, true);
  const { message } = ack.data;
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
  assert.equal(world.cloud.count('list'), lists + 1);
  assert.equal(world.cloud.count('status'), statuses + MAX_DEVICES);
  assert.equal(world.cloud.count('command'), commands);
  assert.match(message.en, new RegExp(`^${MAX_DEVICES} of ${total} SwitchBot device`));
  assert.match(message.en, /#1 Smart Lock Ultra Max \(supported\)/);
  assert.match(message.en, /"lockState":"latchBoltLocked","doorState":"close"/);
  assert.match(message.en, /status: the SwitchBot hub is offline|status: the device is offline/);
  assert.match(message.fr, /Identifiants masqués/);
  for (const text of Object.values(message)) {
    assert.ok(!/F0000000/i.test(text), 'a device id leaked');
    assert.ok(!text.includes('Porte de Jean') && !text.includes(TOKEN) && !text.includes(SECRET));
  }
});

test('nothing to read, refused credentials, not configured: thrown, in red', async () => {
  const world = await createWorld({ addAll: false });
  world.cloud.refuseAll = true;
  let ack = await world.gladys.fake.action('device_diagnostics');
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /SwitchBot refuse les identifiants/);

  world.cloud.refuseAll = false;
  for (const raw of world.cloud.deviceList.deviceList) {
    world.cloud.offline.add(raw.deviceId);
  }
  ack = await world.gladys.fake.action('device_diagnostics');
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /Aucun appareil n'a répondu/);

  world.cloud.deviceList.deviceList = [];
  ack = await world.gladys.fake.action('device_diagnostics');
  assert.equal(ack.success, false);
  assert.match(ack.error.es, /no tiene ningún dispositivo/);

  const empty = await createWorld({ configured: false });
  ack = await empty.gladys.fake.action('device_diagnostics');
  assert.equal(ack.success, false);
  assert.match(ack.error.de, /Gib das Token/);
});

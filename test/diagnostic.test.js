// -----------------------------------------------------------------------------
// The "Device diagnostics" action: raw statuses, identifiers masked, names
// and credentials never shown, failures thrown (red in Gladys).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASKED, MAX_DEVICES, maskIds, scrubString } from '../src/diagnostic.js';
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

test('a camera: a presigned image link keeps only its host, tokens masked at any depth', () => {
  // Hand-written, shaped like the status of an outdoor camera: the link
  // grants access to the picture on its own until it expires.
  const link =
    'https://example-bucket.s3.eu-west-1.amazonaws.com/cam/F000000000F5/latest.jpg' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20261122' +
    '&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEXAMPLEtokenEXAMPLEtokenEXAMPLE' +
    '&X-Amz-Signature=0123456789abcdef0123456789abcdef0123456789abcdef';
  const masked = maskIds({
    deviceId: 'F000000000F5',
    deviceType: 'Outdoor PTC 3K',
    latestImage: { imageUrl: link, expireAt: 1795302317 },
    nested: [{ deep: { note: `see ${link} now` } }],
    accessToken: 'abc',
    sessionKey: 'abc',
    authMode: 'fingerprint',
    sessionCount: 3,
    [`${link}`]: 1,
    bare: link.replace('https://', ''),
    query: 'X-Amz-Security-Token=short&X-Amz-Signature=abc&size=2',
    sentence: 'token IQoJb3JpZ2luX2VjEXAMPLEtokenEXAMPLEtokenEXAMPLE here',
    blob: 'dGhpcyBpcyBhIHZlcnkgbG9uZyB0b2tlbi1saWtlIHN0cmluZw==',
  });
  const text = JSON.stringify(masked);
  for (const leak of ['Signature=0123', 'AWS4', 'IQoJ', 'AKIA', 'latest.jpg', 'F000000000F5']) {
    assert.ok(!text.includes(leak), `${leak} leaked`);
  }
  assert.equal(masked.latestImage.imageUrl, '<url example-bucket.s3.eu-west-1.amazonaws.com>');
  assert.equal(masked.latestImage.expireAt, 1795302317);
  assert.equal(
    masked.nested[0].deep.note,
    'see <url example-bucket.s3.eu-west-1.amazonaws.com> now',
  );
  assert.equal(masked.accessToken, undefined);
  assert.equal(masked.sessionKey, MASKED);
  assert.equal(masked.blob, MASKED);
  assert.equal(masked.authMode, 'fingerprint');
  assert.equal(masked.sessionCount, 3);
  assert.equal(masked.bare, '<url example-bucket.s3.eu-west-1.amazonaws.com>');
  assert.equal(masked.query, `X-Amz-Security-Token=${MASKED}&X-Amz-Signature=${MASKED}&size=2`);
  assert.equal(masked.sentence, `token ${MASKED} here`);
  assert.ok('<url example-bucket.s3.eu-west-1.amazonaws.com>' in masked);
  // Ordinary values are left alone.
  assert.equal(scrubString('255:97:0'), '255:97:0');
  assert.equal(scrubString('V0.9-0.9'), 'V0.9-0.9');
  assert.equal(scrubString('latchBoltLocked'), 'latchBoltLocked');
});

test('a Keypad: no passcode, no key name, no key id', () => {
  const masked = maskIds({
    deviceId: 'F000000000F3',
    deviceName: 'Clavier',
    deviceType: 'Keypad Vision Pro',
    lockDeviceId: 'F000000000F1',
    keyList: [
      { id: 3, name: 'Code de Mamie', type: 'permanent', password: 'c2VjcmV0', iv: 'aXY=' },
    ],
    MAC: 'F0:00:00:00:00:F3',
  });
  assert.deepEqual(masked, {
    deviceId: '#1',
    deviceType: 'Keypad Vision Pro',
    lockDeviceId: '#2',
    MAC: '#1',
  });
});

test('the locks come first, beyond the 20-device cap', async () => {
  const world = await createWorld();
  world.cloud.deviceList.deviceList.push(ULTRA_MAX);
  const { data } = await world.gladys.fake.action('device_diagnostics');
  assert.match(data.message.en, /\n\n#1 Smart Lock Pro \(supported\)/);
  assert.match(data.message.en, /Smart Lock Ultra Max \(supported\)/);
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
  assert.match(message.en, /\n\n#1 Smart Lock Ultra Max \(supported\)/);
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

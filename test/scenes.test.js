// -----------------------------------------------------------------------------
// Scene triggers (fired on transitions only) and scene actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRIGGER_KEYS, detectEvents } from '../src/events.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const events = (world) => world.gladys.fake.sceneEvents;
const refresh = (world, id) => world.hub.refresh(world.hub.entries.get(id));

test('a start never replays an event', async () => {
  const world = await createWorld();
  assert.deepEqual(events(world), []);
});

test('contact sensor: open, left open, closed — with the device and its name', async () => {
  const world = await createWorld();
  const id = 'F00000000010';
  const device = world.discovered(id).external_id;
  for (const openState of ['open', 'timeOutNotClose', 'close', 'close']) {
    world.cloud.statuses[id].openState = openState;
    await refresh(world, id);
  }
  const contact = events(world).filter((e) => e.key === 'contact_changed');
  assert.deepEqual(
    contact.map((e) => e.data),
    [
      { device, device_name: 'Fenêtre cuisine', state: 'open' },
      { device, device_name: 'Fenêtre cuisine', state: 'left_open' },
      { device, device_name: 'Fenêtre cuisine', state: 'closed' },
    ],
  );
});

test('motion and leak fire when they start, not while they last', async () => {
  const world = await createWorld();
  world.cloud.statuses.F00000000011.moveDetected = true;
  world.cloud.statuses.F00000000012.status = 1;
  for (let i = 0; i < 2; i += 1) {
    await refresh(world, 'F00000000011');
    await refresh(world, 'F00000000012');
  }
  assert.deepEqual(
    events(world).map((e) => [e.key, e.data.device_name]),
    [
      ['motion_detected', 'Couloir'],
      ['leak_detected', 'Salle de bain'],
    ],
  );
});

test('battery low: once below 20 %, re-armed above 30 %', async () => {
  const world = await createWorld();
  const id = 'F0000000000D'; // Meter, 100 %
  for (const battery of [60, 20, 10, 20, 60, 10]) {
    world.cloud.statuses[id].battery = battery;
    await refresh(world, id);
  }
  const low = events(world).filter((e) => e.key === 'battery_low');
  assert.deepEqual(
    low.map((e) => e.data.battery),
    [20, 10],
  );
  assert.equal(low[0].data.device_name, 'Thermomètre chambre');
  // A device already low at start does not fire.
  assert.deepEqual(
    events(world).filter((e) => e.data.device_name === 'Extérieur'),
    [],
  );
});

test('every fired key is declared, with the fields and variables the data carries', () => {
  const declared = new Map((manifest.scene_triggers ?? []).map((t) => [t.key, t]));
  assert.deepEqual([...declared.keys()].sort(), [...TRIGGER_KEYS].sort());
  const identity = { device: 'ext:x:device:1', device_name: 'D' };
  const samples = [
    ...detectEvents({ contact: 'closed' }, { contact: 'open' }, identity),
    ...detectEvents({ motion: 0 }, { motion: 1 }, identity),
    ...detectEvents({ leak: 0 }, { leak: 1 }, identity),
    ...detectEvents({ batteryLow: false }, { batteryLow: true, battery: 15 }, identity),
  ];
  assert.equal(samples.length, 4);
  for (const { key, data } of samples) {
    const trigger = declared.get(key);
    const keys = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    for (const key2 of keys) {
      assert.ok(key2 in data, `${key}: "${key2}" missing from the event data`);
    }
    for (const value of Object.values(data)) {
      assert.ok(['string', 'number'].includes(typeof value));
    }
  }
});

test('scene action press_bot presses the chosen Bot, refuses another device', async () => {
  const world = await createWorld();
  const bot = world.discovered('F00000000004').external_id;
  assert.deepEqual(await world.gladys.fake.sceneAction('press_bot', { device: bot }), {
    success: true,
  });
  assert.deepEqual(world.cloud.commands.at(-1), {
    id: 'F00000000004',
    command: 'press',
    parameter: 'default',
    commandType: 'command',
  });
  const plug = world.discovered('F00000000007').external_id;
  const ack = await world.gladys.fake.sceneAction('press_bot', { device: plug });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Bot/);
});

test('scene action send_ir_command: standard, with parameter, custom button', async () => {
  const world = await createWorld({ config: { ir_remotes: true } });
  const tv = 'ext:test-integration:remote:02-202301010000-01';
  const ac = 'ext:test-integration:remote:02-202301010000-02';
  await world.gladys.fake.sceneAction('send_ir_command', { device: tv, command: 'volumeAdd' });
  await world.gladys.fake.sceneAction('send_ir_command', {
    device: ac,
    command: 'setAll',
    parameter: '26,1,3,on',
  });
  await world.gladys.fake.sceneAction('send_ir_command', { device: tv, command: ' Netflix ' });
  assert.deepEqual(
    world.cloud.commands.slice(-3).map((c) => [c.id, c.command, c.parameter, c.commandType]),
    [
      ['02-202301010000-01', 'volumeAdd', 'default', 'command'],
      ['02-202301010000-02', 'setAll', '26,1,3,on', 'command'],
      ['02-202301010000-01', 'Netflix', 'default', 'customize'],
    ],
  );
  assert.equal(world.gladys.fake.lastState(`${tv}:last-command`), 'Netflix');
  const empty = await world.gladys.fake.sceneAction('send_ir_command', { device: tv, command: '' });
  assert.equal(empty.success, false);
  const notRemote = await world.gladys.fake.sceneAction('send_ir_command', {
    device: world.discovered('F00000000004').external_id,
    command: 'turnOn',
  });
  assert.equal(notRemote.success, false);
});

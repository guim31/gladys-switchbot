// -----------------------------------------------------------------------------
// Device kinds: what each documented status becomes in Gladys, and what each
// Gladys command becomes for the SwitchBot API. The traps are pinned here:
// an opening sensor reads 0 when OPEN, a SwitchBot curtain counts 0 = open,
// a Blind Tilt is open at 50, the current is in amperes, colour temperatures
// in mireds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { entriesOf, kindOf, SUPPORTED_TYPES } from '../src/devices/index.js';
import { OPENING_SENSOR_STATE, LOCK_STATE, VACUUM_CLEANER_STATE } from '../src/devices/features.js';
import { irCommand } from '../src/devices/remote.js';
import { DEVICE_LIST, STATUSES } from './helpers/fakeSwitchBot.js';

const raw = (id) => DEVICE_LIST.body.deviceList.find((device) => device.deviceId === id);
const statesOf = (id, status = STATUSES[id]) => kindOf(raw(id).deviceType).states(status, raw(id));
const commandOf = (id, key, value, extra = {}) =>
  kindOf(raw(id).deviceType).command({
    key,
    value,
    device: raw(id),
    status: STATUSES[id],
    config: normalizeConfig({ lock_control: true }),
    ...extra,
  });

test('the catalog keeps the supported devices, and the remotes only on demand', () => {
  const without = entriesOf(DEVICE_LIST.body, normalizeConfig());
  assert.equal(without.length, 26);
  assert.ok(!without.some((entry) => ['Hub Mini', 'Indoor Cam'].includes(entry.raw.deviceType)));
  assert.equal(without.filter((entry) => entry.remote).length, 0);
  const withRemotes = entriesOf(DEVICE_LIST.body, normalizeConfig({ ir_remotes: true }));
  assert.equal(withRemotes.filter((entry) => entry.remote).length, 3);
  // No type is claimed by two kinds.
  assert.equal(new Set(SUPPORTED_TYPES).size, SUPPORTED_TYPES.length);
});

test('a contact sensor reads 0 when open, 1 when closed, and left open is open', () => {
  assert.equal(OPENING_SENSOR_STATE.OPEN, 0);
  assert.equal(OPENING_SENSOR_STATE.CLOSE, 1);
  const id = 'F00000000010';
  assert.equal(statesOf(id).contact, 1); // fixture: "close"
  assert.equal(statesOf(id, { ...STATUSES[id], openState: 'open' }).contact, 0);
  assert.equal(statesOf(id, { ...STATUSES[id], openState: 'timeOutNotClose' }).contact, 0);
  assert.equal(statesOf(id, { ...STATUSES[id], openState: 'weird' }).contact, undefined);
  assert.equal(statesOf(id).motion, 0);
  assert.equal(statesOf(id).battery, 60);
});

test('a lock reads its state and its door, both spellings', () => {
  const pro = 'F0000000000B';
  assert.deepEqual(statesOf(pro), { lock: 0, 'lock-state': 0, door: 0, battery: 100 });
  const closed = statesOf(pro, { ...STATUSES[pro], lockState: 'LOCKED', doorState: 'closed' });
  assert.equal(closed['lock-state'], LOCK_STATE.LOCKED);
  assert.equal(closed.door, OPENING_SENSOR_STATE.CLOSE);
  assert.equal(
    statesOf(pro, { ...STATUSES[pro], lockState: 'jammed' })['lock-state'],
    LOCK_STATE.ERROR,
  );
  assert.equal(statesOf(pro, { ...STATUSES[pro], lockState: 'jammed' }).lock, undefined);
  assert.equal(
    statesOf(pro, { ...STATUSES[pro], lockState: 'locking' })['lock-state'],
    LOCK_STATE.ACTIVITY,
  );
  // The Lock Lite has no door sensor.
  assert.equal(statesOf('F0000000000C').door, undefined);
  assert.equal(statesOf('F0000000000C')['lock-state'], LOCK_STATE.LOCKED);
});

test('a lock is controllable only with the option on', () => {
  const pro = 'F0000000000B';
  const kind = kindOf('Smart Lock Pro');
  const keys = (config) =>
    kind.features(raw(pro), { config: normalizeConfig(config) }).map((f) => f.key);
  assert.deepEqual(keys({}), ['lock-state', 'battery', 'door']);
  assert.deepEqual(keys({ lock_control: true }), [
    'lock',
    'deadbolt',
    'lock-state',
    'battery',
    'door',
  ]);
  assert.equal(commandOf(pro, 'lock', 1, { config: normalizeConfig() }), null);
  assert.equal(commandOf(pro, 'deadbolt', 1, { config: normalizeConfig() }), null);
  assert.deepEqual(commandOf(pro, 'lock', 1).commands, [{ command: 'lock' }]);
  assert.deepEqual(commandOf(pro, 'lock', 0).commands, [{ command: 'unlock' }]);
  // Already unlocked: `deadbolt` would toggle the lock, nothing is sent and
  // the command succeeds (the lock is where it was asked to be).
  assert.deepEqual(commandOf(pro, 'deadbolt', 1), { commands: [], expected: { lock: 0 } });
  // `unlock` keeps opening nothing more than the lock on a Pro.
  assert.equal(commandOf(pro, 'lock', 0).retryDeviceError, true);
  // No "open the door" button on a Pro, even with both options.
  const both = { config: normalizeConfig({ lock_control: true, lock_open: true }) };
  assert.ok(!kind.features(raw(pro), both).some((f) => f.key === 'open-door'));
  assert.equal(commandOf(pro, 'open-door', 1, both), null);
  const locked = { status: { ...STATUSES[pro], lockState: 'lock' } };
  assert.deepEqual(commandOf(pro, 'deadbolt', 1, locked), {
    commands: [{ command: 'deadbolt' }],
    expected: { lock: 0 },
  });
});

// The Lock Ultra Max of a user (forum, 16/11/2026) read "locked" for good and
// could only be unlocked: its resting state once unlocked is
// `latchBoltLocked`, read as locked by 1.0. Statuses written from the
// SwitchBot documentation of the Lock Ultra Max (no capture of the real one).
const ULTRA_MAX = {
  deviceId: 'F000000000F1',
  deviceName: 'Entrée',
  deviceType: 'Smart Lock Ultra Max',
  enableCloudService: true,
  hubDeviceId: 'F000000000F2',
  group: false,
  master: true,
  groupName: null,
  lockDevicesIds: ['F000000000F1'],
};
const ultraStatus = (lockState, doorState) => ({
  deviceId: 'F000000000F1',
  deviceType: 'Smart Lock Ultra Max',
  hubDeviceId: 'F000000000F2',
  battery: 90,
  version: 'V1.2',
  lockState,
  doorState,
  calibrate: true,
});

test('a Lock Ultra Max: every documented lock state, any case, and its door', () => {
  const kind = kindOf('Smart Lock Ultra Max');
  assert.equal(kind.kind, 'lock');
  const read = (lockState, doorState = 'close') =>
    kind.states(ultraStatus(lockState, doorState), ULTRA_MAX);
  const cases = {
    locked: [1, 1],
    LOCKED: [1, 1],
    lock: [1, 1],
    unlocked: [0, 0],
    UNLOCKED: [0, 0],
    unlock: [0, 0],
    latchBoltLocked: [0, 0],
    LATCHBOLTLOCKED: [0, 0],
    locking: [undefined, LOCK_STATE.ACTIVITY],
    unlocking: [undefined, LOCK_STATE.ACTIVITY],
    jammed: [undefined, LOCK_STATE.ERROR],
    JAMMED: [undefined, LOCK_STATE.ERROR],
    halfLocked: [undefined, LOCK_STATE.ERROR],
    somethingNew: [undefined, undefined],
  };
  for (const [lockState, [lock, state]] of Object.entries(cases)) {
    assert.equal(read(lockState).lock, lock, lockState);
    assert.equal(read(lockState)['lock-state'], state, lockState);
  }
  for (const [doorState, door] of Object.entries({
    open: OPENING_SENSOR_STATE.OPEN,
    OPEN: OPENING_SENSOR_STATE.OPEN,
    opened: OPENING_SENSOR_STATE.OPEN,
    close: OPENING_SENSOR_STATE.CLOSE,
    CLOSE: OPENING_SENSOR_STATE.CLOSE,
    closed: OPENING_SENSOR_STATE.CLOSE,
    Closed: OPENING_SENSOR_STATE.CLOSE,
    unknown: undefined,
  })) {
    assert.equal(read('locked', doorState).door, door, doorState);
  }
  assert.equal(read('locked').battery, 90);
  // Elsewhere, latchBoltLocked keeps the Home Assistant reading until a
  // diagnostic shows otherwise.
  const pro = kindOf('Smart Lock Pro').states(ultraStatus('latchBoltLocked', 'close'), {
    ...ULTRA_MAX,
    deviceType: 'Smart Lock Pro',
  });
  assert.equal(pro.lock, LOCK_STATE.LOCKED);
  assert.equal(
    kind.states(ultraStatus('LATCHBOLTLOCKED'), { ...ULTRA_MAX, deviceType: 'Smart Lock Ultra' })
      .lock,
    0,
  );
  const keys = kind
    .features(ULTRA_MAX, { config: normalizeConfig({ lock_control: true }) })
    .map((f) => f.key);
  assert.deepEqual(keys, ['lock', 'deadbolt', 'lock-state', 'battery', 'door']);
  const command = (key, value) =>
    kind.command({
      key,
      value,
      device: ULTRA_MAX,
      status: ultraStatus('locked', 'close'),
      config: normalizeConfig({ lock_control: true }),
    });
  assert.deepEqual(command('lock', 1), {
    commands: [{ command: 'lock' }],
    expected: { lock: 1 },
    retryDeviceError: true,
    verify: true,
  });
  // `unlock` opens the door of an Ultra Max (forum, 26/11/2026): unlocking
  // retracts the deadbolt only, never sent again on a 190 (it toggles).
  assert.deepEqual(command('lock', 0), {
    commands: [{ command: 'deadbolt' }],
    expected: { lock: 0 },
    verify: true,
  });
  assert.deepEqual(command('deadbolt', 1).commands, [{ command: 'deadbolt' }]);
  // Already unlocked (deadbolt retracted, latch holding): nothing is sent,
  // whatever the door sensor says (the app itself shows it wrong).
  for (const doorState of ['opened', 'closed']) {
    const unlocked = ultraStatus('latchBoltLocked', doorState);
    const run = (key, value) =>
      kind.command({
        key,
        value,
        device: ULTRA_MAX,
        status: unlocked,
        config: normalizeConfig({ lock_control: true }),
      });
    assert.deepEqual(run('lock', 0).commands, []);
    assert.deepEqual(run('deadbolt', 1).commands, []);
    // Locking does not look at the door either.
    assert.deepEqual(run('lock', 1).commands, [{ command: 'lock' }]);
  }
  // Moving, jammed, half locked or unknown: `deadbolt` (a toggle) is never
  // sent blind.
  for (const lockState of ['unlocking', 'locking', 'jammed', 'halfLocked', undefined]) {
    for (const [key, value] of [
      ['lock', 0],
      ['deadbolt', 1],
    ]) {
      assert.throws(
        () =>
          kind.command({
            key,
            value,
            device: ULTRA_MAX,
            status: lockState ? ultraStatus(lockState, 'close') : undefined,
            config: normalizeConfig({ lock_control: true }),
          }),
        /nothing sent/,
        `${key} from ${lockState}`,
      );
    }
  }
  // The Lock Ultra too (OpenWonderLabs/SwitchBotAPI#416).
  assert.deepEqual(
    kindOf('Smart Lock Ultra').command({
      key: 'lock',
      value: 0,
      device: { ...ULTRA_MAX, deviceType: 'Smart Lock Ultra' },
      status: ultraStatus('locked', 'close'),
      config: normalizeConfig({ lock_control: true }),
    }).commands,
    [{ command: 'deadbolt' }],
  );
  assert.equal(kind.needsFreshStatus({ key: 'lock', value: 0, device: ULTRA_MAX }), true);
  assert.equal(kind.needsFreshStatus({ key: 'lock', value: 1, device: ULTRA_MAX }), false);
});

test('opening the door of a Lock Ultra needs its own option, off by default', () => {
  const kind = kindOf('Smart Lock Ultra Max');
  const keysWith = (config) =>
    kind.features(ULTRA_MAX, { config: normalizeConfig(config) }).map((f) => f.key);
  assert.equal(normalizeConfig().lock_open, false);
  assert.ok(!keysWith({ lock_control: true }).includes('open-door'));
  // Without lock control, the second option alone gives nothing.
  assert.deepEqual(keysWith({ lock_open: true }), ['lock-state', 'battery', 'door']);
  assert.deepEqual(keysWith({ lock_control: true, lock_open: true }), [
    'lock',
    'deadbolt',
    'open-door',
    'lock-state',
    'battery',
    'door',
  ]);
  const run = (config) =>
    kind.command({
      key: 'open-door',
      value: 1,
      device: ULTRA_MAX,
      status: ultraStatus('locked', 'close'),
      config: normalizeConfig(config),
    });
  assert.equal(run({ lock_control: true }), null);
  assert.equal(run({ lock_open: true }), null);
  // Never sent again on a 190: a second `unlock` would pull the latch twice.
  assert.deepEqual(run({ lock_control: true, lock_open: true }), {
    commands: [{ command: 'unlock' }],
    expected: { lock: 0 },
    verify: true,
  });
});

test('no deadbolt button on the Lite (left out by Home Assistant) nor the Vision models', () => {
  const config = normalizeConfig({ lock_control: true });
  for (const deviceType of ['Smart Lock Lite', 'Smart Lock Vision', 'Lock Vision Pro']) {
    const device = { ...ULTRA_MAX, deviceType };
    const kind = kindOf(deviceType);
    const keys = kind.features(device, { config }).map((f) => f.key);
    assert.ok(!keys.includes('deadbolt'), deviceType);
    assert.equal(kind.command({ key: 'deadbolt', value: 1, device, config }), null, deviceType);
  }
});

test('covers: position 100 = open in Gladys, inverted for curtains and roller shades', () => {
  assert.equal(statesOf('F00000000008').position, 100); // slidePosition 0 = open
  assert.equal(statesOf('F00000000009').position, 75); // 25 closed
  assert.equal(statesOf('F0000000000A').position, 80); // tilt 60: 50 is fully open
  assert.equal(statesOf('F0000000000A', { slidePosition: 0 }).position, 0);
  assert.equal(statesOf('F0000000000A', { slidePosition: 100 }).position, 0);
  assert.equal(statesOf('F00000000008').battery, 44);
  assert.equal(statesOf('F0000000000A').battery, undefined);
});

test('covers: commands per model', () => {
  assert.deepEqual(commandOf('F00000000008', 'position', 30).commands, [
    { command: 'setPosition', parameter: '0,ff,70' },
  ]);
  assert.deepEqual(commandOf('F00000000009', 'position', 30).commands, [
    { command: 'setPosition', parameter: 70 },
  ]);
  assert.deepEqual(commandOf('F0000000000A', 'position', 31).commands, [
    { command: 'setPosition', parameter: 'up;32' },
  ]);
  assert.deepEqual(commandOf('F00000000008', 'state', 1).commands, [{ command: 'turnOn' }]);
  assert.deepEqual(commandOf('F00000000008', 'state', -1).commands, [{ command: 'turnOff' }]);
  assert.deepEqual(commandOf('F00000000008', 'state', 0).commands, [{ command: 'pause' }]);
  assert.deepEqual(commandOf('F00000000009', 'state', -1).commands, [
    { command: 'setPosition', parameter: 100 },
  ]);
  assert.throws(() => commandOf('F00000000009', 'state', 0), /cannot stop/);
  assert.deepEqual(commandOf('F0000000000A', 'state', 1).commands, [{ command: 'fullyOpen' }]);
  assert.deepEqual(commandOf('F0000000000A', 'state', -1).commands, [{ command: 'closeUp' }]);
  assert.equal(commandOf('F00000000008', 'state', 7), null);
});

test('plugs: amperes, watts, kilowatt-hours of the day', () => {
  assert.deepEqual(statesOf('F00000000005'), {
    power: 1,
    voltage: 236.8,
    current: 0.02,
    'power-usage': 10,
    'energy-today': 0,
  });
  assert.equal(
    statesOf('F00000000005', { ...STATUSES.F00000000005, usedElectricity: 1500 })['energy-today'],
    0.025,
  );
  assert.deepEqual(statesOf('F00000000006'), {
    power: 1,
    voltage: 120.2,
    current: 0.083,
    'power-usage': 10,
  });
  assert.deepEqual(statesOf('F00000000007'), { power: 0 });
  assert.deepEqual(commandOf('F00000000007', 'power', 1), {
    commands: [{ command: 'turnOn' }],
    expected: { power: 1 },
  });
});

test('bot: a press in press mode, on/off in switch mode', () => {
  assert.equal(statesOf('F00000000003').power, 0);
  assert.deepEqual(commandOf('F00000000003', 'power', 1), {
    commands: [{ command: 'press' }],
    expected: { power: 0 },
  });
  assert.equal(statesOf('F00000000004').power, 1);
  assert.deepEqual(commandOf('F00000000004', 'power', 0).commands, [{ command: 'turnOff' }]);
});

test('lights: RGB as an integer, white temperature in mireds', () => {
  assert.deepEqual(statesOf('F00000000013'), {
    power: 1,
    brightness: 80,
    color: 0xff8000,
    'color-temperature': 250,
  });
  assert.equal(statesOf('F00000000014').color, 0x0000ff);
  assert.equal(statesOf('F00000000014')['color-temperature'], undefined);
  assert.equal(statesOf('F00000000015')['color-temperature'], 370);
  assert.equal(statesOf('F00000000015').color, undefined);
  assert.deepEqual(commandOf('F00000000013', 'color', 0xff8000).commands, [
    { command: 'setColor', parameter: '255:128:0' },
  ]);
  assert.deepEqual(commandOf('F00000000013', 'color-temperature', 250).commands, [
    { command: 'setColorTemperature', parameter: 4000 },
  ]);
  assert.deepEqual(commandOf('F00000000013', 'brightness', 0).commands, [{ command: 'turnOff' }]);
  assert.deepEqual(commandOf('F00000000013', 'brightness', 55).commands, [
    { command: 'setBrightness', parameter: 55 },
  ]);
  assert.equal(commandOf('F00000000015', 'color', 0xff0000), null);
});

test('meters and hubs', () => {
  assert.deepEqual(statesOf('F0000000000D'), {
    temperature: 21.8,
    humidity: 32,
    co2: undefined,
    'light-level': undefined,
    motion: undefined,
    battery: 100,
  });
  assert.equal(statesOf('F0000000000E').temperature, -3.4);
  assert.equal(statesOf('F0000000000F').co2, 1203);
  assert.equal(statesOf('F00000000001')['light-level'], 1);
  assert.equal(statesOf('F0000000001B').motion, 0);
});

test('motion, leak, humidifier, purifier, fan, vacuums', () => {
  assert.deepEqual(statesOf('F00000000011'), { motion: 0, battery: 20 });
  assert.deepEqual(statesOf('F00000000012'), { leak: 0, battery: 90 });
  assert.equal(statesOf('F00000000012', { status: 1 }).leak, 1);
  assert.equal(statesOf('F00000000016')['water-tank'], 0); // lackWater: true
  assert.deepEqual(statesOf('F00000000017'), { power: 1, mode: { text: 'auto' } });
  assert.deepEqual(commandOf('F00000000017', 'mode', 'sleep').commands, [
    { command: 'setMode', parameter: { mode: 3 } },
  ]);
  assert.equal(commandOf('F00000000017', 'mode', 'turbo'), null);
  assert.equal(statesOf('F0000000001A')['fan-speed'], 3);
  assert.deepEqual(
    commandOf('F0000000001A', 'fan-speed', 40, { status: { mode: 'natural' } }).commands,
    [
      { command: 'setWindMode', parameter: 'direct' },
      { command: 'setWindSpeed', parameter: 40 },
    ],
  );
  assert.deepEqual(statesOf('F00000000018'), {
    state: VACUUM_CLEANER_STATE.CHARGING,
    run: 0,
    battery: 85,
  });
  assert.deepEqual(commandOf('F00000000018', 'run', 1).commands, [{ command: 'start' }]);
  assert.deepEqual(commandOf('F00000000018', 'dock', 1).commands, [{ command: 'dock' }]);
  assert.equal(statesOf('F00000000019').state, VACUUM_CLEANER_STATE.RUNNING);
  // The S10 starts with a cleaning program: no start/stop feature.
  assert.equal(commandOf('F00000000019', 'run', 1), null);
});

test('IR commands: standard ones, custom buttons, the "Others" remotes', () => {
  assert.deepEqual(irCommand({ remoteType: 'TV' }, 'volumeAdd'), {
    command: 'volumeAdd',
    parameter: 'default',
    commandType: 'command',
  });
  assert.deepEqual(irCommand({ remoteType: 'Air Conditioner' }, 'setAll', ' 26,1,3,on '), {
    command: 'setAll',
    parameter: '26,1,3,on',
    commandType: 'command',
  });
  assert.equal(irCommand({ remoteType: 'TV' }, 'Netflix').commandType, 'customize');
  assert.equal(irCommand({ remoteType: 'Others' }, 'turnOn').commandType, 'customize');
});

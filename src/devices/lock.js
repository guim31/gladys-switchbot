// -----------------------------------------------------------------------------
// Smart locks: Lock, Lock Lite, Lock Pro, Lock Ultra, Lock Vision... (their
// `deviceType` in the API: `Smart Lock`, `Smart Lock Pro`...).
//
// A door lock is a security device: by default it is read only in Gladys
// (lock state, door state, battery). Locking and unlocking from Gladys — so
// from a scene, the dashboard or a voice assistant linked to Gladys — needs
// the "Allow locking and unlocking" option, and adds the command feature to
// the devices added after it is turned on.
//
// `lockState` reads `locked` / `unlocked` / `jammed` (and `locking`,
// `latchBoltLocked`...) on recent firmware, `lock` / `unlock` in the API
// documentation; `doorState` reads `open` / `close` or `opened` / `closed`:
// both spellings are accepted. The Lock Lite has no door sensor.
// -----------------------------------------------------------------------------

import {
  C,
  LOCK_STATE,
  OPENING_SENSOR_STATE,
  T,
  battery,
  control,
  num,
  sensor,
} from './features.js';

const LOCKED = ['locked', 'lock', 'latchboltlocked'];
const UNLOCKED = ['unlocked', 'unlock'];
const MOVING = ['locking', 'unlocking'];
const PROBLEM = ['jammed', 'halflocked'];

const WITHOUT_DOOR_SENSOR = ['Smart Lock Lite'];

export function readLockState(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (LOCKED.includes(lower)) {
    return LOCK_STATE.LOCKED;
  }
  if (UNLOCKED.includes(lower)) {
    return LOCK_STATE.UNLOCKED;
  }
  if (MOVING.includes(lower)) {
    return LOCK_STATE.ACTIVITY;
  }
  return PROBLEM.includes(lower) ? LOCK_STATE.ERROR : undefined;
}

export function readDoorState(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (['open', 'opened', 'timeoutnotclose'].includes(lower)) {
    return OPENING_SENSOR_STATE.OPEN;
  }
  return ['close', 'closed'].includes(lower) ? OPENING_SENSOR_STATE.CLOSE : undefined;
}

export const lock = {
  kind: 'lock',
  types: [
    'Smart Lock',
    'Smart Lock Lite',
    'Smart Lock Pro',
    'Smart Lock Pro Wifi',
    'Smart Lock Ultra',
    'Smart Lock Ultra Max',
    'Smart Lock Vision',
    'Smart Lock Vision Pro',
    'Lock Vision',
    'Lock Vision Pro',
  ],
  webhook: true,

  features(device, { config }) {
    const specs = [sensor('lock-state', 'lockState', C.LOCK, T.LOCK.STATE, { max: 3 }), battery()];
    if (!WITHOUT_DOOR_SENSOR.includes(device.deviceType)) {
      specs.push(sensor('door', 'door', C.OPENING_SENSOR, T.SENSOR.BINARY, { max: 1 }));
    }
    if (config.lock_control) {
      specs.unshift(control('lock', 'lock', C.LOCK, T.LOCK.BINARY, { max: 1 }));
    }
    return specs;
  },

  states(status, device) {
    const state = readLockState(status.lockState);
    return {
      lock: state === LOCK_STATE.LOCKED || state === LOCK_STATE.UNLOCKED ? state : undefined,
      'lock-state': state,
      door: WITHOUT_DOOR_SENSOR.includes(device.deviceType)
        ? undefined
        : readDoorState(status.doorState),
      battery: num(status.battery, 0),
    };
  },

  command({ key, value, config }) {
    // The option may have been turned off after the device was added.
    if (key !== 'lock' || !config.lock_control) {
      return null;
    }
    const locked = Number(value) === 1;
    return {
      commands: [{ command: locked ? 'lock' : 'unlock' }],
      expected: { lock: locked ? 1 : 0 },
    };
  },
};

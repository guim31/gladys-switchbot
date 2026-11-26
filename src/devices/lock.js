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
// `lockState` reads `locked` / `unlocked` / `locking` / `unlocking` /
// `jammed` / `latchBoltLocked` / `halfLocked` (Lock Ultra Max documentation),
// `lock` / `unlock` / `latchBoltLocked` (older documentation), and upper case
// over the webhook; `doorState` reads `open` / `close` or `opened` / `closed`:
// every spelling is accepted, case aside. The Lock Lite has no door sensor.
//
// `latchBoltLocked`: the deadbolt is retracted, only the latch holds the
// door, and the handle opens it. On the Lock Ultra and Ultra Max, it is the
// resting state once unlocked: read as locked (version 1.0, like Home
// Assistant), an unlocked Ultra Max showed a closed padlock for good, and the
// dashboard switch, sitting on "locked", only offered to unlock (forum,
// 16/11/2026). It reads unlocked on those two models. The other models keep
// the Home Assistant reading (locked) until a diagnostic shows otherwise: a
// "lock it if unlocked" scene would otherwise send `lock` again and again.
// `halfLocked` (the deadbolt stopped half way) secures nothing: an error,
// like `jammed`.
//
// `deadbolt` ("disengage deadbolt or latch" for SwitchBot) is the "deadbolt
// only" unlock of the app: the deadbolt retracts, the door stays on its latch
// until the handle is turned, where `unlock` pulls the latch too. Not checked
// on hardware. Documented for the Lock, Pro, Pro Wifi, Ultra and Ultra Max;
// not for the Vision models, and Home Assistant leaves it out of the Lite:
// same here.
//
// `lock` and `unlock` are sent as documented (`commandType` "command",
// parameter "default"): no other form exists in the API.
//
// On the Lock Ultra and Ultra Max, `unlock` unlocks AND pulls the latch: the
// door opens (Ultra Max of a forum user, 26/11/2026; OpenWonderLabs/
// SwitchBotAPI#416 and #473 for the Ultra), where `deadbolt` retracts the
// deadbolt and leaves the door closed on its latch. A remote "unlock" must not
// open the door: on those two models the switch's "unlocked" sends
// `deadbolt`, and only from a lock that does not already read unlocked
// (`deadbolt` sent then made an Ultra Max lock again: it toggles). Opening the
// door (`unlock`) is a separate button behind a second option, off by default.
// -----------------------------------------------------------------------------

import {
  C,
  LOCK_STATE,
  OPENING_SENSOR_STATE,
  T,
  battery,
  control,
  num,
  push,
  sensor,
} from './features.js';

const LOCKED = ['locked', 'lock'];
const UNLOCKED = ['unlocked', 'unlock'];
const LATCH_ONLY = 'latchboltlocked';
const LATCH_ONLY_UNLOCKED = ['Smart Lock Ultra', 'Smart Lock Ultra Max'];
const MOVING = ['locking', 'unlocking'];
const PROBLEM = ['jammed', 'halflocked'];

const WITHOUT_DOOR_SENSOR = ['Smart Lock Lite'];
const WITH_DEADBOLT = [
  'Smart Lock',
  'Smart Lock Pro',
  'Smart Lock Pro Wifi',
  'Smart Lock Ultra',
  'Smart Lock Ultra Max',
];

// `unlock` opens the door on these models: unlocking goes through `deadbolt`.
const UNLOCK_OPENS_DOOR = ['Smart Lock Ultra', 'Smart Lock Ultra Max'];

export const hasDeadbolt = (device) => WITH_DEADBOLT.includes(device?.deviceType);
export const unlockOpensDoor = (device) => UNLOCK_OPENS_DOOR.includes(device?.deviceType);

/** @param {string} value `lockState` @param {string} [deviceType] from the device list */
export function readLockState(value, deviceType) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (lower === LATCH_ONLY) {
    return LATCH_ONLY_UNLOCKED.includes(deviceType) ? LOCK_STATE.UNLOCKED : LOCK_STATE.LOCKED;
  }
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
      if (hasDeadbolt(device)) {
        specs.splice(1, 0, push('deadbolt', 'deadbolt'));
      }
      if (config.lock_open && unlockOpensDoor(device)) {
        specs.splice(2, 0, push('open-door', 'openDoor'));
      }
    }
    return specs;
  },

  states(status, device) {
    const state = readLockState(status.lockState, device.deviceType);
    return {
      lock: state === LOCK_STATE.LOCKED || state === LOCK_STATE.UNLOCKED ? state : undefined,
      'lock-state': state,
      door: WITHOUT_DOOR_SENSOR.includes(device.deviceType)
        ? undefined
        : readDoorState(status.doorState),
      battery: num(status.battery, 0),
    };
  },

  /**
   * Commands decided on the lock's state: read it just before (a status may
   * predate a lock by hand, keypad or the app).
   */
  needsFreshStatus({ key, value, device }) {
    return key === 'deadbolt' || (key === 'lock' && Number(value) !== 1 && unlockOpensDoor(device));
  },

  command({ key, value, device, status, config }) {
    // The option may have been turned off after the device was added.
    if (!config.lock_control) {
      return null;
    }
    const state = readLockState(status?.lockState, device.deviceType);
    if (key === 'deadbolt') {
      if (!hasDeadbolt(device)) {
        return null;
      }
      return deadboltPlan(state);
    }
    if (key === 'open-door') {
      if (!config.lock_open || !unlockOpensDoor(device)) {
        return null;
      }
      // Never sent again on a 190: the lock may have moved anyway, and a
      // second `unlock` would pull the latch twice.
      return { commands: [{ command: 'unlock' }], expected: { lock: 0 }, verify: true };
    }
    if (key !== 'lock') {
      return null;
    }
    const locked = Number(value) === 1;
    if (!locked && unlockOpensDoor(device)) {
      // `unlock` would open the door: retract the deadbolt only. On these
      // models `latchBoltLocked` reads unlocked, so the check below holds.
      return { ...deadboltPlan(state), verify: true };
    }
    return {
      commands: [{ command: locked ? 'lock' : 'unlock' }],
      expected: { lock: locked ? 1 : 0 },
      retryDeviceError: true,
      // SwitchBot can answer 100 to `lock` while the lock never moves (Ultra
      // Max; Lock Ultra, home-assistant/core#179738): read it again later
      // and warn. Not after the `deadbolt` button on a Lock or Pro, which
      // leaves it on `latchBoltLocked`, read as locked on those models.
      verify: true,
    };
  },
};

/**
 * `deadbolt` retracts the deadbolt of a locked lock. Sent to a lock already
 * unlocked, it made an Ultra Max lock again (forum, 22/11/2026): it toggles.
 * So it is sent only from a lock that reads locked; from one that reads
 * unlocked nothing is sent and the command succeeds (the lock is where it
 * was asked to be); moving, jammed, half locked or unknown: refused, nothing
 * sent. Never sent again on a device error (190).
 */
function deadboltPlan(state) {
  if (state === LOCK_STATE.UNLOCKED) {
    return { commands: [], expected: { lock: 0 } };
  }
  if (state !== LOCK_STATE.LOCKED) {
    throw new Error(
      'the lock reads neither locked nor unlocked (moving, jammed or unknown): nothing sent',
    );
  }
  return { commands: [{ command: 'deadbolt' }], expected: { lock: 0 } };
}

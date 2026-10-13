// -----------------------------------------------------------------------------
// Curtains and blinds: Curtain, Curtain 3 (`Curtain3`), `Curtain4`, Roller
// Shade and Blind Tilt.
//
// Gladys reads a cover position as 100 = open, 0 = closed. SwitchBot counts
// the other way for curtains and roller shades (`slidePosition` 0 = open,
// 100 = closed): the value is inverted both ways. A Blind Tilt reports 0 to
// 100 with the slats open at 50 and closed at both ends (up or down); its
// position is read as Home Assistant does, and set with the `up;<even
// number>` / `down;<even number>` command, in the direction it last used.
//
// The open / close / stop feature has no feedback: the core keeps the last
// command, the position says where the cover really is.
// -----------------------------------------------------------------------------

import { C, COVER_STATE, T, battery, clamp, control, num } from './features.js';

const CURTAINS = ['Curtain', 'Curtain3', 'Curtain4'];
const ROLLER = 'Roller Shade';
const BLIND_TILT = 'Blind Tilt';

const categoryOf = (device) => (CURTAINS.includes(device.deviceType) ? 'CURTAIN' : 'SHUTTER');

const unsupported = () => {
  const err = new Error('this cover cannot stop on command');
  err.code = 'unsupported';
  throw err;
};

/** The Blind Tilt direction it last used: `up` or `down`. */
const tiltDirection = (status) =>
  typeof status?.direction === 'string' && status.direction.toLowerCase() === 'down'
    ? 'down'
    : 'up';

export function readPosition(status, device) {
  const raw = num(status.slidePosition, 0);
  if (raw === undefined) {
    return undefined;
  }
  const position = clamp(raw, 0, 100);
  return device.deviceType === BLIND_TILT ? 100 - Math.abs(position - 50) * 2 : 100 - position;
}

function positionCommand(device, position, status) {
  if (CURTAINS.includes(device.deviceType)) {
    return { command: 'setPosition', parameter: `0,ff,${100 - position}` };
  }
  if (device.deviceType === ROLLER) {
    return { command: 'setPosition', parameter: 100 - position };
  }
  // Blind Tilt: an even number, 0 closed to 100 open.
  const even = Math.round(position / 2) * 2;
  return { command: 'setPosition', parameter: `${tiltDirection(status)};${even}` };
}

function stateCommand(device, state, status) {
  if (state === COVER_STATE.STOP) {
    return CURTAINS.includes(device.deviceType) ? { command: 'pause' } : unsupported();
  }
  const open = state === COVER_STATE.OPEN;
  if (CURTAINS.includes(device.deviceType)) {
    return { command: open ? 'turnOn' : 'turnOff' };
  }
  if (device.deviceType === ROLLER) {
    return { command: 'setPosition', parameter: open ? 0 : 100 };
  }
  if (open) {
    return { command: 'fullyOpen' };
  }
  return { command: tiltDirection(status) === 'down' ? 'closeDown' : 'closeUp' };
}

export const cover = {
  kind: 'cover',
  types: [...CURTAINS, ROLLER, BLIND_TILT],
  webhook: true,

  features(device) {
    const category = categoryOf(device);
    const specs = [
      control('position', 'position', C[category], T[category].POSITION, { max: 100 }),
      control('state', 'coverState', C[category], T[category].STATE, {
        min: -1,
        max: 1,
        hasFeedback: false,
      }),
    ];
    if (device.deviceType !== BLIND_TILT) {
      specs.push(battery());
    }
    return specs;
  },

  states: (status, device) => ({
    position: readPosition(status, device),
    battery: device.deviceType === BLIND_TILT ? undefined : num(status.battery, 0),
  }),

  command({ key, value, device, status }) {
    if (key === 'position') {
      const position = clamp(value, 0, 100);
      if (position === undefined) {
        return null;
      }
      return {
        commands: [positionCommand(device, Math.round(position), status)],
        expected: { position: Math.round(position) },
      };
    }
    if (key === 'state') {
      const state = Number(value);
      if (![COVER_STATE.OPEN, COVER_STATE.CLOSE, COVER_STATE.STOP].includes(state)) {
        return null;
      }
      return { commands: [stateCommand(device, state, status)], expected: {} };
    }
    return null;
  },
};

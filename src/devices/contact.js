// -----------------------------------------------------------------------------
// Contact Sensor: a door or window opening sensor, with a motion detector.
//
// `openState` reads `open`, `close`, or `timeOutNotClose` (left open longer
// than the delay set in the SwitchBot app). Gladys reads an opening sensor
// as 0 = OPEN, 1 = CLOSED (OPENING_SENSOR_STATE): left open is open.
// -----------------------------------------------------------------------------

import { C, OPENING_SENSOR_STATE, T, battery, bool, num, sensor } from './features.js';

/** `open` | `closed` | `left_open`, the values of the contact scene trigger. */
export function contactState(openState) {
  if (typeof openState !== 'string') {
    return undefined;
  }
  const lower = openState.toLowerCase();
  if (lower === 'timeoutnotclose') {
    return 'left_open';
  }
  if (lower === 'open') {
    return 'open';
  }
  return lower === 'close' || lower === 'closed' ? 'closed' : undefined;
}

export const contact = {
  kind: 'contact',
  types: ['Contact Sensor'],
  webhook: true,

  features: () => [
    sensor('contact', 'contact', C.OPENING_SENSOR, T.SENSOR.BINARY, { max: 1 }),
    sensor('motion', 'motion', C.MOTION_SENSOR, T.SENSOR.BINARY, { max: 1 }),
    battery(),
  ],

  states(status) {
    const state = contactState(status.openState);
    return {
      contact:
        state === undefined
          ? undefined
          : state === 'closed'
            ? OPENING_SENSOR_STATE.CLOSE
            : OPENING_SENSOR_STATE.OPEN,
      motion: bool(status.moveDetected),
      battery: num(status.battery, 0),
    };
  },
};

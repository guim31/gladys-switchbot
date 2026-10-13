// -----------------------------------------------------------------------------
// Motion Sensor: `moveDetected` (true while it sees motion) and battery.
// -----------------------------------------------------------------------------

import { C, T, battery, bool, num, sensor } from './features.js';

export const motion = {
  kind: 'motion',
  types: ['Motion Sensor'],
  webhook: true,

  features: () => [
    sensor('motion', 'motion', C.MOTION_SENSOR, T.SENSOR.BINARY, { max: 1 }),
    battery(),
  ],

  states: (status) => ({
    motion: bool(status.moveDetected),
    battery: num(status.battery, 0),
  }),
};

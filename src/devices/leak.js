// -----------------------------------------------------------------------------
// Water Leak Detector (`Water Detector`): `status` 0 = dry, 1 = leak.
// -----------------------------------------------------------------------------

import { C, T, battery, num, sensor } from './features.js';

export const leak = {
  kind: 'leak',
  types: ['Water Detector'],
  webhook: true,

  features: () => [sensor('leak', 'leak', C.LEAK_SENSOR, T.SENSOR.BINARY, { max: 1 }), battery()],

  states: (status) => ({
    leak: status.status === 0 || status.status === 1 ? status.status : undefined,
    battery: num(status.battery, 0),
  }),
};

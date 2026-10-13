// -----------------------------------------------------------------------------
// Thermo-hygrometers and hubs with sensors: Meter, Meter Plus (`MeterPlus`),
// Outdoor Meter (`WoIOSensor`), Meter Pro (`MeterPro`), Meter Pro CO2
// (`MeterPro(CO2)`), Hub 2 and Hub 3.
//
// The hubs report a light level from 1 to 20 (a SwitchBot scale, not lux)
// and have no battery; the Hub 3 also detects motion.
// -----------------------------------------------------------------------------

import { C, T, U, battery, bool, num, sensor } from './features.js';

const WITH_BATTERY = ['Meter', 'MeterPlus', 'WoIOSensor', 'MeterPro', 'MeterPro(CO2)'];
const HUBS = ['Hub 2', 'Hub 3'];

export const meter = {
  kind: 'meter',
  types: [...WITH_BATTERY, ...HUBS],
  webhook: true,

  features(device) {
    const specs = [
      sensor('temperature', 'temperature', C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
        min: -40,
        max: 85,
        unit: U.CELSIUS,
      }),
      sensor('humidity', 'humidity', C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, {
        max: 100,
        unit: U.PERCENT,
      }),
    ];
    if (device.deviceType === 'MeterPro(CO2)') {
      specs.push(sensor('co2', 'co2', C.CO2_SENSOR, T.SENSOR.INTEGER, { max: 9999, unit: U.PPM }));
    }
    if (HUBS.includes(device.deviceType)) {
      specs.push(
        sensor('light-level', 'lightLevel', C.LIGHT_SENSOR, T.SENSOR.DECIMAL, { min: 1, max: 20 }),
      );
    }
    if (device.deviceType === 'Hub 3') {
      specs.push(sensor('motion', 'motion', C.MOTION_SENSOR, T.SENSOR.BINARY, { max: 1 }));
    }
    if (WITH_BATTERY.includes(device.deviceType)) {
      specs.push(battery());
    }
    return specs;
  },

  states: (status) => ({
    temperature: num(status.temperature, 1),
    humidity: num(status.humidity, 1),
    co2: num(status.CO2, 0),
    'light-level': num(status.lightLevel, 0),
    motion: bool(status.moveDetected),
    battery: num(status.battery, 0),
  }),
};

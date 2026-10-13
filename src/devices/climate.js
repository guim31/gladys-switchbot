// -----------------------------------------------------------------------------
// Climate appliances, basic control: Humidifier, Air Purifier (VOC, PM2.5,
// table models) and the circulator fans.
//
//   - Humidifier: `power`, `humidity` and `temperature` it measures,
//     `lackWater` (empty tank, shown as a low liquid level).
//   - Air purifiers: `power` "ON"/"OFF", `mode` 1 normal, 2 auto, 3 sleep,
//     4 pet (set with `setMode {"mode": n}`, as Home Assistant does).
//   - Fans: `power`, `fanSpeed` 1-100 (applies in the "direct" mode: setting
//     a speed switches the fan to it first), `battery` on battery models.
// -----------------------------------------------------------------------------

import { C, LIQUID_STATE, T, U, battery, clamp, control, num, onOff, sensor } from './features.js';

const powerFeature = () => control('power', 'power', C.SWITCH, T.SWITCH.BINARY, { max: 1 });

const powerCommand = (value) => {
  const on = Number(value) === 1;
  return { commands: [{ command: on ? 'turnOn' : 'turnOff' }], expected: { power: on ? 1 : 0 } };
};

export const humidifier = {
  kind: 'humidifier',
  types: ['Humidifier'],
  webhook: false,

  features: () => [
    powerFeature(),
    sensor('humidity', 'humidity', C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, {
      max: 100,
      unit: U.PERCENT,
    }),
    sensor('temperature', 'temperature', C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
      min: -40,
      max: 85,
      unit: U.CELSIUS,
    }),
    sensor('water-tank', 'waterTank', C.LEVEL_SENSOR, T.LEVEL_SENSOR.LIQUID_STATE, { max: 2 }),
  ],

  states: (status) => ({
    power: onOff(status.power),
    humidity: num(status.humidity, 1),
    temperature: num(status.temperature, 1),
    'water-tank':
      typeof status.lackWater === 'boolean'
        ? status.lackWater
          ? LIQUID_STATE.LOW
          : LIQUID_STATE.NORMAL
        : undefined,
  }),

  command: ({ key, value }) => (key === 'power' ? powerCommand(value) : null),
};

// Purifier modes: the option values are part of the feature, never renamed.
export const PURIFIER_MODES = { normal: 1, auto: 2, sleep: 3, pet: 4 };

export const purifier = {
  kind: 'purifier',
  types: [
    'Air Purifier VOC',
    'Air Purifier Table VOC',
    'Air Purifier PM2.5',
    'Air Purifier Table PM2.5',
  ],
  webhook: true,

  features: () => [
    powerFeature(),
    control('mode', 'mode', C.TEXT, T.TEXT.SELECT, { options: 'purifierModes' }),
  ],

  states(status) {
    const mode = Object.entries(PURIFIER_MODES).find(([, n]) => n === Number(status.mode));
    return { power: onOff(status.power), mode: mode ? { text: mode[0] } : undefined };
  },

  command({ key, value }) {
    if (key === 'power') {
      return powerCommand(value);
    }
    if (key === 'mode' && PURIFIER_MODES[value] !== undefined) {
      return {
        commands: [{ command: 'setMode', parameter: { mode: PURIFIER_MODES[value] } }],
        expected: { mode: { text: String(value) } },
      };
    }
    return null;
  },
};

const BATTERY_FANS = ['Battery Circulator Fan', 'Standing Fan', 'Battery Circulator Fan 2 Pro'];

export const fan = {
  kind: 'fan',
  types: ['Circulator Fan', ...BATTERY_FANS],
  webhook: true,

  features(device) {
    const specs = [
      powerFeature(),
      control('fan-speed', 'fanSpeed', C.FAN, T.FAN.PERCENT, { min: 1, max: 100, unit: U.PERCENT }),
    ];
    if (BATTERY_FANS.includes(device.deviceType)) {
      specs.push(battery());
    }
    return specs;
  },

  states: (status, device) => ({
    power: onOff(status.power),
    'fan-speed': clamp(num(status.fanSpeed, 0), 1, 100),
    battery: BATTERY_FANS.includes(device.deviceType) ? num(status.battery, 0) : undefined,
  }),

  command({ key, value, status }) {
    if (key === 'power') {
      return powerCommand(value);
    }
    if (key !== 'fan-speed') {
      return null;
    }
    const speed = Math.round(clamp(value, 1, 100) ?? NaN);
    if (!Number.isFinite(speed)) {
      return null;
    }
    const commands = [{ command: 'setWindSpeed', parameter: speed }];
    if (status?.mode !== undefined && status.mode !== 'direct') {
      commands.unshift({ command: 'setWindMode', parameter: 'direct' });
    }
    return { commands, expected: { 'fan-speed': speed } };
  },
};

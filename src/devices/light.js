// -----------------------------------------------------------------------------
// Lights: Color Bulb, Strip Light, Strip Light 3, Floor Lamp, RGBICWW strip
// and floor lamp, RGBIC neon rope lights, Ceiling Light and Ceiling Light Pro.
//
// Three families by what the API documents: colour + white temperature
// (`setColor` and `setColorTemperature`), colour only, white temperature
// only (the ceiling lights). Status: `power` "on"/"off", `brightness` 1-100,
// `color` "r:g:b", `colorTemperature` in kelvins (2700-6500), published to
// Gladys in mireds (see features.js).
// -----------------------------------------------------------------------------

import {
  C,
  MIRED_MAX,
  MIRED_MIN,
  T,
  clamp,
  control,
  intToRgb,
  kelvinToMired,
  miredToKelvin,
  num,
  onOff,
  rgbToInt,
} from './features.js';

const COLOR_AND_WHITE = [
  'Color Bulb',
  'Strip Light 3',
  'Floor Lamp',
  'RGBICWW Strip Light',
  'RGBICWW Floor Lamp',
];
const COLOR_ONLY = ['Strip Light', 'RGBIC Neon Rope Light', 'RGBIC Neon Wire Rope Light'];
const WHITE_ONLY = ['Ceiling Light', 'Ceiling Light Pro'];

const hasColor = (device) => !WHITE_ONLY.includes(device.deviceType);
const hasWhite = (device) => !COLOR_ONLY.includes(device.deviceType);

export const light = {
  kind: 'light',
  types: [...COLOR_AND_WHITE, ...COLOR_ONLY, ...WHITE_ONLY],
  webhook: true,

  features(device) {
    const specs = [
      control('power', 'light', C.LIGHT, T.LIGHT.BINARY, { max: 1 }),
      control('brightness', 'brightness', C.LIGHT, T.LIGHT.BRIGHTNESS, { max: 100 }),
    ];
    if (hasColor(device)) {
      specs.push(control('color', 'color', C.LIGHT, T.LIGHT.COLOR, { max: 0xffffff }));
    }
    if (hasWhite(device)) {
      specs.push(
        control('color-temperature', 'colorTemperature', C.LIGHT, T.LIGHT.TEMPERATURE, {
          min: MIRED_MIN,
          max: MIRED_MAX,
        }),
      );
    }
    return specs;
  },

  states: (status, device) => ({
    power: onOff(status.power),
    brightness: clamp(num(status.brightness, 0), 0, 100),
    color: hasColor(device) ? rgbToInt(status.color) : undefined,
    'color-temperature': hasWhite(device) ? kelvinToMired(status.colorTemperature) : undefined,
  }),

  command({ key, value, device }) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    switch (key) {
      case 'power': {
        const on = number === 1;
        return {
          commands: [{ command: on ? 'turnOn' : 'turnOff' }],
          expected: { power: on ? 1 : 0 },
        };
      }
      case 'brightness': {
        const brightness = Math.round(clamp(number, 0, 100));
        if (brightness === 0) {
          return { commands: [{ command: 'turnOff' }], expected: { power: 0 } };
        }
        return {
          commands: [{ command: 'setBrightness', parameter: brightness }],
          expected: { brightness },
        };
      }
      case 'color':
        if (!hasColor(device)) {
          return null;
        }
        return {
          commands: [{ command: 'setColor', parameter: intToRgb(number) }],
          expected: { color: Math.round(clamp(number, 0, 0xffffff)) },
        };
      case 'color-temperature': {
        if (!hasWhite(device)) {
          return null;
        }
        const kelvin = miredToKelvin(number);
        return {
          commands: [{ command: 'setColorTemperature', parameter: kelvin }],
          expected: { 'color-temperature': kelvinToMired(kelvin) },
        };
      }
      default:
        return null;
    }
  },
};

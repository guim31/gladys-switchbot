// -----------------------------------------------------------------------------
// Feature specs and value converters shared by the device kinds.
//
// A spec is the Gladys feature without its name and external id, which the
// catalog adds (src/devices/index.js). Every spec carries numeric min/max:
// the core refuses "Add to Gladys" with a 422 without them (text features
// included: 0/0).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const C = DEVICE_FEATURE_CATEGORIES;
export const T = DEVICE_FEATURE_TYPES;
export const U = DEVICE_FEATURE_UNITS;

/**
 * A read-only feature, fed by the device status.
 * @param {string} key feature key: part of the external id, never renamed
 * @param {string} nameKey key of the name in NAMES (src/i18n.js)
 */
export const sensor = (key, nameKey, category, type, { min = 0, max = 0, unit } = {}) => ({
  key,
  nameKey,
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: true,
  has_feedback: false,
});

/**
 * A controllable feature. `hasFeedback`: the status reports the value back
 * (the core then waits for the integration to publish it).
 */
export const control = (
  key,
  nameKey,
  category,
  type,
  { min = 0, max = 0, unit, hasFeedback = true, options } = {},
) => ({
  ...sensor(key, nameKey, category, type, { min, max, unit }),
  read_only: false,
  has_feedback: hasFeedback,
  ...(options ? { optionsKey: options } : {}),
});

/** The battery level every battery-powered device reports. */
export const battery = () =>
  sensor('battery', 'battery', C.BATTERY, T.BATTERY.INTEGER, { max: 100, unit: U.PERCENT });

/** `on` / `ON` / `off` / `OFF` → 1 / 0; anything else → undefined. */
export function onOff(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (lower === 'on') {
    return 1;
  }
  return lower === 'off' ? 0 : undefined;
}

/** A finite number, rounded to `digits` decimals; anything else → undefined. */
export function num(value, digits = 2) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return undefined;
  }
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

/** A number clamped into [min, max]; anything else → undefined. */
export function clamp(value, min, max) {
  const number = num(value);
  return number === undefined ? undefined : Math.min(max, Math.max(min, number));
}

/** A boolean as 1 / 0; anything else → undefined. */
export const bool = (value) => (typeof value === 'boolean' ? Number(value) : undefined);

/** `"255:128:0"` → 0xff8000; anything else → undefined. */
export function rgbToInt(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split(':').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return undefined;
  }
  return (parts[0] << 16) + (parts[1] << 8) + parts[2];
}

/** 0xff8000 → `"255:128:0"`. */
export function intToRgb(value) {
  const color = Math.max(0, Math.min(0xffffff, Math.round(value)));
  return `${(color >> 16) & 0xff}:${(color >> 8) & 0xff}:${color & 0xff}`;
}

// Gladys draws the colour temperature slider cold (left, low values) to warm
// (right): it works in mireds, like Zigbee lights. SwitchBot works in kelvins,
// 2700 to 6500.
export const KELVIN_MIN = 2700;
export const KELVIN_MAX = 6500;
export const MIRED_MIN = Math.round(1e6 / KELVIN_MAX); // 154
export const MIRED_MAX = Math.round(1e6 / KELVIN_MIN); // 370

export const kelvinToMired = (kelvin) => {
  const k = num(kelvin, 0);
  return k === undefined || k <= 0
    ? undefined
    : Math.min(MIRED_MAX, Math.max(MIRED_MIN, Math.round(1e6 / k)));
};
export const miredToKelvin = (mired) =>
  Math.min(KELVIN_MAX, Math.max(KELVIN_MIN, Math.round(1e6 / Math.max(1, mired))));

// State values of the Gladys core (server/utils/constants.js): the SDK does
// not export them.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const LOCK_STATE = { UNLOCKED: 0, LOCKED: 1, ACTIVITY: 2, ERROR: 3 };
// An opening sensor reads 0 when OPEN and 1 when CLOSED: the reverse of the
// motion and leak sensors (1 = detected). Pinned by test/devices.test.js.
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const VACUUM_CLEANER_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING_TO_DOCK: 4,
  CHARGING: 5,
  DOCKED: 6,
};
export const VACUUM_CLEANER_MODE = { IDLE: 0, CLEANING: 1 };
export const LIQUID_STATE = { LOW: 0, NORMAL: 1 };

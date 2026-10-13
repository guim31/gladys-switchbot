// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`): what changed between two reads
// of a device, as events.
//
// Device states already trigger scenes in Gladys; these triggers add what a
// state cannot say:
//   - contact_changed: a door or window opened, closed, or was LEFT OPEN
//     (SwitchBot's `timeOutNotClose`, which the binary feature reads as
//     "open"), one card for every contact sensor, with the device name;
//   - motion_detected / leak_detected: one card for every sensor that sees
//     motion (motion sensors, the motion detector of the contact sensors, Hub
//     3) or water, with the device name for a notification;
//   - battery_low: the battery crossed 20 % (SwitchBot reports segments: 20
//     and below is the lowest one or two), once, then re-armed above 30 %.
//
// Only transitions fire: the first read after a start never does, so a
// restart does not replay "door opened" or "battery low".
// -----------------------------------------------------------------------------

import { contactState } from './devices/contact.js';

export const TRIGGERS = {
  CONTACT: 'contact_changed',
  MOTION: 'motion_detected',
  LEAK: 'leak_detected',
  BATTERY_LOW: 'battery_low',
};

export const TRIGGER_KEYS = Object.values(TRIGGERS);

export const BATTERY_LOW_THRESHOLD = 20;
export const BATTERY_REARM_THRESHOLD = 30;

/**
 * The values the triggers watch, from one read.
 * @param {object} entry catalog entry
 * @param {object} status the raw SwitchBot status
 * @param {object} values the feature values of the read (kind.states)
 * @param {object} [previous] the signals of the previous read
 */
export function signalsOf(entry, status, values, previous = {}) {
  const signals = {
    contact: entry.kind.kind === 'contact' ? contactState(status.openState) : undefined,
    motion: values.motion,
    leak: values.leak,
    battery: values.battery,
    batteryLow: previous.batteryLow,
  };
  if (typeof signals.battery === 'number') {
    if (signals.battery <= BATTERY_LOW_THRESHOLD) {
      signals.batteryLow = true;
    } else if (signals.battery > BATTERY_REARM_THRESHOLD || previous.batteryLow === undefined) {
      signals.batteryLow = false;
    }
  }
  return signals;
}

/**
 * The events between two reads of one device.
 * @param {object|undefined} previous signals of the previous read (undefined: first read)
 * @param {object} next signals of this read
 * @param {{ device: string, device_name: string }} identity
 * @returns {{ key: string, data: object }[]}
 */
export function detectEvents(previous, next, identity) {
  if (!previous) {
    return [];
  }
  const events = [];
  if (next.contact !== undefined && previous.contact !== undefined) {
    if (next.contact !== previous.contact) {
      events.push({ key: TRIGGERS.CONTACT, data: { ...identity, state: next.contact } });
    }
  }
  if (next.motion === 1 && previous.motion === 0) {
    events.push({ key: TRIGGERS.MOTION, data: { ...identity } });
  }
  if (next.leak === 1 && previous.leak === 0) {
    events.push({ key: TRIGGERS.LEAK, data: { ...identity } });
  }
  if (next.batteryLow === true && previous.batteryLow === false) {
    events.push({ key: TRIGGERS.BATTERY_LOW, data: { ...identity, battery: next.battery } });
  }
  return events;
}

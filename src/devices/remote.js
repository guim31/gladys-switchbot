// -----------------------------------------------------------------------------
// Virtual infrared remotes of a SwitchBot hub (TV, air conditioner, fan,
// light, "Others"...), published only when the "IR remotes" option is on.
//
// The API gives no state for them: they send, they never read. A remote is a
// Gladys device with a power feature (no feedback: the core keeps the last
// command sent, it may not match the appliance) — except the "Others" type,
// which only has custom buttons — and the last command sent. Any button,
// custom ones included, is sent by the "Send an IR command" scene action.
// -----------------------------------------------------------------------------

import { C, T, control, sensor } from './features.js';

// The standard commands of the API documentation; any other name is a custom
// button of the remote (commandType "customize"), case-sensitive.
export const STANDARD_IR_COMMANDS = [
  'turnOn',
  'turnOff',
  'setAll',
  'SetChannel',
  'volumeAdd',
  'volumeSub',
  'channelAdd',
  'channelSub',
  'setMute',
  'FastForward',
  'Rewind',
  'Next',
  'Previous',
  'Pause',
  'Play',
  'Stop',
  'swing',
  'timer',
  'lowSpeed',
  'middleSpeed',
  'highSpeed',
  'brightnessUp',
  'brightnessDown',
];

const CUSTOM_ONLY = ['Others'];

const hasPower = (entry) => !CUSTOM_ONLY.includes(entry.remoteType);

/**
 * The API command for a button name: a standard command, or a custom button.
 * @param {{ remoteType?: string }} entry the remote, from the device list
 * @param {string} name
 * @param {string} [parameter]
 */
export function irCommand(entry, name, parameter) {
  const custom = CUSTOM_ONLY.includes(entry.remoteType) || !STANDARD_IR_COMMANDS.includes(name);
  return {
    command: name,
    parameter: parameter && parameter.trim() !== '' ? parameter.trim() : 'default',
    commandType: custom ? 'customize' : 'command',
  };
}

export const remote = {
  kind: 'remote',

  features: (entry) => [
    ...(hasPower(entry)
      ? [control('power', 'power', C.SWITCH, T.SWITCH.BINARY, { max: 1, hasFeedback: false })]
      : []),
    sensor('last-command', 'lastCommand', C.TEXT, T.TEXT.TEXT),
  ],

  command({ key, value, device }) {
    if (key !== 'power' || !hasPower(device)) {
      return null;
    }
    const on = Number(value) === 1;
    return { commands: [irCommand(device, on ? 'turnOn' : 'turnOff')], expected: {} };
  },
};

// -----------------------------------------------------------------------------
// Bot: the finger that presses a switch. In switch mode it holds a state
// (on/off); in press mode (the default) and customize mode it only presses.
//
// The feature is the same in every mode, so changing the mode in the SwitchBot
// app never changes the device structure in Gladys: in press mode, any command
// presses, and the state falls back to off at once (a press has no state).
// -----------------------------------------------------------------------------

import { C, T, battery, control, num, onOff } from './features.js';

const isSwitchMode = (status) => status?.deviceMode === 'switchMode';

export const bot = {
  kind: 'bot',
  types: ['Bot'],
  webhook: true,

  features: () => [control('power', 'bot', C.SWITCH, T.SWITCH.BINARY, { max: 1 }), battery()],

  states: (status) => ({
    power: isSwitchMode(status) ? onOff(status.power) : 0,
    battery: num(status.battery, 0),
  }),

  command({ key, value, status }) {
    if (key !== 'power') {
      return null;
    }
    if (!isSwitchMode(status)) {
      return { commands: [{ command: 'press' }], expected: { power: 0 } };
    }
    const on = Number(value) === 1;
    return { commands: [{ command: on ? 'turnOn' : 'turnOff' }], expected: { power: on ? 1 : 0 } };
  },
};

// -----------------------------------------------------------------------------
// Robot vacuums, basic control: the working state, the battery, the return to
// the dock — and start / stop for the models whose command is plain (S1, S1
// Plus, K10+, K10+ Pro). The newer models (S10, S20, K10+ Pro Combo, K20+
// Pro, K11+) start with a cleaning program the integration does not guess:
// start them from the SwitchBot app or its schedules.
//
// `workingStatus`: StandBy, Clearing, Paused, GotoChargeBase, Charging,
// ChargeDone, Dormant, InTrouble, InRemoteControl, InDustCollecting.
// -----------------------------------------------------------------------------

import {
  C,
  T,
  VACUUM_CLEANER_MODE,
  VACUUM_CLEANER_STATE as S,
  battery,
  control,
  num,
  sensor,
} from './features.js';

const SIMPLE = ['Robot Vacuum Cleaner S1', 'Robot Vacuum Cleaner S1 Plus', 'K10+', 'K10+ Pro'];
// Spellings of the API documentation and of the Home Assistant code.
const PROGRAMMED = [
  'Robot Vacuum Cleaner S10',
  'Robot Vacuum Cleaner S20',
  'S20',
  'Robot Vacuum Cleaner K10+ Pro Combo',
  'Robot Vacuum Cleaner K20 Plus Pro',
  'K20+ Pro',
  'Robot Vacuum Cleaner K11+',
  'Robot Vacuum Cleaner K11 Plus',
];

const WORKING_STATES = {
  standby: S.STOPPED,
  clearing: S.RUNNING,
  paused: S.PAUSED,
  gotochargebase: S.RETURNING_TO_DOCK,
  charging: S.CHARGING,
  chargedone: S.DOCKED,
  dormant: S.STOPPED,
  introuble: S.ERROR,
  inremotecontrol: S.RUNNING,
  industcollecting: S.DOCKED,
};

export const readWorkingState = (value) =>
  typeof value === 'string' ? WORKING_STATES[value.toLowerCase()] : undefined;

export const vacuum = {
  kind: 'vacuum',
  types: [...SIMPLE, ...PROGRAMMED],
  webhook: true,

  features(device) {
    const specs = [
      sensor('state', 'vacuumState', C.VACUUM_CLEANER, T.VACUUM_CLEANER.STATE, { max: 6 }),
      control('dock', 'dock', C.VACUUM_CLEANER, T.VACUUM_CLEANER.DOCK, {
        max: 1,
        hasFeedback: false,
      }),
      battery(),
    ];
    if (SIMPLE.includes(device.deviceType)) {
      specs.splice(
        1,
        0,
        control('run', 'vacuumRun', C.VACUUM_CLEANER, T.VACUUM_CLEANER.RUN_MODE, { max: 1 }),
      );
    }
    return specs;
  },

  states(status, device) {
    const state = readWorkingState(status.workingStatus);
    return {
      state,
      run:
        SIMPLE.includes(device.deviceType) && state !== undefined
          ? state === S.RUNNING
            ? VACUUM_CLEANER_MODE.CLEANING
            : VACUUM_CLEANER_MODE.IDLE
          : undefined,
      battery: num(status.battery, 0),
    };
  },

  command({ key, value, device }) {
    if (key === 'dock' && Number(value) === 1) {
      return { commands: [{ command: 'dock' }], expected: {} };
    }
    if (key === 'run' && SIMPLE.includes(device.deviceType)) {
      const start = Number(value) === VACUUM_CLEANER_MODE.CLEANING;
      return {
        commands: [{ command: start ? 'start' : 'stop' }],
        expected: { run: start ? VACUUM_CLEANER_MODE.CLEANING : VACUUM_CLEANER_MODE.IDLE },
      };
    }
    return null;
  },
};

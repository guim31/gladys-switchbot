// -----------------------------------------------------------------------------
// Plugs and relays: Plug, Plug Mini (US, JP, EU), Relay Switch 1 and 1PM.
//
// The status fields differ by model (field names from the SwitchBot API
// documentation and the Home Assistant fixtures):
//   - Plug: `power` "ON"/"OFF", nothing measured;
//   - Plug Mini (US, JP): `power` "ON"/"OFF", `voltage` (V), `electricCurrent`
//     (mA), `weight` (W, the instant power, read as Home Assistant does);
//   - Plug Mini (EU), Relay Switch 1PM: `switchStatus` 0/1, `voltage` (V),
//     `power` (W), `electricCurrent` (mA), `usedElectricity` (watt-minutes
//     used today);
//   - Relay Switch 1: `switchStatus` 0/1.
// The current is published in amperes: the `switch` category of Gladys has
// no milliampere unit.
// -----------------------------------------------------------------------------

import { C, T, U, control, num, onOff, sensor } from './features.js';

const SIMPLE = ['Plug', 'Relay Switch 1'];
const MINI_US_JP = ['Plug Mini (US)', 'Plug Mini (JP)'];
const METERED_EU = ['Plug Mini (EU)', 'Relay Switch 1PM'];

const powerState = (status) =>
  status.switchStatus === 0 || status.switchStatus === 1
    ? status.switchStatus
    : onOff(status.power);

const amperes = (milliamperes) => {
  const value = num(milliamperes, 3);
  return value === undefined ? undefined : num(value / 1000, 3);
};

export const plug = {
  kind: 'plug',
  types: [...SIMPLE, ...MINI_US_JP, ...METERED_EU],
  webhook: true,

  features(device) {
    const specs = [control('power', 'power', C.SWITCH, T.SWITCH.BINARY, { max: 1 })];
    if (SIMPLE.includes(device.deviceType)) {
      return specs;
    }
    specs.push(
      sensor('power-usage', 'powerUsage', C.SWITCH, T.SWITCH.POWER, { max: 4000, unit: U.WATT }),
      sensor('voltage', 'voltage', C.SWITCH, T.SWITCH.VOLTAGE, { max: 300, unit: U.VOLT }),
      sensor('current', 'current', C.SWITCH, T.SWITCH.CURRENT, { max: 20, unit: U.AMPERE }),
    );
    if (METERED_EU.includes(device.deviceType)) {
      specs.push(
        sensor('energy-today', 'energyToday', C.SWITCH, T.SWITCH.ENERGY, {
          max: 100,
          unit: U.KILOWATT_HOUR,
        }),
      );
    }
    return specs;
  },

  states(status, device) {
    const values = { power: powerState(status) };
    if (SIMPLE.includes(device.deviceType)) {
      return values;
    }
    values.voltage = num(status.voltage, 1);
    values.current = amperes(status.electricCurrent);
    if (MINI_US_JP.includes(device.deviceType)) {
      values['power-usage'] = num(status.weight, 1);
    } else {
      values['power-usage'] = num(status.power, 1);
      const wattMinutes = num(status.usedElectricity, 3);
      values['energy-today'] = wattMinutes === undefined ? undefined : num(wattMinutes / 60000, 3);
    }
    return values;
  },

  command({ key, value }) {
    if (key !== 'power') {
      return null;
    }
    const on = Number(value) === 1;
    return { commands: [{ command: on ? 'turnOn' : 'turnOff' }], expected: { power: on ? 1 : 0 } };
  },
};

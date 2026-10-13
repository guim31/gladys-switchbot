// -----------------------------------------------------------------------------
// Device catalog: which SwitchBot `deviceType` maps to which kind, and how a
// SwitchBot device becomes a Gladys device.
//
// A kind (one file per family in this folder) exposes:
//   - kind, types: its name and the `deviceType` values it handles;
//   - webhook: whether SwitchBot pushes its changes by webhook;
//   - features(device, { config }): the feature specs (features.js);
//   - states(status, device): feature key → number | { text } | undefined;
//   - command({ key, value, device, status, config }) (optional): the API
//     commands of a Gladys command, and the states expected once done
//     (`{ commands, expected }`), or null when the feature is not controllable.
//
// External ids are built from the SwitchBot `deviceId` (the device MAC, or
// the remote id), never from a name: `ext:<selector>:device:<deviceId>` for a
// physical device, `ext:<selector>:remote:<deviceId>` for an IR remote, and
// `:<feature key>` for the features. They are forever.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { NAMES, OPTION_LABELS } from '../i18n.js';
import { bot } from './bot.js';
import { fan, humidifier, purifier } from './climate.js';
import { contact } from './contact.js';
import { cover } from './cover.js';
import { leak } from './leak.js';
import { light } from './light.js';
import { lock } from './lock.js';
import { meter } from './meter.js';
import { motion } from './motion.js';
import { plug } from './plug.js';
import { remote } from './remote.js';
import { vacuum } from './vacuum.js';

export const KINDS = [
  bot,
  plug,
  cover,
  lock,
  meter,
  contact,
  motion,
  leak,
  light,
  humidifier,
  purifier,
  fan,
  vacuum,
];

export const REMOTE_KIND = remote;

export const ID_TYPES = { DEVICE: 'device', REMOTE: 'remote' };

const KIND_BY_TYPE = new Map(KINDS.flatMap((kind) => kind.types.map((type) => [type, kind])));

/** The kind of a physical device type, or undefined when not supported. */
export const kindOf = (deviceType) => KIND_BY_TYPE.get(deviceType);

/** Every supported `deviceType`. */
export const SUPPORTED_TYPES = [...KIND_BY_TYPE.keys()];

/**
 * One SwitchBot device or remote, as the catalog knows it.
 * @typedef {object} Entry
 * @property {string} id SwitchBot deviceId
 * @property {string} name name given in the SwitchBot app
 * @property {boolean} remote an IR remote
 * @property {object} kind
 * @property {object} raw the device list entry
 */

/**
 * The entries of a device list, supported devices and (when asked) remotes.
 * @param {{ deviceList: object[], infraredRemoteList: object[] }} list
 * @param {{ ir_remotes: boolean }} config
 */
export function entriesOf(list, config) {
  const entries = [];
  for (const raw of list.deviceList) {
    const kind = kindOf(raw.deviceType);
    if (kind && typeof raw.deviceId === 'string' && raw.deviceId !== '') {
      entries.push({ id: raw.deviceId, name: displayName(raw), remote: false, kind, raw });
    }
  }
  if (config.ir_remotes) {
    for (const raw of list.infraredRemoteList) {
      if (typeof raw.deviceId === 'string' && raw.deviceId !== '') {
        entries.push({ id: raw.deviceId, name: displayName(raw), remote: true, kind: remote, raw });
      }
    }
  }
  return entries;
}

const displayName = (raw) =>
  typeof raw.deviceName === 'string' && raw.deviceName.trim() !== ''
    ? raw.deviceName.trim()
    : raw.deviceId;

/** The external ids of one entry. */
export const entryIds = (gladys, entry) =>
  gladys.externalIds(entry.remote ? ID_TYPES.REMOTE : ID_TYPES.DEVICE, entry.id);

/** The feature specs of one entry. */
export const specsOf = (entry, config) => entry.kind.features(entry.raw, { config });

/**
 * The Gladys device of one entry (discovery payload).
 * @param {object} gladys
 * @param {Entry} entry
 * @param {object} config normalized config
 */
export function buildDevice(gladys, entry, config) {
  const ids = entryIds(gladys, entry);
  const names = NAMES[config.language];
  const options = OPTION_LABELS[config.language];
  const features = specsOf(entry, config).map((spec) => {
    const { key, nameKey, optionsKey, ...rest } = spec;
    const feature = {
      name: names[nameKey],
      external_id: ids.feature(key),
      ...rest,
      keep_history: rest.category !== 'text',
    };
    if (optionsKey) {
      feature.supported_options = Object.entries(options[optionsKey]).map(
        ([value, label], index) => ({ value, label, sort_order: index }),
      );
    }
    return feature;
  });
  const params = [
    {
      name: 'SWITCHBOT_TYPE',
      value: String(entry.remote ? entry.raw.remoteType : entry.raw.deviceType),
    },
  ];
  const device = { name: entry.name, external_id: ids.device, features, params };
  if (entry.remote) {
    // A remote has no state to read: nothing to poll.
    device.should_poll = false;
  } else {
    // The container polls by itself (src/poller.js): the core's onPoll, once
    // a minute, is only the fallback, skipped while the timer runs.
    device.should_poll = true;
    device.poll_frequency = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;
  }
  return device;
}

/**
 * The states of one entry from its status, as `publishChangedStates` takes
 * them. Values the status does not give are left out.
 */
export function statesOf(gladys, entry, status, config) {
  const ids = entryIds(gladys, entry);
  const known = new Set(specsOf(entry, config).map((spec) => spec.key));
  return toStates(ids, entry.kind.states(status, entry.raw), known);
}

/** `{ key: value }` → publishChangedStates entries, for the keys in `known`. */
export function toStates(ids, values, known) {
  const states = [];
  for (const [key, value] of Object.entries(values)) {
    if (!known.has(key) || value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'object') {
      if (typeof value.text === 'string' && value.text !== '') {
        states.push({ device_feature_external_id: ids.feature(key), text: value.text });
      }
    } else if (Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  }
  return states;
}

/** The feature key of a feature external id of an entry, or undefined. */
export function featureKeyOf(gladys, entry, featureExternalId) {
  const prefix = `${entryIds(gladys, entry).device}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : undefined;
}

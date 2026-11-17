// -----------------------------------------------------------------------------
// The "Device diagnostics" action of the Configuration screen: the raw device
// list entry and the raw status SwitchBot returns for each physical device,
// for a user to paste on the forum when a device reads wrong (a new model, a
// value nobody documented). Read only: it never sends a command.
//
// Identifiers are masked: every value of a key `id` or ending in `Id`, `Ids`
// or `Mac` (any case) becomes an alias (`#1`, `#2`...), the same alias
// wherever the same id shows up, so a `hubDeviceId` still points to its hub.
// Names are left out (they can say whose door it is), and so is the
// `keyList` of a Keypad (its passcodes, encrypted, and their owners). The
// token and the secret only sign the requests: they are never in a response.
//
// One API call for the list, one per device, at most MAX_DEVICES devices:
// the locks first, then the types this integration does not know, the
// devices a diagnostic is usually about.
// -----------------------------------------------------------------------------

import { TEXT, translate } from './i18n.js';
import { kindOf } from './devices/index.js';

export const MAX_DEVICES = 20;

const ID_KEY = /(id|ids|mac)$/i;
const DROPPED_KEY = /(name|password|passcode|secret|token|^iv|^keylist)$/i;

/** Gladys shows a returned message in green, a thrown one in red. */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

const DIAG_TEXT = {
  en: {
    header: (shown, total, calls) =>
      `${shown} of ${total} SwitchBot device(s), ${calls} API call(s). Identifiers are masked, names left out: you can paste this on the forum.`,
    supported: 'supported',
    unsupported: 'not supported',
    noDevice: 'The SwitchBot account has no device to read (IR remotes have no status).',
    noAnswer: (reason) => `No device answered: ${reason}.`,
  },
  fr: {
    header: (shown, total, calls) =>
      `${shown} appareil(s) SwitchBot sur ${total}, ${calls} appel(s) d'API. Identifiants masqués, noms retirés : vous pouvez coller ce texte sur le forum.`,
    supported: 'pris en charge',
    unsupported: 'non pris en charge',
    noDevice:
      "Le compte SwitchBot n'a aucun appareil à lire (les télécommandes IR n'ont pas de statut).",
    noAnswer: (reason) => `Aucun appareil n'a répondu : ${reason}.`,
  },
  de: {
    header: (shown, total, calls) =>
      `${shown} von ${total} SwitchBot-Gerät(en), ${calls} API-Aufruf(e). Kennungen maskiert, Namen weggelassen: Du kannst den Text ins Forum kopieren.`,
    supported: 'unterstützt',
    unsupported: 'nicht unterstützt',
    noDevice:
      'Das SwitchBot-Konto hat kein lesbares Gerät (IR-Fernbedienungen haben keinen Status).',
    noAnswer: (reason) => `Kein Gerät hat geantwortet: ${reason}.`,
  },
  es: {
    header: (shown, total, calls) =>
      `${shown} de ${total} dispositivo(s) SwitchBot, ${calls} llamada(s) a la API. Identificadores ocultos, nombres omitidos: puede pegar este texto en el foro.`,
    supported: 'compatible',
    unsupported: 'no compatible',
    noDevice:
      'La cuenta SwitchBot no tiene ningún dispositivo que leer (los mandos IR no tienen estado).',
    noAnswer: (reason) => `Ningún dispositivo ha respondido: ${reason}.`,
  },
};

/** Replaces the identifiers of a SwitchBot object by stable aliases. */
export function maskIds(value, aliases = new Map(), key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => maskIds(item, aliases, key));
  }
  if (value !== null && typeof value === 'object') {
    const masked = {};
    for (const [k, v] of Object.entries(value)) {
      if (!DROPPED_KEY.test(k)) {
        masked[k] = maskIds(v, aliases, k);
      }
    }
    return masked;
  }
  if (ID_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
    const id = String(value)
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    if (id === '') {
      return value;
    }
    if (!aliases.has(id)) {
      aliases.set(id, `#${aliases.size + 1}`);
    }
    return aliases.get(id);
  }
  return value;
}

/**
 * Reads the list and every device status. Throws an ActionFailure when
 * nothing can be read; a device that fails is reported in its block.
 * @param {import('./hub.js').SwitchBotHub} hub
 */
export async function deviceDiagnostics(hub) {
  if (!hub.client) {
    throw new ActionFailure(TEXT.notConfigured);
  }
  let list;
  try {
    list = await hub.client.listDevices();
  } catch (err) {
    throw new ActionFailure(err?.code === 'auth' ? TEXT.authFailed : TEXT.unreachable);
  }
  const devices = list.deviceList.filter(
    (raw) => typeof raw?.deviceId === 'string' && raw.deviceId !== '',
  );
  if (devices.length === 0) {
    throw new ActionFailure(translate(DIAG_TEXT, (text) => text.noDevice));
  }
  const rank = (raw) => {
    const kind = kindOf(raw.deviceType);
    return kind?.kind === 'lock' ? 0 : kind ? 2 : 1;
  };
  const shown = devices
    .map((raw, index) => ({ raw, index }))
    .sort((a, b) => rank(a.raw) - rank(b.raw) || a.index - b.index)
    .slice(0, MAX_DEVICES)
    .map(({ raw }) => raw);
  const aliases = new Map();
  // The list entries first: their ids get the first aliases.
  const blocks = shown.map((raw) => ({ raw, entry: maskIds(raw, aliases) }));
  let answered = 0;
  let lastError;
  try {
    for (const block of blocks) {
      try {
        block.status = maskIds(await hub.client.getStatus(block.raw.deviceId), aliases);
        answered += 1;
      } catch (err) {
        if (err?.code === 'auth') {
          throw new ActionFailure(TEXT.authFailed);
        }
        lastError = err?.message ?? String(err);
        block.error = lastError;
      }
    }
  } finally {
    await hub.saveQuota({ force: true });
  }
  if (answered === 0) {
    throw new ActionFailure(translate(DIAG_TEXT, (text) => text.noAnswer(lastError)));
  }
  return translate(DIAG_TEXT, (text) =>
    [
      text.header(shown.length, devices.length, shown.length + 1),
      ...blocks.map((block) => {
        const { deviceType } = block.raw;
        const support = kindOf(deviceType) ? text.supported : text.unsupported;
        return [
          `${block.entry.deviceId} ${deviceType ?? '?'} (${support})`,
          `list: ${JSON.stringify(block.entry)}`,
          block.error ? `status: ${block.error}` : `status: ${JSON.stringify(block.status)}`,
        ].join('\n');
      }),
    ].join('\n\n'),
  );
}

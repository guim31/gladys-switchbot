// -----------------------------------------------------------------------------
// The "SwitchBot" dashboard widget (manifest `widgets`, Gladys 5.1+).
//
// What a glance should tell: the temperatures (live tiles bound to the
// thermometers' features, up to six), then one status list — doors and
// windows open, locks, water leaks, low batteries, API calls of the day. The
// facts come from the last reads of the devices added to Gladys: building the
// content costs no API call.
//
// Budget of the core: 8 components, 6 tiles, 1 status list (10 rows), 2 texts.
// The content is pre-localized from `language` (the core caches it per
// language). The hub asks for a refresh when the facts change.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import { entryIds, specsOf } from './devices/index.js';
import { LOCK_STATE } from './devices/features.js';
import { readLockState } from './devices/lock.js';
import { DAILY_LIMIT } from './quota.js';

export const WIDGET_KEY = 'overview';

const MAX_TILES = 6;
const MAX_VALUE = 40;
const MAX_LABEL = 24;

export const WIDGET_TEXT = {
  en: {
    notConfigured: 'Enter the token and the secret key of the SwitchBot app in the configuration.',
    noDevice: 'Add your SwitchBot devices to Gladys from the Discovery tab.',
    openings: 'Doors and windows',
    allClosed: 'All closed',
    leftOpen: 'left open',
    locks: 'Locks',
    allLocked: 'All locked',
    unlocked: 'unlocked',
    jammed: 'jammed',
    leaks: 'Water leaks',
    noLeak: 'None',
    batteries: 'Batteries',
    batteriesOk: 'All fine',
    api: 'API calls today',
    cloud: 'SwitchBot cloud',
    refused: 'Credentials refused',
    unreachable: 'Unreachable',
  },
  fr: {
    notConfigured:
      "Saisissez le jeton et la clé secrète de l'application SwitchBot dans la configuration.",
    noDevice: "Ajoutez vos appareils SwitchBot à Gladys depuis l'onglet Découverte.",
    openings: 'Portes et fenêtres',
    allClosed: 'Tout est fermé',
    leftOpen: 'restée ouverte',
    locks: 'Serrures',
    allLocked: 'Toutes verrouillées',
    unlocked: 'déverrouillée',
    jammed: 'bloquée',
    leaks: "Fuites d'eau",
    noLeak: 'Aucune',
    batteries: 'Piles',
    batteriesOk: 'Toutes en bon état',
    api: "Appels d'API du jour",
    cloud: 'Cloud SwitchBot',
    refused: 'Identifiants refusés',
    unreachable: 'Injoignable',
  },
  de: {
    notConfigured:
      'Gib das Token und den geheimen Schlüssel der SwitchBot-App in der Konfiguration ein.',
    noDevice: 'Füge deine SwitchBot-Geräte über den Tab „Entdecken“ zu Gladys hinzu.',
    openings: 'Türen und Fenster',
    allClosed: 'Alles geschlossen',
    leftOpen: 'offen gelassen',
    locks: 'Schlösser',
    allLocked: 'Alle verriegelt',
    unlocked: 'entriegelt',
    jammed: 'blockiert',
    leaks: 'Wasserlecks',
    noLeak: 'Keine',
    batteries: 'Batterien',
    batteriesOk: 'Alle in Ordnung',
    api: 'API-Aufrufe heute',
    cloud: 'SwitchBot-Cloud',
    refused: 'Zugangsdaten abgelehnt',
    unreachable: 'Nicht erreichbar',
  },
  es: {
    notConfigured:
      'Introduzca el token y la clave secreta de la aplicación SwitchBot en la configuración.',
    noDevice: 'Añada sus dispositivos SwitchBot a Gladys desde la pestaña Descubrir.',
    openings: 'Puertas y ventanas',
    allClosed: 'Todo cerrado',
    leftOpen: 'abierta demasiado tiempo',
    locks: 'Cerraduras',
    allLocked: 'Todas bloqueadas',
    unlocked: 'desbloqueada',
    jammed: 'atascada',
    leaks: 'Fugas de agua',
    noLeak: 'Ninguna',
    batteries: 'Baterías',
    batteriesOk: 'Todas bien',
    api: 'Llamadas a la API hoy',
    cloud: 'Nube de SwitchBot',
    refused: 'Credenciales rechazadas',
    unreachable: 'Inaccesible',
  },
};

/** Names joined within the row limit: "Kitchen, Hall +2". */
export function joinNames(names, max = MAX_VALUE) {
  const shown = [];
  for (let i = 0; i < names.length; i += 1) {
    const rest = names.length - i - 1;
    const candidate = [...shown, names[i]].join(', ') + (rest > 0 ? ` +${rest}` : '');
    if (candidate.length > max && shown.length > 0) {
      return `${shown.join(', ')} +${names.length - shown.length}`;
    }
    shown.push(names[i]);
  }
  const text = shown.join(', ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const formatCount = (count, language) =>
  new Intl.NumberFormat({ en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language]).format(
    count,
  );

/**
 * The widget content.
 * @param {import('./hub.js').SwitchBotHub} hub
 * @param {{ language?: string }} request
 */
export function buildOverview(hub, { language } = {}) {
  const lang = WIDGET_TEXT[language] ? language : 'en';
  const text = WIDGET_TEXT[lang];
  if (!isConfigured(hub.config)) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: text.notConfigured }],
    };
  }
  const entries = hub
    .createdEntries()
    .filter((entry) => !entry.remote)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: text.noDevice }],
    };
  }

  const components = [];
  const hasFeature = (entry, key) => specsOf(entry, hub.config).some((spec) => spec.key === key);

  for (const entry of entries.filter((e) => hasFeature(e, 'temperature')).slice(0, MAX_TILES)) {
    components.push({
      type: 'value',
      label: shorten(entry.name, MAX_LABEL),
      device_feature: entryIds(hub.gladys, entry).feature('temperature'),
    });
  }

  const items = [];
  const signal = (entry) => hub.signals.get(entry.id) ?? {};

  const contacts = entries.filter((e) => e.kind.kind === 'contact');
  if (contacts.length > 0) {
    const open = contacts.filter((e) => ['open', 'left_open'].includes(signal(e).contact));
    const leftOpen = open.filter((e) => signal(e).contact === 'left_open');
    items.push({
      label: text.openings,
      icon: 'home',
      value:
        open.length === 0
          ? text.allClosed
          : joinNames(
              open.map((e) =>
                signal(e).contact === 'left_open' ? `${e.name} (${text.leftOpen})` : e.name,
              ),
            ),
      color:
        open.length === 0
          ? WIDGET_COLORS.SUCCESS
          : leftOpen.length > 0
            ? WIDGET_COLORS.DANGER
            : WIDGET_COLORS.WARNING,
    });
  }

  const locks = entries.filter((e) => e.kind.kind === 'lock');
  if (locks.length > 0) {
    const states = locks.map((e) => [e, readLockState(hub.statuses.get(e.id)?.lockState)]);
    const notLocked = states.filter(
      ([, state]) => state === LOCK_STATE.UNLOCKED || state === LOCK_STATE.ERROR,
    );
    const jammed = notLocked.some(([, state]) => state === LOCK_STATE.ERROR);
    items.push({
      label: text.locks,
      icon: 'lock',
      value:
        notLocked.length === 0
          ? text.allLocked
          : joinNames(
              notLocked.map(
                ([e, state]) =>
                  `${e.name} (${state === LOCK_STATE.ERROR ? text.jammed : text.unlocked})`,
              ),
            ),
      color:
        notLocked.length === 0
          ? WIDGET_COLORS.SUCCESS
          : jammed
            ? WIDGET_COLORS.DANGER
            : WIDGET_COLORS.WARNING,
    });
  }

  const leaks = entries.filter((e) => e.kind.kind === 'leak');
  if (leaks.length > 0) {
    const wet = leaks.filter((e) => signal(e).leak === 1);
    items.push({
      label: text.leaks,
      icon: 'droplet',
      value: wet.length === 0 ? text.noLeak : joinNames(wet.map((e) => e.name)),
      color: wet.length === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    });
  }

  const powered = entries.filter((e) => hasFeature(e, 'battery'));
  if (powered.length > 0) {
    const low = powered.filter((e) => signal(e).batteryLow === true);
    items.push({
      label: text.batteries,
      icon: 'battery',
      value:
        low.length === 0
          ? text.batteriesOk
          : joinNames(low.map((e) => `${e.name} (${signal(e).battery} %)`)),
      color: low.length === 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }

  if (hub.connection === 'auth' || hub.connection === 'unreachable') {
    items.push({
      label: text.cloud,
      icon: 'cloud-off',
      value: hub.connection === 'auth' ? text.refused : text.unreachable,
      color: WIDGET_COLORS.DANGER,
    });
  }

  const used = hub.quota.used();
  items.push({
    label: text.api,
    icon: 'activity',
    value: `${formatCount(used, lang)} / ${formatCount(DAILY_LIMIT, lang)}`,
    color: used >= DAILY_LIMIT * 0.9 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
  });

  components.push({ type: 'status', items });
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildOverview(hub, request),
  },
};

// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// `poll_interval` options, in minutes; `auto` sizes the pace on the number of
// devices to stay well inside the daily quota (see src/quota.js).
export const POLL_INTERVALS = ['auto', '1', '2', '5', '10', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  token: '',
  secret: '',
  poll_interval: 'auto',
  webhook: false,
  ir_remotes: false,
  lock_control: false,
  language: 'fr',
};

// A token or secret pasted from the app may carry spaces or line breaks.
const cleanCredential = (value) => (typeof value === 'string' ? value.replace(/\s+/g, '') : '');

// Config values arrive as strings from some forms: accept both.
const toBoolean = (value, fallback) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = String(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  const language = String(source.language ?? DEFAULT_CONFIG.language);
  return {
    token: cleanCredential(source.token),
    secret: cleanCredential(source.secret),
    poll_interval: POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval,
    webhook: toBoolean(source.webhook, DEFAULT_CONFIG.webhook),
    ir_remotes: toBoolean(source.ir_remotes, DEFAULT_CONFIG.ir_remotes),
    lock_control: toBoolean(source.lock_control, DEFAULT_CONFIG.lock_control),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}

/** Both credentials are needed to sign a request. */
export function isConfigured(config) {
  return config.token !== '' && config.secret !== '';
}

/** The chosen polling interval in milliseconds, or null for `auto`. */
export function chosenIntervalMs(config) {
  return config.poll_interval === 'auto' ? null : Number(config.poll_interval) * 60_000;
}

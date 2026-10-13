// -----------------------------------------------------------------------------
// SwitchBot webhook through Gladys Plus (optional, "webhook" setting).
//
// SwitchBot can POST every change of the account's devices to ONE URL. A
// local Gladys is not reachable from the Internet, but Gladys Plus relays
// webhooks to the integration (manifest `webhooks`, the user pastes an Open
// API key in the "Gladys Plus webhooks" block): the integration registers the
// relay URL at SwitchBot, on every connection and when the URL changes.
//
// SwitchBot keeps a single webhook URL per account: registering this one
// removes the URL another app (Home Assistant...) may have registered. That
// is why the setting is off by default, and said so in the configuration.
//
// Doctrine "trigger, not data": an event only says which device changed. The
// device is then read through the API (once per burst: events are coalesced
// per device), and polling goes on, slower, as the source of truth.
//
// The relay URL contains the user's Open API key: it is never logged.
// -----------------------------------------------------------------------------

export const WEBHOOK_KEY = 'events';

export const WEBHOOK_STATES = {
  OFF: 'off',
  NO_PLUS: 'no_plus',
  ACTIVE: 'active',
  FAILED: 'failed',
};

/** The SwitchBot device id an event is about, or null. */
export function eventDeviceId(body) {
  let payload = body;
  if (typeof body === 'string') {
    try {
      payload = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const mac = payload?.context?.deviceMac;
  if (payload?.eventType !== 'changeReport' || typeof mac !== 'string' || mac === '') {
    return null;
  }
  return mac;
}

/** `AA:BB:CC:00:11:22` and `aabbcc001122` are the same device. */
export const normalizeId = (id) =>
  String(id)
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

/**
 * @param {object} options
 * @param {object} options.gladys
 * @param {() => object} options.getClient the SwitchBot client of the current config
 * @param {() => object} options.getConfig
 * @param {object} options.logger
 * @param {object} options.issues issue log (src/issues.js)
 */
export function createWebhookManager({ gladys, getClient, getConfig, logger, issues }) {
  let state = WEBHOOK_STATES.OFF;
  // The relay URL this integration registered, to remove it when the
  // setting is turned off. Never logged.
  let registeredUrl = null;

  async function unregister() {
    if (!registeredUrl) {
      return;
    }
    const url = registeredUrl;
    registeredUrl = null;
    try {
      const urls = await getClient().queryWebhookUrls();
      if (urls.includes(url)) {
        await getClient().deleteWebhook(url);
        logger.info('SwitchBot webhook removed');
      }
    } catch (err) {
      logger.warn(`SwitchBot webhook not removed (${err.message})`);
    }
  }

  return {
    state: () => state,

    /** Register (or remove) the webhook to match the setting and Gladys Plus. */
    async sync() {
      if (!getConfig().webhook) {
        await unregister();
        state = WEBHOOK_STATES.OFF;
        return state;
      }
      let url;
      try {
        const { available, webhooks } = await gladys.getWebhooks();
        url = available ? webhooks.find((webhook) => webhook.key === WEBHOOK_KEY)?.url : null;
      } catch (err) {
        issues.fail('webhook', `Gladys Plus webhooks unavailable (${err.message})`);
        state = WEBHOOK_STATES.FAILED;
        return state;
      }
      if (!url) {
        if (state !== WEBHOOK_STATES.NO_PLUS) {
          logger.info('Webhook enabled, but Gladys Plus webhooks are not set up: polling only');
        }
        state = WEBHOOK_STATES.NO_PLUS;
        return state;
      }
      try {
        const client = getClient();
        const urls = await client.queryWebhookUrls();
        if (!urls.includes(url)) {
          for (const other of urls) {
            await client.deleteWebhook(other);
            logger.info('Replaced the webhook URL another app had registered at SwitchBot');
          }
          await client.setupWebhook(url);
        }
        registeredUrl = url;
        issues.ok('webhook', 'SwitchBot webhook registered again');
        if (state !== WEBHOOK_STATES.ACTIVE) {
          logger.info('SwitchBot webhook registered: changes arrive in real time');
        }
        state = WEBHOOK_STATES.ACTIVE;
      } catch (err) {
        issues.fail('webhook', `SwitchBot webhook not registered (${err.message})`);
        state = WEBHOOK_STATES.FAILED;
      }
      return state;
    },

    /** Remove this integration's URL, with the current client (before a new config). */
    async disable() {
      await unregister();
      state = WEBHOOK_STATES.OFF;
    },
  };
}

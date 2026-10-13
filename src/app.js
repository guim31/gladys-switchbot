// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SwitchBotHub } from './hub.js';
import { TEXT } from './i18n.js';
import { checkReport } from './report.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WEBHOOK_KEY, eventDeviceId } from './webhook.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'switchbot-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: fetch, dataDir, timers, now, later
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new SwitchBotHub({ gladys, ...options });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first discovery is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = await gladys.getConfig();
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      logger.info('Search requested from the Discovery tab');
      await hub.discover();
    }),
  );

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  gladys.onPoll(whenReady((device) => hub.onPoll(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((config) => hub.reconfigure(config)));

  gladys.onAction(
    'check_connection',
    whenReady(async () => {
      logger.info('Connection test requested');
      await hub.discover();
      return checkReport(hub);
    }),
  );

  gladys.onWebhook(WEBHOOK_KEY, async ({ body }) => {
    await ready;
    const deviceId = eventDeviceId(body);
    if (deviceId) {
      hub.onWebhookEvent(deviceId);
    }
  });
  gladys.onWebhookUpdated(whenReady(() => hub.webhook.sync()));

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return { hub, ready, stop: () => hub.stop() };
}

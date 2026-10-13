// -----------------------------------------------------------------------------
// A test world: the integration wired on the SDK's fake Gladys
// (`@gladysassistant/integration-sdk/testing`) and on the fake SwitchBot
// cloud, timers off and delayed work collected, so a test runs it when it
// wants.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { SECRET, TOKEN, createFakeSwitchBot } from './fakeSwitchBot.js';

// The integration's logs stay quiet in the tests (test/logs.test.js sets
// its own level).
process.env.LOG_LEVEL ??= 'silent';

export const PLUS_URL =
  'https://api.gladysgateway.com/v1/api/external-integration/open-api-key-secret/test-integration/events';

/**
 * @param {object} [options]
 * @param {object} [options.config] config values on top of the credentials
 * @param {boolean} [options.configured] give the credentials (default true)
 * @param {boolean} [options.addAll] add every discovered device to Gladys (default true)
 * @param {object} [options.webhooks] Gladys Plus webhook state
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the real poller timer
 * @param {number} [options.tickMs]
 */
export async function createWorld({
  config = {},
  configured = true,
  addAll = true,
  webhooks,
  now,
  timers = false,
  tickMs,
} = {}) {
  const cloud = createFakeSwitchBot();
  const gladys = createFakeGladys({
    config: { ...(configured ? { token: TOKEN, secret: SECRET } : {}), ...config },
    webhooks,
  });
  const delayed = [];
  const app = registerHandlers(gladys, {
    fetch: cloud.fetch,
    dataDir: null,
    timers,
    tickMs,
    now,
    later: (fn, ms) => delayed.push({ fn, ms }),
  });
  await gladys.connect();
  await app.ready;

  const world = {
    gladys,
    app,
    hub: app.hub,
    cloud,
    delayed,

    /** Run the delayed work (refresh after a command, webhook reads). */
    async runDelayed() {
      while (delayed.length > 0) {
        const { fn } = delayed.shift();
        await fn();
      }
    },

    /** Add one discovered device to Gladys, the way the user would. */
    async add(device) {
      await gladys.fake.deviceCreated(device);
    },

    /** The discovered device of a SwitchBot id. */
    discovered(id) {
      return gladys.fake.discoveredDevices.find((device) => device.external_id.endsWith(`:${id}`));
    },

    /** The last state Gladys received for a feature of a SwitchBot device. */
    state(id, key) {
      return gladys.fake.lastState(`ext:test-integration:device:${id}:${key}`);
    },

    feature(id, key) {
      return world.discovered(id).features.find((f) => f.external_id.endsWith(`:${key}`));
    },
  };

  if (addAll) {
    for (const device of gladys.fake.discoveredDevices) {
      await world.add(device);
    }
  }
  return world;
}

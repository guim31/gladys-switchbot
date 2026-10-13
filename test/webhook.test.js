// -----------------------------------------------------------------------------
// The SwitchBot webhook through Gladys Plus: registration (off by default,
// SwitchBot keeps one URL per account), events read as triggers (the device
// is read through the API, once per burst), slower polling while it works.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEBHOOK_DEBOUNCE_MS } from '../src/hub.js';
import { WEBHOOK_FALLBACK_PERIOD_MS } from '../src/quota.js';
import { eventDeviceId } from '../src/webhook.js';
import { PLUS_URL, createWorld } from './helpers/world.js';

const PLUS = {
  available: true,
  webhooks: [{ key: 'events', mode: 'fire_and_forget', url: PLUS_URL }],
};

const event = (mac, extra = {}) =>
  JSON.stringify({
    eventType: 'changeReport',
    eventVersion: '1',
    context: {
      deviceType: 'WoContact',
      deviceMac: mac,
      openState: 'open',
      timeOfSample: 1,
      ...extra,
    },
  });

test('off by default: no webhook call at all', async () => {
  const world = await createWorld({ webhooks: PLUS });
  assert.equal(world.cloud.count('webhook'), 0);
  assert.equal(world.hub.webhook.state(), 'off');
});

test('on, with Gladys Plus: registered, replacing the URL of another app', async () => {
  const world = await createWorld({ addAll: false });
  world.cloud.webhookUrls = ['https://other-app.example/hook'];
  await world.gladys.fake.webhookUpdated(PLUS);
  assert.equal(world.cloud.count('webhook'), 0, 'setting still off');
  await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, webhook: true });
  assert.deepEqual(world.cloud.webhookUrls, [PLUS_URL]);
  assert.equal(world.hub.webhook.state(), 'active');
  // Already registered: a reconnection only checks.
  await world.hub.webhook.sync();
  assert.deepEqual(world.cloud.webhookUrls, [PLUS_URL]);
  const report = await world.gladys.fake.action('check_connection');
  assert.match(report.data.message.fr, /Webhook : actif/);
});

test('a new relay URL from Gladys Plus is registered in place of the old one', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  const next = PLUS_URL.replace('open-api-key-secret', 'new-key');
  await world.gladys.fake.webhookUpdated({
    available: true,
    webhooks: [{ key: 'events', url: next }],
  });
  assert.deepEqual(world.cloud.webhookUrls, [next]);
});

test('on, without Gladys Plus: polling only, and said so', async () => {
  const world = await createWorld({ config: { webhook: true } });
  assert.equal(world.hub.webhook.state(), 'no_plus');
  assert.equal(world.cloud.count('webhook'), 0);
  const report = await world.gladys.fake.action('check_connection');
  assert.match(report.data.message.en, /Gladys Plus is not linked, polling only/);
});

test('turned off: this integration removes its URL', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  assert.deepEqual(world.cloud.webhookUrls, [PLUS_URL]);
  await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, webhook: false });
  assert.deepEqual(world.cloud.webhookUrls, []);
  assert.equal(world.hub.webhook.state(), 'off');
});

test('an event reads the device once per burst (trigger, not data)', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  const id = 'F00000000010';
  const reads = () => world.cloud.calls.filter((c) => c.kind === 'status' && c.id === id).length;
  const before = reads();
  world.cloud.statuses[id].openState = 'open';
  for (let i = 0; i < 3; i += 1) {
    await world.gladys.fake.webhook('events', { method: 'POST', body: event(id) });
  }
  assert.equal(world.delayed.length, 1);
  assert.equal(world.delayed[0].ms, WEBHOOK_DEBOUNCE_MS);
  // The payload is not applied: the state changes with the read.
  assert.equal(world.state(id, 'contact'), 1);
  await world.runDelayed();
  assert.equal(reads(), before + 1);
  assert.equal(world.state(id, 'contact'), 0);
});

test('events for unknown devices, other event types and garbage are ignored', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  const bodies = [
    event('FFFFFFFFFFFF'),
    '{"eventType":"somethingElse","context":{"deviceMac":"F00000000010"}}',
    'not json',
    '',
    undefined,
  ];
  for (const body of bodies) {
    await world.gladys.fake.webhook('events', { method: 'POST', body });
  }
  assert.equal(world.delayed.length, 0);
  assert.equal(eventDeviceId({ eventType: 'changeReport', context: { deviceMac: 'AB' } }), 'AB');
});

test('a MAC written with colons or in lower case is the same device', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  await world.gladys.fake.webhook('events', { method: 'POST', body: event('f0:00:00:00:00:11') });
  assert.equal(world.delayed.length, 1);
});

test('while the webhook works, the devices it covers are polled slowly', async () => {
  const world = await createWorld({ config: { webhook: true }, webhooks: PLUS });
  const contact = world.hub.entries.get('F00000000010');
  const humidifier = world.hub.entries.get('F00000000016');
  assert.equal(world.hub.periodFor(contact), WEBHOOK_FALLBACK_PERIOD_MS);
  // The Humidifier sends no webhook: normal pace.
  assert.equal(world.hub.periodFor(humidifier), world.hub.basePeriodMs());
  assert.ok(world.hub.basePeriodMs() < WEBHOOK_FALLBACK_PERIOD_MS);
});

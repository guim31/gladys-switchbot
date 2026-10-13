// -----------------------------------------------------------------------------
// Configuration normalization, and the "Test the connection" report.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, chosenIntervalMs, isConfigured, normalizeConfig } from '../src/config.js';
import { createWorld } from './helpers/world.js';

test('defaults, and values from a form', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const config = normalizeConfig({
    token: ' abc\n123 ',
    secret: 'sec ret',
    poll_interval: 5,
    webhook: 'true',
    ir_remotes: 1,
    lock_control: 'false',
    language: 'de',
  });
  assert.deepEqual(config, {
    token: 'abc123',
    secret: 'secret',
    poll_interval: '5',
    webhook: true,
    ir_remotes: true,
    lock_control: false,
    language: 'de',
  });
  assert.equal(chosenIntervalMs(config), 300_000);
  assert.equal(chosenIntervalMs(normalizeConfig()), null);
  assert.equal(normalizeConfig({ poll_interval: '7', language: 'it' }).poll_interval, 'auto');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(isConfigured(normalizeConfig({ token: 'a' })), false);
  assert.equal(isConfigured(normalizeConfig({ token: 'a', secret: 'b' })), true);
});

test('not configured: a status asks for the credentials, nothing is called', async () => {
  const world = await createWorld({ configured: false });
  assert.equal(world.cloud.calls.length, 0);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /jeton et la clé secrète/);
  const report = await world.gladys.fake.action('check_connection');
  assert.match(report.data.message.en, /Enter the token/);
});

test('the connection report: devices, unsupported ones, remotes, pace, calls', async () => {
  const world = await createWorld();
  const { data } = await world.gladys.fake.action('check_connection');
  assert.deepEqual(Object.keys(data.message).sort(), ['de', 'en', 'es', 'fr']);
  assert.match(data.message.en, /28 SwitchBot device\(s\), 26 supported\./);
  assert.match(data.message.en, /Not supported: Hub Mini, Indoor Cam\./);
  assert.match(data.message.en, /3 IR remote\(s\) \(turn on the IR remotes option/);
  assert.match(data.message.en, /26 device\(s\) polled every 8 min\./);
  assert.match(data.message.fr, /Appels d'API aujourd'hui : \d+ sur 10 000\./);
});

test('refused credentials are reported in the status and the report', async () => {
  const world = await createWorld({ addAll: false });
  world.cloud.refuseAll = true;
  const { data } = await world.gladys.fake.action('check_connection');
  assert.match(data.message.de, /SwitchBot lehnt die Zugangsdaten ab/);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
});

test('a new token: the account is read again, the states start over', async () => {
  const world = await createWorld();
  const lists = world.cloud.count('list');
  await world.gladys.fake.configUpdated({ token: 'other', secret: 'other' });
  assert.equal(world.cloud.count('list'), lists);
  assert.equal(world.hub.connection, 'auth');
  assert.equal(world.hub.statuses.size, 0);
});

// -----------------------------------------------------------------------------
// The "SwitchBot" dashboard widget: rendered exactly as sent (the SDK's own
// validator), within the core budget, its live tiles bound to features that
// exist, and its texts in the four languages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_TEXT, joinNames } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const get = async (world, language = 'fr') => {
  const ack = await world.gladys.fake.widgetGet('overview', { language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

test('the widget fits the core vocabulary and budget, in every language', async () => {
  const world = await createWorld();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const content = await get(world, language);
    assert.deepEqual(validateWidgetContent(content), [], language);
    assert.ok(content.components.length <= 8);
    assert.ok(content.components.filter((c) => c.type === 'value').length <= 6);
    assert.equal(content.components.filter((c) => c.type === 'status').length, 1);
  }
});

test('the temperature tiles are bound to features of added devices', async () => {
  const world = await createWorld();
  const content = await get(world);
  const features = new Set(
    world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.equal(tiles.length, 6);
  for (const tile of tiles) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
    assert.ok(tile.device_feature.endsWith(':temperature'));
    assert.ok(tile.label.length <= 24);
  }
});

test('the status rows say what needs attention', async () => {
  const world = await createWorld();
  let rows = (await get(world, 'en')).components.find((c) => c.type === 'status').items;
  const row = (label) => rows.find((r) => r.label === label);
  assert.deepEqual(row('Doors and windows'), {
    label: 'Doors and windows',
    icon: 'home',
    value: 'All closed',
    color: 'success',
  });
  assert.equal(row('Locks').value, "Porte d'entrée (unlocked)");
  assert.equal(row('Locks').color, 'warning');
  assert.equal(row('Water leaks').value, 'None');
  // Bot radiateur 19 %, Extérieur 20 %, Couloir 20 %, Ventilateur 22 %... (≤ 20 %).
  assert.match(row('Batteries').value, /Bot radiateur \(19 %\)/);
  assert.equal(row('Batteries').color, 'warning');
  assert.match(row('API calls today').value, /^\d+ \/ 10,000$/);

  world.cloud.statuses.F00000000010.openState = 'timeOutNotClose';
  world.cloud.statuses.F00000000012.status = 1;
  await world.hub.refresh(world.hub.entries.get('F00000000010'));
  await world.hub.refresh(world.hub.entries.get('F00000000012'));
  rows = (await get(world, 'en')).components.find((c) => c.type === 'status').items;
  assert.equal(row('Doors and windows').value, 'Fenêtre cuisine (left open)');
  assert.equal(row('Doors and windows').color, 'danger');
  assert.equal(row('Water leaks').value, 'Salle de bain');
  assert.equal(row('Water leaks').color, 'danger');
  for (const item of rows) {
    assert.ok(String(item.value).length <= 40, item.value);
    assert.ok(item.label.length <= 40, item.label);
  }
});

test('the widget asks for a refresh when what it shows changes, not on every read', async () => {
  const world = await createWorld();
  const before = world.gladys.fake.widgetRefreshes.length;
  await world.hub.refresh(world.hub.entries.get('F0000000000D'));
  assert.equal(world.gladys.fake.widgetRefreshes.length, before);
  world.cloud.statuses.F00000000012.status = 1;
  await world.hub.refresh(world.hub.entries.get('F00000000012'));
  assert.equal(world.gladys.fake.widgetRefreshes.length, before + 1);
});

test('without credentials or devices, the widget says what to do', async () => {
  const unconfigured = await createWorld({ configured: false });
  const content = await get(unconfigured, 'de');
  assert.deepEqual(content.components, [
    { type: 'text', variant: 'body', text: WIDGET_TEXT.de.notConfigured },
  ]);
  assert.deepEqual(validateWidgetContent(content), []);
  const empty = await createWorld({ addAll: false });
  assert.equal((await get(empty, 'es')).components[0].text, WIDGET_TEXT.es.noDevice);
});

test('long name lists are cut within the row limit', () => {
  assert.equal(joinNames(['Kitchen', 'Hall']), 'Kitchen, Hall');
  const long = joinNames(['A very long window name', 'Another long window name', 'Third one']);
  assert.ok(long.length <= 40, long);
  assert.match(long, /\+2$/);
  assert.ok(joinNames(['x'.repeat(60)]).length <= 40);
});

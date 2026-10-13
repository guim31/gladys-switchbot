// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/switchbot: the documented responses of 26 supported
// SwitchBot devices and 3 IR remotes), with and without the options that
// change the structure, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'default options', config: {}, expected: 26 },
  {
    label: 'IR remotes and lock control',
    config: { ir_remotes: true, lock_control: true },
    expected: 29,
  },
  { label: 'English names', config: { ir_remotes: true, language: 'en' }, expected: 29 },
  {
    label: 'German names',
    config: { ir_remotes: true, lock_control: true, language: 'de' },
    expected: 29,
  },
  { label: 'Spanish names', config: { ir_remotes: true, language: 'es' }, expected: 29 },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld({ config: scenario.config, addAll: false });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, scenario.expected);
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          assert.equal(typeof feature.name, 'string', `${at}: name`);
          assert.ok(feature.name.trim() !== '', `${at}: empty name`);
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.flat().includes(feature.unit),
                `${at}: unit ${feature.unit} not for ${feature.category}`,
              );
            }
          }
          if (feature.supported_options !== undefined) {
            assert.equal(
              `${feature.category}/${feature.type}`,
              'text/select',
              `${at}: string options`,
            );
            for (const option of feature.supported_options) {
              assert.ok(
                typeof option.label === 'string' && option.label.trim() !== '',
                `${at}: option label`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: id prefix`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('every published state targets a declared feature and fits its bounds', async () => {
  const { gladys, app } = await createWorld({ config: { ir_remotes: true, lock_control: true } });
  try {
    const features = new Map(
      gladys.fake.discoveredDevices.flatMap((d) => d.features).map((f) => [f.external_id, f]),
    );
    assert.ok(gladys.fake.states.length > 60, `only ${gladys.fake.states.length} states`);
    for (const state of gladys.fake.states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `${state.device_feature_external_id}: no such feature`);
      if (feature.category === 'text') {
        assert.equal(typeof state.text, 'string', `${feature.external_id}: text state`);
        assert.ok(state.text !== '', `${feature.external_id}: empty text`);
        if (feature.supported_options) {
          assert.ok(feature.supported_options.some((o) => o.value === state.text));
        }
      } else {
        assert.equal(typeof state.state, 'number', `${feature.external_id}: numeric state`);
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.external_id}: ${state.state} outside [${feature.min}, ${feature.max}]`,
        );
      }
    }
  } finally {
    await app.stop();
  }
});

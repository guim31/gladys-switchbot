// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { TRIGGER_KEYS } from '../src/events.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WEBHOOK_KEY } from '../src/webhook.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

/** The keys the code registers, per handler family, read from a real client. */
function registeredKeys() {
  const gladys = createFakeGladys();
  const keys = { action: [], scene: [], widget: [], webhook: [] };
  for (const [method, family] of [
    ['onAction', 'action'],
    ['onSceneAction', 'scene'],
    ['onWidgetGet', 'widget'],
    ['onWebhook', 'webhook'],
  ]) {
    const original = gladys[method].bind(gladys);
    gladys[method] = (key, handler) => {
      keys[family].push(key);
      return original(key, handler);
    };
  }
  registerHandlers(gladys, { dataDir: null, timers: false });
  return keys;
}

test('identity: name, image, cloud transport, categories', () => {
  assert.equal(manifest.name, 'SwitchBot');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-switchbot:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-switchbot/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['environment', 'lighting', 'security']);
});

test('every handler the code registers is declared, and vice versa', () => {
  const keys = registeredKeys();
  assert.deepEqual(keys.action.sort(), keysOf(manifest.actions).sort());
  assert.deepEqual(keys.scene.sort(), keysOf(manifest.scene_actions).sort());
  assert.deepEqual(keys.widget.sort(), keysOf(manifest.widgets).sort());
  assert.deepEqual(keys.webhook, keysOf(manifest.webhooks));
  assert.deepEqual(keys.webhook, [WEBHOOK_KEY]);
  assert.deepEqual(Object.keys(SCENE_ACTIONS).sort(), keysOf(manifest.scene_actions).sort());
  assert.deepEqual(Object.keys(WIDGETS), keysOf(manifest.widgets));
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual([...TRIGGER_KEYS].sort(), keysOf(manifest.scene_triggers).sort());
});

test('the keys users store are the published ones (never renamed)', () => {
  assert.deepEqual(keysOf(manifest.config_schema), [
    'intro',
    'token',
    'secret',
    'poll_interval',
    'webhook',
    'ir_remotes',
    'lock_control',
    'language',
  ]);
  assert.deepEqual(keysOf(manifest.actions), ['check_connection']);
  assert.deepEqual(keysOf(manifest.scene_triggers), [
    'contact_changed',
    'motion_detected',
    'leak_detected',
    'battery_low',
  ]);
  assert.deepEqual(keysOf(manifest.scene_actions), ['press_bot', 'send_ir_command']);
  assert.deepEqual(keysOf(manifest.widgets), ['overview']);
  assert.deepEqual(keysOf(manifest.webhooks), ['events']);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget button opens a form (#3168, 5.2.0): 5.1.0 is enough.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('poll_interval'), POLL_INTERVALS);
  assert.deepEqual(options('language'), LANGUAGES);
  // The credentials are secrets, required, without default.
  for (const key of ['token', 'secret']) {
    const field = manifest.config_schema.find((f) => f.key === key);
    assert.equal(field.type, 'secret');
    assert.equal(field.required, true);
    assert.equal(field.default, undefined);
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, and no required field (Gladys#3154, #3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.notEqual(field.required, true, `${action.key}.${field.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en);
  }
});

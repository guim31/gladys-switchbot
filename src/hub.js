// -----------------------------------------------------------------------------
// The SwitchBot hub: what the integration knows of the account, and every
// operation the SDK handlers delegate to (src/app.js wires them).
//
//   - discovery: one `GET /devices` on start, on reconnection, on a new
//     configuration and when the user searches in the Discovery tab;
//   - reads: one `GET /devices/{id}/status` per device added to Gladys, on
//     the timer of src/poller.js, after a command and on a webhook event;
//     only the changed values are published (SDK deduplication), with a
//     heartbeat so a stable value stays dated in Gladys;
//   - commands: `POST /devices/{id}/commands`, then the expected state is
//     published at once and the device read again a few seconds later.
//
// Logs: nothing at info level for a normal cycle (reads, states). Info keeps
// the lifecycle (start, connection lost and back) and one line per user
// action; a repeated failure writes one line when it starts and one when it
// ends (src/issues.js). Credentials are never logged.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { chosenIntervalMs, isConfigured, normalizeConfig } from './config.js';
import {
  REMOTE_KIND,
  buildDevice,
  entriesOf,
  entryIds,
  featureKeyOf,
  kindOf,
  specsOf,
  statesOf,
  toStates,
} from './devices/index.js';
import { irCommand } from './devices/remote.js';
import { detectEvents, signalsOf } from './events.js';
import { TEXT } from './i18n.js';
import { createIssueLog } from './issues.js';
import { createPoller } from './poller.js';
import { WEBHOOK_FALLBACK_PERIOD_MS, createQuota, pollPeriodMs } from './quota.js';
import { createClient } from './switchbot/client.js';
import { WEBHOOK_STATES, createWebhookManager, normalizeId } from './webhook.js';
import { WIDGET_KEY } from './widgets.js';

// A stable value is published again at least this often, so Gladys never
// shows it as stale ("no recent value" past 48 h).
export const HEARTBEAT_MS = 6 * 3600_000;
// Read a device again this long after a command, to show its real state.
export const COMMAND_REFRESH_MS = 5_000;
export const COVER_REFRESH_MS = 15_000;
// Webhook events of one device within this delay are read once.
export const WEBHOOK_DEBOUNCE_MS = 2_000;
// Retry delays when the account is unreachable or refuses the credentials.
export const RETRY_UNREACHABLE_MS = 5 * 60_000;
export const RETRY_AUTH_MS = 30 * 60_000;

export const CONNECTION = {
  UNCONFIGURED: 'unconfigured',
  OK: 'ok',
  AUTH: 'auth',
  UNREACHABLE: 'unreachable',
};

export class SwitchBotHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {typeof fetch} [options.fetch] test seam
   * @param {string|null} [options.dataDir] where the quota count is saved (null: memory)
   * @param {boolean} [options.timers] run the timers (tests turn them off)
   * @param {() => number} [options.now]
   * @param {(fn: Function, ms: number) => void} [options.later] delayed work (tests run it now)
   * @param {number} [options.tickMs] poller tick (tests shorten it)
   */
  constructor({
    gladys,
    fetch,
    dataDir = '/data',
    timers = true,
    now = () => Date.now(),
    later,
    tickMs,
  }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.now = now;
    this.timers = timers;
    this.later =
      later ??
      ((fn, ms) => {
        if (timers) {
          setTimeout(fn, ms).unref?.();
        }
      });
    this.logger = createLogger({ name: 'switchbot' });
    this.issues = createIssueLog(this.logger);
    this.quota = createQuota({ dataDir, now, logger: this.logger });
    this.config = normalizeConfig();
    this.client = null;
    this.connection = CONNECTION.UNCONFIGURED;
    this.nextRetryAt = 0;
    /** @type {Map<string, object>} SwitchBot id → catalog entry */
    this.entries = new Map();
    this.unsupportedTypes = [];
    this.deviceCount = 0;
    this.remoteCount = 0;
    this.statuses = new Map();
    this.signals = new Map();
    this.transports = new Map();
    this.pendingWebhook = new Set();
    this.widgetSignature = null;
    this.webhook = createWebhookManager({
      gladys,
      getClient: () => this.client,
      getConfig: () => this.config,
      logger: this.logger,
      issues: this.issues,
    });
    this.poller = createPoller({ hub: this, timers, now, tickMs });
  }

  // --- Lifecycle -------------------------------------------------------------

  /** First connection to Gladys. */
  async start(rawConfig) {
    await this.quota.load();
    this.applyConfig(rawConfig);
    await this.connect();
  }

  /** Reconnection to Gladys (it may have restarted): publish everything again. */
  async resync(rawConfig) {
    // Gladys may have lost the transport badges: publish them again.
    this.transports.clear();
    this.applyConfig(rawConfig);
    await this.connect();
  }

  /** New configuration from the user. */
  async reconfigure(rawConfig) {
    const next = normalizeConfig(rawConfig);
    const credentialsChanged =
      next.token !== this.config.token || next.secret !== this.config.secret;
    if (this.client && (credentialsChanged || !next.webhook)) {
      // Remove our URL from the account it was registered on.
      await this.webhook.disable();
    }
    this.applyConfig(rawConfig);
    if (credentialsChanged) {
      this.statuses.clear();
      this.signals.clear();
      this.transports.clear();
    }
    this.logger.info('New configuration received');
    await this.connect();
  }

  applyConfig(rawConfig) {
    this.config = normalizeConfig(rawConfig);
    this.client = isConfigured(this.config)
      ? createClient({
          token: this.config.token,
          secret: this.config.secret,
          fetch: this.fetch,
          now: this.now,
          onCall: () => this.quota.record(),
        })
      : null;
  }

  /** Discover, register the webhook, then poll every added device. */
  async connect() {
    await this.discover();
    if (this.connection === CONNECTION.OK) {
      await this.webhook.sync();
    }
    await this.poller.restart();
  }

  async stop() {
    this.poller.stop();
    await this.saveQuota({ force: true });
  }

  isConnected() {
    return this.connection === CONNECTION.OK;
  }

  /** Called by each poller tick: retries a lost connection when it is time. */
  async ensureConnected() {
    if (this.connection === CONNECTION.OK) {
      return true;
    }
    if (this.connection === CONNECTION.UNCONFIGURED || this.now() < this.nextRetryAt) {
      return false;
    }
    await this.discover();
    if (this.connection === CONNECTION.OK) {
      await this.webhook.sync();
    }
    return this.connection === CONNECTION.OK;
  }

  // --- Discovery ---------------------------------------------------------------

  /** Read the device list and publish it to Gladys. Never throws. */
  async discover() {
    if (!this.client) {
      this.setConnection(CONNECTION.UNCONFIGURED);
      this.entries.clear();
      await this.gladys.publishDiscoveredDevices([]).catch(() => {});
      await this.gladys.setConnectionStatus(false, TEXT.notConfigured).catch(() => {});
      return;
    }
    let list;
    try {
      list = await this.client.listDevices();
    } catch (err) {
      await this.connectionFailed(err);
      return;
    }
    this.entries = new Map(entriesOf(list, this.config).map((entry) => [entry.id, entry]));
    this.deviceCount = list.deviceList.length;
    this.remoteCount = list.infraredRemoteList.length;
    this.unsupportedTypes = [
      ...new Set(
        list.deviceList
          .filter((raw) => !kindOf(raw.deviceType))
          .map((raw) => String(raw.deviceType ?? '?')),
      ),
    ];
    const firstConnection = this.connection === CONNECTION.UNCONFIGURED;
    this.setConnection(CONNECTION.OK);
    if (firstConnection) {
      this.logger.info(
        `Connected to SwitchBot: ${this.deviceCount} device(s), ${this.entries.size} published` +
          `${this.unsupportedTypes.length ? `, not supported: ${this.unsupportedTypes.join(', ')}` : ''}`,
      );
    }
    try {
      await this.gladys.publishDiscoveredDevices(
        [...this.entries.values()].map((entry) => buildDevice(this.gladys, entry, this.config)),
      );
      await this.gladys.setConnectionStatus(true);
      this.issues.ok('publish', 'Gladys accepts the device list again');
    } catch (err) {
      this.issues.fail('publish', `Publishing the devices failed (${err.message})`);
      await this.gladys.setConnectionStatus(false, TEXT.publishFailed).catch(() => {});
    }
  }

  async connectionFailed(err) {
    const auth = err?.code === 'auth';
    const state = auth ? CONNECTION.AUTH : CONNECTION.UNREACHABLE;
    this.nextRetryAt = this.now() + (auth ? RETRY_AUTH_MS : RETRY_UNREACHABLE_MS);
    if (this.connection !== state) {
      this.logger.warn(`SwitchBot connection failed (${err.message})`);
    } else {
      this.logger.debug(`SwitchBot connection still failing (${err.message})`);
    }
    this.setConnection(state);
    await this.gladys
      .setConnectionStatus(false, auth ? TEXT.authFailed : TEXT.unreachable)
      .catch(() => {});
  }

  setConnection(state) {
    if (this.connection !== CONNECTION.OK && state === CONNECTION.OK && this.connectionLost) {
      this.logger.info('SwitchBot connection is back');
    }
    this.connectionLost = state === CONNECTION.AUTH || state === CONNECTION.UNREACHABLE;
    this.connection = state;
  }

  // --- Devices -------------------------------------------------------------------

  /** The entry of a Gladys device (by its external id), or undefined. */
  entryOf(deviceExternalId) {
    for (const entry of this.entries.values()) {
      if (entryIds(this.gladys, entry).device === deviceExternalId) {
        return entry;
      }
    }
    return undefined;
  }

  /** The entries whose device the user added to Gladys. */
  createdEntries() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    return [...this.entries.values()].filter((entry) =>
      created.has(entryIds(this.gladys, entry).device),
    );
  }

  /** The added devices that have a status to read (not the IR remotes). */
  pollable() {
    return this.createdEntries().filter((entry) => !entry.remote);
  }

  /** The polling period of a device, in ms (src/quota.js). */
  periodFor(entry) {
    const period = this.basePeriodMs();
    if (this.webhook.state() === WEBHOOK_STATES.ACTIVE && entry.kind.webhook) {
      return Math.max(period, WEBHOOK_FALLBACK_PERIOD_MS);
    }
    return period;
  }

  basePeriodMs() {
    return pollPeriodMs({
      count: this.pollable().length,
      chosenMs: chosenIntervalMs(this.config),
    });
  }

  pollingAllowed() {
    if (this.quota.pollingAllowed()) {
      this.issues.ok('quota', 'New day: polling resumes');
      return true;
    }
    this.issues.fail(
      'quota',
      `${this.quota.used()} SwitchBot API calls today: polling paused until midnight, commands still work`,
    );
    return false;
  }

  /**
   * Read one device and publish what changed. Never throws: a failure is
   * logged (once while it lasts) and the device marked unreachable when
   * SwitchBot says it is offline.
   */
  async refresh(entry) {
    if (!this.client || entry.remote) {
      return;
    }
    let status;
    try {
      status = await this.client.getStatus(entry.id);
    } catch (err) {
      await this.readFailed(entry, err);
      return;
    }
    this.issues.ok(`read:${entry.id}`, `${entry.name}: answers again`);
    this.statuses.set(entry.id, status);
    await this.publishTransport(entry, DEVICE_TRANSPORTS.CLOUD);
    const values = entry.kind.states(status, entry.raw);
    await this.publishStates(statesOf(this.gladys, entry, status, this.config), entry);
    await this.fireEvents(entry, status, values);
    this.logger.debug(`${entry.name}: read`);
    this.nudgeWidget();
    await this.saveQuota();
  }

  /** Save the quota count, at most once a minute. */
  async saveQuota({ force = false } = {}) {
    if (!force && this.now() - (this.quotaSavedAt ?? 0) < 60_000) {
      return;
    }
    this.quotaSavedAt = this.now();
    await this.quota.save();
  }

  async readFailed(entry, err) {
    if (err?.code === 'auth') {
      // The whole account is refused: stop polling until the retry.
      await this.connectionFailed(err);
      return;
    }
    if (err?.code === 'offline') {
      this.issues.fail(`read:${entry.id}`, `${entry.name}: ${err.message}`);
      await this.publishTransport(entry, DEVICE_TRANSPORTS.UNREACHABLE);
      return;
    }
    this.issues.fail(`read:${entry.id}`, `${entry.name}: read failed (${err.message})`);
  }

  async publishStates(states, entry) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      this.issues.ok('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', `Publishing the states of ${entry.name} failed (${err.message})`);
    }
  }

  async publishTransport(entry, transport) {
    if (this.transports.get(entry.id) === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([
        { external_id: entryIds(this.gladys, entry).device, transport },
      ]);
      this.transports.set(entry.id, transport);
    } catch (err) {
      this.logger.debug(`Transport of ${entry.name} not published (${err.message})`);
    }
  }

  async fireEvents(entry, status, values) {
    const previous = this.signals.get(entry.id);
    const next = signalsOf(entry, status, values, previous);
    this.signals.set(entry.id, next);
    const identity = { device: entryIds(this.gladys, entry).device, device_name: entry.name };
    for (const { key, data } of detectEvents(previous, next, identity)) {
      this.logger.debug(`${entry.name}: scene event ${key}`);
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        this.issues.fail('scene-event', `Scene event ${key} refused (${err.message})`);
      }
    }
  }

  /** Ask open dashboards to reload the widget when what it shows changed. */
  nudgeWidget() {
    const signature = JSON.stringify(this.widgetFacts());
    if (signature === this.widgetSignature) {
      return;
    }
    this.widgetSignature = signature;
    try {
      // Fire-and-forget, rate-limited by the core (1 per 10 s per widget).
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      this.logger.debug(`Widget refresh not requested (${err.message})`);
    }
  }

  /** The facts the widget shows, from the last reads. */
  widgetFacts() {
    return this.createdEntries()
      .filter((entry) => this.signals.has(entry.id))
      .map((entry) => {
        const s = this.signals.get(entry.id);
        const lockState =
          entry.kind.kind === 'lock' ? this.statuses.get(entry.id)?.lockState : null;
        return [entry.id, s.contact ?? null, s.leak ?? null, s.batteryLow ?? null, lockState];
      });
  }

  // --- Gladys events -------------------------------------------------------------

  /** A device was added (or updated) in Gladys: send its states now. */
  async onDeviceCreated(device) {
    const entry = this.entryOf(device.external_id);
    if (!entry) {
      return;
    }
    // A badge published before the device existed was dropped by the core.
    this.transports.delete(entry.id);
    if (!entry.remote && this.isConnected()) {
      await this.poller.pollNow(entry);
    }
    this.widgetSignature = null;
    this.nudgeWidget();
  }

  /** The core's onPoll (fallback of the timer). */
  async onPoll(device) {
    const entry = this.entryOf(device.external_id);
    if (entry && !entry.remote) {
      await this.poller.pollFromCore(entry);
    }
  }

  /** A webhook event: read the device, once per burst. */
  onWebhookEvent(deviceId) {
    const id = normalizeId(deviceId);
    const entry = this.pollable().find((candidate) => normalizeId(candidate.id) === id);
    if (!entry) {
      this.logger.debug('Webhook event for a device not added to Gladys: ignored');
      return;
    }
    if (this.pendingWebhook.has(entry.id)) {
      return;
    }
    this.pendingWebhook.add(entry.id);
    this.later(async () => {
      this.pendingWebhook.delete(entry.id);
      if (this.isConnected() && this.pollingAllowed()) {
        await this.poller.pollNow(entry);
      }
    }, WEBHOOK_DEBOUNCE_MS);
  }

  // --- Commands --------------------------------------------------------------------

  /**
   * A command from Gladys (dashboard, scene, voice). Throws on failure: the
   * SDK acks it as failed and Gladys shows the error.
   */
  async setValue(device, feature, value) {
    if (!this.isConnected()) {
      throw new Error(
        this.connection === CONNECTION.AUTH
          ? 'SwitchBot refuses the credentials (or the daily quota is spent)'
          : 'SwitchBot is not reachable or not configured',
      );
    }
    const entry = this.entryOf(device.external_id);
    if (!entry) {
      throw new Error('unknown SwitchBot device (search again in the Discovery tab)');
    }
    const key = featureKeyOf(this.gladys, entry, feature.external_id);
    const plan = entry.kind.command?.({
      key,
      value,
      device: entry.raw,
      status: this.statuses.get(entry.id),
      config: this.config,
    });
    if (!plan) {
      throw new Error(`${entry.name}: "${key}" cannot be controlled`);
    }
    this.logger.info(`Command ${key} = ${value} to ${entry.name}`);
    await this.send(entry, plan.commands);
    const known = new Set(specsOf(entry, this.config).map((spec) => spec.key));
    await this.publishStates(toStates(entryIds(this.gladys, entry), plan.expected, known), entry);
    if (!entry.remote) {
      const delay = entry.kind.kind === 'cover' ? COVER_REFRESH_MS : COMMAND_REFRESH_MS;
      this.later(() => this.poller.pollNow(entry), delay);
    }
  }

  /** Send API commands in order; the first failure stops and throws. */
  async send(entry, commands) {
    if (!this.client) {
      throw new Error('SwitchBot is not configured');
    }
    for (const command of commands) {
      try {
        await this.client.sendCommand(entry.id, command);
      } catch (err) {
        if (err?.code === 'offline') {
          await this.publishTransport(entry, DEVICE_TRANSPORTS.UNREACHABLE);
        }
        this.logger.warn(`${entry.name}: command ${command.command} failed (${err.message})`);
        throw new Error(`${entry.name}: ${err.message}`, { cause: err });
      }
    }
  }

  /** Scene action: press a Bot. */
  async pressBot(deviceExternalId) {
    const entry = this.entryOf(deviceExternalId);
    if (!entry || entry.kind.kind !== 'bot') {
      throw new Error('choose a SwitchBot Bot');
    }
    this.logger.info(`Scene action: press ${entry.name}`);
    await this.send(entry, [{ command: 'press' }]);
  }

  /** Scene action: send a button of an IR remote; resolves the API command. */
  async sendIr(deviceExternalId, name, parameter) {
    const entry = this.entryOf(deviceExternalId);
    if (!entry || entry.kind !== REMOTE_KIND) {
      throw new Error('choose a SwitchBot IR remote (turn on the IR remotes option first)');
    }
    const button = typeof name === 'string' ? name.trim() : '';
    if (button === '') {
      throw new Error('the command name is empty');
    }
    const command = irCommand(entry.raw, button, parameter);
    this.logger.info(`Scene action: IR ${button} to ${entry.name}`);
    await this.send(entry, [command]);
    await this.publishStates(
      toStates(
        entryIds(this.gladys, entry),
        { 'last-command': { text: button } },
        new Set(['last-command']),
      ),
      entry,
    );
    return command;
  }
}

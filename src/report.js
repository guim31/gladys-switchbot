// -----------------------------------------------------------------------------
// The report shown under the "Test the connection" button of the
// Configuration screen, in the four languages: what the account holds, what
// is polled and how often, the API calls of the day, the webhook.
// -----------------------------------------------------------------------------

import { CHECK_TEXT, translate } from './i18n.js';
import { WEBHOOK_STATES } from './webhook.js';

/** @param {import('./hub.js').SwitchBotHub} hub */
export function checkReport(hub) {
  return translate(CHECK_TEXT, (text) => reportLines(hub, text).join(' '));
}

function reportLines(hub, text) {
  if (hub.connection === 'unconfigured') {
    return [text.notConfigured];
  }
  if (hub.connection === 'auth') {
    return [text.authFailed];
  }
  if (hub.connection === 'unreachable') {
    return [text.unreachable];
  }
  const supported = [...hub.entries.values()].filter((entry) => !entry.remote).length;
  const lines = [text.devices(supported, hub.deviceCount)];
  if (hub.unsupportedTypes.length > 0) {
    lines.push(text.unsupported(hub.unsupportedTypes.slice(0, 5).join(', ')));
  }
  if (hub.remoteCount > 0) {
    lines.push(text.remotes(hub.remoteCount, hub.config.ir_remotes));
  }
  const polled = hub.pollable().length;
  lines.push(text.polling(polled, Math.round(hub.basePeriodMs() / 60_000)));
  lines.push(text.calls(hub.quota.used()));
  const webhook = hub.webhook.state();
  if (webhook === WEBHOOK_STATES.ACTIVE) {
    lines.push(text.webhookOn);
  } else if (webhook === WEBHOOK_STATES.NO_PLUS) {
    lines.push(text.webhookNoPlus);
  } else if (webhook === WEBHOOK_STATES.FAILED) {
    lines.push(text.webhookFailed);
  }
  return lines;
}

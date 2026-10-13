// -----------------------------------------------------------------------------
// SwitchBot cloud API v1.1 client (https://github.com/OpenWonderLabs/SwitchBotAPI).
//
// Every request is signed: `sign` = base64(HMAC-SHA256(secret, token + t +
// nonce)), with `t` a 13-digit timestamp and `nonce` a random UUID. The token
// goes in the `Authorization` header; neither the token nor the secret ever
// reaches a log line or an error message.
//
// The API answers HTTP 200 with its own `statusCode` (100 = success, 161/171 =
// device or hub offline, 190 = device error...), and HTTP 401 both for a bad
// token and for a spent daily quota (10,000 calls per account): the caller
// cannot tell them apart, and neither can this client.
// -----------------------------------------------------------------------------

import { createHmac, randomUUID } from 'node:crypto';

export const API_HOST = 'https://api.switch-bot.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** Base class: every error of this client carries a stable `code`. */
export class SwitchBotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SwitchBotError';
    this.code = code;
  }
}

/** HTTP 401/403: bad token or secret, or daily quota exhausted. */
export class SwitchBotAuthError extends SwitchBotError {
  constructor(status) {
    super('auth', `SwitchBot refused the credentials (HTTP ${status})`);
    this.name = 'SwitchBotAuthError';
  }
}

/** statusCode 161 (device offline) or 171 (its hub is offline). */
export class SwitchBotOfflineError extends SwitchBotError {
  constructor(statusCode) {
    super('offline', statusCode === 171 ? 'the SwitchBot hub is offline' : 'the device is offline');
    this.name = 'SwitchBotOfflineError';
    this.statusCode = statusCode;
  }
}

/**
 * The signature headers of one request.
 * @param {{ token: string, secret: string, t: number, nonce: string }} input
 */
export function signHeaders({ token, secret, t, nonce }) {
  const sign = createHmac('sha256', secret).update(`${token}${t}${nonce}`).digest('base64');
  return { Authorization: token, sign, t: String(t), nonce };
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.secret
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {() => string} [options.nonce]
 * @param {() => void} [options.onCall] called once per request sent (quota count)
 */
export function createClient({
  token,
  secret,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  nonce = () => randomUUID(),
  onCall = () => {},
}) {
  async function request(method, path, body) {
    const headers = {
      ...signHeaders({ token, secret, t: now(), nonce: nonce() }),
      'Content-Type': 'application/json; charset=utf8',
    };
    onCall();
    let response;
    try {
      response = await fetchImpl(`${API_HOST}/v1.1/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || err?.message;
      throw new SwitchBotError('network', `SwitchBot cloud unreachable (${reason})`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new SwitchBotAuthError(response.status);
    }
    if (response.status === 429) {
      throw new SwitchBotError('rate_limit', 'SwitchBot rate limit reached (HTTP 429)');
    }
    if (response.status >= 400) {
      throw new SwitchBotError('http', `SwitchBot answered HTTP ${response.status}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new SwitchBotError('http', 'SwitchBot answered something that is not JSON');
    }
    const statusCode = payload?.statusCode;
    if (statusCode === 100) {
      return payload.body ?? {};
    }
    if (statusCode === 161 || statusCode === 171) {
      throw new SwitchBotOfflineError(statusCode);
    }
    // Messages come from SwitchBot and never echo the credentials.
    const detail = typeof payload?.message === 'string' ? payload.message.slice(0, 120) : '';
    const codes = { 151: 'device_type', 152: 'not_found', 160: 'unsupported', 190: 'device' };
    throw new SwitchBotError(
      codes[statusCode] ?? 'api',
      `SwitchBot error ${statusCode ?? '?'}${detail ? ` (${detail})` : ''}`,
    );
  }

  return {
    /** `{ deviceList, infraredRemoteList }` */
    async listDevices() {
      const body = await request('GET', 'devices');
      return {
        deviceList: Array.isArray(body.deviceList) ? body.deviceList : [],
        infraredRemoteList: Array.isArray(body.infraredRemoteList) ? body.infraredRemoteList : [],
      };
    },

    /** The status object of one physical device. */
    getStatus(deviceId) {
      return request('GET', `devices/${encodeURIComponent(deviceId)}/status`);
    },

    /**
     * @param {string} deviceId
     * @param {{ command: string, parameter?: unknown, commandType?: string }} command
     */
    sendCommand(deviceId, { command, parameter = 'default', commandType = 'command' }) {
      return request('POST', `devices/${encodeURIComponent(deviceId)}/commands`, {
        command,
        parameter,
        commandType,
      });
    },

    /** The webhook URLs registered on the account. */
    async queryWebhookUrls() {
      const body = await request('POST', 'webhook/queryWebhook', { action: 'queryUrl' });
      return Array.isArray(body?.urls) ? body.urls : [];
    },

    setupWebhook(url) {
      return request('POST', 'webhook/setupWebhook', {
        action: 'setupWebhook',
        url,
        deviceList: 'ALL',
      });
    },

    deleteWebhook(url) {
      return request('POST', 'webhook/deleteWebhook', { action: 'deleteWebhook', url });
    },
  };
}

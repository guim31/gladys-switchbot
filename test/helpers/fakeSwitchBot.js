// -----------------------------------------------------------------------------
// An in-memory SwitchBot cloud, behind a `fetch` the client is given: no
// network in the tests. It checks the request signature like the real API
// (HMAC-SHA256 of token + t + nonce with the secret), serves the fixtures,
// records every call and command, and lets a test make a device offline, a
// path fail, or the whole account refuse the credentials.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/switchbot/${name}`, import.meta.url), 'utf8'));

export const DEVICE_LIST = load('devices.json');
export const STATUSES = load('statuses.json');

export const TOKEN = 'test-token-0123456789abcdef';
export const SECRET = 'test-secret-fedcba9876';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (body) => json(200, { statusCode: 100, body, message: 'success' });

export function createFakeSwitchBot({ token = TOKEN, secret = SECRET } = {}) {
  const cloud = {
    deviceList: structuredClone(DEVICE_LIST.body),
    statuses: structuredClone(STATUSES),
    calls: [],
    commands: [],
    webhookUrls: [],
    offline: new Set(),
    refuseAll: false,
    down: false,

    /** Calls of one kind: 'list', 'status', 'command', 'webhook'. */
    count(kind) {
      return cloud.calls.filter((call) => call.kind === kind).length;
    },

    async fetch(url, init = {}) {
      if (cloud.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const { pathname } = new URL(url);
      const headers = init.headers ?? {};
      const expected = createHmac('sha256', secret)
        .update(`${headers.Authorization}${headers.t}${headers.nonce}`)
        .digest('base64');
      const signed =
        headers.Authorization === token && headers.sign === expected && /^\d{13}$/.test(headers.t);
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      const record = (kind, extra = {}) => cloud.calls.push({ kind, method, pathname, ...extra });

      if (!signed || cloud.refuseAll) {
        record('refused');
        return json(401, { message: 'Unauthorized' });
      }
      if (method === 'GET' && pathname === '/v1.1/devices') {
        record('list');
        return ok(cloud.deviceList);
      }
      let match = pathname.match(/^\/v1\.1\/devices\/([^/]+)\/status$/);
      if (method === 'GET' && match) {
        const id = decodeURIComponent(match[1]);
        record('status', { id });
        if (cloud.offline.has(id)) {
          return json(200, { statusCode: 161, body: {}, message: 'device offline' });
        }
        const status = cloud.statuses[id];
        return status
          ? ok(status)
          : json(200, { statusCode: 152, body: {}, message: 'device not found' });
      }
      match = pathname.match(/^\/v1\.1\/devices\/([^/]+)\/commands$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        record('command', { id });
        if (cloud.offline.has(id)) {
          return json(200, { statusCode: 161, body: {}, message: 'device offline' });
        }
        cloud.commands.push({ id, ...body });
        return ok({});
      }
      if (method === 'POST' && pathname.startsWith('/v1.1/webhook/')) {
        record('webhook', { action: body?.action });
        if (body.action === 'queryUrl') {
          return ok({ urls: [...cloud.webhookUrls] });
        }
        if (body.action === 'setupWebhook') {
          cloud.webhookUrls.push(body.url);
          return ok({});
        }
        if (body.action === 'deleteWebhook') {
          cloud.webhookUrls = cloud.webhookUrls.filter((u) => u !== body.url);
          return ok({});
        }
      }
      return json(404, { message: 'Not Found' });
    },
  };
  cloud.fetch = cloud.fetch.bind(cloud);
  return cloud;
}

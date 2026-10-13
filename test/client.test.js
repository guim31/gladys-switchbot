// -----------------------------------------------------------------------------
// SwitchBot API client: the request signature, the error mapping, and the
// credentials never showing in an error message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { API_HOST, createClient, signHeaders } from '../src/switchbot/client.js';
import { SECRET, TOKEN, createFakeSwitchBot } from './helpers/fakeSwitchBot.js';

test('the signature is base64(HMAC-SHA256(secret, token + t + nonce))', () => {
  const headers = signHeaders({ token: 'tok', secret: 'sec', t: 1700000000000, nonce: 'n-1' });
  const expected = createHmac('sha256', 'sec').update('tok1700000000000n-1').digest('base64');
  assert.deepEqual(headers, {
    Authorization: 'tok',
    sign: expected,
    t: '1700000000000',
    nonce: 'n-1',
  });
});

test('every request carries a fresh nonce, a 13-digit timestamp and the JSON content type', async () => {
  const seen = [];
  const client = createClient({
    token: TOKEN,
    secret: SECRET,
    fetch: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ statusCode: 100, body: {}, message: 'success' }));
    },
  });
  await client.sendCommand('AA BB', { command: 'turnOn' });
  await client.getStatus('X');
  assert.equal(seen[0].url, `${API_HOST}/v1.1/devices/AA%20BB/commands`);
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    command: 'turnOn',
    parameter: 'default',
    commandType: 'command',
  });
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json; charset=utf8');
  assert.match(seen[0].init.headers.t, /^\d{13}$/);
  assert.notEqual(seen[0].init.headers.nonce, seen[1].init.headers.nonce);
  assert.equal(seen[1].init.body, undefined);
});

test('the fake cloud accepts the signature the client computes', async () => {
  const cloud = createFakeSwitchBot();
  const calls = [];
  const client = createClient({
    token: TOKEN,
    secret: SECRET,
    fetch: cloud.fetch,
    onCall: () => calls.push(1),
  });
  const list = await client.listDevices();
  assert.equal(list.deviceList.length, 28);
  assert.equal(list.infraredRemoteList.length, 3);
  assert.equal(calls.length, 1);
  const status = await client.getStatus('F0000000000D');
  assert.equal(status.temperature, 21.8);
});

test('errors: refused credentials, offline device, API codes, network', async () => {
  const cloud = createFakeSwitchBot();
  const wrong = createClient({ token: TOKEN, secret: 'wrong-secret', fetch: cloud.fetch });
  await assert.rejects(wrong.listDevices(), (err) => err.code === 'auth');

  const client = createClient({ token: TOKEN, secret: SECRET, fetch: cloud.fetch });
  cloud.offline.add('F0000000000D');
  await assert.rejects(client.getStatus('F0000000000D'), (err) => err.code === 'offline');
  await assert.rejects(client.getStatus('NOPE'), (err) => err.code === 'not_found');

  const hubOffline = createClient({
    token: TOKEN,
    secret: SECRET,
    fetch: async () => new Response(JSON.stringify({ statusCode: 171, message: 'hub offline' })),
  });
  await assert.rejects(hubOffline.getStatus('X'), /hub is offline/);

  const busy = createClient({
    token: TOKEN,
    secret: SECRET,
    fetch: async () => new Response('{}', { status: 429 }),
  });
  await assert.rejects(busy.getStatus('X'), (err) => err.code === 'rate_limit');

  cloud.down = true;
  await assert.rejects(
    client.listDevices(),
    (err) => err.code === 'network' && /ECONNREFUSED/.test(err.message),
  );
});

test('no error message ever holds the token or the secret', async () => {
  const responses = [
    () => new Response('{}', { status: 401 }),
    () => new Response('not json', { status: 200 }),
    () => new Response(JSON.stringify({ statusCode: 190, message: 'device error' })),
    () => new Response('{}', { status: 500 }),
    () => {
      throw new Error(`boom ${TOKEN}`.replace(TOKEN, 'x'));
    },
  ];
  for (const respond of responses) {
    const client = createClient({ token: TOKEN, secret: SECRET, fetch: async () => respond() });
    const err = await client.getStatus('X').catch((e) => e);
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes(TOKEN) && !err.message.includes(SECRET), err.message);
  }
});

test('webhook calls', async () => {
  const cloud = createFakeSwitchBot();
  const client = createClient({ token: TOKEN, secret: SECRET, fetch: cloud.fetch });
  assert.deepEqual(await client.queryWebhookUrls(), []);
  await client.setupWebhook('https://example.com/hook');
  assert.deepEqual(await client.queryWebhookUrls(), ['https://example.com/hook']);
  await client.deleteWebhook('https://example.com/hook');
  assert.deepEqual(cloud.webhookUrls, []);
});

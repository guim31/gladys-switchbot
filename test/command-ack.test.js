// -----------------------------------------------------------------------------
// The ack of a command and what follows it. The core fails a command whose ack
// has not come back within 5 s, in red ("the device may be unreachable"),
// while a lock relayed by a hub can take longer: the ack leaves at
// COMMAND_ACK_MS at the latest, a later failure is logged and the device read
// again. A lock command SwitchBot accepts is checked LOCK_VERIFY_MS later.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_ACK_MS, LOCK_VERIFY_MS } from '../src/hub.js';
import { createWorld } from './helpers/world.js';

const LOCK = 'F0000000000B';

function captureLogs(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  for (const method of ['log', 'error', 'warn', 'info', 'debug']) {
    t.mock.method(console, method, record);
  }
  return lines;
}

/** An ack deadline the test fires by hand, recording the delay asked. */
function manualDeadline() {
  const deadline = { asked: [], fire: () => {} };
  deadline.wait = (ms) => {
    deadline.asked.push(ms);
    return new Promise((resolve) => {
      deadline.fire = resolve;
    });
  };
  return deadline;
}

/** A command the fake SwitchBot holds until `release()`. */
function holdCommands(cloud) {
  let release;
  cloud.commandHold = new Promise((resolve) => {
    release = () => {
      cloud.commandHold = null;
      resolve();
    };
  });
  return () => release();
}

test('a slow SwitchBot answer is acked before the core gives up (5 s), not failed', async () => {
  const deadline = manualDeadline();
  const world = await createWorld({ config: { lock_control: true }, ackDelay: deadline.wait });
  const release = holdCommands(world.cloud);
  const pending = world.gladys.fake.setValue(
    world.discovered(LOCK),
    world.feature(LOCK, 'lock'),
    1,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deadline.asked, [COMMAND_ACK_MS]);
  assert.ok(COMMAND_ACK_MS < 5_000, 'under the core command timeout');
  deadline.fire();
  assert.deepEqual(await pending, { success: true });
  // The command goes on: once SwitchBot answers, the expected state.
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(world.cloud.commands.at(-1).command, 'lock');
  assert.equal(world.state(LOCK, 'lock'), 1);
});

test('a failure after the ack is logged and the device read again', async (t) => {
  const deadline = manualDeadline();
  const world = await createWorld({ config: { lock_control: true }, ackDelay: deadline.wait });
  const lines = captureLogs(t, 'info');
  const release = holdCommands(world.cloud);
  world.cloud.commandItemCodes.push(160);
  const pending = world.gladys.fake.setValue(
    world.discovered(LOCK),
    world.feature(LOCK, 'lock'),
    1,
  );
  await new Promise((resolve) => setImmediate(resolve));
  deadline.fire();
  assert.equal((await pending).success, true);
  const reads = world.cloud.count('status');
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(lines.some((line) => /WARN.*command lock failed.*160/.test(line)));
  assert.equal(world.state(LOCK, 'lock'), 0, 'the expected state is not published');
  await world.runDelayed();
  assert.equal(world.cloud.count('status'), reads + 1, 'read again');
});

test('a failure within the deadline still fails the ack, in red', async () => {
  const deadline = manualDeadline();
  const world = await createWorld({ config: { lock_control: true }, ackDelay: deadline.wait });
  world.cloud.commandItemCodes.push(160);
  const ack = await world.gladys.fake.setValue(
    world.discovered(LOCK),
    world.feature(LOCK, 'lock'),
    1,
  );
  assert.equal(ack.success, false);
});

test('a lock SwitchBot accepted but that did not move is reported in the log', async (t) => {
  const world = await createWorld({ config: { lock_control: true } });
  const lines = captureLogs(t, 'info');
  await world.gladys.fake.setValue(world.discovered(LOCK), world.feature(LOCK, 'lock'), 1);
  assert.ok(world.delayed.some((d) => d.ms === LOCK_VERIFY_MS));
  // The lock never moved: still unlocked at every read.
  await world.runDelayed();
  assert.ok(
    lines.some((line) => /WARN.*accepted "lock".*did not move/.test(line)),
    lines.join('\n'),
  );
  assert.equal(world.state(LOCK, 'lock'), 0, 'the real state is shown');
});

test('a lock that moved writes no warning', async (t) => {
  const world = await createWorld({ config: { lock_control: true } });
  const lines = captureLogs(t, 'info');
  await world.gladys.fake.setValue(world.discovered(LOCK), world.feature(LOCK, 'lock'), 1);
  world.cloud.statuses[LOCK].lockState = 'locked';
  await world.runDelayed();
  assert.ok(!lines.some((line) => /WARN/.test(line)), lines.join('\n'));
});

test('the raw answer of a command goes to the debug log, ids masked', async (t) => {
  const world = await createWorld({ config: { lock_control: true } });
  const lines = captureLogs(t, 'debug');
  world.cloud.commandItemCodes.push(190, 100);
  await world.gladys.fake.setValue(world.discovered(LOCK), world.feature(LOCK, 'lock'), 1);
  const answers = lines.filter((line) => /command lock answered in \d+ ms/.test(line));
  assert.equal(answers.length, 2, lines.join('\n'));
  assert.match(answers[0], /"code":190/);
  assert.match(answers[1], /"statusCode":100/);
  assert.ok(!answers.some((line) => line.includes(LOCK)), 'no device id');
});

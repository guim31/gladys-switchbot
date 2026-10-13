// -----------------------------------------------------------------------------
// The container's own polling timer.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.x skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with (GladysAssistant/Gladys#3198). So the
// container polls by itself, and the core's onPoll stays as a fallback.
//
// Each device has its own period (src/quota.js sizes it on the number of
// devices to stay inside the daily quota). A tick every few seconds reads
// the devices that are due, at most a couple per tick and one at a time, so
// the calls are spread instead of sent in bursts. The core's onPoll reads a
// device only if the timer has not read it for 90 % of its period: while the
// timer runs, the core never costs a call.
//
// Only the devices the user added to Gladys are read: the core drops the
// states of a device it does not know, reading them would spend the quota
// for nothing.
// -----------------------------------------------------------------------------

const TICK_MS = 5_000;
const PER_TICK = 2;
// Read at once on a (re)start; the ticks catch up with the others. A full
// burst on a large fleet would pass the 300 states a minute the core takes.
export const RESTART_BURST = 10;

/**
 * @param {object} options
 * @param {object} options.hub the SwitchBot hub (src/hub.js)
 * @param {boolean} [options.timers] run the periodic timer (tests turn it off)
 * @param {() => number} [options.now]
 * @param {number} [options.tickMs]
 */
export function createPoller({ hub, timers = true, now = () => Date.now(), tickMs = TICK_MS }) {
  /** When each device was last read (start of the read), by SwitchBot id. */
  const lastPolledAt = new Map();
  /** Reads in progress, by SwitchBot id: a second caller waits for the same one. */
  const inFlight = new Map();
  let timer = null;
  let stopped = true;

  function poll(entry) {
    const running = inFlight.get(entry.id);
    if (running) {
      return running;
    }
    lastPolledAt.set(entry.id, now());
    const run = hub.refresh(entry).finally(() => inFlight.delete(entry.id));
    inFlight.set(entry.id, run);
    return run;
  }

  /** The devices due for a read, the longest waiting first. */
  function dueEntries() {
    const at = now();
    return hub
      .pollable()
      .filter((entry) => {
        const last = lastPolledAt.get(entry.id);
        return last === undefined || at - last >= hub.periodFor(entry);
      })
      .sort((a, b) => (lastPolledAt.get(a.id) ?? 0) - (lastPolledAt.get(b.id) ?? 0));
  }

  const api = {
    /** One tick: recover the connection if needed, then read the due devices. */
    async tick() {
      if (!(await hub.ensureConnected())) {
        return;
      }
      if (!hub.pollingAllowed()) {
        return;
      }
      for (const entry of dueEntries().slice(0, PER_TICK)) {
        await poll(entry);
      }
    },

    /**
     * (Re)start: forget the previous reads and read the first added devices
     * now; the others are due at once and read by the next ticks.
     */
    async restart() {
      stopped = false;
      lastPolledAt.clear();
      schedule();
      if (!hub.isConnected() || !hub.pollingAllowed()) {
        return;
      }
      for (const entry of hub.pollable().slice(0, RESTART_BURST)) {
        await poll(entry);
      }
    },

    /** The core's onPoll (fallback): reads the device unless the timer just did. */
    async pollFromCore(entry) {
      const last = lastPolledAt.get(entry.id);
      if (last !== undefined && now() - last < hub.periodFor(entry) * 0.9) {
        return;
      }
      if (hub.isConnected() && hub.pollingAllowed()) {
        await poll(entry);
      }
    },

    /** Read one device now (just added to Gladys, after a command, a webhook event). */
    pollNow(entry) {
      return poll(entry);
    },

    /** When the device was last read, or undefined. */
    lastPolled(entry) {
      return lastPolledAt.get(entry.id);
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await api.tick();
      } catch (err) {
        hub.logger.error(`Polling tick failed (${err.message})`);
      } finally {
        schedule();
      }
    }, tickMs);
  }

  return api;
}

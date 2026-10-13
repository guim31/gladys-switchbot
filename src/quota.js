// -----------------------------------------------------------------------------
// The daily API quota: 10,000 calls per SwitchBot account and per day, every
// app using the same token included. Over it, SwitchBot answers 401 until the
// counter resets.
//
// This module counts the calls the integration sends (it cannot see the other
// apps), per local day, and sizes the polling pace on the number of devices
// so that polling never uses more than half of the quota: the rest stays for
// commands, webhook refreshes, and the other apps of the account. Past 90 % of
// the quota, polling pauses until midnight; commands keep going.
//
// The count is saved under /data (the only writable path of the container),
// so a restart does not forget the calls already made today.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const DAILY_LIMIT = 10_000;
// What polling may spend per day, at most.
export const POLL_BUDGET = 5_000;
// Polling pauses past this count; commands keep going.
export const PAUSE_THRESHOLD = 9_000;
// The fastest pace: once a minute per device, whatever the budget.
export const MIN_PERIOD_MS = 60_000;
// `auto` never polls faster than every 2 minutes.
export const AUTO_MIN_PERIOD_MS = 120_000;
// Devices that push their changes by webhook are still polled, slowly, to
// catch a lost event (webhooks are a trigger, polling stays the truth).
export const WEBHOOK_FALLBACK_PERIOD_MS = 30 * 60_000;

const DAY_MS = 86_400_000;

/**
 * The polling period of each device.
 * @param {object} options
 * @param {number} options.count devices polled at the normal pace
 * @param {number|null} options.chosenMs the interval chosen by the user, null for auto
 */
export function pollPeriodMs({ count, chosenMs }) {
  const budgetMs = Math.ceil((DAY_MS * Math.max(count, 1)) / POLL_BUDGET / 1000) * 1000;
  const floor = chosenMs === null ? AUTO_MIN_PERIOD_MS : Math.max(chosenMs, MIN_PERIOD_MS);
  return Math.max(floor, budgetMs);
}

/** `2026-10-13` in the container's time zone (TZ is the one of Gladys). */
export function localDay(timestamp) {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {object} [options]
 * @param {string|null} [options.dataDir] where to save the count; null keeps it in memory
 * @param {() => number} [options.now]
 * @param {{ debug: Function }} [options.logger]
 */
export function createQuota({ dataDir = null, now = () => Date.now(), logger } = {}) {
  const file = dataDir ? join(dataDir, 'quota.json') : null;
  let day = localDay(now());
  let count = 0;
  let dirty = false;

  const rollOver = () => {
    const today = localDay(now());
    if (today !== day) {
      day = today;
      count = 0;
      dirty = true;
    }
  };

  return {
    /** Read back the count saved today, if any. */
    async load() {
      if (!file) {
        return;
      }
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved?.day === localDay(now()) && Number.isInteger(saved.count) && saved.count >= 0) {
          day = saved.day;
          count = saved.count;
        }
      } catch {
        // First start, or an unreadable file: start from zero.
      }
    },

    /** Save the count if it changed (atomic: write then rename). */
    async save() {
      if (!file || !dirty) {
        return;
      }
      dirty = false;
      try {
        await writeFile(`${file}.tmp`, JSON.stringify({ day, count }));
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger?.debug(`Quota count not saved (${err.message})`);
      }
    },

    /** One call sent. */
    record() {
      rollOver();
      count += 1;
      dirty = true;
    },

    /** Calls sent today. */
    used() {
      rollOver();
      return count;
    },

    /** Polling stays inside the quota. */
    pollingAllowed() {
      rollOver();
      return count < PAUSE_THRESHOLD;
    },
  };
}

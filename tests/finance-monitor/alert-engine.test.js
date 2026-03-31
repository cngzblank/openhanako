/**
 * Tests for finance-monitor/lib/alert-engine.js
 *
 * Exercises pure functions: checkAlerts and isTradeTime.
 * The plugin lives at ~/.hanako-dev/plugins/finance-monitor/ (outside the repo),
 * so we import it via an absolute path resolved from the HOME directory.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';

// Resolve plugin path at import time; HANA_HOME is respected when set.
const hanaHome = process.env.HANA_HOME ?? path.join(os.homedir(), '.hanako-dev');
const alertEnginePath = path.join(
  hanaHome,
  'plugins',
  'finance-monitor',
  'lib',
  'alert-engine.js'
);

const { checkAlerts, isTradeTime } = await import(alertEnginePath);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuotes(entries) {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// checkAlerts
// ---------------------------------------------------------------------------

describe('checkAlerts', () => {
  it('triggers price_above when price meets or exceeds threshold', () => {
    const alerts = [{ id: 'a1', symbol: 'sh600519', condition: { type: 'price_above', threshold: 100 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 0, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('does not trigger price_above when price is below threshold', () => {
    const alerts = [{ id: 'a1', symbol: 'sh600519', condition: { type: 'price_above', threshold: 200 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 0, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('triggers price_below when price meets or drops below threshold', () => {
    const alerts = [{ id: 'a2', symbol: 'sz000001', condition: { type: 'price_below', threshold: 15 } }];
    const quotes = makeQuotes([['sz000001', { price: 14.5, changePct: -2, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('does not trigger price_below when price is above threshold', () => {
    const alerts = [{ id: 'a2', symbol: 'sz000001', condition: { type: 'price_below', threshold: 10 } }];
    const quotes = makeQuotes([['sz000001', { price: 14.5, changePct: -2, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('triggers change_pct alert on positive change exceeding threshold', () => {
    const alerts = [{ id: 'a3', symbol: 'sh600519', condition: { type: 'change_pct', threshold: 5 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 6.5, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(1);
  });

  it('triggers change_pct alert on negative change exceeding threshold (abs)', () => {
    const alerts = [{ id: 'a3', symbol: 'sh600519', condition: { type: 'change_pct', threshold: 5 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: -7, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(1);
  });

  it('does not trigger change_pct when change is within threshold', () => {
    const alerts = [{ id: 'a3', symbol: 'sh600519', condition: { type: 'change_pct', threshold: 5 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 3, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('triggers volume_surge when volume/prevVolume meets threshold', () => {
    const alerts = [{ id: 'a4', symbol: 'sh600519', condition: { type: 'volume_surge', threshold: 3 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 0, volume: 30000, prevVolume: 10000 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(1);
  });

  it('does not trigger volume_surge when ratio is below threshold', () => {
    const alerts = [{ id: 'a4', symbol: 'sh600519', condition: { type: 'volume_surge', threshold: 3 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 0, volume: 20000, prevVolume: 10000 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('does not trigger volume_surge when prevVolume is 0', () => {
    const alerts = [{ id: 'a4', symbol: 'sh600519', condition: { type: 'volume_surge', threshold: 2 } }];
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 0, volume: 50000, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('respects cooldown period and suppresses recently triggered alert', () => {
    const alerts = [{ id: 'a5', symbol: 'sh600519', condition: { type: 'price_above', threshold: 100 } }];
    const quotes = makeQuotes([['sh600519', { price: 150, changePct: 0, volume: 0, prevVolume: 0 }]]);
    const state = { a5: { lastTriggeredAt: Date.now() - 5 * 60 * 1000 } }; // 5 min ago
    const cooldownMs = 30 * 60 * 1000; // 30 min
    const result = checkAlerts(alerts, quotes, state, cooldownMs);
    expect(result).toHaveLength(0);
  });

  it('fires again after cooldown has elapsed', () => {
    const alerts = [{ id: 'a5', symbol: 'sh600519', condition: { type: 'price_above', threshold: 100 } }];
    const quotes = makeQuotes([['sh600519', { price: 150, changePct: 0, volume: 0, prevVolume: 0 }]]);
    const state = { a5: { lastTriggeredAt: Date.now() - 31 * 60 * 1000 } }; // 31 min ago
    const cooldownMs = 30 * 60 * 1000;
    const result = checkAlerts(alerts, quotes, state, cooldownMs);
    expect(result).toHaveLength(1);
  });

  it('ignores symbols not present in quotes', () => {
    const alerts = [{ id: 'a6', symbol: 'sh999999', condition: { type: 'price_above', threshold: 1 } }];
    const quotes = makeQuotes([['sh600519', { price: 150, changePct: 0, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts(alerts, quotes, {});
    expect(result).toHaveLength(0);
  });

  it('returns empty array when alerts list is empty', () => {
    const quotes = makeQuotes([['sh600519', { price: 100, changePct: 5, volume: 0, prevVolume: 0 }]]);
    const result = checkAlerts([], quotes, {});
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isTradeTime
// ---------------------------------------------------------------------------

/**
 * Build a Date whose UTC value corresponds to a specific Beijing clock time
 * on a chosen weekday in a known week (Mon 2024-01-08 through Sat 2024-01-13).
 *
 * Beijing is UTC+8, so Beijing HH:MM = UTC (HH-8):MM.
 */
function beijingTime(dayOfWeek, h, m = 0) {
  // Week of 2024-01-08 (Mon=1 … Sat=6)
  const base = new Date('2024-01-08T00:00:00Z'); // Monday UTC midnight
  const dayOffset = dayOfWeek - 1; // 0=Mon
  const utcH = h - 8; // Beijing -> UTC
  // Allow negative hour; Date handles roll-over correctly
  return new Date(
    Date.UTC(2024, 0, 8 + dayOffset, utcH, m, 0)
  );
}

describe('isTradeTime', () => {
  it('returns true at 10:00 Beijing time on a weekday (morning session)', () => {
    expect(isTradeTime(beijingTime(1, 10, 0))).toBe(true);
  });

  it('returns false at 12:30 Beijing time (lunch break)', () => {
    expect(isTradeTime(beijingTime(1, 12, 30))).toBe(false);
  });

  it('returns false on Saturday', () => {
    expect(isTradeTime(beijingTime(6, 10, 0))).toBe(false);
  });

  it('returns false on Sunday', () => {
    // Sunday = next week's 0 offset; use a known Sunday
    const sunday = new Date('2024-01-07T02:00:00Z'); // 2024-01-07 is Sunday, 10:00 Beijing = 02:00 UTC
    expect(isTradeTime(sunday)).toBe(false);
  });

  it('returns true at 14:00 Beijing time (afternoon session)', () => {
    expect(isTradeTime(beijingTime(3, 14, 0))).toBe(true);
  });

  it('returns false at 8:00 Beijing time (before market open)', () => {
    expect(isTradeTime(beijingTime(2, 8, 0))).toBe(false);
  });

  it('returns false at 16:00 Beijing time (after market close)', () => {
    expect(isTradeTime(beijingTime(2, 16, 0))).toBe(false);
  });

  it('returns true at exactly 9:15 Beijing (session open)', () => {
    expect(isTradeTime(beijingTime(1, 9, 15))).toBe(true);
  });

  it('returns true at exactly 11:30 Beijing (morning session close)', () => {
    expect(isTradeTime(beijingTime(1, 11, 30))).toBe(true);
  });

  it('returns false at 11:31 Beijing (just after morning close)', () => {
    expect(isTradeTime(beijingTime(1, 11, 31))).toBe(false);
  });

  it('returns true at exactly 13:00 Beijing (afternoon session open)', () => {
    expect(isTradeTime(beijingTime(1, 13, 0))).toBe(true);
  });

  it('returns true at exactly 15:00 Beijing (afternoon session close)', () => {
    expect(isTradeTime(beijingTime(1, 15, 0))).toBe(true);
  });

  it('returns false at 15:01 Beijing (just after afternoon close)', () => {
    expect(isTradeTime(beijingTime(1, 15, 1))).toBe(false);
  });
});

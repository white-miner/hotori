import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseRateFor,
  isStopSell,
  normalizeTypeRateOverrides,
  normalizeTypeRates,
  normalizeTypeStopSell,
  sellableRemaining,
  setTypeDateRate,
  setTypeRateDefaults,
  setTypeStopSell,
  setTypeStopSellRange,
  stopSellDatesForStay,
} from "./salesCalendar.ts";

const empty = { typeRates: {}, typeRateOverrides: {}, typeStopSell: {}, specialDates: [] as string[] };

test("baseRate: weekday / weekend / override", () => {
  let s = setTypeRateDefaults(empty, "s", { weekday: 50_000, weekend: 70_000 });
  assert.equal(baseRateFor(s, "s", "2026-10-19"), 50_000); // 월
  assert.equal(baseRateFor(s, "s", "2026-10-23"), 70_000); // 금
  assert.equal(baseRateFor(s, "s", "2026-10-24"), 70_000); // 토
  s = setTypeDateRate(s, "s", "2026-10-19", 55_000);
  assert.equal(baseRateFor(s, "s", "2026-10-19"), 55_000);
  s = setTypeDateRate(s, "s", "2026-10-19", null);
  assert.equal(baseRateFor(s, "s", "2026-10-19"), 50_000);
});

test("stop-sell: sellable + stay dates", () => {
  let s = setTypeStopSell(empty, "s", "2026-10-20", true);
  assert.equal(isStopSell(s, "s", "2026-10-20"), true);
  assert.equal(sellableRemaining(5, true), 0);
  assert.equal(sellableRemaining(5, false), 5);
  assert.deepEqual(stopSellDatesForStay(s, "s", "2026-10-19", 3), ["2026-10-20"]);
  s = setTypeStopSellRange(s, "s", "2026-10-21", "2026-10-22", true);
  assert.deepEqual(stopSellDatesForStay(s, "s", "2026-10-19", 4), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  s = setTypeStopSell(s, "s", "2026-10-20", false);
  assert.equal(isStopSell(s, "s", "2026-10-20"), false);
});

test("normalize maps", () => {
  assert.deepEqual(normalizeTypeRates({ s: { weekday: 1, weekend: -1, flat: "x" } }), { s: { weekday: 1, weekend: null, flat: null } });
  assert.deepEqual(normalizeTypeRateOverrides({ s: { "2026-10-19": 90000, bad: 1 } }), { s: { "2026-10-19": 90000 } });
  assert.deepEqual(normalizeTypeStopSell({ s: { "2026-10-19": true, "2026-10-20": false } }), { s: { "2026-10-19": true } });
});

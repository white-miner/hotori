import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBulkTypeDates,
  baseRateFor,
  bookedCount,
  isSellOpen,
  isStopSell,
  normalizeTypeRateOverrides,
  normalizeTypeRates,
  normalizeTypeStopSell,
  sellableRemaining,
  sellStatus,
  setTypeDateRate,
  setTypeRateDefaults,
  setTypeStopSell,
  setTypeStopSellRange,
  shortStayHint,
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

test("bookedCount + isSellOpen match stock math", () => {
  assert.equal(bookedCount(5, 3), 2);
  assert.equal(bookedCount(5, -1), 6);
  assert.equal(isSellOpen(3, false), true);
  assert.equal(isSellOpen(0, false), false);
  assert.equal(isSellOpen(3, true), false);
});

test("sellStatus triad: 판매 / 매진 / 마감", () => {
  assert.equal(sellStatus(3, false), "sell");
  assert.equal(sellStatus(0, false), "soldout");
  assert.equal(sellStatus(-1, false), "soldout");
  assert.equal(sellStatus(5, true), "closed");
  assert.equal(sellStatus(0, true), "closed");
});

test("shortStayHint strips :00", () => {
  assert.equal(shortStayHint("16:00", "12:00"), "16–12");
  assert.equal(shortStayHint("15:30", "11:00"), "15:30–11");
});

test("applyBulkTypeDates: rate and stop across dates", () => {
  let s = setTypeRateDefaults(empty, "s", { weekday: 50_000, weekend: 70_000 });
  s = applyBulkTypeDates(s, ["s"], ["2026-10-20", "2026-10-21"], { rate: 80_000, stopSell: true });
  assert.equal(baseRateFor(s, "s", "2026-10-20"), 80_000);
  assert.equal(baseRateFor(s, "s", "2026-10-21"), 80_000);
  assert.equal(isStopSell(s, "s", "2026-10-20"), true);
  assert.equal(isStopSell(s, "s", "2026-10-21"), true);
  s = applyBulkTypeDates(s, ["s"], ["2026-10-20"], { stopSell: false });
  assert.equal(isStopSell(s, "s", "2026-10-20"), false);
  assert.equal(isStopSell(s, "s", "2026-10-21"), true);
  s = applyBulkTypeDates(s, ["s"], ["2026-10-21"], { rate: null });
  assert.equal(baseRateFor(s, "s", "2026-10-21"), 50_000); // 화 = 평일
});

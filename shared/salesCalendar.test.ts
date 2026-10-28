import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBulkPerType,
  applyBulkTypeDates,
  bulkRateHint,
  filterBulkDates,
  rateSourceLabel,
  resolveNightRate,
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

test("applyBulkPerType: 타입마다 자기 금액 · 비운 타입은 그대로", () => {
  let s = setTypeRateDefaults(empty, "a", { weekday: 50_000, weekend: 70_000 });
  s = setTypeRateDefaults(s, "b", { weekday: 90_000, weekend: 120_000 });
  const dates = ["2026-10-20", "2026-10-21"];
  s = applyBulkPerType(s, [{ typeId: "a", rate: 65_000 }, { typeId: "b" }], dates, {});
  assert.equal(baseRateFor(s, "a", "2026-10-20"), 65_000);
  assert.equal(baseRateFor(s, "a", "2026-10-21"), 65_000);
  assert.equal(baseRateFor(s, "b", "2026-10-20"), 90_000, "b는 비워서 그대로");
  assert.equal((s.typeRateOverrides as Record<string, unknown>)?.b, undefined);
  // 같은 금액 지름길은 입력칸을 채울 뿐 — 타입별로 다시 고치면 각자 금액
  s = applyBulkPerType(s, [{ typeId: "a", rate: 80_000 }, { typeId: "b", rate: 100_000 }], ["2026-10-20"], {});
  assert.equal(baseRateFor(s, "a", "2026-10-20"), 80_000);
  assert.equal(baseRateFor(s, "b", "2026-10-20"), 100_000);
  assert.equal(baseRateFor(s, "a", "2026-10-21"), 65_000);
});

test("applyBulkPerType: 판매 설정은 고른 타입 전부 · 요금과 따로", () => {
  const s = applyBulkPerType(empty, [{ typeId: "a" }, { typeId: "b", rate: 70_000 }], ["2026-10-20"], { stopSell: true });
  assert.equal(isStopSell(s, "a", "2026-10-20"), true);
  assert.equal(isStopSell(s, "b", "2026-10-20"), true);
  assert.equal((s.typeRateOverrides as Record<string, unknown>)?.a, undefined);
  assert.equal(baseRateFor(s, "b", "2026-10-20"), 70_000);
});

test("applyBulkPerType: 평일 밤만 / 주말 밤만", () => {
  const dates = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]; // 목 금 토 일
  const base = setTypeRateDefaults(empty, "a", { weekday: 50_000, weekend: 70_000 });
  const wk = filterBulkDates(base, dates, "weekday");
  const we = filterBulkDates(base, dates, "weekend");
  assert.equal(wk.length + we.length, 4);
  assert.ok(we.includes("2026-10-24"));
  const s = applyBulkPerType(base, [{ typeId: "a", rate: 99_000 }], dates, { days: "weekend" });
  for (const d of we) assert.equal(baseRateFor(s, "a", d), 99_000);
  for (const d of wk) assert.equal(baseRateFor(s, "a", d), resolveNightRate(base, "a", d).amount);
});

test("일괄 적용 칸 안내: 지금 요금 범위와 출처 태그", () => {
  let s = setTypeRateDefaults(empty, "a", { weekday: 50_000, weekend: 70_000 });
  s = applyBulkPerType(s, [{ typeId: "a", rate: 60_000 }], ["2026-10-21"], {});
  const h = bulkRateHint(s, "a", ["2026-10-21", "2026-10-24"]);
  assert.equal(h.min, 60_000);
  assert.equal(h.max, 70_000);
  assert.deepEqual(h.tags.sort(), ["주말", "특별일"].sort());
  assert.equal(rateSourceLabel({ source: "weekday" }), "평일");
  assert.equal(rateSourceLabel({ source: "season" }), "시즌");
});

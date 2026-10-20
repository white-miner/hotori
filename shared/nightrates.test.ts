import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendNightAmount,
  defaultNightAmount,
  fillNightAmounts,
  hasFullNightMatrix,
  memberFlatRate,
  occupiedNightDates,
  parseStayNightRates,
  priceFromNightMatrix,
  setNightAmount,
  sumNightAmounts,
  syncStayNightRates,
} from "./nightrates.ts";

test("occupiedNightDates: 입실~퇴실-1", () => {
  assert.deepEqual(occupiedNightDates("2026-10-19", 2), ["2026-10-19", "2026-10-20"]);
  assert.deepEqual(occupiedNightDates("2026-10-19", 1), ["2026-10-19"]);
});

test("defaultNightAmount: 평일·주말(금·토) · flat 폴백", () => {
  // 2026-10-19 = 월, 10-23 = 금, 10-24 = 토
  assert.equal(defaultNightAmount("2026-10-19", { weekday: 80_000, weekend: 90_000, flat: 70_000 }), 80_000);
  assert.equal(defaultNightAmount("2026-10-23", { weekday: 80_000, weekend: 90_000 }), 90_000);
  assert.equal(defaultNightAmount("2026-10-24", { weekday: 80_000, weekend: 90_000 }), 90_000);
  assert.equal(defaultNightAmount("2026-10-19", { flat: 70_000 }), 70_000);
});

test("fill + shrink/extend sync: 뒤 밤 drop · 새 셀 기본 단가", () => {
  const filled = fillNightAmounts("2026-10-19", 3, { flat: 80_000 });
  assert.deepEqual(filled, {
    "2026-10-19": 80_000,
    "2026-10-20": 80_000,
    "2026-10-21": 80_000,
  });
  const custom = setNightAmount({ flat: 80_000, nights: filled }, "2026-10-19", 70_000);
  const shrunk = syncStayNightRates("2026-10-19", 2, custom);
  assert.deepEqual(shrunk.nights, { "2026-10-19": 70_000, "2026-10-20": 80_000 });
  assert.equal(sumNightAmounts(shrunk.nights), 150_000);
  const grown = syncStayNightRates("2026-10-19", 3, shrunk);
  assert.equal(grown.nights?.["2026-10-21"], 80_000);
  assert.equal(grown.nights?.["2026-10-19"], 70_000);
});

test("방별 flat: 602=7만 vs 타입 8만", () => {
  assert.equal(memberFlatRate({ flat: 70_000 }, 80_000), 70_000);
  assert.equal(memberFlatRate(null, 80_000), 80_000);
});

test("총액 = Σ 밤 · append 연장 셀", () => {
  const r = syncStayNightRates("2026-10-19", 2, { flat: 80_000, nights: { "2026-10-19": 70_000, "2026-10-20": 80_000 } });
  assert.equal(priceFromNightMatrix(r), 150_000);
  assert.equal(hasFullNightMatrix("2026-10-19", 2, r), true);
  const ext = appendNightAmount(r, "2026-10-21", 80_000);
  assert.equal(sumNightAmounts(ext.nights), 230_000);
});

test("parseStayNightRates: 깨진 값 걸러냄", () => {
  assert.equal(parseStayNightRates(null), null);
  const p = parseStayNightRates({
    flat: 70_000,
    weekday: 80_000,
    weekend: 90_000,
    nights: { "2026-10-19": 70_000, bad: 1, "2026-10-20": -5 },
  });
  assert.equal(p?.flat, 70_000);
  assert.deepEqual(p?.nights, { "2026-10-19": 70_000 });
});

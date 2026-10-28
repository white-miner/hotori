import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniform, roomTotal, tableAverage, tableRows, tableSummary, tableTotal, withNight, withWeekdayWeekend } from "./nightTable";
import { readFileSync } from "node:fs";
import type { StayNightRates } from "./nightrates";

import { fillBlankWithAmount, nightTableStatus } from "./nightTable";

test("박당 금액으로 채우기: 빈 박만 · 적어 둔 박과 0원 입력은 그대로", () => {
  const out = fillBlankWithAmount("2026-10-25", 3, { "2026-10-26": 100_000 }, 80_000);
  assert.deepEqual(out, { "2026-10-25": 80_000, "2026-10-26": 100_000, "2026-10-27": 80_000 });
  assert.deepEqual(fillBlankWithAmount("2026-10-25", 3, { "2026-10-26": 100_000 }, 0), { "2026-10-26": 100_000 });
});

test("박별 → 합계: 한 박만 고치면 합이 바뀌어요", () => {
  let r: StayNightRates = { flat: null, nights: fillBlankWithAmount("2026-10-25", 3, null, 80_000) };
  assert.equal(roomTotal(r), 240_000);
  r = withNight("2026-10-25", 3, r, 80_000, "2026-10-26", 100_000);
  assert.equal(roomTotal(r), 260_000);
  const rows = tableRows("2026-10-25", 3, r);
  assert.deepEqual(rows.map((x) => `${x.date.slice(5)}${x.weekday}`), ["10-25일", "10-26월", "10-27화"]);
  assert.equal(isUniform(rows), false);
  assert.match(tableSummary(rows), /평균 86,667원/);
  assert.equal(tableAverage(rows), 86_667);
});

test("표 상태: 판매금과의 차액은 알려 주기만 해요 · 일부만 적으면 비교하지 않아요", () => {
  const rates = { flat: null, nights: { "2026-10-25": 80_000, "2026-10-26": 100_000 } };
  const part = nightTableStatus({ checkIn: "2026-10-25", nights: 3, rates, price: 270_000, addons: 0 });
  assert.deepEqual([part.count, part.allEntered, part.sum, part.diff], [2, false, 180_000, null]);
  const full = nightTableStatus({ checkIn: "2026-10-25", nights: 2, rates, price: 170_000, addons: 0 });
  assert.deepEqual([full.allEntered, full.sumTotal, full.diff], [true, 180_000, 10_000]);
  const addon = nightTableStatus({ checkIn: "2026-10-25", nights: 2, rates, price: 180_000, addons: 20_000 });
  assert.equal(addon.diff, 20_000);
  assert.deepEqual(nightTableStatus({ checkIn: "2026-10-25", nights: 2, rates: null, price: 100, addons: 0 }).count, 0);
});

test("요금 없이 열면 기본 1박 요금으로 채워요 · 박수를 늘려도 앞 박은 그대로", () => {
  const rows = tableRows("2026-10-25", 2, null, 70_000);
  assert.deepEqual(rows.map((x) => x.amount), [70_000, 70_000]);
  const edited = withNight("2026-10-25", 2, null, 70_000, "2026-10-25", 90_000);
  const longer = tableRows("2026-10-25", 4, edited, 70_000);
  assert.deepEqual(longer.map((x) => x.amount), [90_000, 70_000, 70_000, 70_000]);
});

test("366박까지 박별 줄이 만들어져요 (예전엔 90박에서 잘렸어요)", () => {
  const rows = tableRows("2026-01-01", 366, null, 50_000);
  assert.equal(rows.length, 366);
  assert.equal(tableTotal(rows), 366 * 50_000);
  assert.equal(Object.keys(fillBlankWithAmount("2026-01-01", 366, null, 1_000)).length, 366);
});

test("평일·주말(금·토) 한 번에", () => {
  const r = withWeekdayWeekend("2026-10-22", 4, 80_000, 100_000); // 목금토일
  const rows = tableRows("2026-10-22", 4, r);
  assert.deepEqual(rows.map((x) => x.amount), [80_000, 100_000, 100_000, 80_000]);
  assert.deepEqual(rows.map((x) => x.peak), [false, true, true, false]);
});

// ── 기록 정정: 빈 박 · 제안 · 예약 금액 유지/변경 ──
import { enteredNightMap, fillBlankNights, nightEditPlan, nightShiftAmbiguous, shiftEnteredNights } from "./nightTable";

test("요금표 없는 예약은 빈 칸으로 시작 — 총액을 나눈 값이 안 생겨요", () => {
  assert.deepEqual(enteredNightMap("2026-10-26", 3, null), {});
  assert.deepEqual(enteredNightMap("2026-10-26", 3, { "2026-10-27": 100_000, "2026-10-30": 5 }), { "2026-10-27": 100_000 });
});

test("타입 요금으로 채우기는 빈 박만 · 적어 둔 박은 그대로", () => {
  const out = fillBlankNights("2026-10-26", 3, { "2026-10-27": 77_000 }, { "2026-10-26": 90_000, "2026-10-27": 90_000, "2026-10-28": 90_000 });
  assert.deepEqual(out, { "2026-10-26": 90_000, "2026-10-27": 77_000, "2026-10-28": 90_000 });
  assert.deepEqual(fillBlankNights("2026-10-26", 2, null, {}), {}, "제안이 없으면 비어 있어요");
});

test("입실일을 옮겨도 새 박은 비워 둬요 (기본 요금으로 채우지 않아요)", () => {
  const m = { "2026-10-26": 80_000, "2026-10-27": 100_000 };
  assert.deepEqual(shiftEnteredNights(m, "2026-10-26", 2, "2026-10-27", 3, "move"), { "2026-10-27": 80_000, "2026-10-28": 100_000 });
  assert.deepEqual(shiftEnteredNights(m, "2026-10-26", 2, "2026-10-27", 3, "keep"), { "2026-10-27": 100_000 });
  assert.equal(nightShiftAmbiguous(m, "2026-10-26", 2, "2026-10-27", 3), true);
  assert.equal(nightShiftAmbiguous(m, "2026-10-26", 2, "2026-10-26", 3), false);
  assert.equal(nightShiftAmbiguous({}, "2026-10-26", 2, "2026-10-27", 2), false, "적은 박이 없으면 물어볼 것도 없어요");
});

test("예약 금액: 박별 합계가 달라도 기본은 판매가 유지 · 체크하면 합계로", () => {
  const e = { "2026-10-26": 80_000, "2026-10-27": 100_000, "2026-10-28": 120_000 };
  const base = { entered: e, nightCount: 3, oldPrice: 270_000, oldExtras: 0, newExtras: 0, addons: 0 };
  const off = nightEditPlan({ ...base, useSum: false });
  assert.deepEqual([off.sum, off.diff, off.price, off.usesSum], [300_000, 30_000, 270_000, false]);
  const on = nightEditPlan({ ...base, useSum: true });
  assert.deepEqual([on.price, on.usesSum], [300_000, true]);
  // 합이 같으면 차액 없음 · 체크 상관없이 같은 금액
  const same = nightEditPlan({ ...base, oldPrice: 300_000, useSum: false });
  assert.deepEqual([same.diff, same.price], [0, 300_000]);
});

test("예약 금액: 일부 박만 적으면 합계로 못 바꿔요 · 추가 항목 변화만 반영", () => {
  const part = nightEditPlan({ entered: { "2026-10-26": 80_000 }, nightCount: 3, oldPrice: 270_000, oldExtras: 0, newExtras: 0, addons: 0, useSum: true });
  assert.deepEqual([part.allEntered, part.diff, part.usesSum, part.price], [false, null, false, 270_000]);
  const ex = nightEditPlan({ entered: {}, nightCount: 3, oldPrice: 270_000, oldExtras: 10_000, newExtras: 30_000, addons: 0, useSum: false });
  assert.equal(ex.price, 290_000, "판매가 + 추가 항목 증가분");
});

test("기록 정정 편집기는 총액 균등분할을 쓰지 않아요", () => {
  const src = readFileSync(new URL("../src/RecordSheet.tsx", import.meta.url), "utf8");
  const i = src.indexOf("function StayEditor");
  const body = src.slice(i);
  assert.doesNotMatch(body, /nightRatesFromTotal|withTotal|splitAmountLast|syncStayNightRates/);
  assert.match(body, /예약 금액도 박별 합계로 바꾸기/);
  assert.match(readFileSync(new URL("../src/NightRatesEntry.tsx", import.meta.url), "utf8"), /타입 요금으로 채우기/);
});

test("총액 균등분할 제거: 공용 박별 표·입력·그룹 객실 표에 총액 칸·나눠 채우기가 없어요", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  for (const f of ["NightRatesTable.tsx", "NightRatesEntry.tsx", "GroupRoomRates.tsx"]) {
    assert.doesNotMatch(read(f), /nightRatesFromTotal|withTotal|withAllSame|splitAmountLast/, f);
  }
  const t = read("NightRatesTable.tsx");
  assert.match(t, /판매금도 박별 합계로 바꾸기/);
  assert.match(read("NightRatesEntry.tsx"), /박당 금액으로 채우기/);
  assert.doesNotMatch(read("SimpleBooking.tsx") + read("Entry.tsx") + read("tangleFix.ts"), /nightRatesFromTotal/);
  assert.doesNotMatch(readFileSync(new URL("./staySale.ts", import.meta.url), "utf8"), /nightRatesFromTotal/);
});

import { hasHandEditedNights, refillKeepingEdits } from "./nightTable";

test("박당 요금 변경: 손으로 고친 박은 그대로 · 자동 채움 박만 바뀜 · 덮어쓰기는 전부", () => {
  const old = { flat: 80_000, nights: { "2026-10-25": 80_000, "2026-10-26": 95_000, "2026-10-27": 80_000 } };
  assert.equal(hasHandEditedNights("2026-10-25", 3, old), true);
  assert.deepEqual(refillKeepingEdits("2026-10-25", 3, old, { flat: 70_000 }), { "2026-10-25": 70_000, "2026-10-26": 95_000, "2026-10-27": 70_000 });
  assert.deepEqual(refillKeepingEdits("2026-10-25", 3, old, { flat: 70_000 }, true), { "2026-10-25": 70_000, "2026-10-26": 70_000, "2026-10-27": 70_000 });
  assert.equal(hasHandEditedNights("2026-10-25", 3, { flat: 80_000, nights: { "2026-10-25": 80_000, "2026-10-26": 80_000, "2026-10-27": 80_000 } }), false);
});

test("단체 객실 표: 직접 적지 않은 박은 제안(미확정)으로 표시", () => {
  const src = readFileSync(new URL("../src/GroupRoomRates.tsx", import.meta.url), "utf8");
  assert.match(src, /제안\(미확정\)/);
});

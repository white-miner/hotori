import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniform, roomTotal, tableAverage, tableRows, tableSummary, tableTotal, withAllSame, withNight, withTotal, withWeekdayWeekend } from "./nightTable";
import { readFileSync } from "node:fs";

test("총액 → 박별: 남는 원은 마지막 박, 합은 총액과 같아요", () => {
  const r = withTotal("2026-10-25", 3, 230_000);
  const rows = tableRows("2026-10-25", 3, r);
  assert.deepEqual(rows.map((x) => x.amount), [76_666, 76_666, 76_668]);
  assert.equal(tableTotal(rows), 230_000);
  assert.equal(roomTotal(r), 230_000);
});

test("박별 → 총액: 한 박만 고치면 합이 바뀌어요 (양방향)", () => {
  let r = withAllSame("2026-10-25", 3, 80_000);
  assert.equal(roomTotal(r), 240_000);
  r = withNight("2026-10-25", 3, r, 80_000, "2026-10-26", 100_000);
  assert.equal(roomTotal(r), 260_000);
  const rows = tableRows("2026-10-25", 3, r);
  assert.deepEqual(rows.map((x) => `${x.date.slice(5)}${x.weekday}`), ["10-25일", "10-26월", "10-27화"]);
  assert.equal(isUniform(rows), false);
  assert.match(tableSummary(rows), /평균 86,667원/);
  assert.equal(tableAverage(rows), 86_667);
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
  assert.equal(withTotal("2026-01-01", 366, 1_000_000).nights && Object.keys(withTotal("2026-01-01", 366, 1_000_000).nights!).length, 366);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniform, roomTotal, tableAverage, tableRows, tableSummary, tableTotal, withAllSame, withNight, withTotal, withWeekdayWeekend } from "./nightTable";

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

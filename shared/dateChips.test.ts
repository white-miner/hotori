// 간단 예약 날짜 입력: 오늘/내일 칩 · 박수 · 입실→퇴실 요약 · 달력 두 번 누르기
import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDate } from "./ledger";
import { NIGHT_CHIPS, activeDateChip, parseNightsInput, pickRangeClick, quickDateChips, stayRangeSummary, stepNights } from "./dateChips";

test("칩: 오늘·내일·모레는 영업일 기준 (새벽 6시 전은 전날이 오늘)", () => {
  const today = businessDate(new Date("2026-10-26T20:30:00Z")); // KST 10/27 05:30 → 영업일 10/26
  assert.deepEqual(quickDateChips(today).map((c) => [c.label, c.date]), [["오늘", "2026-10-26"], ["내일", "2026-10-27"], ["모레", "2026-10-28"]]);
  const after6 = businessDate(new Date("2026-10-26T21:30:00Z")); // KST 06:30
  assert.equal(quickDateChips(after6)[0].date, "2026-10-27");
  assert.equal(activeDateChip("2026-10-27", "2026-10-28"), "tomorrow");
  assert.equal(activeDateChip("2026-10-27", "2026-11-30"), null);
  // 월 경계
  assert.equal(quickDateChips("2026-10-31")[1].date, "2026-11-01");
});

test("박수: 칩 1~7, 증감은 1~366으로 맞춤, 입력 글자 해석", () => {
  assert.deepEqual([...NIGHT_CHIPS], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(stepNights(1, -1), 1);
  assert.equal(stepNights(1, 1), 2);
  assert.equal(stepNights(366, 1), 366);
  assert.equal(parseNightsInput(" 3 "), 3);
  assert.equal(parseNightsInput("0"), null);
  assert.equal(parseNightsInput(""), null);
  assert.equal(parseNightsInput("abc"), null);
  assert.equal(parseNightsInput("500"), 366);
});

test("요약: 요일 이름이 있는 입실 → 퇴실", () => {
  const r = stayRangeSummary("2026-10-30", 2);
  assert.equal(r.inLabel, "10/30(금)");
  assert.equal(r.outLabel, "11/1(일)");
  assert.equal(r.text, "10/30(금) 입실 → 11/1(일) 퇴실 · 2박 3일");
  assert.equal(stayRangeSummary("2026-12-31", 1).outLabel, "1/1(금)");
});

test("달력 두 번 누르기: 멀리 있는 날짜도 '선택 해제' 없이 새로 시작", () => {
  // 처음 눌렀던 범위가 있어도 첫 클릭은 새 입실일 (1박)
  let r = pickRangeClick({ start: null }, "2027-03-05");
  assert.deepEqual([r.checkIn, r.nights, r.state.start], ["2027-03-05", 1, "2027-03-05"]);
  // 둘째 클릭 = 퇴실일
  r = pickRangeClick(r.state, "2027-03-08");
  assert.deepEqual([r.checkIn, r.nights, r.state.start], ["2027-03-05", 3, null]);
  // 다시 첫 클릭은 또 새 범위
  r = pickRangeClick(r.state, "2026-11-01");
  assert.deepEqual([r.checkIn, r.nights, r.state.start], ["2026-11-01", 1, "2026-11-01"]);
  // 같은 날 다시 누르면 1박 확정
  r = pickRangeClick(r.state, "2026-11-01");
  assert.deepEqual([r.checkIn, r.nights, r.state.start], ["2026-11-01", 1, null]);
  // 입실일보다 앞 날짜를 누르면 그 날이 새 입실일
  r = pickRangeClick({ start: "2026-11-10" }, "2026-11-03");
  assert.deepEqual([r.checkIn, r.nights, r.state.start], ["2026-11-03", 1, "2026-11-03"]);
  // 너무 먼 퇴실일은 최대 박수로
  r = pickRangeClick({ start: "2026-11-01" }, "2028-11-01");
  assert.equal(r.nights, 366);
});

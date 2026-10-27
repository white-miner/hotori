// 숙박 입실·퇴실·박수 양방향 산술 (장부 checkOut = checkIn + nights 와 동일)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAY_NIGHTS_MAX,
  STAY_NIGHTS_MIN,
  checkOut,
  checkOutFromStayNights,
  clampStayNights,
  nightsFromStayDates,
} from "./ledger.ts";

test("입실+퇴실 → 박수: 10/20→10/28 = 8박", () => {
  assert.equal(nightsFromStayDates("2026-10-20", "2026-10-28"), 8);
  assert.equal(nightsFromStayDates("2026-10-19", "2026-10-20"), 1);
  assert.equal(nightsFromStayDates("2026-10-01", "2026-10-11"), 10);
});

test("입실+박수 → 퇴실: 장부 checkOut과 같음", () => {
  assert.equal(checkOutFromStayNights("2026-10-20", 8), "2026-10-28");
  assert.equal(checkOutFromStayNights("2026-10-19", 1), "2026-10-20");
  assert.equal(checkOutFromStayNights("2026-10-20", 8), checkOut({ checkIn: "2026-10-20", nights: 8 }));
});

test("양방향: 퇴실 고르면 박수, 박수 고르면 퇴실이 맞물림", () => {
  const inD = "2026-10-20";
  const nights = nightsFromStayDates(inD, "2026-10-28");
  assert.equal(nights, 8);
  assert.equal(checkOutFromStayNights(inD, nights), "2026-10-28");
  // 입실만 바꿔도 박수 유지 → 퇴실이 같이 움직임
  assert.equal(checkOutFromStayNights("2026-10-21", nights), "2026-10-29");
});

test("클램프: 퇴실≤입실·0·초과는 1~366박", () => {
  assert.equal(clampStayNights(0), STAY_NIGHTS_MIN);
  assert.equal(clampStayNights(-3), STAY_NIGHTS_MIN);
  assert.equal(clampStayNights(400), STAY_NIGHTS_MAX);
  assert.equal(clampStayNights(NaN), STAY_NIGHTS_MIN);
  assert.equal(nightsFromStayDates("2026-10-20", "2026-10-20"), 1);
  assert.equal(nightsFromStayDates("2026-10-20", "2026-10-19"), 1);
  assert.equal(nightsFromStayDates("2026-01-01", "2028-12-31"), STAY_NIGHTS_MAX);
});

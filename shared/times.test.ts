import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DAYUSE_DEFAULTS, DEFAULT_STAY_TIMES, normalizeDayuseDefaults, normalizeStayTimes, shiftTime } from "./tiers";
import { normalizeSettings } from "./ledger";

test("입실 · 퇴실 시간: 없거나 잘못되면 16:00 · 12:00", () => {
  assert.deepEqual(normalizeStayTimes(undefined), DEFAULT_STAY_TIMES);
  assert.deepEqual(normalizeStayTimes({ checkIn: "25:00", checkOut: "9:00" }), { checkIn: "16:00", checkOut: "12:00" });
  assert.deepEqual(normalizeStayTimes({ checkIn: "15:00", checkOut: "11:30" }), { checkIn: "15:00", checkOut: "11:30" });
  assert.deepEqual(normalizeSettings({} as never).stayTimes, { checkIn: "16:00", checkOut: "12:00" });
});

test("대실 기본: 없거나 잘못되면 14:00 · 17:00 · 0원", () => {
  assert.deepEqual(normalizeDayuseDefaults(undefined), DEFAULT_DAYUSE_DEFAULTS);
  assert.deepEqual(normalizeSettings({} as never).dayuseDefaults, { startTime: "14:00", endTime: "17:00", price: 0 });
});

test("빠른 입실 · 늦은 퇴실 기준: 시간 앞당기고 미루기", () => {
  assert.deepEqual(shiftTime("16:00", -2), { time: "14:00", days: 0 });
  assert.deepEqual(shiftTime("12:00", 3), { time: "15:00", days: 0 });
  assert.deepEqual(shiftTime("23:00", 2), { time: "01:00", days: 1 });
  assert.deepEqual(shiftTime("01:00", -3), { time: "22:00", days: -1 });
});

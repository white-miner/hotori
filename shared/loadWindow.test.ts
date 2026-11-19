import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import { longReachOr, mergeBookings, reachesInto } from "./loadWindow";

const bk = (p: Partial<Booking>): Booking => ({ id: "x", status: "active", kind: "stay", checkIn: "2026-01-01", nights: 1, openEnded: false, stayMode: "standard", checkedOutAt: null, ...p }) as unknown as Booking;

test("오래전에 입실한 300박 숙박도 지금 보는 기간까지 이어지면 불러와요", () => {
  // 2026-01-01 입실 300박 → 2026-10-28 퇴실. 120일 창(2026-07-22~) 앞에서 시작
  const long = bk({ id: "L", checkIn: "2026-01-01", nights: 300 });
  assert.equal(reachesInto(long, "2026-07-22"), true);
  assert.equal(reachesInto(long, "2026-10-28"), false, "퇴실일 아침부터는 이어지지 않아요");
  assert.equal(reachesInto(bk({ checkIn: "2026-01-01", nights: 30 }), "2026-07-22"), false);
  assert.equal(reachesInto(bk({ checkIn: "2026-01-01", nights: 1, stayMode: "long_stay" }), "2026-07-22"), true, "장기 원장은 퇴실 전이면 계속");
  assert.equal(reachesInto(bk({ checkIn: "2026-01-01", nights: 1, openEnded: true }), "2026-07-22"), true, "퇴실 미정");
  assert.equal(reachesInto(bk({ checkIn: "2026-01-01", nights: 300, status: "cancelled" }), "2026-07-22"), false);
});

test("DB 조건은 박수가 범위보다 긴 숙박·장기·퇴실 미정만", () => {
  assert.equal(longReachOr(120), "nights.gt.120,stay_mode.eq.long_stay,open_ended.eq.true");
});

test("합칠 때 같은 예약은 한 번만", () => {
  const a = bk({ id: "a" }), b = bk({ id: "b" });
  assert.deepEqual(mergeBookings([a], [a, b]).map((x) => x.id), ["a", "b"]);
});

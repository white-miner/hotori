import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedNightsForRoom,
  nightPickGlance,
  nightPickSummary,
  orderNights,
  paintedNightsFromStay,
  rangeHitsBlocked,
  stayFromPaintedNights,
} from "./nightpick.ts";
import { type Booking, checkOut } from "./ledger.ts";

const bk = (p: Partial<Booking> & Pick<Booking, "id" | "checkIn" | "nights" | "roomId">): Booking => ({
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 0,
  guestName: "손님",
  typeId: "t",
  segments: null,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  ...p,
});

test("11~21 칠함 → 11박 · 입 11 · 퇴 22", () => {
  const s = stayFromPaintedNights("2026-10-11", "2026-10-21");
  assert.deepEqual(s, { checkIn: "2026-10-11", nights: 11, stayEnd: "2026-10-22" });
  assert.equal(s.stayEnd, checkOut({ checkIn: s.checkIn, nights: s.nights }));
});

test("1박: 같은 날만 → 퇴실 다음날 아침", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-11", "2026-10-11"), {
    checkIn: "2026-10-11",
    nights: 1,
    stayEnd: "2026-10-12",
  });
});

test("11~12 → 2박 · 퇴 13", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-11", "2026-10-12"), {
    checkIn: "2026-10-11",
    nights: 2,
    stayEnd: "2026-10-13",
  });
});

test("역순 드래그(끝→시작)도 같은 매핑", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-21", "2026-10-11"), stayFromPaintedNights("2026-10-11", "2026-10-21"));
  assert.deepEqual(orderNights("2026-10-21", "2026-10-11"), { firstNight: "2026-10-11", lastNight: "2026-10-21" });
});

test("stay ↔ paint 왕복", () => {
  const paint = paintedNightsFromStay("2026-10-11", 11);
  assert.deepEqual(paint, { firstNight: "2026-10-11", lastNight: "2026-10-21" });
  const back = stayFromPaintedNights(paint.firstNight, paint.lastNight);
  assert.equal(back.checkIn, "2026-10-11");
  assert.equal(back.nights, 11);
  assert.equal(back.stayEnd, "2026-10-22");
});

test("요약 카피", () => {
  assert.equal(nightPickSummary("2026-10-11", "2026-10-21"), "10/11~10/21밤 · 11박 · 입 10/11 · 퇴 10/22아침");
  assert.equal(nightPickSummary("2026-10-11", "2026-10-11"), "10/11밤 · 1박 · 입 10/11 · 퇴 10/12아침");
  assert.equal(nightPickGlance("2026-10-11", "2026-10-21"), "11박 · 10/22 아침 퇴실");
});

test("막힌 밤 포함 구간은 거부", () => {
  const blocked = new Set(["2026-10-15"]);
  assert.equal(rangeHitsBlocked("2026-10-11", "2026-10-21", blocked), true);
  assert.equal(rangeHitsBlocked("2026-10-11", "2026-10-14", blocked), false);
  assert.equal(rangeHitsBlocked("2026-10-15", "2026-10-15", blocked), true);
});

test("객체실 막힌 밤: 다른 예약만 · 자기는 제외", () => {
  const me = bk({ id: "me", checkIn: "2026-10-11", nights: 3, roomId: "r1" });
  const other = bk({ id: "o1", checkIn: "2026-10-20", nights: 2, roomId: "r1" });
  const otherRoom = bk({ id: "o2", checkIn: "2026-10-12", nights: 5, roomId: "r2" });
  const set = blockedNightsForRoom([me, other, otherRoom], "r1", {
    excludeId: "me",
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(set.has("2026-10-11"), false); // 자기 예약
  assert.equal(set.has("2026-10-20"), true);
  assert.equal(set.has("2026-10-21"), true);
  assert.equal(set.has("2026-10-22"), false); // stayEnd 아침
  assert.equal(set.has("2026-10-12"), false); // 다른 방
});

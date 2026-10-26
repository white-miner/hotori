import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRoomHold,
  holdCoversNight,
  holdNights,
  holdOnNight,
  holdOverlapsStay,
  isRoomHeld,
  normalizeRoomHolds,
  planRoomHold,
  releaseRoomHold,
  roomsHeldForStay,
} from "./roomHold";

test("normalizeRoomHolds: swap from/to · trim note · drop bad", () => {
  const list = normalizeRoomHolds([
    { id: "a", roomId: "r1", from: "2026-10-22", to: "2026-10-20", note: "  상담중  ", createdAt: "t" },
    { id: "b", roomId: "r2", from: "bad", to: "2026-10-20" },
    { id: "a", roomId: "r9", from: "2026-10-01", to: "2026-10-01" }, // dup id skip
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].from, "2026-10-20");
  assert.equal(list[0].to, "2026-10-22");
  assert.equal(list[0].note, "상담중");
  assert.equal(holdNights(list[0]), 3);
});

test("hold covers · stay overlap · roomsHeldForStay", () => {
  const h = { id: "1", roomId: "r301", from: "2026-10-20", to: "2026-10-21", createdAt: "t" };
  assert.equal(holdCoversNight(h, "2026-10-20"), true);
  assert.equal(holdCoversNight(h, "2026-10-22"), false);
  assert.equal(holdOverlapsStay(h, "r301", "2026-10-19", 2), true); // 19–20
  assert.equal(holdOverlapsStay(h, "r301", "2026-10-22", 1), false);
  assert.equal(holdOverlapsStay(h, "r302", "2026-10-20", 1), false);
  const held = roomsHeldForStay([h], "2026-10-21", 2);
  assert.equal(held.has("r301"), true);
  assert.equal(isRoomHeld([h], "r301", "2026-10-21"), true);
  assert.equal(holdOnNight([h], "r302", "2026-10-20"), null);
});

test("planRoomHold + release", () => {
  const planned = planRoomHold([], {
    roomId: "r1",
    from: "2026-10-26",
    nights: 2,
    note: "예비",
    nowIso: "2026-10-26T00:00:00Z",
  });
  assert.ok("ok" in planned);
  if (!("ok" in planned)) return;
  assert.equal(planned.ok.to, "2026-10-27");
  assert.equal(planned.ok.note, "예비");
  let list = addRoomHold([], planned.ok);
  const clash = planRoomHold(list, { roomId: "r1", from: "2026-10-27", nights: 1 });
  assert.ok("err" in clash);
  list = releaseRoomHold(list, planned.ok.id);
  assert.equal(list.length, 0);
  const again = planRoomHold(list, { roomId: "r1", from: "2026-10-27", nights: 1 });
  assert.ok("ok" in again);
});

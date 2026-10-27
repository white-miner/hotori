// 객실 추가: 어떤 호실이든 추가 가능 — 502호 사례 (겹치는 미퇴실 예약이 있어도 막지 않음)
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings } from "./ledger";
import { freeForStay, groupDrafts, validateGroupAttach } from "./group";
import { clashLine, roomClashes, suggestFreeRoom } from "./roomClash";

const room = (no: string, typeId: string) => ({ id: `r${no}`, no, typeId });
const S = normalizeSettings({
  types: [{ id: "s", name: "S" }],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [{ id: "f5", name: "5층", rooms: [room("501", "s"), room("502", "s"), room("503", "s")] }],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 50000, guestName: "손님", typeId: "s", roomId: "r502",
  checkIn: "2026-10-26", nights: 1, startTime: null, endTime: null, arrived: true, memo: null, cancelledAt: null,
  createdAt: "", updatedAt: "", segments: null, earlyOut: null, refund: null, ...p,
});
const TODAY = "2026-10-28";

test("502호 사례: 날짜 지난 미퇴실 예약이 있어도 추가 검증을 통과해요", () => {
  const list = [bk({ id: "x1", checkIn: "2026-10-26", guestName: "A" }), bk({ id: "x2", checkIn: "2026-10-27", guestName: "B" })];
  const free = freeForStay(S, list, "2026-10-25", 3);
  assert.equal(free.has("r502"), false, "겹치므로 비어 있지 않음");
  assert.equal(validateGroupAttach({ nights: 3, roomIds: ["r502"], prices: [80000], free }), null, "그래도 추가는 막지 않음");
  const d = groupDrafts({ groupId: "g", groupName: "단체", platformId: "p", checkIn: "2026-10-25", nights: 3, roomIds: ["r502"], prices: [80000], s: S });
  assert.equal(d.length, 1);
  assert.equal(d[0]!.roomId, "r502");
});

test("roomClashes: 겹치는 예약을 알려 주고, 날짜 지난 미퇴실은 stale", () => {
  const list = [
    bk({ id: "x1", checkIn: "2026-10-26", guestName: "A" }),
    bk({ id: "x2", checkIn: "2026-10-28", nights: 2, guestName: "B" }),
    bk({ id: "x3", checkIn: "2026-10-26", checkedOutAt: "2026-10-27T01:00:00Z" as unknown as string, guestName: "C" }),
  ];
  const c = roomClashes(S, list, "r502", "2026-10-25", 4, TODAY);
  assert.deepEqual(c.map((x) => x.bookingId), ["x1", "x2"], "퇴실처리된 건 겹침 아님");
  assert.equal(c[0]!.stale, true);
  assert.equal(c[1]!.stale, false);
  assert.equal(c[0]!.from, "2026-10-26");
  assert.equal(c[0]!.to, "2026-10-27");
  assert.match(clashLine(c[0]!, (d) => d.slice(5).replace("-", "/")), /10\/26 A .*퇴실처리 안 됨/);
  assert.deepEqual(roomClashes(S, list, "r501", "2026-10-25", 4, TODAY), []);
  assert.deepEqual(roomClashes(S, list, "r502", "2026-10-25", 4, TODAY, new Set(["x1"])).map((x) => x.bookingId), ["x2"]);
});

test("suggestFreeRoom: 같은 타입의 빈 방을 제안 · 이미 고른 방은 제외", () => {
  const list = [bk({ id: "x1", checkIn: "2026-10-26" }), bk({ id: "x2", roomId: "r503", checkIn: "2026-10-26" })];
  assert.equal(suggestFreeRoom(S, list, "r502", "2026-10-26", 1), "r501");
  assert.equal(suggestFreeRoom(S, list, "r502", "2026-10-26", 1, new Set(["r501"])), null);
});

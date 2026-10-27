// 객실 이동 예약: 화요일 입실 511호 → 수요일 608호
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, legsOf, normalizeSettings, roomOnNight } from "./ledger";
import type { Change } from "./changes";
import {
  cancelScheduledMove, isMoveDone, legCharges, moveDateRange, moveDoneSummary, moveDueToday, moveLabel, nextMove, pendingMoves, planScheduledMove, retargetLegRate,
} from "./scheduledMove";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  buildings: [{ id: "b1", name: "본관" }],
  floors: [
    { id: "f5", name: "5층", buildingId: "b1", rooms: [{ id: "r502", no: "502", typeId: "s" }, { id: "r511", no: "511", typeId: "s" }] },
    { id: "f6", name: "6층", buildingId: "b1", rooms: [{ id: "r608", no: "608", typeId: "s" }] },
  ],
});
const no = (id: string) => ({ r502: "502", r511: "511", r608: "608" })[id] ?? id;
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `m${++n}`, kind: "stay", status: "active", platformId: "p", price: 300000, guestName: `손님${n}`, typeId: "s", roomId: "r511",
  checkIn: "2026-10-27", nights: 3, startTime: null, endTime: null, arrived: true, memo: null, cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});
const TODAY = "2026-10-27"; // 화요일

test("511호 화요일 입실 → 수요일 608호: 한 예약이 두 구간(511 1박 + 608 2박)으로 이어져요", () => {
  const b = bk({});
  const p = planScheduledMove(S, [b], b, "2026-10-28", "r608", TODAY);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.segments, [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }]);
  assert.equal(p.fromNight, 2);
  assert.equal(p.nightsMoved, 2);
  assert.equal(p.fromRoomId, "r511");
  assert.deepEqual(p.clashes, []);
  const m = { ...b, segments: p.segments };
  assert.deepEqual(legsOf(m).map((l) => [l.roomId, l.checkIn, l.nights]), [["r511", "2026-10-27", 1], ["r608", "2026-10-28", 2]]);
  assert.equal(roomOnNight(m, "2026-10-27"), "r511");
  assert.equal(roomOnNight(m, "2026-10-28"), "r608");
  assert.equal(roomOnNight(m, "2026-10-29"), "r608");
  // 같은 손님·같은 예약·같은 총액
  assert.equal(m.id, b.id);
  assert.equal(m.price, b.price);
});

test("현황판 문구: 「10/28 608호로 이동 예정」 · 이동일 전에는 오늘 방이 511호", () => {
  const b = bk({});
  const p = planScheduledMove(S, [b], b, "2026-10-28", "r608", TODAY);
  assert.ok(p.ok);
  const m = { ...b, segments: p.ok ? p.segments : null };
  const mv = nextMove(m, TODAY);
  assert.ok(mv);
  assert.equal(moveLabel(mv!, no), "10/28 608호로 이동 예정");
  assert.equal(mv!.fromRoomId, "r511");
  assert.equal(roomOnNight(m, TODAY), "r511");
  assert.equal(nextMove(m, "2026-10-29"), null, "이동일이 지나면 예정이 아니에요");
});

test("이동일에는 다음 행동이 「이동 완료」 · 누르면(기록) 사라져요", () => {
  const b = bk({ segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }] });
  assert.equal(moveDueToday(b, TODAY, []), null, "이동일 전날은 아직");
  const due = moveDueToday(b, "2026-10-28", []);
  assert.ok(due);
  assert.equal(due!.toRoomId, "r608");
  const done: Change = { id: "c1", groupId: null, bookingId: b.id, kind: "room", summary: moveDoneSummary(due!, "511", "608"), effectiveOn: "2026-10-28", pinned: false, at: "2026-10-28T10:00:00Z" };
  assert.ok(isMoveDone([done], b.id, "2026-10-28"));
  assert.equal(moveDueToday(b, "2026-10-28", [done]), null);
  assert.equal(moveDueToday(b, "2026-10-28", [{ ...done, bookingId: "other" }])?.toRoomId, "r608", "다른 예약의 완료 기록은 상관없어요");
});

test("어떤 호실이든 고를 수 있어요 — 502호가 그 기간에 차 있어도 막지 않고 겹침만 알려 줘요", () => {
  const b = bk({});
  const other = bk({ roomId: "r502", checkIn: "2026-10-28", nights: 2, guestName: "다른 손님" });
  const p = planScheduledMove(S, [b, other], b, "2026-10-28", "r502", TODAY);
  assert.ok(p.ok, "막히지 않아요");
  if (!p.ok) return;
  assert.equal(p.clashes.length, 1);
  assert.equal(p.clashes[0]!.guest, "다른 손님");
  assert.equal(p.clashes[0]!.roomId, "r502");
  // 비어 있는 날부터 쓰면 겹침 없음
  const q = planScheduledMove(S, [b, { ...other, checkIn: "2026-10-27", nights: 1 }], b, "2026-10-28", "r502", TODAY);
  assert.ok(q.ok && q.clashes.length === 0);
});

test("거절: 같은 방 · 이동일 범위 밖 · 1박 · 퇴실한 예약", () => {
  const b = bk({});
  const bad = (x: ReturnType<typeof planScheduledMove>) => (x.ok ? "" : x.reason);
  assert.match(bad(planScheduledMove(S, [b], b, "2026-10-28", "r511", TODAY)), /같아요/);
  assert.match(bad(planScheduledMove(S, [b], b, "2026-10-27", "r608", TODAY)), /사이로/, "입실일 당일은 「객실 이동」");
  assert.match(bad(planScheduledMove(S, [b], b, "2026-10-30", "r608", TODAY)), /사이로/, "퇴실일 이후");
  const one = bk({ nights: 1 });
  assert.match(bad(planScheduledMove(S, [one], one, "2026-10-28", "r608", TODAY)), /2박 이상/);
  const out = bk({ checkedOutAt: "2026-10-28T02:00:00Z" });
  assert.match(bad(planScheduledMove(S, [out], out, "2026-10-28", "r608", TODAY)), /퇴실/);
  assert.deepEqual(moveDateRange(b), { min: "2026-10-28", max: "2026-10-29" });
  assert.equal(moveDateRange(one), null);
});

test("이동 구간이 이미 있으면 그 날부터 남은 밤을 다시 옮겨요 (두 번 이동)", () => {
  const b = bk({ nights: 4, segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 3 }] });
  const p = planScheduledMove(S, [b], b, "2026-10-29", "r502", TODAY);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.segments, [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 1 }, { roomId: "r502", nights: 2 }]);
  assert.equal(p.fromRoomId, "r608");
  const m = { ...b, segments: p.segments };
  assert.deepEqual(pendingMoves(m, TODAY).map((x) => [x.date, x.toRoomId]), [["2026-10-28", "r608"], ["2026-10-29", "r502"]]);
});

test("이동 예약 취소: 앞 방으로 합쳐져요", () => {
  const b = bk({ segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }] });
  assert.equal(cancelScheduledMove(b, 1), null);
});

test("결제·미수금: 구간이 나뉘어도 총액·구간별 객실료 합이 같아요", () => {
  const b = bk({ price: 300000, segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }] });
  const ch = legCharges(b);
  assert.deepEqual(ch.map((c) => [c.roomId, c.nights, c.amount]), [["r511", 1, 100000], ["r608", 2, 200000]]);
  assert.equal(ch.reduce((x, c) => x + c.amount, 0), b.price);
});

test("이동 후 요금만 따로: 앞 구간은 그대로, 총액은 차이만큼", () => {
  const b = bk({ price: 300000, segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }] });
  const r = retargetLegRate(b, "2026-10-28", 130000);
  assert.equal(r.price, 100000 + 260000);
  const m = { ...b, price: r.price, nightRates: r.nightRates };
  assert.deepEqual(legCharges(m).map((c) => c.amount), [100000, 260000]);
  assert.equal(r.nightRates.nights?.["2026-10-27"], 100000);
});

test("날짜별 요금(평일/주말 차등)도 구간을 따라가요", () => {
  const b = bk({
    price: 100000 + 150000 + 150000,
    nightRates: { nights: { "2026-10-27": 100000, "2026-10-28": 150000, "2026-10-29": 150000 } },
    segments: [{ roomId: "r511", nights: 2 }, { roomId: "r608", nights: 1 }],
  });
  assert.deepEqual(legCharges(b).map((c) => c.amount), [250000, 150000]);
});

// 단체 예약: 금액 나누기 · 같은 층 붙은 방 자동 채우기 · 재고 영향 · 장부 묶음 · 날짜 바꾸기 막기
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings, stockTable } from "./ledger";
import { autoPick, expandTypeSlots, freeForStay, groupDateBlock, groupDrafts, groupStockImpact, groupStockImpactByTypes, groupSummaries, splitTotal, validateGroup } from "./group";

const room = (no: string, typeId: string) => ({ id: `r${no}`, no, typeId });
const S = normalizeSettings({
  types: [{ id: "s", name: "S" }, { id: "t", name: "T" }],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [
    { id: "f3", name: "3층", rooms: [room("301", "s"), room("302", "s"), room("303", "t"), room("304", "s"), room("305", "s"), room("306", "s")] },
    { id: "f2", name: "2층", rooms: [room("201", "s"), room("202", "s"), room("203", "s"), room("204", "t"), room("205", "t")] },
  ],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 100000, guestName: "손님", typeId: "s", roomId: "r301",
  checkIn: "2026-10-19", nights: 2, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: "", updatedAt: "", segments: null, earlyOut: null, refund: null, ...p,
});

test("총액 나누기: 똑같이, 남는 원은 첫 방", () => {
  assert.deepEqual(splitTotal(1000000, 3), [333334, 333333, 333333]);
  assert.deepEqual(splitTotal(900000, 3), [300000, 300000, 300000]);
  assert.equal(splitTotal(1000001, 10).reduce((a, b) => a + b, 0), 1000001);
  assert.deepEqual(splitTotal(5, 0), []);
});

test("그 기간 내내 빈 방만 (하루라도 겹치면 빠져요)", () => {
  const free = freeForStay(S, [bk({ roomId: "r302", checkIn: "2026-10-22", nights: 1 })], "2026-10-19", 6);
  assert.equal(free.has("r302"), false);
  assert.equal(free.has("r301"), true);
  assert.equal(freeForStay(S, [bk({ roomId: "r302", checkIn: "2026-10-25", nights: 1 })], "2026-10-19", 6).has("r302"), true); // 퇴실날 입실은 괜찮아요
});

test("자동 채우기: 같은 층에서 붙은 방을 먼저", () => {
  const free = freeForStay(S, [], "2026-10-19", 2);
  // 3층 S: 301 302 _ 304 305 306 → 3개면 304·305·306(붙어 있음)
  assert.deepEqual(autoPick(S, free, "s", 3), ["r304", "r305", "r306"]);
  // 5개면 3층에 다 있어요
  assert.deepEqual(autoPick(S, free, "s", 5), ["r301", "r302", "r304", "r305", "r306"]);
  // 7개면 한 층에 없어서 빈 방 많은 층부터
  assert.equal(autoPick(S, free, "s", 7).length, 7);
  // 이미 고른 방은 건너뛰어요
  assert.deepEqual(autoPick(S, free, "s", 2, new Set(["r305"])), ["r301", "r302"]);
  // T 2개: 2층 204·205 (붙음) — 3층 303 하나보다 촘촘
  assert.deepEqual(autoPick(S, free, "t", 2), ["r204", "r205"]);
  assert.deepEqual(autoPick(S, free, "t", 9).length, 3); // 있는 만큼만
});

test("재고 영향: 타입마다 가장 적게 남는 날 기준 전 → 후", () => {
  const bs = [bk({ roomId: null, checkIn: "2026-10-20", nights: 1 })]; // 방 안 정한 S 1
  const imp = groupStockImpact(S, bs, "2026-10-19", 3, ["r301", "r302", "r303"]);
  assert.deepEqual(imp.find((x) => x.typeId === "s"), { typeId: "s", n: 2, before: 7, after: 5 });
  assert.deepEqual(imp.find((x) => x.typeId === "t"), { typeId: "t", n: 1, before: 3, after: 2 });
});

test("저장 줄: 방마다 한 줄, 같은 group_id · 이름, 타입은 그 방 타입", () => {
  const list = groupDrafts({ groupId: "g1", groupName: " 한빛상사 ", platformId: "p", checkIn: "2026-10-19", nights: 6, roomIds: ["r301", "r303"], prices: [300001, 300000], s: S, guestsOf: () => 2 });
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((b) => [b.roomId, b.typeId, b.price, b.groupId, b.groupName, b.guestName, b.guests]), [
    ["r301", "s", 300001, "g1", "한빛상사", "한빛상사", 2],
    ["r303", "t", 300000, "g1", "한빛상사", "한빛상사", 2],
  ]);
  // 저장하면 재고에서 빠져요
  const st = stockTable(S, list, ["2026-10-24", "2026-10-25"]);
  assert.equal(st.get("s")!.get("2026-10-24"), 7);
  assert.equal(st.get("s")!.get("2026-10-25"), 8);
});

test("단체 검사", () => {
  const free = new Set(["r301", "r302"]);
  const ok = { name: "단체", platformId: "p", nights: 6, roomIds: ["r301", "r302"], prices: [1, 1], free };
  assert.equal(validateGroup(ok), null);
  assert.match(validateGroup({ ...ok, name: " " })!, /단체명/);
  assert.match(validateGroup({ ...ok, roomIds: ["r301"] })!, /두 개/);
  assert.match(validateGroup({ ...ok, roomIds: ["r301", "r304"] })!, /다른 예약/);
  assert.match(validateGroup({ ...ok, nights: 0 })!, /박수/);
});

test("단체 타입만: 호실 없이 타입×수 · 재고 차감 · 방별 금액", () => {
  const free = new Set<string>();
  const slots = [{ typeId: "s", count: 2 }, { typeId: "t", count: 1 }];
  const typeIds = expandTypeSlots(slots);
  assert.deepEqual(typeIds, ["s", "s", "t"]);
  const prices = [110000, 120000, 200000];
  assert.equal(validateGroup({ name: "한빛", platformId: "p", nights: 2, roomIds: [], prices, free, typeOnly: slots }), null);
  assert.match(validateGroup({ name: "한빛", platformId: "p", nights: 2, roomIds: [], prices: [1], free, typeOnly: [{ typeId: "s", count: 1 }] })!, /두 실/);
  const list = groupDrafts({ groupId: "g1", groupName: "한빛", platformId: "p", checkIn: "2026-10-19", nights: 2, typeIds, prices, s: S, tentative: true });
  assert.equal(list.length, 3);
  assert.ok(list.every((b) => b.roomId === null && b.tentative));
  assert.deepEqual(list.map((b) => [b.typeId, b.price]), [["s", 110000], ["s", 120000], ["t", 200000]]);
  const imp = groupStockImpactByTypes(S, [], "2026-10-19", 2, { s: 2, t: 1 });
  assert.deepEqual(imp.find((x) => x.typeId === "s"), { typeId: "s", n: 2, before: 8, after: 6 });
  const st = stockTable(S, list, ["2026-10-19"]);
  assert.equal(st.get("s")!.get("2026-10-19"), 6);
  assert.equal(st.get("t")!.get("2026-10-19"), 2);
});

test("장부 묶음: 방 수 · 박수 · 합계 (취소 빼고, 노쇼·환불 반영) · 입실 수", () => {
  const g = (p: Partial<Booking>) => bk({ groupId: "g1", groupName: "한빛", nights: 6, price: 300000, ...p });
  const list = [g({ arrived: true }), g({ roomId: "r302" }), g({ roomId: "r303", status: "cancelled" }), g({ roomId: "r304", status: "noshow" }), g({ roomId: "r305", earlyOut: "2026-10-22", refund: 100000 }), bk({})];
  const m = groupSummaries(list);
  assert.equal(m.size, 1);
  const s = m.get("g1")!;
  assert.equal(s.members.length, 5);
  assert.equal(s.rooms, 3);
  assert.equal(s.nights, 6);
  assert.equal(s.total, 300000 + 300000 + 300000 + 200000);
  assert.equal(s.arrived, 1);
});

test("단체 날짜 바꾸기: 다른 예약과 겹치는 방 · 객실 이동한 방은 막아요", () => {
  const m1 = bk({ groupId: "g", groupName: "x", roomId: "r301" });
  const m2 = bk({ groupId: "g", groupName: "x", roomId: "r302" });
  const other = bk({ roomId: "r302", checkIn: "2026-10-21", nights: 1 });
  const all = [m1, m2, other];
  assert.equal(groupDateBlock(S, all, [m1, m2], "2026-10-19", 2), null);
  assert.match(groupDateBlock(S, all, [m1, m2], "2026-10-19", 3)!, /302호/);
  const mv = { ...m1, nights: 2, segments: [{ roomId: "r301", nights: 1 }, { roomId: "r304", nights: 1 }] };
  assert.match(groupDateBlock(S, [mv, m2], [mv, m2], "2026-10-20", 2)!, /객실 이동/);
});

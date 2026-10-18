// 객실 이동: 한 예약이 밤마다 다른 방을 써요
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking, fitSegments, freeRooms, isMoved, legConflicts, legsOf, moveStay, nightBoard, normalizeSettings, roomOnNight,
  stayRoomIds, stockTable, undoMove, unassignedStays, isCancelledRefilled, roomMap,
} from "./ledger";
import { calendarLayout } from "./calendar";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }, { id: "ss", name: "스탠다드 스타일러" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  buildings: [{ id: "b1", name: "본관" }, { id: "b2", name: "별관" }],
  floors: [
    { id: "f3", name: "3층", buildingId: "b1", rooms: [{ id: "r301", no: "301", typeId: "s" }, { id: "r302", no: "302", typeId: "s" }, { id: "r305", no: "305", typeId: "ss" }] },
    { id: "fa", name: "1층", buildingId: "b2", rooms: [{ id: "ra1", no: "101", typeId: "ss" }] },
  ],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `m${++n}`, kind: "stay", status: "active", platformId: "p", price: 400000, guestName: `손님${n}`, typeId: "s", roomId: "r301",
  checkIn: "2026-10-18", nights: 4, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: `2026-10-01T00:00:0${n % 10}Z`, updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});
const D = ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];

test("이동: 2박째부터 305로 → 301 1박 + 305 3박, 총액·예약 하나는 그대로", () => {
  const b = bk({});
  const segs = moveStay(b, 2, "r305");
  assert.deepEqual(segs, [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 3 }]);
  const m = { ...b, segments: segs };
  assert.ok(isMoved(m));
  assert.deepEqual(legsOf(m).map((l) => [l.roomId, l.checkIn, l.nights]), [["r301", "2026-10-18", 1], ["r305", "2026-10-19", 3]]);
  assert.deepEqual(D.map((d) => roomOnNight(m, d)), ["r301", "r305", "r305", "r305", undefined], "퇴실일(10/22)은 아무 방도 아니에요");
  assert.deepEqual(stayRoomIds(m), ["r301", "r305"]);
});

test("여러 번 이동, 같은 방으로 되돌리면 합쳐요, 1박째·범위 밖은 무시", () => {
  const b = bk({ nights: 5 });
  const a = { ...b, segments: moveStay(b, 2, "r305") };
  const c = { ...a, segments: moveStay(a, 4, "r302") };
  assert.deepEqual(c.segments, [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 2 }, { roomId: "r302", nights: 2 }]);
  assert.deepEqual(moveStay(c, 2, "r301"), null, "2박째부터 원래 방으로 → 이동 없음");
  assert.deepEqual(moveStay(b, 1, "r305"), null);
  assert.deepEqual(moveStay(b, 6, "r305"), null);
});

test("이동 취소: 경계를 지우면 앞 방으로 합쳐져요", () => {
  const b = bk({ nights: 5, segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 2 }, { roomId: "r302", nights: 2 }] });
  assert.deepEqual(undoMove(b, 2), [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 4 }]);
  assert.deepEqual(undoMove(b, 1), [{ roomId: "r301", nights: 3 }, { roomId: "r302", nights: 2 }]);
  assert.equal(undoMove({ ...b, segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 4 }] }, 1), null, "하나 남으면 이동 없음");
  // 앞뒤가 같은 방이면 셋이 하나로
  assert.equal(undoMove(bk({ nights: 3, segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 1 }, { roomId: "r301", nights: 1 }] }), 1), null);
});

test("박수·첫 방이 바뀌면 구간을 맞춰요", () => {
  const segs = [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 3 }];
  assert.deepEqual(fitSegments(segs, "r301", 6), [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 5 }]);
  assert.deepEqual(fitSegments(segs, "r301", 2), [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 1 }]);
  assert.equal(fitSegments(segs, "r301", 1), null);
  assert.deepEqual(fitSegments(segs, "r302", 4), [{ roomId: "r302", nights: 1 }, { roomId: "r305", nights: 3 }], "첫 방만 바꿔요");
  assert.equal(fitSegments(segs, "r305", 4), null, "첫 방을 다음 방과 같게 → 합쳐져 이동 없음");
  assert.equal(fitSegments(segs, null, 4), null);
  // 구간 합이 박수와 안 맞는 데이터는 이동 없는 예약처럼 봐요
  assert.deepEqual(legsOf(bk({ segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 1 }] })).length, 1);
});

test("재고: 밤마다 실제로 쓰는 방의 타입에서 빼요, 건물도 구간마다", () => {
  const m = bk({ roomId: "r301", segments: [{ roomId: "r301", nights: 1 }, { roomId: "ra1", nights: 3 }] });
  const t = stockTable(S, [m], D);
  assert.deepEqual(D.map((d) => t.get("s")!.get(d)), [1, 2, 2, 2, 2]);
  assert.deepEqual(D.map((d) => t.get("ss")!.get(d)), [2, 1, 1, 1, 2]);
  const b1 = stockTable(S, [m], D, "b1");
  assert.deepEqual(D.map((d) => b1.get("s")!.get(d)), [1, 2, 2, 2, 2]);
  assert.deepEqual(D.map((d) => b1.get("ss")!.get(d)), [1, 1, 1, 1, 1], "본관 305는 그대로");
  const b2 = stockTable(S, [m], D, "b2");
  assert.deepEqual(D.map((d) => b2.get("ss")!.get(d)), [1, 0, 0, 0, 1]);
  assert.equal(unassignedStays(S, [m], D), 0);
});

test("겹침: 구간 단위로, 빈 방도 구간 단위로", () => {
  const m = bk({ segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 3 }] });
  const later = bk({ roomId: "r301", checkIn: "2026-10-19", nights: 2 }); // 301이 비는 밤 → 안 겹침
  const clash = bk({ roomId: "r305", checkIn: "2026-10-20", nights: 1 }); // 305 둘째 밤 → 겹침
  assert.deepEqual(legConflicts([m, later], later), []);
  assert.deepEqual(legConflicts([m, clash], clash).map((l) => l.roomId), ["r305"]);
  assert.deepEqual(legConflicts([m, clash], m).map((l) => l.roomId), ["r305"]);
  const free = freeRooms(S, [m], { id: "x", kind: "stay", checkIn: "2026-10-19", nights: 1, startTime: null, endTime: null });
  assert.ok(free.has("r301") && !free.has("r305"));
  const L = calendarLayout(S, [m, later, clash], "2026-10-18", "2026-10-24");
  assert.equal(L.rooms.get("r301")?.length, 2);
  assert.equal(L.conflicts, 1);
  const bars305 = L.rooms.get("r305")!;
  assert.equal(bars305.find((x) => x.b.id === m.id)?.prev, "r301");
  assert.equal(L.rooms.get("r301")!.find((x) => x.b.id === m.id)?.next, "r305");
});

test("보드: 그 밤에 쓰는 방에 보여요, 취소 자리 숨김은 구간마다", () => {
  const c = bk({ status: "cancelled", cancelledAt: "2026-10-02T00:00:00Z", segments: [{ roomId: "r301", nights: 1 }, { roomId: "r305", nights: 3 }] });
  assert.equal(nightBoard(S, [c], "2026-10-18").byRoom.get("r301")?.id, c.id);
  assert.equal(nightBoard(S, [c], "2026-10-19").byRoom.get("r305")?.id, c.id);
  assert.equal(nightBoard(S, [c], "2026-10-19").byRoom.get("r301"), undefined);
  const fill = bk({ roomId: "r305", checkIn: "2026-10-20", nights: 1 }); // 305 구간만 채움
  assert.equal(nightBoard(S, [c, fill], "2026-10-18").byRoom.get("r301")?.id, c.id, "301 구간은 그대로 보여요");
  assert.equal(nightBoard(S, [c, fill], "2026-10-19").byRoom.get("r305"), undefined, "305 구간은 사라져요");
  const [l0, l1] = legsOf(c);
  assert.equal(isCancelledRefilled(c, [c, fill], roomMap(S), l0), false);
  assert.equal(isCancelledRefilled(c, [c, fill], roomMap(S), l1), true);
  const L = calendarLayout(S, [c, fill], "2026-10-18", "2026-10-24");
  assert.equal(L.rooms.get("r301")?.length, 1);
  assert.deepEqual(L.rooms.get("r305")?.map((x) => x.b.id), [fill.id]);
});

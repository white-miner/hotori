// 활성 투숙끼리 방 맞교환 (602↔508) · 빈 방/퇴실완료는 기존 경로
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  boardMoveTargets,
  boardMoveWindow,
  boardSwapTargets,
  checkedOutRoomOverlaps,
  freeRooms,
  legConflicts,
  normalizeSettings,
  proposeRoomSwap,
} from "./ledger";

const S = normalizeSettings({
  types: [
    { id: "s", name: "스탠다드" },
    { id: "t", name: "트윈" },
  ],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [
    {
      id: "f5",
      name: "5층",
      rooms: [
        { id: "r508", no: "508", typeId: "s" },
        { id: "r602", no: "602", typeId: "s" },
        { id: "r603", no: "603", typeId: "t" },
        { id: "r605", no: "605", typeId: "s" },
      ],
    },
  ],
});

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r602",
  checkIn: "2026-10-19",
  nights: 2,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  segments: null,
  earlyOut: null,
  refund: null,
  checkedOutAt: null,
  ...p,
});

test("602↔508 겹침 만실: proposeRoomSwap → A→508 · B→602 · conflicts 없음", () => {
  const a = bk({ id: "a", guestName: "A", roomId: "r602", checkIn: "2026-10-19", nights: 3 });
  const b = bk({ id: "b", guestName: "B", roomId: "r508", checkIn: "2026-10-19", nights: 2 });
  assert.equal(freeRooms(S, [a, b], a).has("r508"), false);
  assert.equal(boardMoveTargets(S, [a, b], a, "2026-10-19").has("r508"), false);

  const plan = proposeRoomSwap([a, b], a, "r508", "2026-10-19");
  assert.ok(plan);
  assert.equal(plan!.b.id, "b");
  assert.equal(plan!.fromRoomId, "r602");
  assert.equal(plan!.toRoomId, "r508");
  assert.deepEqual(plan!.aPlace, { roomId: "r508", segments: null });
  assert.deepEqual(plan!.bPlace, { roomId: "r602", segments: null });

  const next = [a, b].map((x) =>
    x.id === "a" ? { ...x, ...plan!.aPlace } : x.id === "b" ? { ...x, ...plan!.bPlace } : x,
  );
  assert.deepEqual(legConflicts(next, next[0]!), []);
  assert.deepEqual(legConflicts(next, next[1]!), []);
});

test("빈 방이면 swap null · boardMoveTargets만", () => {
  const a = bk({ id: "a", roomId: "r602" });
  assert.equal(proposeRoomSwap([a], a, "r605", "2026-10-19"), null);
  assert.equal(boardMoveTargets(S, [a], a, "2026-10-19").has("r605"), true);
});

test("퇴실완료만 겹치면 swap null · checkedOut overlaps", () => {
  const ghost = bk({
    id: "ghost",
    roomId: "r508",
    checkIn: "2026-10-19",
    nights: 1,
    checkedOutAt: "2026-10-21T03:00:00.000Z",
  });
  const a = bk({ id: "a", roomId: "r602", checkIn: "2026-10-19", nights: 2 });
  assert.equal(proposeRoomSwap([ghost, a], a, "r508", "2026-10-19"), null);
  assert.equal(boardMoveTargets(S, [ghost, a], a, "2026-10-19").has("r508"), true);
  const draft = { ...a, roomId: "r508" };
  assert.equal(checkedOutRoomOverlaps([ghost, a], draft).length, 1);
});

test("중간 밤 night 인자여도 전체 숙박 퍼즐 맞교환 (605↔608 회귀)", () => {
  // 예전: night=today → whole=false → null (운영패널 버그). 지금은 night 무시·전체 A↔B.
  const a = bk({ id: "a", guestName: "A", roomId: "r605", checkIn: "2026-10-19", nights: 3 });
  const b = bk({ id: "b", guestName: "B", roomId: "r508", checkIn: "2026-10-19", nights: 2 });
  const mid = "2026-10-20";
  assert.equal(boardMoveWindow(a, mid).whole, false);
  const plan = proposeRoomSwap([a, b], a, "r508", mid);
  assert.ok(plan);
  assert.equal(plan!.fromRoomId, "r605");
  assert.equal(plan!.toRoomId, "r508");
  assert.deepEqual(plan!.aPlace, { roomId: "r508", segments: null });
  assert.deepEqual(plan!.bPlace, { roomId: "r605", segments: null });
  const map = boardSwapTargets(S, [a, b], a, mid);
  assert.equal(map.has("r508"), true);
});

test("제3자가 원 방에 있으면 swap 불가", () => {
  // A 19만 602 · B 19~20 508 · C 20 602 → B→602 시 C와 겹침
  const a = bk({ id: "a", roomId: "r602", checkIn: "2026-10-19", nights: 1 });
  const b = bk({ id: "b", roomId: "r508", checkIn: "2026-10-19", nights: 2 });
  const c = bk({ id: "c", roomId: "r602", checkIn: "2026-10-20", nights: 1 });
  assert.equal(proposeRoomSwap([a, b, c], a, "r508", "2026-10-19"), null);
});

test("boardSwapTargets: 508만 맞교환 후보", () => {
  const a = bk({ id: "a", roomId: "r602", checkIn: "2026-10-19", nights: 2 });
  const b = bk({ id: "b", roomId: "r508", checkIn: "2026-10-19", nights: 2 });
  const map = boardSwapTargets(S, [a, b], a, "2026-10-19");
  assert.equal(map.has("r508"), true);
  assert.equal(map.has("r605"), false);
  assert.equal(boardMoveTargets(S, [a, b], a, "2026-10-19").has("r605"), true);
});

test("숙박↔숙박예약·퇴실예정 무관: occupiesRoom이면 맞교환", () => {
  const a = bk({ id: "a", roomId: "r602", checkIn: "2026-10-19", nights: 2, arrived: true });
  const b = bk({ id: "b", roomId: "r508", checkIn: "2026-10-20", nights: 1, arrived: false });
  assert.ok(proposeRoomSwap([a, b], a, "r508", "2026-10-21"));
  assert.equal(boardSwapTargets(S, [a, b], a, "2026-10-21").has("r508"), true);
});

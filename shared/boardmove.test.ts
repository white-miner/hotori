// 객실 배치에서 빈 방을 눌러 바로 옮기기: 어디부터 옮기나 · 되돌리기 · 옮길 수 있는 방
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, boardMove, boardMoveTargets, boardMoveWindow, legsOf, normalizeSettings, placementOf, roomOnNight } from "./ledger";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }, { id: "t", name: "트윈" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [
    { id: "f6", name: "6층", rooms: [{ id: "r601", no: "601", typeId: "s" }, { id: "r602", no: "602", typeId: "s" }, { id: "r603", no: "603", typeId: "t" }, { id: "r605", no: "605", typeId: "s" }] },
  ],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 300000, guestName: `손님${n}`, typeId: "s", roomId: "r601",
  checkIn: "2026-10-18", nights: 3, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});

test("첫 밤에서 옮기면 숙박 전체: 방만 바뀌고 나누지 않아요", () => {
  const b = bk({});
  assert.deepEqual(boardMoveWindow(b, "2026-10-18"), { from: 1, whole: true, checkIn: "2026-10-18", nights: 3 });
  assert.deepEqual(boardMove(b, "2026-10-18", "r602"), { roomId: "r602", segments: null });
});

test("중간 밤에서 옮기면 그 밤에서 나눠요 (오늘이 2박째면 오늘 밤부터)", () => {
  const b = bk({});
  assert.deepEqual(boardMoveWindow(b, "2026-10-19"), { from: 2, whole: false, checkIn: "2026-10-19", nights: 2 });
  const p = boardMove(b, "2026-10-19", "r602");
  assert.deepEqual(p, { roomId: "r601", segments: [{ roomId: "r601", nights: 1 }, { roomId: "r602", nights: 2 }] });
  const m = { ...b, ...p };
  assert.deepEqual(["2026-10-18", "2026-10-19", "2026-10-20"].map((d) => roomOnNight(m, d)), ["r601", "r602", "r602"]);
  // 마지막 밤에서
  assert.deepEqual(boardMove(b, "2026-10-20", "r605").segments, [{ roomId: "r601", nights: 2 }, { roomId: "r605", nights: 1 }]);
});

test("이미 옮긴 숙박: 첫 밤에서 다시 옮기면 전체가 한 방, 뒤 밤에서 옮기면 그 밤부터 새 방", () => {
  const b = bk({ nights: 4, segments: [{ roomId: "r601", nights: 1 }, { roomId: "r602", nights: 3 }] });
  assert.deepEqual(boardMove(b, "2026-10-18", "r605"), { roomId: "r605", segments: null });
  const p = boardMove(b, "2026-10-20", "r605");
  assert.deepEqual(p.segments, [{ roomId: "r601", nights: 1 }, { roomId: "r602", nights: 1 }, { roomId: "r605", nights: 2 }]);
  assert.equal(p.roomId, "r601");
  // 앞 방으로 돌아가면 합쳐요
  assert.deepEqual(boardMove(b, "2026-10-19", "r601"), { roomId: "r601", segments: null });
});

test("보는 밤이 범위 밖이면 가까운 쪽으로 (첫 밤 앞은 전체, 퇴실 뒤는 마지막 밤)", () => {
  const b = bk({});
  assert.equal(boardMoveWindow(b, "2026-10-10").whole, true);
  assert.deepEqual(boardMoveWindow(b, "2026-10-30"), { from: 3, whole: false, checkIn: "2026-10-20", nights: 1 });
});

test("대실은 늘 그날 전체, 방만 바꿔요", () => {
  const d = bk({ kind: "dayuse", nights: null, roomId: "r601", startTime: "14:00", endTime: "17:00" });
  assert.deepEqual(boardMove(d, "2026-10-18", "r603"), { roomId: "r603", segments: null });
});

test("되돌리기: 옮기기 전 room_id·구간을 그대로 다시", () => {
  const b = bk({ nights: 4, segments: [{ roomId: "r601", nights: 2 }, { roomId: "r602", nights: 2 }] });
  const before = placementOf(b);
  const moved = { ...b, ...boardMove(b, "2026-10-21", "r605") };
  assert.notDeepEqual(placementOf(moved), before);
  const back = { ...moved, ...before };
  assert.deepEqual(placementOf(back), { roomId: "r601", segments: [{ roomId: "r601", nights: 2 }, { roomId: "r602", nights: 2 }] });
  assert.deepEqual(legsOf(back), legsOf(b));
  // 복사본이라 원래 예약을 바꿔도 되돌리기 값은 그대로
  b.segments![0].nights = 99;
  assert.equal(before.segments![0].nights, 2);
  // 이동 없는 예약은 구간 null
  assert.deepEqual(placementOf(bk({ roomId: "r603" })), { roomId: "r603", segments: null });
});

test("옮길 수 있는 방: 보는 밤부터 퇴실까지 내내 빈 방만, 지금 방은 빼요", () => {
  const me = bk({ id: "me", checkIn: "2026-10-18", nights: 3, roomId: "r601" });
  const a = bk({ roomId: "r602", checkIn: "2026-10-20", nights: 1 }); // 3박째 밤만 602
  const c = bk({ roomId: "r603", checkIn: "2026-10-17", nights: 2 }); // 18일 밤까지 603
  const x = bk({ roomId: "r605", status: "cancelled" }); // 취소는 막지 않아요
  const all = [me, a, c, x];
  assert.deepEqual([...boardMoveTargets(S, all, me, "2026-10-18")].sort(), ["r605"]);
  assert.deepEqual([...boardMoveTargets(S, all, me, "2026-10-19")].sort(), ["r603", "r605"], "2박째부터면 18일 밤 603은 상관없어요");
});

test("대실 옮길 방: 대실↔대실 겹침만 제외 · 숙박 방은 허용 (경고는 UI)", () => {
  const d = bk({ id: "du", kind: "dayuse", nights: null, roomId: "r601", startTime: "14:00", endTime: "17:00" });
  const other = bk({ kind: "dayuse", nights: null, roomId: "r602", startTime: "15:00", endTime: "18:00" });
  const stay = bk({ roomId: "r603", checkIn: "2026-10-18", nights: 1 });
  assert.deepEqual([...boardMoveTargets(S, [d, other, stay], d, "2026-10-18")].sort(), ["r603", "r605"]);
  const late = bk({ kind: "dayuse", nights: null, roomId: "r602", startTime: "18:00", endTime: "20:00" });
  assert.deepEqual([...boardMoveTargets(S, [d, late, stay], d, "2026-10-18")].sort(), ["r602", "r603", "r605"]);
});

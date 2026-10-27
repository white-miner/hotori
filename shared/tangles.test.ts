import assert from "node:assert/strict";
import test from "node:test";
import type { Booking } from "./ledger";
import { findDuplicates, findOverlaps, findTangles, newTangles } from "./tangles";

const bk = (p: Partial<Booking> & { id: string }): Booking => ({
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: "홍길동",
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-28",
  nights: 2,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  segments: null,
  earlyOut: null,
  refund: null,
  ...p,
});

test("T08 같은 방 같은 밤 겹침", () => {
  const a = bk({ id: "a", guestName: "가", checkIn: "2026-10-28", nights: 3 });
  const b = bk({ id: "b", guestName: "나", checkIn: "2026-10-30", nights: 2 });
  const t = findOverlaps([a, b]);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.rule, "T08");
  assert.deepEqual(t[0]!.ids, ["a", "b"]);
  assert.match(t[0]!.title, /10\/30/);
});

test("T08 맞붙은 예약·다른 방·취소·퇴실 처리·조기 퇴실은 겹침 아님", () => {
  const a = bk({ id: "a", nights: 2 }); // 28~29
  assert.equal(findOverlaps([a, bk({ id: "b", checkIn: "2026-10-30" })]).length, 0, "퇴실일에 입실");
  assert.equal(findOverlaps([a, bk({ id: "c", roomId: "r302" })]).length, 0);
  assert.equal(findOverlaps([a, bk({ id: "d", status: "cancelled" as Booking["status"] })]).length, 0);
  assert.equal(findOverlaps([a, bk({ id: "e", checkedOutAt: "2026-10-29T01:00:00Z" })]).length, 0);
  const early = bk({ id: "f", checkIn: "2026-10-20", nights: 10, earlyOut: "2026-10-28" });
  assert.equal(findOverlaps([early, a]).length, 0, "조기 퇴실한 뒤는 방이 비어요");
});

test("T08 방 이동 구간도 본다", () => {
  const moved = bk({ id: "m", roomId: "r301", checkIn: "2026-10-28", nights: 4, segments: [{ roomId: "r301", nights: 2 }, { roomId: "r305", nights: 2 }] });
  const other = bk({ id: "o", roomId: "r305", checkIn: "2026-10-30", nights: 1 });
  assert.equal(findOverlaps([moved, other]).length, 1);
  assert.equal(findOverlaps([moved, bk({ id: "o2", roomId: "r305", checkIn: "2026-10-28", nights: 2 })]).length, 0, "그 구간엔 301호");
});

test("T11 똑같은 예약 · 단체·다른 금액은 제외", () => {
  const a = bk({ id: "a" });
  const b = bk({ id: "b", roomId: "r302" });
  const t = findDuplicates([a, b]);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.rule, "T11");
  assert.equal(findDuplicates([a, bk({ id: "c", price: 90000 })]).length, 0);
  assert.equal(findDuplicates([bk({ id: "g1", groupId: "g" }), bk({ id: "g2", groupId: "g" })]).length, 0);
  assert.equal(findDuplicates([bk({ id: "n1", guestName: " " }), bk({ id: "n2", guestName: "" })]).length, 0);
});

test("방 이름은 label로", () => {
  const t = findTangles([bk({ id: "a", nights: 3 }), bk({ id: "b", checkIn: "2026-10-29", guestName: "나" })], (id) => (id === "r301" ? "301" : "?"));
  assert.match(t[0]!.title, /^301호/);
});

test("newTangles는 이미 알던 건 빼요 · 서명이 바뀌면 다시 나와요", () => {
  const a = bk({ id: "a", nights: 3 });
  const b = bk({ id: "b", checkIn: "2026-10-29", guestName: "나" });
  const before = findTangles([a, b]);
  assert.equal(newTangles(before, before).length, 0);
  const c = bk({ id: "b", checkIn: "2026-10-30", guestName: "나" });
  assert.equal(newTangles(before, findTangles([a, c])).length, 1);
  assert.equal(newTangles([], before).length, 1);
});

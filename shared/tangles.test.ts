import assert from "node:assert/strict";
import test from "node:test";
import type { Booking } from "./ledger";
import { findDuplicates, findOverlaps, findTangles, newTangles, sortTangles, visibleTangles } from "./tangles";

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
  const t = findTangles([bk({ id: "a", nights: 3 }), bk({ id: "b", checkIn: "2026-10-29", guestName: "나" })], { label: (id) => (id === "r301" ? "301" : "?") });
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

const pay = (amount: number) => ({ id: "x" + amount, bookingId: "a", kind: "balance", method: "cash", amount, bizDate: "2026-10-28", createdAt: "" }) as never;
const onsite = () => ({ name: "현장", onsite: true });
const ctx = { today: "2026-10-28", plat: onsite };

test("T01 입실했는데 퇴실일이 지나도 퇴실 처리가 없으면 · 고치기는 그 퇴실일", () => {
  const a = bk({ id: "a", checkIn: "2026-10-20", nights: 2, arrived: true });
  const t = findTangles([a], ctx).filter((x) => x.rule === "T01");
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.fix && { kind: t[0]!.fix.kind, date: (t[0]!.fix as { date: string }).date }, { kind: "checkout", date: "2026-10-22" });
  // 퇴실 처리가 되어 있거나 아직 안 지났으면 없음
  assert.equal(findTangles([bk({ id: "b", checkIn: "2026-10-20", nights: 2, arrived: true, checkedOutAt: "2026-10-22T02:00:00Z" })], ctx).length, 0);
  assert.equal(findTangles([bk({ id: "c", checkIn: "2026-10-27", nights: 2, arrived: true })], ctx).length, 0);
  // 입실 전이면 T01 아님
  assert.equal(findTangles([bk({ id: "d", checkIn: "2026-10-20", nights: 2, arrived: false })], ctx).filter((x) => x.rule === "T01").length, 0);
});

test("T02 조기 퇴실 환불이 비어 있고 낸 돈이 이용분보다 많을 때만", () => {
  const base = { id: "a", checkIn: "2026-10-20", nights: 4, price: 400000, earlyOut: "2026-10-22", arrived: true, checkedOutAt: "2026-10-22T02:00:00Z" };
  const gap = findTangles([bk({ ...base, payments: [pay(400000)] })], ctx).filter((x) => x.rule === "T02");
  assert.equal(gap.length, 1);
  assert.match(gap[0]!.detail, /200,000원/);
  // 환불이 있으면 없음 · 낸 돈이 이용분 이하면 없음
  assert.equal(findTangles([bk({ ...base, payments: [pay(400000)], refund: { amount: 200000 } as never })], ctx).filter((x) => x.rule === "T02").length, 0);
  assert.equal(findTangles([bk({ ...base, payments: [pay(200000)] })], ctx).filter((x) => x.rule === "T02").length, 0);
});

test("T04 낸 돈이 청구액보다 많을 때 · 선수금이 아닌 초과", () => {
  const a = bk({ id: "a", checkIn: "2026-10-28", nights: 2, price: 100000, payments: [pay(130000)] });
  const t = findTangles([a], ctx).filter((x) => x.rule === "T04");
  assert.equal(t.length, 1);
  assert.match(t[0]!.title, /30,000원 많아요/);
  assert.equal(findTangles([bk({ id: "b", price: 100000, payments: [pay(100000)] })], ctx).filter((x) => x.rule === "T04").length, 0);
  // OTA(현장 결제 아님)는 따지지 않아요
  assert.equal(findTangles([a], { today: ctx.today, plat: () => ({ name: "OTA", onsite: false }) }).filter((x) => x.rule === "T04").length, 0);
});

test("T05 7박 이상인데 박당 금액이 너무 낮음 · 형제 중앙값으로 제안", () => {
  const a = bk({ id: "a", checkIn: "2026-10-28", nights: 10, price: 50000 });
  const t = findTangles([a], ctx).filter((x) => x.rule === "T05");
  assert.equal(t.length, 1);
  assert.equal(t[0]!.fix!.kind, "open");
  const g = (id: string, price: number) => bk({ id, groupId: "g", roomId: "r" + id, checkIn: "2026-10-28", nights: 10, price });
  const t2 = findTangles([g("a", 50000), g("b", 600000), g("c", 600000)], ctx).filter((x) => x.rule === "T05");
  assert.equal(t2.length, 1);
  assert.deepEqual(t2[0]!.fix && { kind: t2[0]!.fix.kind, total: (t2[0]!.fix as { total: number }).total }, { kind: "price", total: 600000 });
  // 7박 미만은 건드리지 않음
  assert.equal(findTangles([bk({ id: "s", nights: 3, price: 10000 })], ctx).filter((x) => x.rule === "T05").length, 0);
});

test("T07 금액 미정 · T09 입실 지났는데 방 없음", () => {
  const u = bk({ id: "u", priceUnset: true, price: 0 } as never);
  assert.equal(findTangles([u], ctx).filter((x) => x.rule === "T07").length, 1);
  const n = bk({ id: "n", roomId: null, checkIn: "2026-10-27", nights: 3 });
  const t = findTangles([n], ctx).filter((x) => x.rule === "T09");
  assert.equal(t.length, 1);
  // 오늘 입실이면 아직 아님
  assert.equal(findTangles([bk({ id: "m", roomId: null, checkIn: "2026-10-28" })], ctx).filter((x) => x.rule === "T09").length, 0);
});

test("정렬: 돈 → 겹침 → 정리 · 이대로 둠은 서명이 같을 때만 숨김", () => {
  const list = findTangles(
    [
      bk({ id: "a", checkIn: "2026-10-20", nights: 2, arrived: true }),
      bk({ id: "b", roomId: "r2", checkIn: "2026-10-28", nights: 2, price: 100000, payments: [pay(130000)] }),
    ],
    ctx,
  );
  assert.deepEqual(sortTangles(list).map((x) => x.rule), ["T04", "T01"]);
  const t04 = list.find((x) => x.rule === "T04")!;
  assert.equal(visibleTangles(list, new Map([[t04.key, t04.signature]])).length, 1);
  assert.equal(visibleTangles(list, new Map([[t04.key, "다른 서명"]])).length, 2);
});

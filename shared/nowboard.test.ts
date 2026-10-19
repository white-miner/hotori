// 현장 현황 보드: 영업일 기준 상태 파생 · 옆 패널 분류
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import { nowFlags, nowLists, nowStayChips, nowStayHint, unassignedTypeCounts } from "./nowboard";

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: "손님",
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-19",
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

test("지금 상태: 입실 예정 · 투숙 · 퇴실 예정 · 늦은 퇴실 · 임시 · 미배정", () => {
  const date = "2026-10-19";
  assert.equal(nowFlags(bk({ arrived: false, checkIn: date }), date).kind, "arriving");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 3 }), date).kind, "inhouse");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), date).kind, "departing");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 1, lateOut: 2 }), date).kind, "lateOut");
  assert.equal(nowFlags(bk({ arrived: true, tentative: true, checkIn: date, nights: 3 }), date).tentative, true);
  assert.equal(nowFlags(bk({ arrived: true, noClean: true, checkIn: date, nights: 3 }), date).noClean, true);
  assert.equal(nowFlags(bk({ roomId: null, checkIn: date }), date).kind, "unassigned");
  assert.equal(nowFlags(null, date).kind, "empty");
  assert.equal(nowFlags(null, date).noClean, false);
});

test("중도 퇴실 밤은 보드에 안 나오고, 그 전날 밤은 퇴실 예정", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-18", nights: 4, earlyOut: "2026-10-20" });
  assert.equal(nowFlags(b, "2026-10-19").kind, "departing");
  assert.equal(nowFlags(b, "2026-10-20").kind, "empty");
});

test("옆 패널: 임시·미배정·퇴실·늦은퇴실·입실예정 분류", () => {
  const date = "2026-10-19";
  const list = [
    bk({ id: "u1", guestName: "미정", roomId: null, checkIn: date, nights: 2 }),
    bk({ id: "t1", guestName: "임시", roomId: "r301", tentative: true, arrived: true, checkIn: date, nights: 3 }),
    bk({ id: "d1", guestName: "나감", roomId: "r302", arrived: true, checkIn: date, nights: 1 }),
    bk({ id: "l1", guestName: "늦음", roomId: "r303", arrived: true, checkIn: date, nights: 1, lateOut: 1 }),
    bk({ id: "a1", guestName: "올예", roomId: "r304", arrived: false, checkIn: date, nights: 2 }),
    bk({ id: "x1", guestName: "취소", status: "cancelled", checkIn: date }),
  ];
  const m = nowLists(list, date);
  assert.equal(m.unassigned.length, 1);
  assert.equal(m.tentative.length, 1);
  assert.equal(m.departing.map((b) => b.guestName).join(), "나감");
  assert.equal(m.lateOut.map((b) => b.guestName).join(), "늦음");
  assert.equal(m.arriving.map((b) => b.guestName).join(), "올예");
});

test("미배정 타입 카운트: 단체·타입별", () => {
  const list = [
    bk({ roomId: null, typeId: "s", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "s", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "t", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "s", guestName: "개인" }),
  ];
  const c = unassignedTypeCounts(list);
  assert.equal(c.find((x) => x.groupName === "한빛" && x.typeId === "s")?.n, 2);
  assert.equal(c.find((x) => x.groupName === "한빛" && x.typeId === "t")?.n, 1);
  assert.equal(c.find((x) => !x.groupName && x.typeId === "s")?.n, 1);
});

test("연박 칩: 총 박수 + 몇 박째, 1박은 빈 배열", () => {
  const b = bk({ checkIn: "2026-10-10", nights: 11, arrived: true });
  assert.deepEqual(nowStayChips(b, "2026-10-18"), ["11박", "9박째"]);
  assert.deepEqual(nowStayChips(b, "2026-10-10"), ["11박", "1박째"]);
  assert.deepEqual(nowStayChips(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), []);
  assert.equal(nowStayHint(b, "2026-10-18"), "11박 · 9박째");
  assert.equal(nowStayHint(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), "1박");
});

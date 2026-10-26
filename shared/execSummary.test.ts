import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import { methodSales, platformPayMatrix, resolvePlatformForPay, typeSalesByType } from "./execSummary";

let n = 0;
const bk = (p: Partial<Booking> & Pick<Booking, "typeId" | "checkIn" | "price">): Booking =>
  ({
    id: `b${++n}`,
    kind: "stay",
    status: "active",
    platformId: "p",
    guestName: "손님",
    guestPhone: null,
    roomId: "r1",
    nights: 1,
    startTime: null,
    endTime: null,
    guests: 2,
    memo: null,
    groupId: null,
    groupName: null,
    earlyOut: null,
    refund: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    segments: null,
    checkedOutAt: null,
    cancelledAt: null,
    ...p,
  }) as Booking;

const types = [
  { id: "s", name: "스탠다드" },
  { id: "d", name: "디럭스" },
];

test("타입별 판매수: 기간 입실·취소 제외·설정 순서", () => {
  const list = [
    bk({ typeId: "s", checkIn: "2026-10-20", price: 100000, nights: 2 }),
    bk({ typeId: "s", checkIn: "2026-10-21", price: 90000, kind: "dayuse", nights: null }),
    bk({ typeId: "d", checkIn: "2026-10-20", price: 150000, nights: 1 }),
    bk({ typeId: "s", checkIn: "2026-10-19", price: 80000 }), // 기간 밖
    bk({ typeId: "d", checkIn: "2026-10-20", price: 50000, status: "cancelled" }), // 제외
    bk({ typeId: "d", checkIn: "2026-10-22", price: 70000, status: "noshow" }), // 매출 포함
  ];
  const { rows, total } = typeSalesByType(list, "2026-10-20", "2026-10-22", types);
  assert.equal(rows[0].label, "스탠다드");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].stay, 1);
  assert.equal(rows[0].dayuse, 1);
  assert.equal(rows[0].nights, 2);
  assert.equal(rows[0].net, 190000);
  assert.equal(rows[1].label, "디럭스");
  assert.equal(rows[1].count, 2); // active + noshow
  assert.equal(rows[1].net, 220000);
  assert.equal(total.count, 4);
  assert.equal(total.net, 410000);
});

test("중도퇴실 환불은 퇴실일이 기간 안이면 타입 net에서 차감", () => {
  const list = [
    bk({
      typeId: "s",
      checkIn: "2026-10-20",
      price: 200000,
      nights: 3,
      earlyOut: "2026-10-21",
      refund: 50000,
    }),
  ];
  const a = typeSalesByType(list, "2026-10-20", "2026-10-20", types);
  assert.equal(a.rows[0].sales, 200000);
  assert.equal(a.rows[0].refunds, 0);
  assert.equal(a.rows[0].net, 200000);
  const b = typeSalesByType(list, "2026-10-21", "2026-10-21", types);
  assert.equal(b.rows[0].sales, 0);
  assert.equal(b.rows[0].refunds, 50000);
  assert.equal(b.rows[0].net, -50000);
});

test("결제수단 합산: 예약 + 매점 카드·현금", () => {
  const m = methodSales(
    { card: 100000, cash: 50000, transfer: 30000, credit: 10000, total: 190000 },
    { card: 8000, cash: 2000, none: 500 },
  );
  assert.equal(m.card, 108000);
  assert.equal(m.cash, 52000);
  assert.equal(m.transfer, 30000);
  assert.equal(m.total, 190000);
  assert.equal(m.shop.total, 10500);
  assert.equal(m.booking.credit, 10000);
});

test("플랫폼×결제수단 매트릭스: 행·열 합계 · 매점 · credit 제외", () => {
  const plats = [
    { id: "ya", name: "야놀자" },
    { id: "on", name: "현장" },
  ];
  const byBooking = new Map([
    ["b1", { platformId: "ya", groupId: null }],
    ["b2", { platformId: "on", groupId: null }],
    ["b3", { platformId: "on", groupId: "g1" }],
  ]);
  const byGroup = new Map([["g1", "on"]]);
  const resolve = (p: { bookingId: string; groupId?: string | null }) =>
    resolvePlatformForPay(p, byBooking, new Map(plats.map((x) => [x.id, x])), byGroup);
  const pays = [
    { bookingId: "b1", method: "card" as const, amount: 100000, bizDate: "2026-10-20" },
    { bookingId: "b1", method: "transfer" as const, amount: 20000, bizDate: "2026-10-20" },
    { bookingId: "b2", method: "cash" as const, amount: 50000, bizDate: "2026-10-21" },
    { bookingId: "b2", method: "credit" as const, amount: 10000, bizDate: "2026-10-21" },
    { bookingId: "", groupId: "g1", method: "card" as const, amount: 30000, bizDate: "2026-10-20" },
    { bookingId: "b9", method: "cash" as const, amount: 1000, bizDate: "2026-10-19" }, // 기간 밖
  ];
  const { rows, total } = platformPayMatrix(pays, "2026-10-20", "2026-10-21", resolve, plats, {
    card: 8000,
    cash: 2000,
    none: 500,
  });
  assert.equal(rows[0].label, "야놀자");
  assert.equal(rows[0].card, 100000);
  assert.equal(rows[0].transfer, 20000);
  assert.equal(rows[0].total, 120000);
  assert.equal(rows[1].label, "현장");
  assert.equal(rows[1].cash, 50000);
  assert.equal(rows[1].card, 30000);
  assert.equal(rows[1].total, 80000);
  assert.equal(rows[2].label, "매점");
  assert.equal(rows[2].card, 8000);
  assert.equal(rows[2].cash, 2000);
  assert.equal(rows[2].total, 10000);
  assert.equal(total.card, 138000);
  assert.equal(total.cash, 52000);
  assert.equal(total.transfer, 20000);
  assert.equal(total.total, 210000);
  assert.equal(total.credit, 10000);
});

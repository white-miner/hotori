// 결제 등록(단체): 3박 묶음 · 객실 추가(입실일부터 자기 요금) · 일부 객실 · 금액 자유 · 선수금 · 기간 없음
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "./ledger";
import type { Payment } from "./payment";
import type { PeriodBooking } from "./periodPay";
import { planGroupPeriod, periodPayLines, stayCoverage } from "./periodPay";
import { groupLedger, type GroupLedger } from "./groupLedger";
import { RECEIPT_NIGHTS_MAX, receiptDefaultNights, receiptDefaultRooms, receiptDefaultStart, receiptHeadline, receiptPlan, type ReceiptPlan } from "./receipt";

let n = 100;
const matrix = (checkIn: string, per: number, count: number) => ({
  flat: per,
  nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [addDays(checkIn, i), per])),
});
const room = (id: string, per: number, count: number, checkIn = "2026-10-28", p: Partial<PeriodBooking> = {}): PeriodBooking =>
  ({
    id, status: "active", kind: "stay", checkIn, nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
    nightRates: matrix(checkIn, per, count), payments: [], checkedOutAt: null, stayMode: null, ...p,
  }) as PeriodBooking;
const g3 = () => [room("r602", 70_000, 30), room("r501", 80_000, 30), room("r301", 80_000, 30)];

/** 저장된 결제 줄을 예약에 붙여요 (앱이 하는 일을 흉내) */
function apply(rooms: PeriodBooking[], plan: ReceiptPlan): { rooms: PeriodBooking[]; lump: number } {
  const t = `2026-10-28T00:00:${String(++n % 60).padStart(2, "0")}Z`;
  const next = rooms.map((b) => {
    const mine = plan.lines.filter((l) => l.bookingId === b.id);
    if (!mine.length) return b;
    const adds: Payment[] = mine.map((l, i) => ({
      id: `q${++n}`, bookingId: b.id, kind: "balance", method: "card", amount: l.amount, bizDate: "2026-10-28", createdAt: t, note: l.note,
      nightDate: l.nightDate, periodNights: l.periodNights,
    }) as Payment);
    return { ...b, payments: [...(b.payments ?? []), ...adds] } as PeriodBooking;
  });
  return { rooms: next, lump: plan.lump?.amount ?? 0 };
}
const ledgerOf = (rooms: PeriodBooking[], lump: number, today: string): GroupLedger => groupLedger(rooms, lump, today);
const sum = (p: ReceiptPlan) => p.lines.reduce((s, l) => s + l.amount, 0) + (p.lump?.amount ?? 0);

test("3박 × 3객실 = 690,000원 · 기존 기간 결제 계산과 똑같아요", () => {
  const rooms = g3();
  const l = ledgerOf(rooms, 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-28");
  assert.equal(p.total, 690_000);
  assert.equal(p.suggested, 690_000);
  assert.equal(p.start, "2026-10-28");
  assert.equal(p.end, "2026-10-30");
  assert.equal(receiptHeadline(p, { kind: "nights", nights: 3 }), "3박 × 3객실 = 690,000원");
  assert.equal(p.lump, null);
  // 예전 계산과 한 줄씩 같아야 해요
  const old = periodPayLines(planGroupPeriod(rooms.map(stayCoverage), 3, "2026-10-28"));
  assert.deepEqual(p.lines.map((x) => [x.bookingId, x.amount, x.nightDate, x.periodNights]), old.map((x) => [x.bookingId, x.amount, x.nightDate, x.periodNights]));
});

test("객실 추가(302호 90,000원): 다음 결제에 모든 객실이 채워지고 302호는 입실일부터만", () => {
  // 10/28~30 3박 결제 후, 302호가 10/31에 들어옴 (자기 요금 90,000 · 3박 이상 머묾)
  let rooms = g3();
  rooms = apply(rooms, receiptPlan({ ledger: ledgerOf(rooms, 0, "2026-10-28"), roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-28")).rooms;
  rooms = [...rooms, room("r302", 90_000, 20, "2026-10-31")];
  const l = ledgerOf(rooms, 0, "2026-10-31");
  assert.deepEqual(receiptDefaultRooms(l).sort(), ["r301", "r302", "r501", "r602"]);
  assert.equal(receiptDefaultStart(l, null, "2026-10-31"), "2026-10-31");
  assert.equal(receiptDefaultNights(l), 3); // 지난번 3박
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-31");
  assert.equal(p.rows.length, 4);
  assert.equal(p.rows.find((r) => r.bookingId === "r302")!.amount, 270_000);
  assert.equal(p.total, 690_000 + 270_000);
  assert.equal(receiptHeadline(p, { kind: "nights", nights: 3 }), "3박 × 4객실 = 960,000원");
  assert.equal(p.lines.length, 4);
  // 결제 등록 후: 오늘 밤까지 미수금 없음 · 결제 완료 ~11/02
  const after = apply(rooms, p);
  const l2 = ledgerOf(after.rooms, after.lump, "2026-10-31");
  assert.equal(l2.owed, 0);
  assert.equal(l2.paidThrough, "2026-11-02");
});

test("302호가 기간 중간(10/30)에 들어오면 다음 결제 시작이 302호 첫 밤으로 당겨지고, 그날부터 그 객실 요금만 더해져요", () => {
  let rooms = g3();
  rooms = apply(rooms, receiptPlan({ ledger: ledgerOf(rooms, 0, "2026-10-28"), roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-28")).rooms;
  rooms = [...rooms, room("r302", 90_000, 20, "2026-10-30")];
  const l = ledgerOf(rooms, 0, "2026-10-30");
  assert.equal(receiptDefaultStart(l, null, "2026-10-30"), "2026-10-30");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-30");
  // 10/30 ~ 11/01: 기존 객실은 10/31·11/01 두 밤만 남음 (10/30은 결제됨) + 302호 3박
  assert.equal(p.rows.find((r) => r.bookingId === "r302")!.amount, 270_000);
  assert.equal(p.rows.find((r) => r.bookingId === "r602")!.amount, 140_000);
  assert.equal(p.rows.find((r) => r.bookingId === "r602")!.nights, 2);
  assert.equal(receiptHeadline(p, { kind: "nights", nights: 3 }), "3박 · 4객실 = " + (270_000 + 140_000 + 160_000 + 160_000).toLocaleString("ko-KR") + "원");
});

test("일부 객실만 결제 (602 + 301) · 나머지 객실은 건드리지 않아요", () => {
  const l = ledgerOf(g3(), 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: ["r602", "r301"], period: { kind: "nights", nights: 2 } }, "2026-10-28");
  assert.equal(p.total, 2 * 70_000 + 2 * 80_000);
  assert.deepEqual(p.lines.map((x) => x.bookingId).sort(), ["r301", "r602"]);
});

test("금액을 직접 고치면 객실 몫 비율로 나눠 합계가 같아요 (일부 결제 · 안내만 하고 막지 않아요)", () => {
  const l = ledgerOf(g3(), 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 }, amount: 600_000 }, "2026-10-28");
  assert.equal(p.total, 600_000);
  assert.equal(sum(p), 600_000);
  assert.equal(p.diff, -90_000);
  assert.equal(p.lump, null);
  assert.ok(p.notes.some((x) => x.includes("일부 결제")));
  const after = apply(g3(), p);
  const l2 = ledgerOf(after.rooms, after.lump, "2026-10-30");
  assert.equal(l2.paid, 600_000);
  assert.equal(l2.owed, 3 * 230_000 - 600_000);
});

test("제안보다 많이 받으면 남는 돈은 선수금 (단체 몫) · 합계 보존 · 다음 박에 자동 반영", () => {
  const rooms = g3();
  const l = ledgerOf(rooms, 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 }, amount: 1_000_000 }, "2026-10-28");
  assert.equal(p.total, 1_000_000);
  assert.equal(p.lump!.amount, 310_000);
  assert.equal(p.carry, 310_000);
  assert.equal(sum(p), 1_000_000);
  const after = apply(rooms, p);
  const l2 = ledgerOf(after.rooms, after.lump, "2026-10-28");
  assert.equal(l2.paid, 1_000_000);
  // 3박(690,000) 다음 박 230,000 + 80,000 남은 돈 → 다음 박(10/31)이 채워지고 (230,000 ≤ 310,000) 그 다음 박은 일부
  assert.equal(l2.paidThrough, "2026-10-31");
  assert.equal(l2.prepaid, 1_000_000 - 230_000);
});

test("기간 없이 금액만: 선수금으로 등록되고 맨 앞 미결제 박부터 반영 (객실 순서대로)", () => {
  const rooms = g3();
  const l = ledgerOf(rooms, 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "none" }, amount: 500_000 }, "2026-10-28");
  assert.equal(p.total, 500_000);
  assert.equal(p.start, null);
  assert.equal(p.lines.every((x) => x.nightDate === null && x.periodNights === null), true);
  // 10/28 밤 230,000 → 10/29 밤 270,000분 (602 70,000 + 501 80,000 + 301 80,000 + ...)
  assert.equal(sum(p), 500_000);
  const after = apply(rooms, p);
  const l2 = ledgerOf(after.rooms, after.lump, "2026-10-28");
  assert.equal(l2.paid, 500_000);
  assert.equal(l2.paidThrough, "2026-10-29");
});

test("기간 없이 금액만 + 객실 합계를 넘기면 나머지는 단체 선수금", () => {
  const rooms = [room("a", 50_000, 1), room("b", 50_000, 1)];
  const l = ledgerOf(rooms, 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "none" }, amount: 150_000 }, "2026-10-28");
  assert.equal(p.lines.reduce((s, x) => s + x.amount, 0), 100_000);
  assert.equal(p.lump!.amount, 50_000);
  assert.equal(sum(p), 150_000);
});

test("~날짜까지: 박수가 날짜로 정해져요 · 366박까지도 잘리지 않아요", () => {
  const l = ledgerOf(g3(), 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "through", date: "2026-10-31" } }, "2026-10-28");
  assert.equal(p.nights, 4);
  assert.equal(p.total, 4 * 230_000);
  const big = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 500 }, amount: 8_000_000 }, "2026-10-28");
  assert.equal(big.nights, RECEIPT_NIGHTS_MAX);
  // 남은 박(30박)을 넘는 기간은 있는 박만 계산 · 나머지는 선수금
  assert.equal(big.suggested, 30 * 230_000);
  assert.equal(big.lump!.amount, 8_000_000 - 30 * 230_000);
});

test("이미 결제된 기간에 돈을 받으면 전부 선수금 · 금액 0이면 안내", () => {
  let rooms = g3();
  rooms = apply(rooms, receiptPlan({ ledger: ledgerOf(rooms, 0, "2026-10-28"), roomIds: null, period: { kind: "nights", nights: 3 } }, "2026-10-28")).rooms;
  const l = ledgerOf(rooms, 0, "2026-10-28");
  const p = receiptPlan({ ledger: l, roomIds: null, period: { kind: "nights", nights: 3 }, start: "2026-10-28", amount: 100_000 }, "2026-10-28");
  assert.equal(p.lines.length, 0);
  assert.equal(p.lump!.amount, 100_000);
  assert.equal(p.ok, true);
  const zero = receiptPlan({ ledger: l, roomIds: null, period: { kind: "none" }, amount: 0 }, "2026-10-28");
  assert.equal(zero.ok, false);
  assert.ok(zero.error);
});

test("합계 보존: 어떤 입력이든 저장 합 = 입력 금액", () => {
  const l = ledgerOf([...g3(), room("r302", 90_000, 10, "2026-10-30")], 0, "2026-10-30");
  for (const amount of [1, 7, 333_333, 960_000, 2_000_001]) {
    for (const period of [{ kind: "none" }, { kind: "nights", nights: 3 }, { kind: "through", date: "2026-11-05" }] as const) {
      for (const roomIds of [null, ["r302"], ["r602", "r301"]]) {
        const p = receiptPlan({ ledger: l, roomIds, period, amount }, "2026-10-30");
        assert.equal(sum(p), amount, JSON.stringify({ amount, period, roomIds }));
        assert.equal(p.total, amount);
      }
    }
  }
});

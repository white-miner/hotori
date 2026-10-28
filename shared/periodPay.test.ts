// 박별 금액 · 박별 결제 채움(참고) · 환불/조기 퇴실/박 초과
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import type { Payment } from "./payment";
import {
    coverageRuns,
  coverageSummary,
    stayCoverage,
  stayNightAmounts,
  type PeriodBooking,
} from "./periodPay";

let n = 0;
const rates = (checkIn: string, per: number, count: number) => ({
  flat: per,
  nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [new Date(Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8) + i)).toISOString().slice(0, 10), per])),
});
const pay = (bookingId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `p${++n}`, bookingId, kind: "balance", method: "card", amount, bizDate: "2026-10-27", createdAt: `2026-10-27T00:00:${String(n).padStart(2, "0")}Z`, ...extra,
});
/** per원 × count박 (박별 요금 행렬 있음) */
const stay = (id: string, per: number, count: number, p: Partial<PeriodBooking> = {}): PeriodBooking => ({
  id, status: "active", kind: "stay", checkIn: "2026-10-27", nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
  nightRates: rates("2026-10-27", per, count), payments: [], checkedOutAt: null, stayMode: null, ...p,
} as PeriodBooking);
const book = (b: PeriodBooking) => b as unknown as Booking;

test("stayNightAmounts: 박별 요금 그대로 · 추가금은 마지막 박 · 합 = revenueOf", () => {
  const b = stay("a", 70_000, 4, { price: 290_000 }); // 추가금 10,000
  const a = stayNightAmounts(b);
  assert.equal(a.length, 4);
  assert.deepEqual(a.map((x) => x.amount), [70_000, 70_000, 70_000, 80_000]);
  assert.equal(a[0]!.date, "2026-10-27");
});

test("stayNightAmounts: 행렬 없으면 판매가 균등 · 나머지는 마지막 박", () => {
  const b = stay("a", 0, 3, { price: 100_000, nightRates: null });
  assert.deepEqual(stayNightAmounts(b).map((x) => x.amount), [33_333, 33_333, 33_334]);
});

test("stayNightAmounts: 조기 퇴실 = 묵은 박까지만 · 환불 반영해 합 = 판매가 − 환불", () => {
  const b = stay("a", 80_000, 5, { earlyOut: "2026-10-29", refund: 240_000 });
  const a = stayNightAmounts(b);
  assert.equal(a.length, 2);
  assert.equal(a.reduce((s, x) => s + x.amount, 0), 160_000);
  // 환불을 더 크게 입력하면 마지막 박부터 줄어요 (0 밑으로 안 내려감)
  const c = stay("a", 80_000, 5, { earlyOut: "2026-10-29", refund: 300_000 });
  assert.deepEqual(stayNightAmounts(c).map((x) => x.amount), [80_000, 20_000]);
  const d = stay("a", 80_000, 5, { earlyOut: "2026-10-29", refund: 380_000 });
  assert.deepEqual(stayNightAmounts(d).map((x) => x.amount), [20_000, 0]);
  assert.equal(stayNightAmounts(c).reduce((s, x) => s + x.amount, 0), 100_000);
});

test("stayNightAmounts: 취소 · 대실 · 장기는 박 없음", () => {
  assert.deepEqual(stayNightAmounts(stay("a", 1000, 2, { status: "cancelled" })), []);
  assert.deepEqual(stayNightAmounts(stay("a", 1000, 2, { kind: "dayuse" })), []);
  assert.deepEqual(stayNightAmounts(stay("a", 1000, 2, { stayMode: "long_stay" })), []);
});

test("stayCoverage: 결제 내역 없음 = 전부 미결제", () => {
  const c = stayCoverage(stay("a", 70_000, 30));
  assert.equal(c.due, 2_100_000);
  assert.equal(c.left, 2_100_000);
  assert.equal(c.firstUnpaid, "2026-10-27");
  assert.equal(coverageSummary(c), "미결제");
});

test("stayCoverage: 기간 결제 3박 → '3박 결제 완료 · 이후 미결제'", () => {
  const b = stay("a", 70_000, 30, { payments: [pay("a", 210_000, { nightDate: "2026-10-27", periodNights: 3 })] });
  const c = stayCoverage(b);
  assert.equal(c.paid, 210_000);
  assert.equal(c.left, 2_100_000 - 210_000);
  assert.equal(c.firstUnpaid, "2026-10-30");
  assert.equal(coverageSummary(c), "3박 결제 완료(~10/29) · 이후 미결제");
  assert.deepEqual(coverageRuns(c).map((r) => [r.state, r.nights]), [["paid", 3], ["unpaid", 27]]);
});

test("stayCoverage: 기간 표시 없는 결제는 맨 앞 미결제 박부터 채움 (예전 결제 호환)", () => {
  const b = stay("a", 80_000, 5, { payments: [pay("a", 200_000)] });
  const c = stayCoverage(b);
  assert.deepEqual(c.nights.map((x) => x.covered), [80_000, 80_000, 40_000, 0, 0]);
  assert.equal(coverageSummary(c), "2박 결제 완료(~10/28) · 이후 미결제");
  assert.equal(c.firstUnpaid, "2026-10-29");
});

test("stayCoverage: 완납 · 초과 수납", () => {
  const b = stay("a", 80_000, 2, { payments: [pay("a", 100_000), pay("a", 100_000)] });
  const c = stayCoverage(b);
  assert.equal(c.left, 0);
  assert.equal(c.over, 40_000);
  assert.equal(c.firstUnpaid, null);
  assert.equal(coverageSummary(c), "전체 2박 결제 완료");
});

test("stayCoverage: 기간 결제가 그 기간보다 많으면 초과 수납액은 다음 미결제 박으로", () => {
  const b = stay("a", 50_000, 6, { payments: [pay("a", 175_000, { nightDate: "2026-10-27", periodNights: 3 })] });
  const c = stayCoverage(b);
  assert.deepEqual(c.nights.map((x) => x.covered), [50_000, 50_000, 50_000, 25_000, 0, 0]);
});

test("stayCoverage: 건너뛴 기간 결제 (오늘부터) → 앞쪽은 미결제로 남음", () => {
  const b = stay("a", 70_000, 6, { payments: [pay("a", 140_000, { nightDate: "2026-10-30", periodNights: 2 })] });
  const c = stayCoverage(b);
  assert.deepEqual(coverageRuns(c).map((r) => [r.state, r.nights]), [["unpaid", 3], ["paid", 2], ["unpaid", 1]]);
  assert.equal(coverageSummary(c), "10/27~10/29 미결제 · 10/30~10/31 결제 · 11/1 미결제");
  assert.equal(c.firstUnpaid, "2026-10-27");
});

test("stayCoverage: 조기 퇴실 뒤에는 청구액 줄고 낸 돈이 더 많으면 초과로", () => {
  const b = stay("a", 80_000, 5, { earlyOut: "2026-10-29", refund: 240_000, payments: [pay("a", 240_000, { nightDate: "2026-10-27", periodNights: 3 })] });
  const c = stayCoverage(b);
  assert.equal(c.due, 160_000);
  assert.equal(c.over, 80_000);
  assert.equal(c.left, 0);
});

// 사용자 사례: 602호 7만 · 501호 · 301호 8만 = 하루 23만 · 3박 = 690,000
const GROUP = () => [stay("602", 70_000, 30), stay("501", 80_000, 30), stay("301", 80_000, 30)];

// 단체 기간 결제: 박별 금액 · 박별 결제 채움 · 다음 N박 합계 · 총액 배분 · 환불/중도퇴실/박 초과
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import type { Payment } from "./payment";
import {
  allocateTotal,
  coverageRuns,
  coverageSummary,
  groupFirstUnpaid,
  periodHeadline,
  periodPayLines,
  planGroupPeriod,
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

test("stayNightAmounts: 중도퇴실 = 묵은 박까지만 · 환불 반영해 합 = 판매가 − 환불", () => {
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

test("stayCoverage: 중도퇴실 뒤에는 청구액 줄고 낸 돈이 더 많으면 초과로", () => {
  const b = stay("a", 80_000, 5, { earlyOut: "2026-10-29", refund: 240_000, payments: [pay("a", 240_000, { nightDate: "2026-10-27", periodNights: 3 })] });
  const c = stayCoverage(b);
  assert.equal(c.due, 160_000);
  assert.equal(c.over, 80_000);
  assert.equal(c.left, 0);
});

// 사용자 사례: 602호 7만 · 501호 · 301호 8만 = 하루 23만 · 3박 = 690,000
const GROUP = () => [stay("602", 70_000, 30), stay("501", 80_000, 30), stay("301", 80_000, 30)];

test("planGroupPeriod: (7+8+8만) × 3박 = 690,000 · 3객실", () => {
  const covs = GROUP().map(stayCoverage);
  const plan = planGroupPeriod(covs, 3);
  assert.equal(plan.total, 690_000);
  assert.equal(plan.rooms, 3);
  assert.equal(plan.nights, 3);
  assert.equal(plan.start, "2026-10-27");
  assert.equal(plan.end, "2026-10-29");
  assert.deepEqual(plan.rows.map((r) => r.amount), [210_000, 240_000, 240_000]);
  assert.equal(periodHeadline(plan), "3박 × 3객실 = 690,000원");
  const lines = periodPayLines(plan);
  assert.equal(lines.length, 3);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 690_000);
  assert.ok(lines.every((l) => l.nightDate === "2026-10-27" && l.periodNights === 3));
  assert.equal(lines[0]!.note, "기간결제 10/27~10/29 3박");
});

test("planGroupPeriod: 결제 뒤 다음 3박 · 이미 낸 박은 안 겹침", () => {
  let group = GROUP();
  const plan1 = planGroupPeriod(group.map(stayCoverage), 3);
  group = group.map((b) => ({ ...b, payments: periodPayLines(plan1).filter((l) => l.bookingId === b.id).map((l) => pay(b.id, l.amount, { nightDate: l.nightDate, periodNights: l.periodNights })) }));
  const covs = group.map(stayCoverage);
  assert.equal(groupFirstUnpaid(covs), "2026-10-30");
  const plan2 = planGroupPeriod(covs, 3);
  assert.equal(plan2.start, "2026-10-30");
  assert.equal(plan2.total, 690_000);
  // 같은 3박을 다시 골라도(시작일 지정) 이미 낸 박 몫은 0 → 앞으로 밀림
  const again = planGroupPeriod(covs, 3, "2026-10-27");
  assert.equal(again.start, "2026-10-30");
  assert.equal(again.total, 690_000);
});

test("planGroupPeriod: 남은 박보다 길게 고르면 남은 박까지만 · 퇴실 뒤 박은 방 몫 0", () => {
  const group = [stay("a", 70_000, 2), stay("b", 80_000, 5)];
  const plan = planGroupPeriod(group.map(stayCoverage), 7);
  assert.equal(plan.nights, 5);
  assert.equal(plan.maxNights, 5);
  assert.deepEqual(plan.rows.map((r) => [r.amount, r.nights]), [[140_000, 2], [400_000, 5]]);
  assert.equal(periodHeadline(plan), "5박 · 2객실 = 540,000원");
});

test("planGroupPeriod: 오늘부터(시작일 지정) · 시작일이 더 이르면 첫 미결제 박으로 보정", () => {
  const covs = GROUP().map(stayCoverage);
  assert.equal(planGroupPeriod(covs, 1, "2026-10-30").start, "2026-10-30");
  assert.equal(planGroupPeriod(covs, 1, "2026-10-01").start, "2026-10-27");
  assert.equal(planGroupPeriod(covs, 3, "2026-10-30").total, 690_000);
});

test("planGroupPeriod: 다 냈으면 빈 계획 · 라인 없음", () => {
  const b = stay("a", 70_000, 2, { payments: [pay("a", 140_000)] });
  const plan = planGroupPeriod([stayCoverage(b)], 3);
  assert.equal(plan.start, null);
  assert.equal(plan.total, 0);
  assert.deepEqual(periodPayLines(plan), []);
  assert.equal(periodHeadline(plan), "결제할 박이 없어요");
});

test("planGroupPeriod: 일부 낸 박은 남은 금액만", () => {
  const b = stay("a", 80_000, 3, { payments: [pay("a", 100_000)] });
  const plan = planGroupPeriod([stayCoverage(b)], 2);
  // 1박째 완납 · 2박째 20,000 낸 상태 → 이번 기간(10/28~10/29)은 60,000 + 80,000
  assert.equal(plan.start, "2026-10-28");
  assert.equal(plan.total, 140_000);
});

test("planGroupPeriod: 방마다 시작이 달라도 단체 첫 미결제 박부터", () => {
  const a = stay("a", 70_000, 4, { payments: [pay("a", 140_000, { nightDate: "2026-10-27", periodNights: 2 })] });
  const b = stay("b", 80_000, 4);
  const plan = planGroupPeriod([a, b].map(stayCoverage), 2);
  assert.equal(plan.start, "2026-10-27");
  assert.deepEqual(plan.rows.map((r) => r.amount), [0, 160_000]);
  assert.equal(plan.rooms, 1);
});

test("allocateTotal: 합 = 총액 · 비례 · 최대잔여법 · 0 몫은 0", () => {
  assert.deepEqual(allocateTotal(690_000, [210_000, 240_000, 240_000]), [210_000, 240_000, 240_000]);
  const a = allocateTotal(100_000, [1, 1, 1]);
  assert.equal(a.reduce((s, x) => s + x, 0), 100_000);
  assert.deepEqual(a, [33_334, 33_333, 33_333]);
  const b = allocateTotal(680_000, [210_000, 240_000, 240_000]);
  assert.equal(b.reduce((s, x) => s + x, 0), 680_000);
  assert.deepEqual(allocateTotal(10, [0, 5, 0]), [0, 10, 0]);
  assert.deepEqual(allocateTotal(0, [1, 2]), [0, 0]);
  assert.deepEqual(allocateTotal(5, []), []);
});

test("periodPayLines: 총액을 고치면 방별로 비례 배분 · 납부액 0인 방은 줄 없음", () => {
  const plan = planGroupPeriod(GROUP().map(stayCoverage), 3);
  const lines = periodPayLines(plan, 680_000);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 680_000);
  assert.equal(lines.length, 3);
  const one = planGroupPeriod([stay("a", 70_000, 4, { payments: [pay("a", 140_000, { nightDate: "2026-10-27", periodNights: 2 })] }), stay("b", 80_000, 4)].map(stayCoverage), 2);
  assert.deepEqual(periodPayLines(one).map((l) => l.bookingId), ["b"]);
});

test("기간 결제 내역을 장부 결제와 합쳐도 방 수납 합계 = 줄 합계 (기존 payState 호환)", async () => {
  const { paidOf } = await import("./payment");
  const plan = planGroupPeriod(GROUP().map(stayCoverage), 3);
  const lines = periodPayLines(plan);
  const b = stay("602", 70_000, 30, { payments: lines.filter((l) => l.bookingId === "602").map((l) => pay("602", l.amount, { nightDate: l.nightDate, periodNights: l.periodNights })) });
  assert.equal(paidOf(book(b)), 210_000);
});

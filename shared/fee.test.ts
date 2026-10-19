// 수수료 · 입금 예정가 · 카드 수수료
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings } from "./ledger";
import { cardFeeOf, cleanCoupons, feeOf, payoutLine, payoutOf, payoutRevenue, payoutSummary } from "./fee";

const Y = { feeRate: 10 }; // 야놀자 10% · 판매가 기준
const bk = (p: Partial<Booking>): Booking => ({
  id: "b", kind: "stay", status: "active", platformId: "y", price: 70000, guestName: "손님", typeId: "t", roomId: "r1", checkIn: "2026-10-19", nights: 1,
  startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null, createdAt: "", updatedAt: "", ...p,
});

test("70,000 · 쿠폰 5,000+1,000 플랫폼 부담 → 63,000", () => {
  const x = payoutOf(bk({ coupons: [{ amount: 5000, hotel: false }, { amount: 1000, hotel: false }] }), Y);
  assert.equal(x.fee, 7000);
  assert.equal(x.expected, 63000);
  assert.equal(payoutLine(x), "70,000 − 수수료 10% 7,000 = 63,000 (쿠폰 6,000 플랫폼 부담)");
});
test("240,000 · 쿠폰 3,000 → 216,000", () => {
  assert.equal(payoutOf(bk({ price: 240000, coupons: [{ amount: 3000, hotel: false }] }), Y).expected, 216000);
});
test("쿠폰 뺀 금액 기준: 수수료는 (판매가 − 쿠폰 전부) × 율", () => {
  const x = payoutOf(bk({ coupons: [{ amount: 5000, hotel: false }, { amount: 1000, hotel: false }] }), { feeRate: 10, feeBasis: "net" });
  assert.equal(x.base, 64000);
  assert.equal(x.fee, 6400);
  assert.equal(x.expected, 63600);
  assert.match(payoutLine(x)!, /수수료 10%\(쿠폰 뺀 64,000 기준\) 6,400 = 63,600/);
});
test("숙소 부담 쿠폰은 입금에서 빠져요 (판매가 기준이면 수수료는 그대로)", () => {
  const x = payoutOf(bk({ price: 120000, coupons: [{ amount: 10000, hotel: true }, { amount: 2000, hotel: false }] }), Y);
  assert.equal(x.fee, 12000);
  assert.equal(x.hotelCoupons, 10000);
  assert.equal(x.expected, 98000);
  assert.equal(payoutLine(x), "120,000 − 수수료 10% 12,000 − 쿠폰 숙소 부담 10,000 = 98,000 (쿠폰 2,000 플랫폼 부담)");
  // 쿠폰 뺀 금액 기준 + 숙소 부담
  assert.equal(payoutOf(bk({ price: 120000, coupons: [{ amount: 10000, hotel: true }] }), { feeRate: 10, feeBasis: "net" }).expected, 120000 - 11000 - 10000);
});
test("수수료율이 없고 숙소 부담 쿠폰도 없으면 판매가만 (줄 없음)", () => {
  const x = payoutOf(bk({ coupons: [{ amount: 3000, hotel: false }] }), {});
  assert.equal(x.shown, false);
  assert.equal(payoutLine(x), null);
  assert.equal(x.expected, 70000);
  assert.equal(x.tracked, false);
  // 수수료율 없음 + 숙소 부담 쿠폰 → 줄이 생겨요
  const y = payoutOf(bk({ coupons: [{ amount: 3000, hotel: true }] }), null);
  assert.equal(payoutLine(y), "70,000 − 쿠폰 숙소 부담 3,000 = 67,000");
});
test("원 단위 반올림 · 소수 수수료율", () => {
  assert.equal(feeOf(33333, 10), 3333);
  assert.equal(feeOf(33335, 10), 3334);
  assert.equal(feeOf(70000, 9.9), 6930);
  assert.equal(feeOf(12345, 2.75), 339);
  assert.equal(feeOf(100000, null), 0);
});
test("추가 인원 · 빠른/늦은 · 주차는 판매가에 들어 있어서 수수료도 같이", () => {
  const x = payoutOf(bk({ price: 152000, extraFee: 10000, timeFee: 20000, carFee: 10000 }), Y);
  assert.equal(x.fee, 15200);
  assert.equal(x.expected, 136800);
});
test("중도 퇴실 환불은 입금에서 빠지고 · 노쇼는 수수료 그대로 · 취소는 0", () => {
  const eo = payoutOf(bk({ price: 200000, nights: 2, earlyOut: "2026-10-20", refund: 90000 }), Y);
  assert.equal(eo.expected, 200000 - 20000 - 90000);
  assert.match(payoutLine(eo)!, /− 환불 90,000 = 90,000/);
  const ns = payoutOf(bk({ status: "noshow" }), Y);
  assert.equal(ns.fee, 7000);
  assert.equal(ns.expected, 63000);
  const cx = payoutOf(bk({ status: "cancelled", coupons: [{ amount: 1000, hotel: true }] }), Y);
  assert.deepEqual([cx.sale, cx.fee, cx.hotelCoupons, cx.expected, cx.tracked, cx.shown], [0, 0, 0, 0, false, false]);
});
test("입금 예정일 = 퇴실일 + N일 (중도 퇴실이면 떠난 날 · 대실은 그날)", () => {
  assert.equal(payoutOf(bk({ nights: 3 }), { feeRate: 10, payoutDays: 3 }).dueOn, "2026-10-25");
  assert.equal(payoutOf(bk({ nights: 3, earlyOut: "2026-10-20" }), { feeRate: 10, payoutDays: 3 }).dueOn, "2026-10-23");
  assert.equal(payoutOf(bk({ kind: "dayuse", nights: null }), { payoutDays: 0 }).dueOn, "2026-10-19");
  assert.equal(payoutOf(bk({}), Y).dueOn, null);
});
test("입금 확인: 실제 입금액 (안 적으면 예정가) · 차이", () => {
  const a = payoutOf(bk({ payoutOk: true }), Y);
  assert.deepEqual([a.ok, a.received, a.diff], [true, 63000, 0]);
  const b = payoutOf(bk({ payoutOk: true, payoutAmount: 62500 }), Y);
  assert.deepEqual([b.received, b.diff], [62500, -500]);
  assert.equal(payoutOf(bk({ payoutAmount: 1 }), Y).received, null);
});
test("장부 요약 · 입금 예정 기준 매출", () => {
  const list = [
    bk({ id: "1", coupons: [{ amount: 6000, hotel: false }] }),
    bk({ id: "2", price: 240000, payoutOk: true, payoutAmount: 215000 }),
    bk({ id: "3", platformId: "w", price: 50000 }),
    bk({ id: "4", status: "cancelled" }),
  ];
  const plat = (b: Pick<Booking, "platformId">) => (b.platformId === "y" ? Y : null);
  const s = payoutSummary(list, plat as never);
  assert.deepEqual(s, { count: 2, sale: 310000, fee: 31000, hotelCoupons: 0, refund: 0, expected: 279000, okCount: 1, okAmount: 215000, waitCount: 1, waitAmount: 63000 });
  const r = payoutRevenue(list, plat as never, "2026-10-01", "2026-10-31");
  assert.equal(r.amount, 63000 + 215000 + 50000);
  assert.equal(r.diff, -1000);
});
test("카드 수수료: 설정 · 반올림 · 없으면 0", () => {
  assert.equal(normalizeSettings({}).cardFeeRate, null);
  const s = normalizeSettings({ cardFeeRate: 2 } as never);
  assert.equal(cardFeeOf(s, 152000), 3040);
  assert.equal(cardFeeOf(normalizeSettings({ cardFeeRate: "" } as never), 152000), 0);
});
test("설정: 플랫폼 수수료 칸 정리 · 다른 칸은 그대로", () => {
  const s = normalizeSettings({ platforms: [{ id: "y", name: "야놀자", abbr: "야", feeRate: "10", feeBasis: "x", couponHotel: "yes", payoutDays: 3.4, extra: 1 }, { id: "n", name: "네이버", abbr: "네", feeRate: 0, feeBasis: "net", couponHotel: true }] } as never);
  assert.deepEqual(s.platforms[0], { id: "y", name: "야놀자", abbr: "야", feeRate: 10, payoutDays: 3, extra: 1 });
  assert.deepEqual(s.platforms[1], { id: "n", name: "네이버", abbr: "네", feeBasis: "net", couponHotel: true });
  assert.equal(normalizeSettings({ platforms: [{ id: "a", name: "a", abbr: "a", feeRate: 80 }] } as never).platforms[0].feeRate, 50);
});
test("쿠폰 줄 정리", () => {
  assert.deepEqual(cleanCoupons([{ amount: 5000 }, { amount: 0, hotel: true }, { amount: "1000", hotel: true }, null, { amount: -1 }]), [{ amount: 5000, hotel: false }, { amount: 1000, hotel: true }]);
  assert.equal(cleanCoupons(Array.from({ length: 20 }, () => ({ amount: 1 }))).length, 10);
});

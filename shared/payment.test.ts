// 선금 · 잔금: 현장 결제만 잔금을 따지고, 플랫폼 예약은 플랫폼이 받은 걸로 봐요
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings } from "./ledger";
import {
  type Payment,
  bookingCash,
  defaultBookingPlatformId,
  isOnsite,
  onsiteCreatePayTail,
  paidOf,
  payKindLabel,
  payLineMain,
  payState,
  planOnsiteCreatePay,
  isWalkInPlaceholderName,
  validateGuestPhone,
  validateOnsiteCreateDeposit,
  validatePayment,
  walkInDisplayName,
  WALKIN_IMMEDIATE_PREFIX,
} from "./payment";
import { moneySummary } from "./expense";

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 150000, guestName: `손님${n}`, typeId: "s", roomId: "r305",
  checkIn: "2026-10-19", nights: 2, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", segments: null, earlyOut: null, refund: null, ...p,
});
const pay = (kind: Payment["kind"], method: Payment["method"], amount: number, bizDate = "2026-10-19"): Payment => ({
  id: `p${++n}`, bookingId: "b", kind, method, amount, bizDate, createdAt: "2026-10-19T01:00:00Z",
});
const onsite = { name: "현장·전화" };
const ota = { name: "야놀자" };

test("현장 결제: 이름에 현장·전화가 있으면 켜지고, 설정에서 고른 값이 먼저예요", () => {
  assert.equal(isOnsite({ name: "현장" }), true);
  assert.equal(isOnsite({ name: "전화 예약" }), true);
  assert.equal(isOnsite({ name: "야놀자" }), false);
  assert.equal(isOnsite({ name: "현장", onsite: false }), false);
  assert.equal(isOnsite({ name: "에어비앤비", onsite: true }), true);
  assert.equal(isOnsite(null), false);
});

test("연락처: OTA는 빈 번호 OK · 현장·전화만 필수 · 바로 입실이면 현장도 선택", () => {
  assert.equal(validateGuestPhone(ota, ""), null);
  assert.equal(validateGuestPhone(ota, "   "), null);
  assert.equal(validateGuestPhone(ota, null), null);
  assert.match(validateGuestPhone(onsite, "")!, /연락처/);
  assert.match(validateGuestPhone(onsite, "  ")!, /연락처/);
  assert.equal(validateGuestPhone(onsite, "010-1111-2222"), null);
  assert.equal(validateGuestPhone(null, ""), null);
  assert.equal(validateGuestPhone(onsite, "", { walkInImmediate: true }), null);
  assert.equal(validateGuestPhone(onsite, "  ", { walkInImmediate: true }), null);
});

test("바로 입실 표시명: M/D · prefix 감지", () => {
  assert.equal(walkInDisplayName("2026-10-21"), `${WALKIN_IMMEDIATE_PREFIX} 10/21`);
  assert.equal(walkInDisplayName("bad"), WALKIN_IMMEDIATE_PREFIX);
  assert.equal(isWalkInPlaceholderName("바로입실"), true);
  assert.equal(isWalkInPlaceholderName("바로입실 10/21"), true);
  assert.equal(isWalkInPlaceholderName("김손님"), false);
});

test("간단 예약 기본 채널: 현장이 맨 위여도 첫 OTA를 고름", () => {
  const plats = [
    { id: "p-walk", name: "현장·전화" },
    { id: "p-ya", name: "야놀자" },
    { id: "p-ag", name: "아고다" },
  ];
  assert.equal(defaultBookingPlatformId(plats), "p-ya");
  assert.equal(defaultBookingPlatformId(plats, "p-ag"), "p-ag");
  assert.equal(defaultBookingPlatformId(plats, "missing"), "p-ya");
  assert.equal(defaultBookingPlatformId([{ id: "p-walk", name: "현장·전화" }]), "p-walk");
});

test("현장 예약: 선금 50,000 받으면 잔금 100,000, 잔금 받으면 완납", () => {
  const b = bk({ payments: [pay("deposit", "cash", 50000)] });
  assert.deepEqual(payState(b, onsite), { tracked: true, due: 150000, paid: 50000, left: 100000, full: false });
  const b2 = bk({ payments: [pay("deposit", "cash", 50000), pay("balance", "card", 100000)] });
  assert.equal(paidOf(b2), 150000);
  assert.equal(payState(b2, onsite).left, 0);
  assert.equal(payState(b2, onsite).full, true);
});

test("현장 예약은 받은 돈이 없으면 전액이 잔금", () => {
  assert.equal(payState(bk({}), onsite).left, 150000);
});

test("OTA 예약은 잔금이 없어요 (플랫폼·손님 선결제) · 결제 줄이 있어도 잔금·미수 톤 금지", () => {
  assert.deepEqual(payState(bk({}), ota), { tracked: false, due: 150000, paid: 0, left: 0, full: false });
  const b = bk({ payments: [pay("deposit", "card", 30000)] });
  assert.deepEqual(payState(b, ota), { tracked: false, due: 150000, paid: 30000, left: 0, full: false });
  assert.equal(isOnsite({ name: "야놀자", onsite: true }), true);
  assert.equal(payState(b, { name: "야놀자", onsite: true }).left, 120000);
});

test("취소 · 노쇼 예약은 잔금을 보여 주지 않아요", () => {
  assert.equal(payState(bk({ status: "cancelled" }), onsite).left, 0);
  assert.equal(payState(bk({ status: "noshow", payments: [pay("deposit", "cash", 10000)] }), onsite).left, 0);
});

test("중도 퇴실 환불을 빼고 잔금을 계산해요 · 더 받았으면 잔금 0", () => {
  const b = bk({ nights: 3, price: 300000, earlyOut: "2026-10-21", refund: 100000, payments: [pay("deposit", "cash", 150000)] });
  assert.equal(payState(b, onsite).due, 200000);
  assert.equal(payState(b, onsite).left, 50000);
  const over = bk({ payments: [pay("deposit", "cash", 200000)] });
  assert.equal(payState(over, onsite).left, 0);
  assert.equal(payState(over, onsite).full, true);
});

test("현금 시재: 기간 안에 현금으로 받은 선금·잔금만 더해요", () => {
  const list = [pay("deposit", "cash", 50000, "2026-10-18"), pay("balance", "cash", 100000, "2026-10-19"), pay("balance", "card", 70000, "2026-10-19"), pay("deposit", "cash", 9000, "2026-10-25")];
  assert.equal(bookingCash(list, "2026-10-18", "2026-10-19"), 150000);
  assert.equal(bookingCash(list, "2026-10-19", "2026-10-19"), 100000);
  const m = moneySummary(500000, 20000, 10000, { amount: 30000, cash: 25000 }, 150000);
  assert.equal(m.cashIn, 160000);
  assert.equal(m.cash, 135000);
  assert.equal(m.bookingCash, 150000);
  assert.equal(moneySummary(1, 0, 10000, { amount: 0, cash: 0 }).cash, 10000); // 예전처럼 매점 현금만
});

test("받은 돈 검사", () => {
  assert.equal(validatePayment(50000, "cash", "2026-10-19"), null);
  assert.match(validatePayment(0, "cash", "2026-10-19")!, /금액/);
  assert.match(validatePayment(1.5, "cash", "2026-10-19")!, /금액/);
  assert.match(validatePayment(200_000_000, "card", "2026-10-19")!, /1억/);
  assert.match(validatePayment(1000, "bank", "2026-10-19")!, /카드/);
  assert.match(validatePayment(1000, "card", "")!, /날짜/);
});

test("내역 카피: 방법+금액이 먼저 · kind는 장기/표준 라벨", () => {
  assert.equal(payLineMain("cash", 80000), "현금 80,000");
  assert.equal(payLineMain("card", 80000), "카드 80,000");
  assert.equal(payKindLabel("deposit"), "선금");
  assert.equal(payKindLabel("balance"), "잔금");
  assert.equal(payKindLabel("deposit", true), "선수");
  assert.equal(payKindLabel("balance", true), "수납");
});

test("설정: 플랫폼의 현장 결제 값이 저장·불러오기 뒤에도 남아요", () => {
  const S = normalizeSettings({ platforms: [{ id: "p1", name: "야놀자", abbr: "야", onsite: true } as never, { id: "p2", name: "현장", abbr: "현" }] });
  assert.equal(isOnsite(S.platforms[0]), true);
  assert.equal(isOnsite(S.platforms[1]), true);
});

test("생성 progressive: 선불=완납 balance · 후불=none · 선금=deposit", () => {
  assert.deepEqual(planOnsiteCreatePay("prepaid", { saleTotal: 80000, depAmt: "", depMethod: "card" }), {
    kind: "balance",
    amount: 80000,
    method: "card",
  });
  assert.deepEqual(planOnsiteCreatePay("postpaid", { saleTotal: 80000, depAmt: "30000", depMethod: "cash" }), {
    kind: "none",
  });
  assert.deepEqual(planOnsiteCreatePay("deposit", { saleTotal: 80000, depAmt: "30000", depMethod: "cash" }), {
    kind: "deposit",
    amount: 30000,
    method: "cash",
  });
  assert.deepEqual(planOnsiteCreatePay("prepaid", { priceUnset: true, saleTotal: 80000, depAmt: "", depMethod: "card" }), {
    kind: "none",
  });
  assert.equal(onsiteCreatePayTail({ kind: "balance", amount: 80000, method: "card" }), " · 선불(완납) 80,000원");
  assert.equal(onsiteCreatePayTail({ kind: "deposit", amount: 30000, method: "cash" }), " · 선금 30,000원(현금)");
  assert.equal(validateOnsiteCreateDeposit("postpaid", { saleTotal: 80000, depAmt: "", depMethod: "card", bizDate: "2026-10-22" }), null);
  assert.match(
    validateOnsiteCreateDeposit("deposit", { saleTotal: 80000, depAmt: "90000", depMethod: "card", bizDate: "2026-10-22" })!,
    /선금이 판매금/,
  );
  assert.equal(
    validateOnsiteCreateDeposit("deposit", { saleTotal: 80000, depAmt: "30000", depMethod: "card", bizDate: "2026-10-22" }),
    null,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Booking } from "./ledger";
import type { Payment } from "./payment";
import {
  STAY_CREDIT_COPY,
  STAY_CREDIT_PAY_METHOD,
  type StayCredit,
  applyCreditNotifyLine,
  defaultKeepAmount,
  earnedForEarlyOut,
  keepCreditNotifyLine,
  listOpenCredits,
  matchOpenCredits,
  planApplyStayCredit,
  planCreateStayCredit,
  planVoidStayCredit,
  validateEarlyOutKeep,
  validateKeepCreditAmount,
} from "./stayCredit";

const pay = (amount: number, method: Payment["method"] = "card"): Payment => ({
  id: `p${amount}`,
  bookingId: "b1",
  kind: "deposit",
  method,
  amount,
  bizDate: "2026-10-18",
  createdAt: "2026-10-18T00:00:00Z",
});

const bk = (p: Partial<Booking> = {}): Booking =>
  ({
    id: "b1",
    kind: "stay",
    status: "active",
    platformId: "onsite",
    price: 300_000,
    priceUnset: false,
    guestName: "김민수",
    guestPhone: "010-1234-5678",
    typeId: "t1",
    roomId: "r301",
    segments: null,
    checkIn: "2026-10-18",
    nights: 3,
    startTime: null,
    endTime: null,
    arrived: true,
    tentative: false,
    noClean: false,
    earlyOut: null,
    checkedOutAt: null,
    stayMode: "standard",
    longStayRate: null,
    settleCycle: null,
    charges: [],
    refund: null,
    memo: null,
    guests: null,
    extraFee: null,
    earlyIn: null,
    lateOut: null,
    timeFee: null,
    arrival: null,
    cars: null,
    plates: null,
    carFee: null,
    walkOff: null,
    coupons: null,
    payoutOk: false,
    payoutAmount: null,
    groupId: null,
    groupName: null,
    nightRates: null,
    payments: [pay(300_000)],
    cancelledAt: null,
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
    ...p,
  }) as Booking;

const credit = (p: Partial<StayCredit> = {}): StayCredit => ({
  id: "c1",
  hotelId: "h1",
  guestName: "김민수",
  guestPhone: "01012345678",
  amountOriginal: 200_000,
  amountRemaining: 200_000,
  preferredRecheckinDate: "2026-11-01",
  sourceBookingId: "b0",
  status: "open",
  expiresOn: null,
  note: null,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
  ...p,
});

test("defaultKeepAmount: 완납 3박 중 1박 이용 → 미사용 2박분", () => {
  // price 300k / 3 = 100k · earlyOut 10/19 = 1박 이용 · unused 2×100k = 200k
  const b = bk();
  assert.equal(earnedForEarlyOut(b, "2026-10-19"), 100_000);
  assert.equal(defaultKeepAmount(b, "2026-10-19"), 200_000);
});

test("defaultKeepAmount: 선금만 받았으면 paid−earned (음수 클램프)", () => {
  const b = bk({ payments: [pay(80_000)] });
  // earned 100k · paid 80k → keep 0
  assert.equal(defaultKeepAmount(b, "2026-10-19"), 0);
  const b2 = bk({ payments: [pay(250_000)] });
  assert.equal(defaultKeepAmount(b2, "2026-10-19"), 150_000);
});

test("validateKeepCreditAmount: paid 초과·0원 거절", () => {
  assert.match(validateKeepCreditAmount(0, 100_000)!, /보관 금액/);
  assert.match(validateKeepCreditAmount(120_000, 100_000)!, /수납액/);
  assert.equal(validateKeepCreditAmount(50_000, 100_000), null);
});

test("planApplyStayCredit: 부분 사용 → remaining · depleted", () => {
  const c = credit();
  const partial = planApplyStayCredit({ credit: c, bookingId: "b2", amount: 80_000, bizDate: "2026-10-23" });
  assert.ok(!("err" in partial));
  if ("err" in partial) return;
  assert.equal(partial.amount, 80_000);
  assert.equal(partial.remainingAfter, 120_000);
  assert.equal(partial.statusAfter, "open");
  assert.equal(partial.kind, "balance");
  assert.match(partial.paymentNote, /잔액 사용/);

  const full = planApplyStayCredit({ credit: c, bookingId: "b2", amount: 200_000, bizDate: "2026-10-23" });
  assert.ok(!("err" in full));
  if ("err" in full) return;
  assert.equal(full.remainingAfter, 0);
  assert.equal(full.statusAfter, "depleted");

  const over = planApplyStayCredit({ credit: c, bookingId: "b2", amount: 200_001, bizDate: "2026-10-23" });
  assert.ok("err" in over);
});

test("planVoidStayCredit: open만 · depleted/void 거절", () => {
  assert.deepEqual(planVoidStayCredit(credit()), { creditId: "c1" });
  assert.ok("err" in planVoidStayCredit(credit({ status: "depleted", amountRemaining: 0 })));
  assert.ok("err" in planVoidStayCredit(credit({ status: "void" })));
});

test("matchOpenCredits: 전화 우선 · 이름 부분", () => {
  const list: StayCredit[] = [
    credit({ id: "a", guestName: "김민수", guestPhone: "01099998888", amountRemaining: 10_000 }),
    credit({ id: "b", guestName: "김민수", guestPhone: "01012345678", amountRemaining: 50_000 }),
    credit({
      id: "c",
      guestName: "이영희",
      guestPhone: "01077776666",
      status: "depleted",
      amountRemaining: 0,
    }),
  ];
  const hit = matchOpenCredits(list, "김민수", "010-1234-5678");
  assert.equal(hit.length, 1);
  assert.equal(hit[0]!.id, "b");
  const byName = matchOpenCredits(
    [credit({ id: "n", guestName: "박서준", guestPhone: null })],
    "박서",
    null,
  );
  assert.equal(byName[0]?.id, "n");
  assert.equal(listOpenCredits(list).length, 2);
});

test("planCreateStayCredit: OTA 차단 · onsite OK", () => {
  const ota = planCreateStayCredit({
    guestName: "김민수",
    amount: 100_000,
    sourceBookingId: "b1",
    today: "2026-10-23",
    onsite: false,
  });
  assert.ok("err" in ota);
  const ok = planCreateStayCredit({
    guestName: "김민수",
    guestPhone: "01012345678",
    amount: 100_000,
    preferredRecheckinDate: "2026-11-05",
    sourceBookingId: "b1",
    today: "2026-10-23",
    onsite: true,
  });
  assert.ok(!("err" in ok));
});

test("validateEarlyOutKeep: refund_amount와 분리 · 보관만 검사", () => {
  const b = bk();
  assert.equal(validateEarlyOutKeep(b, "2026-10-19", 200_000, "2026-11-01", "2026-10-19", true), null);
  assert.match(validateEarlyOutKeep(b, "2026-10-19", 200_000, null, "2026-10-19", false)!, /현장·전화/);
  assert.match(validateEarlyOutKeep(b, "2026-10-19", 400_000, null, "2026-10-19", true)!, /수납액/);
});

test("labels KR · method credit", () => {
  assert.equal(STAY_CREDIT_COPY.keep, "잔액 보관");
  assert.equal(STAY_CREDIT_COPY.use, "잔액 사용");
  assert.equal(STAY_CREDIT_COPY.preferredDate, "희망 재입실일");
  assert.equal(STAY_CREDIT_PAY_METHOD, "credit");
  assert.match(keepCreditNotifyLine("김민수", 100_000, "2026-11-01"), /잔액 보관/);
  assert.match(applyCreditNotifyLine("김민수", 50_000, 50_000), /잔액 사용/);
});

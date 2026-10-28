// 결제 등록(단체): 결제일 · 수단 · 금액 · 메모 — 한 줄. 금액은 미수금으로 채워지고 고칠 수 있어요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLedger } from "./groupLedger";
import { RECEIPT_AMOUNT_MAX, receiptAfterLabel, receiptButtonLabel, receiptMemoHint, receiptNextAction, receiptPlan, receiptSuggest } from "./receipt";
import { addDays } from "./ledger";
import type { PeriodBooking } from "./periodPay";

const room = (id: string, per: number, count: number, checkIn = "2026-10-25"): PeriodBooking =>
  ({
    id, status: "active", kind: "stay", checkIn, nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
    nightRates: { flat: per, nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [addDays(checkIn, i), per])) },
    payments: [], checkedOutAt: null, stayMode: null,
  }) as unknown as PeriodBooking;

const rooms = () => [room("r602", 70_000, 3), room("r501", 80_000, 3), room("r301", 80_000, 3)];
const T = "2026-10-25";

test("열면 금액은 미수금 · 큰 버튼은 「결제 등록 · 690,000원」", () => {
  const led = groupLedger(rooms(), 0, T);
  assert.equal(receiptSuggest(led), 690_000);
  assert.equal(receiptNextAction(led).label, "결제 등록 · 690,000원");
  assert.equal(receiptButtonLabel(0), "결제 등록");
});

test("한 줄만 저장: 날짜·수단·금액·메모, 객실·박에 나누지 않아요", () => {
  const led = groupLedger(rooms(), 0, T);
  const p = receiptPlan(led, { amount: 690_000, method: "card", bizDate: T, memo: " 10/25~10/27 3박 " });
  assert.equal(p.ok, true);
  assert.deepEqual(p.line, { amount: 690_000, method: "card", bizDate: T, note: "10/25~10/27 3박" });
  assert.equal(p.after, 0);
  assert.equal(receiptAfterLabel(p.after), "등록하면 정산 완료예요");
});

test("일부만 받아도 되고, 더 받아도 막지 않고 안내만", () => {
  const led = groupLedger(rooms(), 0, T);
  assert.equal(receiptPlan(led, { amount: 300_000, method: "cash", bizDate: T }).after, 390_000);
  const over = receiptPlan(led, { amount: 700_000, method: "transfer", bizDate: T });
  assert.equal(over.ok, true);
  assert.equal(receiptAfterLabel(over.after), "등록하면 초과 수납 10,000원이에요");
});

test("금액·날짜 점검: 0 · 1억 초과 · 날짜 없음은 막아요", () => {
  const led = groupLedger(rooms(), 0, T);
  assert.equal(receiptPlan(led, { amount: 0, method: "card", bizDate: T }).ok, false);
  assert.equal(receiptPlan(led, { amount: RECEIPT_AMOUNT_MAX + 1, method: "card", bizDate: T }).ok, false);
  assert.equal(receiptPlan(led, { amount: 1000, method: "card", bizDate: "" }).ok, false);
});

test("이미 정산 완료면 제안 금액 0 · 메모 힌트는 기간+박수", () => {
  const led = groupLedger(rooms(), 690_000, T);
  assert.equal(receiptSuggest(led), 0);
  assert.equal(receiptNextAction(led).label, "결제 등록");
  assert.equal(receiptMemoHint(groupLedger(rooms(), 0, T)), "10/25~10/27 3박");
});

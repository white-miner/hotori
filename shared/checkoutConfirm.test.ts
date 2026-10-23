import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutNeedsBalanceUi,
  planCheckoutBalancePay,
  checkoutPayNotifyLine,
  checkoutLeaveBalanceNotifyLine,
} from "./checkoutConfirm";
import type { PaymentDeskGlance } from "./paymentDesk";

const glance = (p: Partial<PaymentDeskGlance>): PaymentDeskGlance => ({
  tracked: true,
  due: 100000,
  paid: 0,
  left: 100000,
  full: false,
  group: false,
  memberCount: 1,
  priceUnset: false,
  ...p,
});

test("checkoutNeedsBalanceUi: left>0 tracked만", () => {
  assert.equal(checkoutNeedsBalanceUi(glance({})), true);
  assert.equal(checkoutNeedsBalanceUi(glance({ left: 0 })), false);
  assert.equal(checkoutNeedsBalanceUi(glance({ tracked: false, left: 50000 })), false);
  assert.equal(checkoutNeedsBalanceUi(glance({ priceUnset: true })), false);
});

test("planCheckoutBalancePay: 카드 잔금", () => {
  const ok = planCheckoutBalancePay(glance({ left: 80000 }), {
    amount: 80000,
    method: "card",
    bizDate: "2026-10-23",
  });
  assert.ok(!("err" in ok));
  if (!("err" in ok)) {
    assert.equal(ok.amount, 80000);
    assert.equal(ok.method, "card");
    assert.equal(ok.kind, "balance");
  }
  const bad = planCheckoutBalancePay(glance({}), { amount: 0, method: "cash", bizDate: "2026-10-23" });
  assert.ok("err" in bad);
});

test("checkout notify lines", () => {
  assert.match(checkoutPayNotifyLine("김", 10000, "transfer"), /이체/);
  assert.match(checkoutLeaveBalanceNotifyLine("김", 5000), /잔금/);
});

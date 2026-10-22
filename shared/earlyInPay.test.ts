import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_IN_PAY_NOTE,
  effectiveEarlyInAmount,
  earlyInPayNotifyLine,
  planEarlyInPay,
  validateEarlyInPay,
} from "./earlyInPay";

test("팝업 게이트: 금액·방법 검증 · 서비스는 0원", () => {
  assert.equal(validateEarlyInPay({ amount: 0, method: "card", bizDate: "2026-10-22" }), null);
  assert.equal(validateEarlyInPay({ amount: 10000, method: "cash", bizDate: "2026-10-22" }), null);
  assert.equal(validateEarlyInPay({ amount: 50000, method: "service", bizDate: "2026-10-22" }), null);
  assert.match(validateEarlyInPay({ amount: -1, method: "card", bizDate: "2026-10-22" })!, /금액/);
  assert.match(validateEarlyInPay({ amount: 10000, method: "card", bizDate: "bad" })!, /날짜/);
});

test("서비스=0: effective · plan은 결제/가격 델타 없음", () => {
  assert.equal(effectiveEarlyInAmount(30000, "service"), 0);
  assert.equal(effectiveEarlyInAmount(0, "card"), 0);
  assert.equal(effectiveEarlyInAmount(12000.4, "cash"), 12000);

  const svc = planEarlyInPay({ amount: 99999, method: "service", bizDate: "2026-10-22" });
  assert.ok(!("err" in svc));
  assert.deepEqual(svc, { priceDelta: 0, collectAmount: 0, method: null, payNote: null, hours: 0 });

  const zero = planEarlyInPay({ amount: 0, method: "transfer", bizDate: "2026-10-22" });
  assert.ok(!("err" in zero));
  assert.equal(zero.collectAmount, 0);
  assert.equal(zero.method, null);
});

test("금액>0 · 카드/현금/이체 → 판매가 델타 + 수납 + 노트", () => {
  for (const method of ["card", "cash", "transfer"] as const) {
    const p = planEarlyInPay({ amount: 15000, method, bizDate: "2026-10-22", hours: 2 });
    assert.ok(!("err" in p));
    assert.deepEqual(p, {
      priceDelta: 15000,
      collectAmount: 15000,
      method,
      payNote: EARLY_IN_PAY_NOTE,
      hours: 2,
    });
  }
});

test("알림 카피: 서비스·0원·유료", () => {
  const empty = { priceDelta: 0, collectAmount: 0, method: null, payNote: null, hours: 0 };
  assert.match(earlyInPayNotifyLine("김손님", empty, "service"), /서비스\(0원\)/);
  assert.match(earlyInPayNotifyLine("김손님", empty, "card"), /빠른 입실했어요/);
  assert.equal(
    earlyInPayNotifyLine("김손님", { priceDelta: 10000, collectAmount: 10000, method: "cash", payNote: EARLY_IN_PAY_NOTE, hours: 0 }, "cash"),
    "김손님 님 빠른 입실 · 현금 10,000원",
  );
});

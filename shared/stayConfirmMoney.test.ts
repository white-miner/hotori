import assert from "node:assert/strict";
import { test } from "node:test";
import { stayConfirmMoney, stayConfirmMoneyLine } from "./stayConfirmMoney";
import type { Booking } from "./ledger";

const base = (over: Partial<Booking> = {}): Booking =>
  ({
    id: "b1",
    kind: "stay",
    status: "active",
    platformId: "p1",
    price: 100_000,
    guestName: "김",
    typeId: "t1",
    roomId: "r1",
    checkIn: "2026-10-20",
    nights: 2,
    startTime: null,
    endTime: null,
    arrived: true,
    memo: null,
    payments: [],
    ...over,
  }) as Booking;

test("stayConfirmMoney: OTA unpaid → 판매가만 (잔금 숨김)", () => {
  const m = stayConfirmMoney(base(), { name: "야놀자", onsite: false });
  assert.equal(m.sale, 100_000);
  assert.equal(m.showPaid, false);
  assert.equal(m.left, null);
});

test("stayConfirmMoney: 현장 일부 수납 → 받은·잔금", () => {
  const m = stayConfirmMoney(
    base({
      payments: [
        {
          id: "p",
          bookingId: "b1",
          kind: "deposit",
          method: "card",
          amount: 40_000,
          bizDate: "2026-10-20",
          createdAt: "2026-10-20T00:00:00Z",
        },
      ],
    }),
    { name: "현장", onsite: true },
  );
  assert.equal(m.sale, 100_000);
  assert.equal(m.paid, 40_000);
  assert.equal(m.showPaid, true);
  assert.equal(m.left, 60_000);
});

test("stayConfirmMoney: 금액미정", () => {
  const m = stayConfirmMoney(base({ priceUnset: true, price: 0 }), { name: "현장", onsite: true });
  assert.equal(m.unset, true);
  assert.equal(
    stayConfirmMoneyLine(m, (n) => String(n), {
      sale: "판매가",
      paid: "받은",
      balance: "잔금",
      amountUnset: "금액미정",
    }),
    "금액미정",
  );
});

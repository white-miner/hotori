// 단체 결제 표시: 한 번 받은 결제는 한 번만 — 객실마다 되풀이·합산하지 않음. 청구 합계 − 결제 합계 = 미수금/초과 수납
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, type Booking } from "./ledger";
import type { Payment } from "./payment";
import { balanceLabel, diffLine, groupLedger } from "./groupLedger";
import { deskPaymentLines } from "./paymentDesk";
import { nowAmountGlance, nowGroupLine, nowPayMethodPrefix } from "./nowboard";
import { emptyGroupInfo } from "./settle";

const TODAY = "2026-10-25";
const pay = (bookingId: string, amount: number, id = `p${amount}`): Payment => ({
  id, bookingId, kind: "balance", method: "cash", amount, bizDate: TODAY, createdAt: "2026-10-25T01:00:00Z",
});
const room = (id: string, roomId: string, per: number, payments: Payment[] = []): Booking =>
  ({
    id, kind: "stay", status: "active", platformId: "p", price: per * 3, guestName: "단체", typeId: "s", roomId,
    checkIn: TODAY, nights: 3, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
    createdAt: "", updatedAt: "", segments: null, earlyOut: null, refund: null, checkedOutAt: null, groupId: "g1",
    nightRates: { flat: per, nights: Object.fromEntries([0, 1, 2].map((i) => [addDays(TODAY, i), per])) },
    payments,
  }) as unknown as Booking;
const rooms = (p602: Payment[] = []) => [room("a", "602", 70_000, p602), room("b", "501", 80_000), room("c", "502", 80_000)];
const onsite = { name: "현장", onsite: true };

test("단체 3객실, 80,000 한 건(단체 결제) → 결제 합계 80,000 · 청구 불변 690,000 · 미수금 610,000", () => {
  const before = groupLedger(rooms(), 0, TODAY);
  const after = groupLedger(rooms(), 80_000, TODAY);
  assert.equal(after.due, before.due);
  assert.equal(after.due, 690_000);
  assert.deepEqual(after.rooms.map((r) => r.subtotal), [210_000, 240_000, 240_000]);
  assert.equal(after.paid, 80_000);
  assert.equal(after.owed, after.due - 80_000);
  assert.equal(diffLine(after), "청구 690,000원 − 결제 80,000원 = 미수금 610,000원");
});

test("80,000 한 건을 602호에 기록해도 결제 합계는 80,000 (다른 객실·청구 불변)", () => {
  const g = groupLedger(rooms([pay("a", 80_000)]), 0, TODAY);
  assert.equal(g.paid, 80_000);
  assert.equal(g.due, 690_000);
  assert.equal(g.owed, 610_000);
  assert.deepEqual(g.rooms.map((r) => r.subtotal), [210_000, 240_000, 240_000]);
});

test("결제 내역은 입력한 그대로 한 줄, 객실로 쪼개지 않음", () => {
  const info = { ...emptyGroupInfo("g1"), payments: [pay("", 80_000, "gp1")] };
  const lines = deskPaymentLines(rooms(), info);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.pay.amount, 80_000);
});

test("객실 칸 금액 = 그 객실 자기 요금 · 단체 결제 80,000을 객실마다 되풀이하지 않음", () => {
  const members = rooms();
  const info = { ...emptyGroupInfo("g1"), payments: [pay("", 80_000, "gp1")] };
  const ctx = { members, info };
  const cells = members.map((m) => nowAmountGlance(m, onsite, ctx));
  assert.deepEqual(cells, ["₩210,000", "₩240,000", "₩240,000"]);
  for (const c of cells) assert.ok(!c!.includes("80,000") && !c!.includes("잔금"));
  assert.equal(nowPayMethodPrefix(cells[0]!, null), null);
});

test("단체 한 줄은 단체 합계 하나 (미수금 610,000원) · 초과 수납 · 정산 완료", () => {
  assert.equal(nowGroupLine(groupLedger(rooms(), 80_000, TODAY)), "단체 미수금 610,000원");
  assert.equal(nowGroupLine(groupLedger(rooms(), 700_000, TODAY)), "단체 초과 수납 10,000원");
  assert.equal(balanceLabel(groupLedger(rooms(), 690_000, TODAY)), "정산 완료");
  assert.equal(nowGroupLine(groupLedger(rooms(), 690_000, TODAY)), "단체 정산 완료");
});

test("결제 여러 건: 합계는 입력 합 · 각 건 한 번씩만", () => {
  const info = { ...emptyGroupInfo("g1"), payments: [pay("", 80_000, "x1"), pay("", 50_000, "x2")] };
  assert.equal(deskPaymentLines(rooms(), info).length, 2);
  const g = groupLedger(rooms(), info.payments.reduce((n, p) => n + p.amount, 0), TODAY);
  assert.equal(g.paid, 130_000);
  assert.equal(g.owed, 560_000);
});

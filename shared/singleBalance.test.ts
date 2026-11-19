// 잔액 기준 하나 (전체 청구 − 결제) · 높음 항목 회귀 시험
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, type Booking } from "./ledger";
import type { Payment } from "./payment";
import { bookingCash, earlyOutRefundReturn, paidOf, paySplit, payState } from "./payment";
import { bookingBalance, bookingFolio, groupFolio, longStayFolio } from "./folio";
import { emptyGroupInfo, settle, type GroupInfo } from "./settle";
import { cardCharges } from "./cardCharges";
import { stayConfirmMoney } from "./stayConfirmMoney";
import { paymentDeskGlance, paymentEntryGroupId, planPaymentDeskPay } from "./paymentDesk";

const ONSITE = { name: "현장", onsite: true };
const OTA = { name: "야놀자", onsite: false };

function room(id: string, per: number, nights: number, checkIn: string, extra: Partial<Booking> = {}): Booking {
  const nightsMap = Object.fromEntries(Array.from({ length: nights }, (_, i) => [addDays(checkIn, i), per]));
  return {
    id, kind: "stay", status: "active", platformId: "walk", price: per * nights, guestName: "손님",
    typeId: "s", roomId: id, checkIn, nights, startTime: null, endTime: null, arrived: true, memo: null,
    cancelledAt: null, createdAt: "", updatedAt: "2026-11-19T00:00:00Z", groupId: null,
    nightRates: { flat: per, nights: nightsMap }, payments: [], ...extra,
  } as Booking;
}
const pay = (amount: number, method: Payment["method"] = "card", kind: Payment["kind"] = "balance", bizDate = "2026-11-19"): Payment =>
  ({ id: `p${amount}${method}${kind}`, bookingId: "", kind, method, amount, bizDate, createdAt: "" }) as Payment;
const info = (payments: Payment[], payMode: GroupInfo["payMode"], extras: GroupInfo["extras"] = []): GroupInfo => ({ ...emptyGroupInfo("g"), payMode, payments, extras });

test("1박·2박·10박: 예약 상세·카드·결제 등록·숙박확인서가 모두 같은 금액 (전체 청구 − 결제)", () => {
  for (const n of [1, 2, 10]) {
    const b = room("a", 70_000, n, "2026-11-17", { payments: [pay(50_000)] });
    const total = 70_000 * n;
    const expect = total - 50_000;
    // 어느 날 봐도 같아요 (입실 전 · 투숙 중 · 퇴실일)
    for (const today of ["2026-11-10", "2026-11-17", "2026-11-18", addDays("2026-11-17", n)]) {
      assert.equal(bookingFolio(b, true, today).owed, expect, `${n}박 ${today}`);
      assert.equal(payState(b, ONSITE, today).left, expect);
      assert.equal(cardCharges(b, null, ONSITE as never, today).due, expect);
    }
    assert.equal(bookingBalance(total, 50_000).owed, expect);
    assert.equal(stayConfirmMoney(b, ONSITE).left, expect);
    assert.equal(paymentDeskGlance([b], ONSITE).left, expect);
  }
});

test("초과 수납: 전체 청구보다 많이 받으면 초과 수납으로 보여요", () => {
  const b = room("a", 70_000, 2, "2026-11-17", { payments: [pay(150_000)] });
  const f = bookingFolio(b, true, "2026-11-17");
  assert.equal(f.owed, 0);
  assert.equal(f.over, 10_000);
  assert.equal(f.label, "초과 수납 10,000원");
  assert.equal(bookingBalance(140_000, 150_000).label, "초과 수납 10,000원");
});

test("단체 정산(장부)과 현황 머리글이 같은 미수금 · 객실마다 요금이 달라도 나누지 않음", () => {
  const a = room("a", 70_000, 3, "2026-11-17", { groupId: "g" });
  const b = room("b", 80_000, 3, "2026-11-17", { groupId: "g" });
  const g = info([pay(300_000, "card")], "postpaid");
  const head = groupFolio([a, b], 300_000, 0, { onsite: true, payMode: "postpaid" }, "2026-11-18");
  const st = settle([a, b], g, ONSITE, "2026-11-18");
  const stNoDay = settle([a, b], g, ONSITE);
  assert.equal(head.due, 450_000);
  assert.equal(head.owed, 150_000);
  assert.equal(st.left, head.owed);
  assert.equal(stNoDay.left, head.owed, "오늘을 넘기든 안 넘기든 같아요");
});

test("장기 숙박 상세와 결제 등록: 올라 있는 원장 전부 − 수납", () => {
  const charges = [
    { id: "c1", nightDate: "2026-11-17", amount: 50_000 },
    { id: "c2", nightDate: "2026-11-18", amount: 50_000 },
    { id: "c3", nightDate: "2026-11-25", amount: 50_000 },
  ];
  const f = longStayFolio({ charges, payments: [pay(60_000)], priceUnset: false } as never, true, "2026-11-18");
  assert.equal(f.due, 150_000);
  assert.equal(f.owed, 90_000);
});

test("OTA 선결제 단체: 숙박료는 채널이 받았고, 단체 추가 항목(식사)은 미수금으로 남아요", () => {
  const a = room("a", 70_000, 2, "2026-11-17", { groupId: "g", platformId: "ya" });
  const b = room("b", 80_000, 2, "2026-11-17", { groupId: "g", platformId: "ya" });
  const noExtra = groupFolio([a, b], 0, 0, { onsite: false, payMode: "prepaid" }, "2026-11-18");
  assert.equal(noExtra.owed, 0);
  assert.equal(noExtra.label, "OTA 선결제");
  assert.equal(noExtra.tracked, false);
  const meal = groupFolio([a, b], 0, 40_000, { onsite: false, payMode: "prepaid" }, "2026-11-18");
  assert.equal(meal.ota, true);
  assert.equal(meal.onsiteDue, 40_000);
  assert.equal(meal.owed, 40_000);
  assert.equal(meal.label, "미수금 40,000원");
  assert.equal(meal.tracked, true);
  const st = settle([a, b], info([], "prepaid", [{ name: "조식", amount: 40_000 }]), OTA);
  assert.equal(st.left, 40_000, "단체 정산에도 같은 금액");
  const paid = groupFolio([a, b], 40_000, 40_000, { onsite: false, payMode: "prepaid" }, "2026-11-18");
  assert.equal(paid.owed, 0);
  assert.equal(paid.label, "OTA 선결제");
});

test("숙박확인서: 단체 객실은 단체 결제까지 넣은 단체 잔액을 써요", () => {
  const a = room("a", 70_000, 2, "2026-11-17", { groupId: "g" });
  const b = room("b", 80_000, 2, "2026-11-17", { groupId: "g" });
  const g = info([pay(250_000, "card")], "postpaid");
  const m = stayConfirmMoney(a, ONSITE, { members: [a, b], info: g });
  assert.equal(m.group, true);
  assert.equal(m.sale, 140_000, "판매가는 이 객실");
  assert.equal(m.paid, 250_000);
  assert.equal(m.left, 50_000, "300,000 − 250,000");
  const room1 = stayConfirmMoney(a, ONSITE);
  assert.equal(room1.left, 140_000, "단체 정보를 안 넘기면 예전처럼 객실만");
});

test("결제 등록 입구 하나: 단체 숙박은 늘 단체 결제 등록, 활성 1실 단체도 단체 결제 한 줄", () => {
  const a = room("a", 70_000, 2, "2026-11-17", { groupId: "g" });
  assert.equal(paymentEntryGroupId(a), "g");
  assert.equal(paymentEntryGroupId({ ...a, groupId: null }), null);
  assert.equal(paymentEntryGroupId({ ...a, stayMode: "long_stay" }), null, "장기는 원장이라 객실 결제");
  const glance = paymentDeskGlance([a], ONSITE, info([], "postpaid"));
  assert.equal(glance.group, true);
  const plan = planPaymentDeskPay(glance, { amount: 10_000, method: "card", kind: "balance", bizDate: "2026-11-18" });
  assert.ok(!("err" in plan) && plan.asGroup, "단체 결제 한 줄로 저장");
});

test("조기 퇴실 현금 환불: 돌려준 돈을 '환불' 한 줄(음수)로 남기면 받은 돈·현금 시재·잔액이 맞아요", () => {
  // 3박 300,000 현금 완납 → 1박만 묵고 200,000 환불
  const b = room("a", 100_000, 3, "2026-11-17", { payments: [pay(300_000, "cash", "balance", "2026-11-17")] });
  const back = earlyOutRefundReturn(b, 200_000);
  assert.equal(back, 200_000);
  const after = { ...b, earlyOut: "2026-11-18", refund: 200_000, payments: [...b.payments!, pay(-back, "cash", "refund", "2026-11-18")] } as Booking;
  assert.equal(paidOf(after), 100_000);
  assert.equal(bookingCash(after.payments!, "2026-11-17", "2026-11-18"), 100_000, "현금 시재 = 받은 300,000 − 돌려준 200,000");
  assert.equal(paySplit(after.payments!).cash, 100_000);
  const ps = payState(after, ONSITE);
  assert.equal(ps.due, 100_000);
  assert.equal(ps.left, 0);
  assert.equal(bookingFolio(after, true).over, 0, "초과 수납으로 남지 않아요");
  // 선금만 받은 경우: 청구만 줄고 돌려줄 돈은 0
  const dep = room("d", 100_000, 3, "2026-11-17", { payments: [pay(100_000, "cash", "deposit")] });
  assert.equal(earlyOutRefundReturn(dep, 200_000), 0);
  // 일부만 돌려줌: 받은 250,000, 청구 300,000 − 환불 100,000 = 200,000 → 50,000 돌려줌
  const part = room("p", 100_000, 3, "2026-11-17", { payments: [pay(250_000, "cash")] });
  assert.equal(earlyOutRefundReturn(part, 100_000), 50_000);
});

test("대실도 같은 잔액: 후불 대실은 판매가가 미수금 · 받으면 정산 완료", async () => {
  const { payState } = await import("./payment");
  const { bookingFolio } = await import("./folio");
  const { dayuseSaleNotifyLine } = await import("./dayuseSale");
  const du = { id: "d1", kind: "dayuse", status: "active", checkIn: "2026-11-20", nights: 0, price: 30_000, payments: [], platformId: "p" } as never;
  const onsite = { name: "현장", onsite: true };
  assert.equal(payState(du, onsite, "2026-11-20").left, 30_000);
  assert.equal(bookingFolio(du, true, "2026-11-20").label, "미수금 30,000원");
  const paid = { ...(du as object), payments: [{ id: "x", amount: 30_000, method: "cash", kind: "balance", bizDate: "2026-11-20", createdAt: "" }] } as never;
  assert.equal(payState(paid, onsite, "2026-11-20").left, 0);
  assert.equal(payState(paid, onsite, "2026-11-20").full, true);
  // OTA 대실은 미수금 없음
  assert.equal(payState(du, { name: "야놀자", onsite: false }, "2026-11-20").left, 0);
  assert.match(dayuseSaleNotifyLine("홍길동", "301", 30_000, false, null), /미수금 30,000원/);
  assert.doesNotMatch(dayuseSaleNotifyLine("홍길동", "301", 30_000, true, "cash"), /미수금/);
});

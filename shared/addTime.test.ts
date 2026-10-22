import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import {
  ADD_TIME_CTA,
  addTimeAmount,
  canAddTime,
  planAddTime,
  planAddTimeDayuse,
  planAddTimeStay,
  validateAddTime,
} from "./addTime";

let n = 0;
const bk = (p: Partial<Booking> = {}): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  priceUnset: false,
  guestName: `손님${n}`,
  guestPhone: null,
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-19",
  nights: 1,
  startTime: null,
  endTime: null,
  arrived: true,
  tentative: false,
  noClean: false,
  memo: null,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  segments: null,
  earlyOut: null,
  checkedOutAt: null,
  stayMode: "standard",
  longStayRate: null,
  settleCycle: null,
  charges: [],
  refund: null,
  lateOut: null,
  timeFee: null,
  earlyIn: null,
  arrival: null,
  cars: null,
  plates: null,
  carFee: null,
  walkOff: null,
  coupons: null,
  payoutOk: false,
  payoutAmount: null,
  payments: [],
  groupId: null,
  groupName: null,
  nightRates: null,
  guests: null,
  extraFee: null,
  ...p,
});

test("canAddTime: 숙박 활성 · 대실 종료시각 있음", () => {
  assert.equal(canAddTime(bk()), true);
  assert.equal(canAddTime(bk({ earlyOut: "2026-10-19" })), false);
  assert.equal(canAddTime(bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00" })), true);
  assert.equal(
    canAddTime(bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00", checkedOutAt: "2026-10-19T18:00:00Z" })),
    false,
  );
});

test("addTimeAmount: 서비스=0 · 그 외 hours×rate", () => {
  assert.equal(addTimeAmount(2, 10000, "service"), 0);
  assert.equal(addTimeAmount(2, 10000, "card"), 20000);
  assert.equal(addTimeAmount(2, 10000, "deferred"), 20000);
});

test("숙박: +2시간 · 기존 lateOut 1 → 3 · 카드 수납", () => {
  const b = bk({ lateOut: 1, timeFee: 10000, price: 110000 });
  const plan = planAddTimeStay(b, { hours: 2, hourlyRate: 10000, method: "card", bizDate: "2026-10-20" });
  assert.ok(!("err" in plan));
  assert.equal(plan.hoursAdded, 2);
  assert.equal(plan.amount, 20000);
  assert.equal(plan.collect, true);
  assert.equal(plan.surcharge.draft.lateOut, 3);
  assert.equal(plan.surcharge.draft.price, 130000);
  assert.equal(plan.surcharge.collectAmount, 20000);
});

test("숙박: 서비스=시간만 · 금액 0", () => {
  const plan = planAddTimeStay(bk(), { hours: 1, hourlyRate: 10000, method: "service", bizDate: "2026-10-20" });
  assert.ok(!("err" in plan));
  assert.equal(plan.amount, 0);
  assert.equal(plan.collect, false);
  assert.equal(plan.surcharge.draft.lateOut, 1);
  assert.equal(plan.surcharge.draft.price, 100000);
});

test("숙박: 후불=잔금 · 수납 없음", () => {
  const plan = planAddTimeStay(bk(), { hours: 1, hourlyRate: 10000, method: "deferred", bizDate: "2026-10-20" });
  assert.ok(!("err" in plan));
  assert.equal(plan.amount, 10000);
  assert.equal(plan.collect, false);
  assert.equal(plan.surcharge.collectAmount, 0);
  assert.equal(plan.surcharge.draft.price, 110000);
});

test("대실: endTime +2h · 이체 수납", () => {
  const b = bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00", price: 40000 });
  const plan = planAddTimeDayuse(b, { hours: 2, hourlyRate: 10000, method: "transfer", bizDate: "2026-10-20" });
  assert.ok(!("err" in plan));
  assert.equal(plan.endTime, "19:00");
  assert.equal(plan.price, 60000);
  assert.equal(plan.collectAmount, 20000);
  assert.equal(plan.payMethod, "transfer");
});

test("대실: 후불 · endTime만·가격↑·수납0", () => {
  const b = bk({ kind: "dayuse", nights: null, startTime: "13:00", endTime: "15:00", price: 30000 });
  const plan = planAddTime(b, { hours: 1, hourlyRate: 8000, method: "deferred", bizDate: "2026-10-20" });
  assert.ok(!("err" in plan));
  assert.equal(plan.kind, "dayuse");
  if (plan.kind !== "dayuse") return;
  assert.equal(plan.endTime, "16:00");
  assert.equal(plan.price, 38000);
  assert.equal(plan.collectAmount, 0);
});

test("validate: 0시간 거부 · CTA 카피", () => {
  assert.match(validateAddTime(bk(), { hours: 0, hourlyRate: 10000, method: "card", bizDate: "2026-10-20" }) ?? "", /1시간/);
  assert.equal(ADD_TIME_CTA, "시간 추가");
});

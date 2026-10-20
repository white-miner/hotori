// 「+추가금」: lateOut·price·받기 한 확정 · 박수 불변 · 1박 연장과 분리
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import {
  SURCHARGE_COPY,
  canAddSurcharge,
  defaultSurchargeAmount,
  mergeSurchargeMemo,
  payLineSub,
  planAddSurcharge,
  suggestElapsedLateHours,
  surchargeNotifyLine,
  surchargePayNote,
  validateAddSurcharge,
} from "./addSurcharge";
import { EXTEND_COPY, applyExtend } from "./extend";

let n = 0;
const bk = (p: Partial<Booking> = {}): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-19",
  nights: 1,
  startTime: null,
  endTime: null,
  arrived: true,
  memo: null,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  segments: null,
  earlyOut: null,
  refund: null,
  lateOut: null,
  timeFee: null,
  earlyIn: null,
  ...p,
});

const baseIn = {
  reason: "late_out" as const,
  hours: 3,
  amount: 30000,
  memo: "합의 15시까지",
  collect: true,
  method: "transfer" as const,
  bizDate: "2026-10-20",
};

test("시나리오 A: +3시간·이체 3만 · lateOut·timeFee·price · nights 불변", () => {
  const b = bk();
  const plan = planAddSurcharge(b, baseIn);
  assert.ok(!("err" in plan));
  assert.equal(plan.draft.lateOut, 3);
  assert.equal(plan.draft.timeFee, 30000);
  assert.equal(plan.draft.price, 130000);
  assert.equal(plan.draft.nights, 1);
  assert.equal(plan.collectAmount, 30000);
  assert.equal(plan.payNote, "추가금 · 늦은 퇴실");
  assert.equal(plan.appliesLateOut, true);
  assert.match(plan.draft.memo ?? "", /합의 15시까지/);
});

test("시나리오 B: 레이트·무단 · 경과 제안 시간 · lateOut 반영", () => {
  assert.equal(suggestElapsedLateHours("12:00", "14:00"), 2);
  assert.equal(suggestElapsedLateHours("12:00", "12:00"), 0);
  assert.equal(suggestElapsedLateHours("12:00", "11:30"), 0);
  assert.equal(defaultSurchargeAmount(10000, 2), 20000);

  const b = bk();
  const plan = planAddSurcharge(b, {
    reason: "late_fee",
    hours: 2,
    amount: 20000,
    memo: "14시 무단",
    collect: true,
    method: "cash",
    bizDate: "2026-10-20",
  });
  assert.ok(!("err" in plan));
  assert.equal(plan.draft.lateOut, 2);
  assert.equal(plan.draft.price, 120000);
  assert.equal(plan.collectAmount, 20000);
  assert.equal(plan.payNote, "추가금 · 레이트·무단");
});

test("기타: lateOut 강제 안 함 · 메모 필수 · 잔금으로 남김", () => {
  const b = bk({ lateOut: null });
  assert.match(validateAddSurcharge(b, { ...baseIn, reason: "other", hours: 0, memo: "" })!, /메모/);
  const plan = planAddSurcharge(b, {
    reason: "other",
    hours: 0,
    amount: 15000,
    memo: "미니바",
    collect: false,
    method: "card",
    bizDate: "2026-10-20",
  });
  assert.ok(!("err" in plan));
  assert.equal(plan.draft.lateOut, null);
  assert.equal(plan.draft.price, 115000);
  assert.equal(plan.collectAmount, 0);
  assert.equal(plan.payNote, null);
  assert.equal(plan.appliesLateOut, false);
});

test("늦은 퇴실 N≥1 필수 · 0원 서비스는 받기 스킵·lateOut만", () => {
  const b = bk();
  assert.match(validateAddSurcharge(b, { ...baseIn, hours: 0 })!, /1시간/);
  const plan = planAddSurcharge(b, { ...baseIn, amount: 0, collect: true });
  assert.ok(!("err" in plan));
  assert.equal(plan.draft.lateOut, 3);
  assert.equal(plan.draft.price, 100000);
  assert.equal(plan.collectAmount, 0);
});

test("「1박 연장」과 분리: nights·checkOut 불변 · 카피 다름", () => {
  const b = bk({ nights: 2, price: 200000 });
  const plan = planAddSurcharge(b, baseIn);
  assert.ok(!("err" in plan));
  assert.equal(plan.draft.nights, 2);
  const ext = applyExtend(b, 100000);
  assert.equal(ext.nights, 3);
  assert.notEqual(SURCHARGE_COPY, EXTEND_COPY);
});

test("내역 카피: 이체 주 + 추가금 보조", () => {
  assert.equal(surchargePayNote("late_out"), "추가금 · 늦은 퇴실");
  assert.match(payLineSub("balance", "2026-10-20", "추가금 · 늦은 퇴실"), /^추가금 · 늦은 퇴실 · 10\/20/);
  assert.match(payLineSub("balance", "2026-10-20", null), /^잔금 · 10\/20/);
  assert.match(payLineSub("deposit", "2026-10-18", null), /^선금 · 10\/18/);
});

test("메모 접두 · 알림 줄 · canAddSurcharge", () => {
  assert.equal(mergeSurchargeMemo("기존", "late_out", "합의"), "기존\n[추가금·늦은 퇴실] 합의");
  assert.match(surchargeNotifyLine("김", "late_out", 30000, true, 3), /\+추가금.*늦은 퇴실.*3시간.*받음/);
  assert.equal(canAddSurcharge(bk()), true);
  assert.equal(canAddSurcharge(bk({ earlyOut: "2026-10-19" })), false);
  assert.equal(canAddSurcharge(bk({ status: "cancelled" })), false);
});

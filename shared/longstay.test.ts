// 장기숙박: 요금표 · 누적 · 미수 · 재고 창 롤링
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import {
  LONG_STAY_WINDOW_DEFAULT,
  accruedOf,
  balanceDue,
  chargesOutsideWindow,
  flatRate,
  longPayState,
  nightAmount,
  nightDow,
  nightsAtCheckout,
  planLongStayExtend,
  planMissingCharges,
  planWindowExtend,
  settleHint,
  validateLongStayRate,
  windowNights,
  withPlannedCharges,
} from "./longstay";
import { payState } from "./payment";

let n = 0;
const bk = (p: Partial<Booking> = {}): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 0,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-11",
  nights: 7,
  startTime: null,
  endTime: null,
  arrived: true,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  segments: null,
  earlyOut: null,
  refund: null,
  stayMode: "long_stay",
  longStayRate: flatRate(80000),
  settleCycle: "weekly",
  charges: [],
  payments: [],
  ...p,
});

test("기본 재고 창 7박 · flat 단가 · 요일 계산", () => {
  assert.equal(LONG_STAY_WINDOW_DEFAULT, 7);
  assert.equal(nightAmount(flatRate(80000), "2026-10-11"), 80000);
  assert.equal(nightDow("2026-10-11"), 0); // 일요일
  assert.equal(nightDow("2026-10-12"), 1);
  assert.equal(validateLongStayRate(flatRate(80000)), null);
  assert.ok(validateLongStayRate(null));
  assert.ok(validateLongStayRate({ kind: "flat", currency: "KRW" }));
});

test("창 밤 목록 · 누락 줄 계획 · 창 밖 삭제", () => {
  const nights = windowNights("2026-10-11", 3);
  assert.deepEqual(nights, ["2026-10-11", "2026-10-12", "2026-10-13"]);
  const planned = planMissingCharges("2026-10-11", 3, flatRate(80000), [{ nightDate: "2026-10-11" }]);
  assert.ok(!("err" in planned));
  if ("err" in planned) return;
  assert.equal(planned.length, 2);
  assert.equal(planned[0]!.nightDate, "2026-10-12");
  assert.equal(planned[0]!.amount, 80000);
  const drop = chargesOutsideWindow("2026-10-11", 2, [
    { id: "1", bookingId: "b", nightDate: "2026-10-11", amount: 1, createdAt: "" },
    { id: "2", bookingId: "b", nightDate: "2026-10-13", amount: 1, createdAt: "" },
  ]);
  assert.equal(drop.length, 1);
  assert.equal(drop[0]!.nightDate, "2026-10-13");
});

test("미수 = 누적 − 수납액 · 정산 후에도 누적 유지", () => {
  const charges = [
    { id: "1", bookingId: "b", nightDate: "2026-10-11", amount: 80000, createdAt: "" },
    { id: "2", bookingId: "b", nightDate: "2026-10-12", amount: 80000, createdAt: "" },
  ];
  const b = bk({ charges, payments: [] });
  assert.equal(accruedOf(b), 160000);
  assert.equal(balanceDue(b), 160000);
  const paid = bk({
    charges,
    payments: [{ id: "p1", bookingId: "b", kind: "balance", method: "card", amount: 160000, bizDate: "2026-10-18", createdAt: "" }],
  });
  assert.equal(balanceDue(paid), 0);
  assert.equal(longPayState(paid).full, true);
  // 다음 밤이 쌓이면 미수가 다시 오른다
  const again = {
    ...paid,
    charges: [...charges, { id: "3", bookingId: "b", nightDate: "2026-10-13", amount: 80000, createdAt: "" }],
  };
  assert.equal(balanceDue(again), 80000);
  const ps = payState(again, { name: "현장", onsite: true });
  assert.equal(ps.tracked, true);
  assert.equal(ps.left, 80000);
  assert.equal(ps.due, 240000);
});

test("재고 창 +7 · 1박 연장 원장 줄", () => {
  const b = bk({ nights: 7, charges: windowNights("2026-10-11", 7).map((d, i) => ({ id: `c${i}`, bookingId: "b", nightDate: d, amount: 80000, createdAt: "" })) });
  const win = planWindowExtend(b, 7, flatRate(80000));
  assert.ok(!("err" in win));
  if ("err" in win) return;
  assert.equal(win.nights, 14);
  assert.equal(win.lines.length, 7);
  assert.equal(win.totalRate, 560000);
  assert.equal(win.extraNights[0], "2026-10-18");
  const one = planLongStayExtend(b, flatRate(80000));
  assert.ok(!("err" in one));
  if ("err" in one) return;
  assert.equal(one.draft.nights, 8);
  assert.equal(one.line.nightDate, "2026-10-18");
  assert.equal(one.line.amount, 80000);
  assert.equal(one.draft.price, accruedOf(b) + 80000);
});

test("저장 미리보기 · 퇴실처리 박수 · 주간 힌트", () => {
  const b = bk({ nights: 2, charges: [] });
  const w = withPlannedCharges(b, flatRate(80000));
  assert.ok(!("err" in w));
  if ("err" in w) return;
  assert.equal(w.charges.length, 2);
  assert.equal(w.price, 160000);
  assert.equal(nightsAtCheckout("2026-10-11", "2026-10-15"), 4);
  assert.equal(nightsAtCheckout("2026-10-11", "2026-10-11"), 1);
  assert.match(settleHint("weekly", 720000), /주간/);
  assert.match(settleHint("adhoc", 0), /정산됨/);
});

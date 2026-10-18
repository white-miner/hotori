// 빠른 입실 · 늦은 퇴실 · 이체
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings, revenueOf } from "./ledger";
import { autoTimeFee, inTimeOf, isTimeService, outTimeOf, timeLine, timeTags, turnoverWarnings } from "./extratime";
import { bookingCash, paySplit, payState, splitLine, validatePayment } from "./payment";
import { settle } from "./settle";

const S = normalizeSettings({ types: [{ id: "t", name: "T" }], platforms: [{ id: "w", name: "현장·전화", abbr: "현" }], floors: [{ id: "f", name: "1층", rooms: [{ id: "r1", no: "101", typeId: "t" }, { id: "r2", no: "102", typeId: "t" }] }] });
const bk = (p: Partial<Booking>): Booking => ({
  id: "b", kind: "stay", status: "active", platformId: "w", price: 100000, guestName: "손님", typeId: "t", roomId: "r1", checkIn: "2026-10-19", nights: 1,
  startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null, createdAt: "", updatedAt: "", ...p,
});

test("기본 시간에서 앞당기고 미뤄요: 빠른 입실 2시간 = 14:00 · 늦은 퇴실 2시간 = 14:00", () => {
  assert.equal(S.extraHourFee, 10000);
  assert.equal(normalizeSettings({ extraHourFee: 15000 } as never).extraHourFee, 15000);
  assert.equal(normalizeSettings({ extraHourFee: -1 } as never).extraHourFee, 10000);
  const b = bk({ earlyIn: 2, lateOut: 2 });
  assert.equal(inTimeOf(S, b), "14:00");
  assert.equal(outTimeOf(S, b), "14:00");
  assert.equal(inTimeOf(S, bk({})), "16:00");
  assert.deepEqual(timeTags(S, b), ["빠른 14:00", "늦은 14:00"]);
  assert.deepEqual(timeTags(S, bk({ kind: "dayuse", earlyIn: 2 })), []);
  assert.equal(timeLine(b), "빠른 입실 2시간 · 늦은 퇴실 2시간");
  assert.equal(autoTimeFee(S, 2, 1), 30000);
});

test("금액은 판매 가격에 들어 있어요: 매출 · 잔금에 그대로 · 서비스는 0원", () => {
  const b = bk({ price: 130000, earlyIn: 2, lateOut: 1, timeFee: 30000 });
  assert.equal(revenueOf(b), 130000);
  assert.equal(payState(b, { name: "현장·전화" }).left, 130000);
  assert.equal(isTimeService(b), false);
  assert.equal(isTimeService(bk({ lateOut: 2, timeFee: 0 })), true);
});

test("같은 방 같은 날: 앞 손님 늦은 퇴실이면 다음 손님에게 경고", () => {
  const a = bk({ id: "a", checkIn: "2026-10-18", nights: 1, lateOut: 2 });
  const n = bk({ id: "n", checkIn: "2026-10-19", nights: 2 });
  const w = turnoverWarnings(S, [a, n]);
  assert.deepEqual(w.map((x) => [x.id, x.text]), [["n", "앞 손님 늦은 퇴실 14:00"], ["a", "다음 손님 같은 날 입실 16:00"]]);
  // 다른 방 · 취소 · 중도 퇴실이면 없어요
  assert.equal(turnoverWarnings(S, [a, { ...n, roomId: "r2" }]).length, 0);
  assert.equal(turnoverWarnings(S, [{ ...a, status: "cancelled" }, n]).length, 0);
  // 빠른 입실이 앞 손님 퇴실(12:00)보다 이르면
  const e = turnoverWarnings(S, [{ ...a, lateOut: 0 }, { ...n, earlyIn: 5 }]);
  assert.deepEqual(e.map((x) => [x.id, x.text]), [["n", "앞 손님 퇴실 12:00 전에 빠른 입실 11:00"], ["a", "다음 손님 빠른 입실 11:00"]]);
  // 빠른 입실 2시간(14:00)은 12:00 퇴실 뒤라 괜찮아요
  assert.equal(turnoverWarnings(S, [{ ...a, lateOut: 0 }, { ...n, earlyIn: 2 }]).length, 0);
  // 객실 이동: 마지막 방에서 나가는 날 기준
  const mv = bk({ id: "m", checkIn: "2026-10-17", nights: 2, roomId: "r2", segments: [{ roomId: "r2", nights: 1 }, { roomId: "r1", nights: 1 }], lateOut: 1 });
  assert.deepEqual(turnoverWarnings(S, [mv, n]).map((x) => x.text), ["앞 손님 늦은 퇴실 13:00", "다음 손님 같은 날 입실 16:00"]);
});

test("이체: 결제 방법으로 받고, 현금 시재에는 안 들어가요", () => {
  assert.equal(validatePayment(1000, "transfer", "2026-10-19"), null);
  assert.ok(validatePayment(1000, "check", "2026-10-19"));
  const list = [
    { method: "card" as const, amount: 100, bizDate: "2026-10-19" },
    { method: "cash" as const, amount: 50, bizDate: "2026-10-19" },
    { method: "transfer" as const, amount: 30, bizDate: "2026-10-19" },
    { method: "transfer" as const, amount: 7, bizDate: "2026-10-25" },
  ];
  assert.equal(bookingCash(list, "2026-10-19", "2026-10-19"), 50);
  assert.deepEqual(paySplit(list, "2026-10-19", "2026-10-19"), { card: 100, cash: 50, transfer: 30, total: 180 });
  assert.equal(splitLine(paySplit(list)), "카드 100 · 현금 50 · 이체 37");
});

test("단체 정산: 빠른 입실 · 늦은 퇴실 금액을 따로 한 줄", () => {
  const m = [bk({ id: "1", groupId: "g", price: 120000, lateOut: 2, timeFee: 20000 }), bk({ id: "2", groupId: "g", roomId: "r2", price: 100000, earlyIn: 1, timeFee: 0 })];
  const st = settle(m, null, { name: "현장·전화" });
  assert.equal(st.extraTime, 20000);
  assert.equal(st.roomSum, 200000);
  assert.equal(st.total, 220000);
});

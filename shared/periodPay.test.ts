// 박 목록 · 박별 약정 요금(적어 둔 값만) — 총액을 박에 나누지 않아요
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import { groupLedger, rateLabel } from "./groupLedger";
import { stayNightRows, type PeriodBooking } from "./periodPay";

const rates = (checkIn: string, per: number, count: number) => ({
  flat: per,
  nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [new Date(Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8) + i)).toISOString().slice(0, 10), per])),
});
/** per원 × count박 (박별 요금 행렬 있음) */
const stay = (id: string, per: number, count: number, p: Partial<PeriodBooking> = {}): PeriodBooking => ({
  id, status: "active", kind: "stay", checkIn: "2026-10-27", nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
  nightRates: rates("2026-10-27", per, count), payments: [], checkedOutAt: null, stayMode: null, ...p,
} as PeriodBooking);
const book = (b: PeriodBooking) => b as unknown as Booking;

test("stayNightRows: 박별 요금 그대로 (추가금을 마지막 박에 섞지 않아요)", () => {
  const b = stay("a", 70_000, 4, { price: 290_000 }); // 추가금 10,000
  assert.deepEqual(stayNightRows(b).map((x) => x.amount), [70_000, 70_000, 70_000, 70_000]);
  const g = groupLedger([b], 0, "2026-10-27");
  assert.equal(g.rooms[0]!.subtotal, 290_000, "객실 청구 = 예약 총액");
  assert.equal(g.rooms[0]!.perNight, true);
});

test("stayNightRows: 박별 요금이 없으면 박마다 null · 총액을 박에 나누지 않아요", () => {
  const b = stay("b", 0, 3, { price: 250_000, nightRates: null });
  assert.deepEqual(stayNightRows(b).map((x) => x.amount), [null, null, null]);
  const g = groupLedger([b], 0, "2026-10-27");
  assert.equal(g.rooms[0]!.subtotal, 250_000);
  assert.equal(g.rooms[0]!.perNight, false);
  assert.equal(g.rooms[0]!.tonight, 0, "오늘 밤 요금을 만들어 내지 않아요");
  assert.equal(rateLabel(g.rooms[0]!), "박별 요금 없음 · 총액만");
  assert.equal(g.due, 250_000);
});

test("stayNightRows: 조기 퇴실 = 묵은 박까지만 · 청구는 판매가 − 환불", () => {
  const b = stay("c", 100_000, 4, { earlyOut: "2026-10-29", refund: 200_000 });
  assert.deepEqual(stayNightRows(b).map((x) => x.date), ["2026-10-27", "2026-10-28"]);
  assert.equal(groupLedger([b], 0, "2026-10-27").rooms[0]!.subtotal, 200_000);
});

test("stayNightRows: 취소 · 대실 · 장기는 박 없음", () => {
  assert.equal(stayNightRows(stay("d", 1, 2, { status: "cancelled" })).length, 0);
  assert.equal(stayNightRows(stay("e", 1, 2, { kind: "dayuse" })).length, 0);
  assert.equal(stayNightRows(stay("f", 1, 2, { stayMode: "long_stay" })).length, 0);
  void book;
});

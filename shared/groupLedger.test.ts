// 단체 요금 · 결제 비교: 객실 요금(청구)과 결제 내역(받은 돈)을 따로 두고 차액만 봐요. 배분 없음.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "./ledger";
import type { Payment } from "./payment";
import type { PeriodBooking } from "./periodPay";
import { balanceLabel, diffLine, groupLedger, groupTone, rateLabel, stayRangeLabel } from "./groupLedger";

let n = 0;
const pay = (bookingId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `p${++n}`, bookingId, kind: "balance", method: "card", amount, bizDate: "2026-10-25", createdAt: `2026-10-25T00:00:${String(n % 60).padStart(2, "0")}Z`, ...extra,
});
/** per원 × count박 (같은 요금) */
const room = (id: string, per: number, count: number, checkIn = "2026-10-25", p: Partial<PeriodBooking> = {}): PeriodBooking =>
  ({
    id, status: "active", kind: "stay", checkIn, nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
    nightRates: { flat: per, nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [addDays(checkIn, i), per])) },
    payments: [], checkedOutAt: null, stayMode: null, ...p,
  }) as PeriodBooking;
const TODAY = "2026-10-25";
const three = () => [room("r602", 70_000, 3), room("r501", 80_000, 3), room("r301", 80_000, 3)];

test("사례: 602(7만)+501(8만)+301(8만) 10/25~10/27 3박 = 청구 690,000 → 카드 690,000 결제 = 정산 완료", () => {
  const open = groupLedger(three(), 0, TODAY);
  assert.equal(open.due, 690_000);
  assert.equal(open.paid, 0);
  assert.equal(balanceLabel(open), "미수금 690,000원");
  const settled = groupLedger(three(), 690_000, TODAY);
  assert.equal(settled.owed, 0);
  assert.equal(settled.prepaid, 0);
  assert.equal(balanceLabel(settled), "정산 완료");
  assert.equal(groupTone(settled), "even");
});

test("객실 요금은 평균내지 않아요: 객실마다 박당 요금 · 소계가 자기 요금 그대로", () => {
  const g = groupLedger(three(), 690_000, TODAY);
  const by = Object.fromEntries(g.rooms.map((r) => [r.bookingId, r]));
  assert.deepEqual([by.r602!.subtotal, by.r501!.subtotal, by.r301!.subtotal], [210_000, 240_000, 240_000]);
  assert.deepEqual([by.r602!.rateMin, by.r602!.rateMax], [70_000, 70_000]);
  assert.equal(rateLabel(by.r501!), "80,000원");
  // 단체에 한 번에 낸 결제가 객실에 배분되지 않음 → 객실별 noted는 0
  assert.equal(by.r602!.noted + by.r501!.noted + by.r301!.noted, 0);
});

test("요일별 요금: 최저~최고로 보이고 소계는 날짜별 합", () => {
  const b = room("rw", 70_000, 3, "2026-10-23", { nightRates: { flat: 70_000, nights: { "2026-10-23": 90_000, "2026-10-24": 90_000, "2026-10-25": 70_000 } } as never, price: 250_000 });
  const g = groupLedger([b], 0, "2026-10-23");
  const r = g.rooms[0]!;
  assert.equal(r.subtotal, 250_000);
  assert.deepEqual([r.rateMin, r.rateMax], [70_000, 90_000]);
  assert.equal(rateLabel(r), "70,000~90,000원 (요일별)");
});

test("502호 추가(박당 8만) 3박: 청구 930,000 → 결제 690,000이면 미수금 240,000 → 카드 80,000 더 받으면 미수금 160,000", () => {
  const rooms = [...three(), room("r502", 80_000, 3)];
  const a = groupLedger(rooms, 690_000, TODAY);
  assert.equal(a.due, 930_000);
  assert.equal(a.owed, 240_000);
  assert.equal(balanceLabel(a), "미수금 240,000원");
  const b = groupLedger(
    rooms.map((r) => (r.id === "r502" ? ({ ...r, payments: [pay("r502", 80_000)] } as PeriodBooking) : r)),
    690_000,
    TODAY,
  );
  assert.equal(b.paid, 770_000);
  assert.equal(b.owed, 160_000);
  assert.equal(diffLine(b), "청구 930,000원 − 결제 770,000원 = 미수금 160,000원");
});

test("502호가 1박(8만)만이면 카드 8만 결제로 정확히 정산 완료", () => {
  const rooms = [...three(), room("r502", 80_000, 1, "2026-10-26")];
  const g = groupLedger(rooms.map((r) => (r.id === "r502" ? ({ ...r, payments: [pay("r502", 80_000, { bizDate: "2026-10-26" })] } as PeriodBooking) : r)), 690_000, "2026-10-26");
  assert.equal(g.due, 770_000);
  assert.equal(g.paid, 770_000);
  assert.equal(balanceLabel(g), "정산 완료");
});

test("초과 수납: 더 받았으면 그만큼 표시", () => {
  const g = groupLedger(three(), 700_000, TODAY);
  assert.equal(g.prepaid, 10_000);
  assert.equal(g.owed, 0);
  assert.equal(balanceLabel(g), "초과 수납 10,000원");
  assert.equal(groupTone(g), "prepaid");
});

test("예전에 객실·박에 나눠 적힌 결제도 그대로 합산돼요 (배분 여부와 무관)", () => {
  const rooms = three().map((r) => ({ ...r, payments: [pay(r.id, (r.price as number) ?? 0, { nightDate: "2026-10-25", periodNights: 3 })] }) as PeriodBooking);
  const g = groupLedger(rooms, 0, TODAY);
  assert.equal(g.paid, 690_000);
  assert.equal(g.owed, 0);
  // 일부는 객실로, 일부는 단체로
  const mixed = groupLedger([{ ...rooms[0]! }, rooms[1]!, three()[2]!], 240_000, TODAY);
  assert.equal(mixed.paid, 210_000 + 240_000 + 240_000);
  assert.equal(mixed.owed, 0);
});

test("이용 기간 미정: 「10/25 ~ 퇴실 미정」 · 청구는 지금까지 기록된 박만", () => {
  const g = groupLedger([room("ro", 80_000, 2, "2026-10-25", { openEnded: true })], 0, "2026-10-26");
  const r = g.rooms[0]!;
  assert.equal(r.openEnded, true);
  assert.equal(stayRangeLabel(r), "10/25 ~ 퇴실 미정");
  assert.equal(g.due, 160_000);
  assert.equal(stayRangeLabel(groupLedger(three(), 0, TODAY).rooms[0]!), "10/25 ~ 10/27 · 3박");
});

test("추가 항목(식사 등)은 청구에 더해요", () => {
  const g = groupLedger(three(), 690_000, TODAY, { extras: 50_000 });
  assert.equal(g.due, 740_000);
  assert.equal(g.owed, 50_000);
});

test("취소·장기 숙박은 청구에서 빠져요", () => {
  const g = groupLedger([...three(), room("rx", 80_000, 3, "2026-10-25", { status: "cancelled" })], 0, TODAY);
  assert.equal(g.due, 690_000);
  assert.equal(g.roomCount, 3);
});

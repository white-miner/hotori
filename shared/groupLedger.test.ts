// 단체 결제 요약: 객실이 들어오고 나가도 · 며칠씩 묶어 결제해도 · 선수금/미수금이 한 줄로 맞는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, md } from "./ledger";
import type { Payment } from "./payment";
import type { PeriodBooking } from "./periodPay";
import { balanceLabel, coverLabel, groupLedger, groupTone, paidThroughLabel, unpaidTodayLabel } from "./groupLedger";

let n = 0;
const matrix = (checkIn: string, per: number, count: number) => ({
  flat: per,
  nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [addDays(checkIn, i), per])),
});
const pay = (bookingId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `p${++n}`, bookingId, kind: "balance", method: "card", amount, bizDate: "2026-10-28", createdAt: `2026-10-28T00:00:${String(n % 60).padStart(2, "0")}Z`, ...extra,
});
/** per원 × count박 (박별 요금 있음) */
export const room = (id: string, per: number, count: number, checkIn = "2026-10-28", p: Partial<PeriodBooking> = {}): PeriodBooking =>
  ({
    id, status: "active", kind: "stay", checkIn, nights: count, price: per * count, priceUnset: false, earlyOut: null, refund: null,
    nightRates: matrix(checkIn, per, count), payments: [], checkedOutAt: null, stayMode: null, ...p,
  }) as PeriodBooking;
const group3 = () => [room("r602", 70_000, 30), room("r501", 80_000, 30), room("r301", 80_000, 30)];
/** 3박 결제(10/28~30) 한 줄씩 */
const paid3 = (rooms: PeriodBooking[], from = "2026-10-28", nights = 3) =>
  rooms.map((b) => ({ ...b, payments: [...(b.payments ?? []), pay(b.id, (b.nightRates!.flat ?? 0) * nights, { nightDate: from, periodNights: nights })] }) as PeriodBooking);

test("결제 내역 없음: 오늘 밤 합계 = 미수금 · 결제 완료 날짜 없음", () => {
  const g = groupLedger(group3(), 0, "2026-10-28");
  assert.equal(g.roomCount, 3);
  assert.equal(g.tonight, 230_000);
  assert.equal(g.dueToday, 230_000);
  assert.equal(g.owed, 230_000);
  assert.equal(g.prepaid, 0);
  assert.equal(g.paidThrough, null);
  assert.equal(g.unpaidNightsToday, 1);
  assert.equal(balanceLabel(g), "미수금 230,000원");
  assert.equal(paidThroughLabel(g, md), "결제 내역 없음");
  assert.equal(unpaidTodayLabel(g), "오늘 밤까지 1박 미결제");
  assert.equal(groupTone(g), "owed");
});

test("3객실 × 3박 카드 690,000원 결제 → 선수금 · 결제 완료 ~10/30 · 오늘 밤 미결제 없음", () => {
  const g = groupLedger(paid3(group3()), 0, "2026-10-28");
  assert.equal(g.paid, 690_000);
  assert.equal(g.prepaid, 460_000);
  assert.equal(g.owed, 0);
  assert.equal(g.paidThrough, "2026-10-30");
  assert.equal(g.firstUncovered, "2026-10-31");
  assert.equal(g.unpaidNightsToday, 0);
  assert.equal(g.coverNights, 2);
  assert.equal(g.lastPeriodNights, 3);
  assert.equal(coverLabel(g), "선수금으로 2박 더 커버");
  assert.equal(paidThroughLabel(g, md), "결제 완료 ~10/30");
});

test("기간이 지나면 미수금 · 밀린 박 수가 보여요", () => {
  const g = groupLedger(paid3(group3()), 0, "2026-11-01"); // 31일 · 1일 두 밤 밀림
  assert.equal(g.dueToday, 230_000 * 5); // 10/28~11/01
  assert.equal(g.owed, 230_000 * 2);
  assert.equal(g.unpaidNightsToday, 2);
  assert.equal(g.paidThrough, "2026-10-30");
  assert.equal(groupTone(g), "owed");
});

test("객실 추가: 302호는 입실일부터 자기 요금(90,000)만 계산돼요", () => {
  const rooms = [...paid3(group3()), room("r302", 90_000, 20, "2026-10-30")];
  const g = groupLedger(rooms, 0, "2026-10-30");
  assert.equal(g.roomCount, 4);
  // 10/30 밤: 기존 3객실 230,000 + 302호 90,000
  assert.equal(g.tonight, 320_000);
  // 302호는 10/30부터 → 10/28·29 박은 없음
  const r302 = g.rooms.find((r) => r.bookingId === "r302")!;
  assert.equal(r302.firstNight, "2026-10-30");
  assert.equal(r302.dueToday, 90_000);
  assert.equal(r302.paidThrough, null);
  // 오늘 밤까지: 기존 3일 × 230,000 = 690,000 (전부 결제) + 302호 90,000 미수
  assert.equal(g.dueToday, 690_000 + 90_000);
  assert.equal(g.owed, 90_000);
  // 단체 결제 완료일: 302호 첫 밤(10/30)이 미결제라 10/29까지
  assert.equal(g.paidThrough, "2026-10-29");
  assert.equal(g.firstUncovered, "2026-10-30");
});

test("선수금(단체 몫)은 맨 앞 미결제 박부터 자동 반영 · 객실 몫을 넘은 돈도 풀로", () => {
  const rooms = group3();
  // 단체 몫 460,000 = 2박 분
  const g = groupLedger(rooms, 460_000, "2026-10-28");
  assert.equal(g.paid, 460_000);
  assert.equal(g.paidThrough, "2026-10-29");
  assert.equal(g.prepaid, 230_000); // 오늘 밤 230,000을 빼고도 남음
  // 객실 하나가 자기 몫보다 많이 낸 경우
  const over = [room("a", 100_000, 2, "2026-10-28", { payments: [pay("a", 300_000)] }), room("b", 100_000, 2)];
  const g2 = groupLedger(over, 0, "2026-10-28");
  assert.equal(g2.paid, 300_000);
  assert.equal(g2.rooms.find((r) => r.bookingId === "b")!.paidThrough, "2026-10-28"); // a의 남는 100,000이 b 첫 밤을 채움
  assert.equal(g2.paidThrough, "2026-10-28");
});

test("객실이 먼저 나가면 (박수 줄임) 그 객실 몫이 사라져 합계가 맞춰져요", () => {
  const rooms = paid3(group3());
  // 301호가 2박만 묵고 나감: 박수 2 · 판매가 160,000 · 결제 240,000(3박)은 그대로
  const left = rooms.map((b) =>
    b.id === "r301" ? ({ ...b, nights: 2, price: 160_000, nightRates: matrix("2026-10-28", 80_000, 2) } as PeriodBooking) : b,
  );
  const g = groupLedger(left, 0, "2026-10-30");
  assert.equal(g.roomCount, 3);
  assert.equal(g.rooms.find((r) => r.bookingId === "r301")!.live, false);
  // 301호가 더 낸 80,000은 단체 선수금으로 남아요 (결제 690,000 − 오늘 밤까지 610,000)
  assert.equal(g.dueToday, 230_000 * 2 + 150_000);
  assert.equal(g.prepaid, 80_000);
  assert.equal(g.tonight, 150_000); // 10/30 밤에는 602 + 501만
});

test("취소·대실·장기 객실은 계산에서 빠져요", () => {
  const rooms = [...group3(), room("x", 50_000, 2, "2026-10-28", { status: "cancelled" }), room("y", 50_000, 2, "2026-10-28", { kind: "dayuse" })];
  const g = groupLedger(rooms, 0, "2026-10-28");
  assert.equal(g.roomCount, 3);
});

test("단체 추가 항목(식사 등)은 오늘 밤까지 금액에 들어가요", () => {
  const g = groupLedger(paid3(group3()), 0, "2026-10-28", { extras: 100_000 });
  assert.equal(g.dueToday, 330_000);
  assert.equal(g.prepaid, 360_000);
});

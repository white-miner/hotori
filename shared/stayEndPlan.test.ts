// 퇴실 미정 / 퇴실일 정하기: 단체 머리글·객실별 요금표에서 한 번에 — 객실마다 다른 요금은 그대로
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, addDays } from "./ledger";
import { canSetStayEnd, planStayEnd, stayEndSummary } from "./stayEndPlan";

const mk = (id: string, per: number, count: number, checkIn = "2026-10-25", p: Partial<Booking> = {}): Booking =>
  ({
    id, kind: "stay", status: "active", platformId: "p", guestName: "단체", typeId: "t", roomId: id, checkIn, nights: count, price: per * count,
    startTime: null, endTime: null, arrived: true, earlyOut: null, refund: null, payments: [], checkedOutAt: null, stayMode: null, priceUnset: false, openEnded: false,
    nightRates: { flat: per, nights: Object.fromEntries(Array.from({ length: count }, (_, i) => [addDays(checkIn, i), per])) }, ...p,
  }) as unknown as Booking;
const TODAY = "2026-10-28";

test("11/9 퇴실 단체 → 퇴실 미정: 오늘 밤 + 방 보호 1일까지로 줄고 요금은 객실별 자기 요금으로", () => {
  const a = planStayEnd(mk("a", 70_000, 15), null, TODAY); // 10/25~11/9
  const b = planStayEnd(mk("b", 80_000, 15), null, TODAY);
  assert.equal(a.patch!.openEnded, true);
  assert.equal(a.patch!.nights, 5); // 10/25..10/29 (오늘 10/28 + 보호 1일)
  assert.equal(a.patch!.price, 5 * 70_000);
  assert.equal(b.patch!.price, 5 * 80_000);
  assert.equal(a.deltaNights, -10);
  assert.equal(b.deltaPrice, 10 * -80_000);
});

test("퇴실 미정은 이미 짧으면 박수·요금을 건드리지 않아요", () => {
  const p = planStayEnd(mk("a", 80_000, 2), null, TODAY);
  assert.equal(p.patch!.nights, 2);
  assert.equal(p.deltaPrice, 0);
  assert.equal(p.patch!.openEnded, true);
});

test("퇴실일 정하기: 박수 = 퇴실일 − 입실일, 미정은 꺼지고 늘어난 밤은 마지막 박 요금", () => {
  const p = planStayEnd(mk("a", 80_000, 3, "2026-10-25", { openEnded: true }), "2026-10-30", TODAY);
  assert.equal(p.patch!.openEnded, false);
  assert.equal(p.patch!.nights, 5);
  assert.equal(p.patch!.price, 400_000);
  assert.equal(p.deltaNights, 2);
  const s = planStayEnd(mk("a", 80_000, 10), "2026-10-27", TODAY);
  assert.equal(s.patch!.nights, 2);
  assert.equal(s.patch!.price, 160_000);
});

test("잘못된 퇴실일 · 퇴실한 예약 · 장기 투숙은 바꾸지 않고 이유를 알려요", () => {
  assert.match(planStayEnd(mk("a", 80_000, 3), "2026-10-25", TODAY).reason!, /빨라요/);
  assert.match(planStayEnd(mk("a", 80_000, 3, "2026-10-25", { checkedOutAt: "2026-10-27T01:00:00Z" }), null, TODAY).reason!, /퇴실/);
  assert.match(planStayEnd(mk("a", 80_000, 3, "2026-10-25", { stayMode: "long_stay" as never }), null, TODAY).reason!, /장기/);
  assert.equal(canSetStayEnd(mk("a", 80_000, 3)), true);
  assert.equal(canSetStayEnd(mk("a", 80_000, 3, "2026-10-25", { status: "cancelled" as never })), false);
});

test("요약 문장", () => {
  const ps = [planStayEnd(mk("a", 80_000, 15), null, TODAY), planStayEnd(mk("b", 80_000, 15), null, TODAY)];
  assert.equal(stayEndSummary(null, ps), "퇴실 미정으로 바꿈 (2실)");
  assert.equal(stayEndSummary("2026-11-09", ps), "퇴실일 11/09로 바꿈 (2실)");
});

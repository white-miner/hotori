// 기간 연장·단체 한 잔액. 결제는 객실·박에 나누지 않습니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, type Booking } from "./ledger";
import type { Payment } from "./payment";
import { groupFolio } from "./folio";
import { paymentDeskGlance } from "./paymentDesk";
import { nowDueAmount } from "./nowboard";
import { nowNightRange } from "./nowboard";
import { emptyGroupInfo, type GroupInfo } from "./settle";
import { extendMemo, extendWriteLines, inHouseMember, planGroupPeriodExtend } from "./groupExtend";
import { receiptPlan } from "./receipt";

const onsite = { name: "현장", onsite: true as const };
const ota = { name: "야놀자" };
let seq = 0;
const pay = (amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `p${++seq}`, bookingId: "", kind: "balance", method: "card", amount, bizDate: "2026-11-19", createdAt: "2026-11-19T01:00:00Z", ...extra,
});

function room(id: string, per: number, nights: number, checkIn: string, extra: Partial<Booking> = {}): Booking {
  const nightsMap = Object.fromEntries(Array.from({ length: nights }, (_, i) => [addDays(checkIn, i), per]));
  return {
    id, kind: "stay", status: "active", platformId: "walk", price: per * nights, guestName: "단체",
    typeId: "s", roomId: id, checkIn, nights, startTime: null, endTime: null, arrived: true, memo: null,
    cancelledAt: null, createdAt: "", updatedAt: "2026-11-19T00:00:00Z", groupId: "g",
    nightRates: { flat: per, nights: nightsMap }, payments: [], ...extra,
  } as Booking;
}

const info = (payments: Payment[] = [], payMode: GroupInfo["payMode"] = "postpaid"): GroupInfo => ({
  ...emptyGroupInfo("g"), payMode, payments,
});

test("70,000원 객실과 80,000원 객실을 3박에서 10박으로 연장하면 새 박은 각 객실 금액", () => {
  const today = "2026-11-19";
  const a = room("a", 70_000, 3, "2026-11-17");
  const b = room("b", 80_000, 3, "2026-11-17");
  const plan = planGroupPeriodExtend({
    all: [a, b], members: [a, b], selected: new Set(["a", "b"]), mode: { kind: "plus", add: 7 }, today,
  });
  assert.equal(plan.ready.length, 2);
  const ra = plan.rooms.find((r) => r.bookingId === "a")!;
  const rb = plan.rooms.find((r) => r.bookingId === "b")!;
  assert.equal(ra.toNights, 10);
  assert.equal(rb.toNights, 10);
  const addedA = ra.lines.filter((l) => l.date > "2026-11-19");
  const addedB = rb.lines.filter((l) => l.date > "2026-11-19");
  assert.equal(addedA.length, 7);
  assert.ok(addedA.every((l) => l.amount === 70_000 && l.proposed));
  assert.ok(addedB.every((l) => l.amount === 80_000 && l.proposed));
  assert.equal(ra.extensionCharge, 70_000 * 7);
  assert.equal(rb.extensionCharge, 80_000 * 7);
  assert.equal(plan.extensionCharge, 70_000 * 7 + 80_000 * 7);
  assert.notEqual(addedA[0]!.amount, addedB[0]!.amount);
  const lines = extendWriteLines([a, b], plan.ready);
  assert.equal(lines[0]!.night_rates!.nights!["2026-11-17"], 70_000);
  assert.equal(lines[1]!.night_rates!.nights!["2026-11-26"], 80_000);
  assert.equal(extendMemo(plan.ready), "기간 연장 (11/20~11/26)");
});

test("카드 한 건은 단체 한 줄이고 머리글·데스크·대표 칸의 미수금이 같다", () => {
  const today = "2026-11-19";
  const members = [room("a", 70_000, 3, "2026-11-17"), room("b", 80_000, 3, "2026-11-17")];
  const card = pay(450_000);
  const g = info([card]);
  const folio = groupFolio(members, 450_000, 0, { onsite: true, payMode: "postpaid" }, today);
  const desk = paymentDeskGlance(members, onsite, g, today);
  const lead = nowDueAmount(members[0]!, onsite, { members, info: g }, today, true);
  const other = nowDueAmount(members[1]!, onsite, { members, info: g }, today, false);
  assert.equal(folio.label, desk.label);
  assert.equal(folio.owed, desk.left);
  assert.equal(lead, folio.owed);
  assert.equal(other, 0);
  assert.equal(folio.paid, 450_000);
  assert.equal(g.payments.length, 1);
  assert.equal(members.every((m) => (m.payments ?? []).length === 0), true);
});

test("나중에 추가한 객실은 자기 요금만 더하고 기존 객실 요금은 그대로", () => {
  const today = "2026-11-19";
  const base = [room("a", 70_000, 3, "2026-11-17"), room("b", 80_000, 3, "2026-11-17")];
  const before = groupFolio(base, 0, 0, { onsite: true, payMode: "postpaid" }, today);
  const added = room("c", 90_000, 2, "2026-11-18");
  const after = groupFolio([...base, added], 0, 0, { onsite: true, payMode: "postpaid" }, today);
  assert.equal(after.rooms.find((r) => r.bookingId === "a")!.subtotal, before.rooms.find((r) => r.bookingId === "a")!.subtotal);
  assert.equal(after.rooms.find((r) => r.bookingId === "c")!.subtotal, 180_000);
  assert.equal(after.due, before.due + 180_000);
});

test("기간과 맞지 않는 금액도 그대로 두고 잔액만 줄어든다", () => {
  const today = "2026-11-19";
  const members = [room("a", 70_000, 3, "2026-11-17")];
  const before = groupFolio(members, 0, 0, { onsite: true, payMode: "postpaid" }, today);
  const odd = 12_345;
  const plan = receiptPlan(before, { amount: odd, method: "card", bizDate: today, memo: "임의 금액" });
  assert.equal(plan.ok, true);
  assert.equal(plan.line?.amount, odd);
  const after = groupFolio(members, odd, 0, { onsite: true, payMode: "postpaid" }, today);
  assert.equal(after.paid, odd);
  assert.equal(after.owed, before.owed - odd);
  assert.equal(after.rooms[0]!.noted, 0);
});

test("연장 후 조기 퇴실해도 결제 줄은 그대로이고 지나지 않은 박 청구만 빠진다", () => {
  const today = "2026-11-19";
  const a = room("a", 70_000, 3, "2026-11-17");
  const b = room("b", 80_000, 3, "2026-11-17");
  const extended = planGroupPeriodExtend({ all: [a, b], members: [a, b], selected: new Set(["a", "b"]), mode: { kind: "plus", add: 7 }, today });
  const lines = extendWriteLines([a, b], extended.ready);
  const saved = [a, b].map((bk) => {
    const line = lines.find((l) => l.id === bk.id)!;
    return { ...bk, nights: line.nights, price: line.price, nightRates: line.night_rates };
  });
  const paid = extended.extensionCharge;
  const beforeLeave = groupFolio(saved, paid, 0, { onsite: true, payMode: "postpaid" }, today);
  const early = { ...saved[0]!, earlyOut: "2026-11-20", refund: 70_000 * 7, price: saved[0]!.price };
  const afterLeave = groupFolio([early, saved[1]!], paid, 0, { onsite: true, payMode: "postpaid" }, today);
  assert.ok(afterLeave.due < beforeLeave.due);
  assert.equal(afterLeave.paid, beforeLeave.paid);
  assert.equal(afterLeave.paid, paid);
});

test("퇴실 미정 객실이 섞여도 미수금은 전체 청구 − 결제이고 보드는 날짜~", () => {
  const today = "2026-11-19";
  const fixed = room("a", 70_000, 5, "2026-11-17");
  const open = room("b", 80_000, 4, "2026-11-17", { openEnded: true });
  const folio = groupFolio([fixed, open], 0, 0, { onsite: true, payMode: "postpaid" }, today);
  const all = 70_000 * 5 + 80_000 * 4;
  assert.equal(folio.due, all);
  assert.equal(folio.owed, all);
  assert.equal(nowNightRange(open).label.endsWith("~"), true);
  assert.equal(inHouseMember(open, today), true);
});

test("OTA 선결제 단체는 결제 줄 없이 데스크와 머리글이 같다", () => {
  const today = "2026-11-19";
  const members = [room("a", 70_000, 3, "2026-11-17", { platformId: "ya" }), room("b", 80_000, 3, "2026-11-17", { platformId: "ya" })];
  const g = info([], "prepaid");
  const folio = groupFolio(members, 0, 0, { onsite: false, payMode: "prepaid" }, today);
  const desk = paymentDeskGlance(members, ota, g, today);
  assert.equal(g.payments.length, 0);
  assert.equal(folio.ota, true);
  assert.equal(folio.owed, 0);
  assert.equal(folio.label, "OTA 선결제");
  assert.equal(desk.ota, true);
  assert.equal(desk.left, 0);
  assert.equal(desk.label, folio.label);
  const lead = nowDueAmount(members[0]!, ota, { members, info: g }, today, true);
  assert.equal(lead, 0);
});

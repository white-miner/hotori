// 기록 정정 · 결제 내역: 실제 사례 (10/25~10/27 3박 카드 690,000 [602·501·301] + 502호 추가 카드 80,000)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import type { Payment } from "./payment";
import { groupLedger } from "./groupLedger";
import { fixPaymentDeleteSummary, fixPaymentSummary, payClassOf, payLines, paymentCopyText, periodText, recordAdvisories, recordTimeline, type TimelineBooking } from "./recordTimeline";

let n = 0;
const pay = (p: Partial<Payment> & { amount: number }): Payment => ({
  id: `p${++n}`, bookingId: "", kind: "balance", method: "card", bizDate: "2026-10-25", createdAt: `2026-10-25T01:00:${String(n).padStart(2, "0")}Z`, ...p,
});
const room = (id: string, no: string, checkIn: string, count: number, price: number, extra: Partial<Booking> = {}): Booking =>
  ({ id, kind: "stay", status: "active", platformId: "p", price, guestName: "단체 손님", typeId: "t", roomId: no, checkIn, nights: count, startTime: null, endTime: null, arrived: true, earlyOut: null, refund: null, payments: [], checkedOutAt: null, stayMode: null, priceUnset: false, nightRates: null, ...extra }) as unknown as Booking;
const names: Record<string, string> = { r602: "602호", r501: "501호", r301: "301호", r502: "502호", r608: "608호", r511: "511호" };
const roomName = (id: string | null | undefined) => (id ? names[id] ?? id : "");

const lump = pay({ id: "lump", groupId: "g1", amount: 690_000 });
const p502 = pay({ id: "p502", bookingId: "b502", amount: 80_000, bizDate: "2026-10-26", createdBy: "u-me" });
const members = () => [
  room("b602", "r602", "2026-10-25", 3, 230_000),
  room("b501", "r501", "2026-10-25", 3, 230_000),
  room("b301", "r301", "2026-10-25", 3, 230_000),
  room("b502", "r502", "2026-10-26", 1, 80_000, { payments: [p502] }),
];

test("실제 사례: 단체 몫 69만 + 502호 8만 = 결제 77만, 미수금 0, 10/27까지 결제 완료", () => {
  const led = groupLedger(members() as never, 690_000, "2026-10-27");
  assert.equal(led.paid, 770_000);
  assert.equal(led.due, 770_000);
  assert.equal(led.owed, 0);
  assert.equal(led.paidThrough, "2026-10-27");
});

test("결제 내역 줄: 결제일·객실·수단·금액·기간·구분·처리자", () => {
  const lines = payLines([lump, p502], { roomName: (id) => (id === "b502" ? "502호" : "?"), meId: "u-me" });
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0]!.scope, lines[0]!.method, lines[0]!.amount, lines[0]!.cls], ["단체 몫", "카드", 690_000, "잔금"]);
  assert.equal(lines[0]!.period, "기간 미지정 · 앞 박부터");
  assert.deepEqual([lines[1]!.scope, lines[1]!.by, lines[1]!.bizDate], ["502호", "나", "2026-10-26"]);
});

test("구분: 선수금 · 잔금 · 미수 수납", () => {
  assert.equal(payClassOf({ kind: "deposit", bizDate: "2026-10-20", nightDate: null, periodNights: null }), "선수금");
  assert.equal(payClassOf({ kind: "balance", bizDate: "2026-10-20", nightDate: "2026-10-25", periodNights: 3 }), "선수금");
  assert.equal(payClassOf({ kind: "balance", bizDate: "2026-10-25", nightDate: "2026-10-25", periodNights: 3 }), "잔금");
  assert.equal(payClassOf({ kind: "balance", bizDate: "2026-10-29", nightDate: "2026-10-25", periodNights: 3 }), "미수 수납");
  assert.equal(periodText({ nightDate: "2026-10-25", periodNights: 3 }), "10/25~10/27 · 3박");
});

test("타임라인: 입실 → 객실 추가 → 결제 → 퇴실 순서", () => {
  const rows = recordTimeline({ bookings: members() as TimelineBooking[], groupPayments: [lump], payments: (id) => (id === "b502" ? [p502] : []), roomName, today: "2026-10-27" });
  const kinds = rows.map((r) => `${r.date.slice(5)} ${r.kind}`);
  assert.deepEqual(kinds.slice(0, 5), ["10-25 checkin", "10-25 checkin", "10-25 checkin", "10-25 pay", "10-26 join"]);
  assert.equal(rows.find((r) => r.kind === "join")!.title, "객실 추가 · 502호");
  assert.ok(rows.some((r) => r.kind === "pay" && r.title === "결제 · 카드 80,000원"));
  assert.equal(rows.filter((r) => r.kind === "checkout").length, 4);
});

test("타임라인: 객실 이동은 이동 줄이 하나, 예정이면 future", () => {
  const b = room("b511", "r511", "2026-10-27", 3, 300_000, { segments: [{ roomId: "r511", nights: 1 }, { roomId: "r608", nights: 2 }] as never });
  const rows = recordTimeline({ bookings: [b as TimelineBooking], roomName, today: "2026-10-27" });
  const mv = rows.filter((r) => r.kind === "move");
  assert.equal(mv.length, 1);
  assert.equal(mv[0]!.title, "이동 · 511호 → 608호");
  assert.equal(mv[0]!.date, "2026-10-28");
  assert.equal(mv[0]!.future, true);
});

test("정정 문장: 바뀐 칸만 · 삭제 · 총합 보존 (객실로 옮겨도 합계는 그대로)", () => {
  const before = lump;
  const s = fixPaymentSummary(before, { bookingId: "b602", groupId: null, kind: "balance", method: "cash", amount: 230_000, bizDate: "2026-10-26", nightDate: "2026-10-25", periodNights: 3 }, () => "602호");
  assert.match(s, /^기록 정정 · 결제 수정/);
  assert.match(s, /금액 690,000 → 230,000원/);
  assert.match(s, /수단 카드 → 현금/);
  assert.match(s, /대상 단체 몫 → 602호/);
  assert.match(s, /기간 미지정 → 10\/25~10\/27 · 3박/);
  assert.match(fixPaymentDeleteSummary(p502, () => "502호"), /결제 삭제: 카드 80,000원 \(10\/26\) · 502호/);
  // 단체 몫을 객실 줄로 바꾸면 장부 합계는 그대로
  const moved = { ...lump, groupId: null, bookingId: "b602", nightDate: "2026-10-25", periodNights: 3, amount: 690_000 } as Payment;
  const m = members();
  m[0] = { ...m[0]!, payments: [moved] } as never;
  assert.equal(groupLedger(m as never, 0, "2026-10-27").paid, 770_000);
});

test("복사용 문장에 결제 합계·미수금·결제 완료가 들어가요", () => {
  const led = groupLedger(members() as never, 690_000, "2026-10-27");
  const t = paymentCopyText("단체 손님", payLines([lump, p502], { roomName: () => "502호" }), led);
  assert.match(t, /^단체 손님 · 결제 내역/);
  assert.match(t, /결제 합계 770,000원/);
  assert.match(t, /미수금 없음/);
  assert.match(t, /결제 완료 ~10\/27/);
});

test("어긋남 안내: 숙박 밖 기간 · 단체 몫 미배분", () => {
  const bad = room("b1", "r602", "2026-10-25", 2, 100_000, { payments: [pay({ bookingId: "b1", amount: 100_000, nightDate: "2026-10-25", periodNights: 3 })] });
  const adv = recordAdvisories({ bookings: [bad as never], groupPayments: [lump], roomName });
  assert.equal(adv.length, 2);
  assert.match(adv[0]!, /기간이 숙박 기간 밖/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_BADGE, openStayFields, openStayHint, openStayNights } from "./openStay";
import { CELL_BADGE_LABEL } from "./cellBadges";
import { planOpenFollow } from "./extend";
import type { Booking } from "./ledger";

test("오늘 입실한 미정 숙박: 청구는 오늘 밤 1박 — 방 보호 일수는 박수에 안 들어가요", () => {
  assert.equal(openStayNights("2026-10-28", "2026-10-28", 1), 1);
  assert.equal(openStayNights("2026-10-28", "2026-10-28", 0), 1);
  assert.equal(openStayNights("2026-10-28", "2026-10-28", 7), 1);
});
test("지난 입실일이면 오늘 밤까지 이어서", () => {
  assert.equal(openStayNights("2026-10-25", "2026-10-28", 1), 4); // 10/25~10/28 4박 (10/29는 아직 안 지남)
});
test("앞으로 올 예약은 첫 밤만", () => {
  assert.equal(openStayNights("2026-11-03", "2026-10-28", 1), 1);
});
test("366박 상한을 안 넘어요", () => {
  assert.equal(openStayNights("2024-01-01", "2026-10-28", 30), 366);
});
test("배지는 ∞ 미정, 힌트에 결제 주기 말이 없어요", () => {
  assert.equal(CELL_BADGE_LABEL.openEnded, OPEN_BADGE);
  assert.doesNotMatch(openStayHint(1), /주마다|월마다|결제 주기 \d/);
  assert.deepEqual(openStayFields("2026-10-28", "2026-10-28", 2), { nights: 1, openEnded: true, holdAhead: 2 });
});
test("만든 미정 예약은 다음 날 앱이 오늘 밤까지 이어요 (§8 재사용)", () => {
  const f = openStayFields("2026-10-28", "2026-10-28", 1);
  const b = { id: "b", kind: "stay", status: "active", checkIn: "2026-10-28", nights: f.nights, price: 200_000, arrived: true, checkedOutAt: null, openEnded: true, holdAhead: 1, stayMode: "standard", roomId: "r1", typeId: "t", segments: null, nightRates: null, platformId: "p", guestName: "x" } as unknown as Booking;
  assert.equal(planOpenFollow(b, [b], "2026-10-28"), null, "이미 충분");
  const next = planOpenFollow(b, [b], "2026-10-30");
  assert.ok(next && next.plan.draft.nights === 3, "10/28~10/30 = 3박 (오늘 밤까지만)");
});

// ── 602 사례: 10/25 열린 숙박, 오늘 10/28 — 청구는 오늘 밤까지만, 방 보호는 방만 막아요 ──
import { holdNightsOf, legsOf, occupiesNight, type Booking as B2 } from "./ledger";
import { planStayEnd } from "./stayEndPlan";
const mk602 = (over: Partial<B2> = {}) => ({ id: "r602", kind: "stay", status: "active", checkIn: "2026-10-25", nights: 4, price: 4 * 110_000, arrived: true, checkedOutAt: null, openEnded: true, holdAhead: 1, stayMode: "standard", roomId: "r602", typeId: "t", segments: null, nightRates: null, platformId: "p", guestName: "x", ...over }) as unknown as B2;
test("602 사례: 10/25 열린 숙박 오늘 10/28 → 4박(10/28까지) · 5박(10/29)이 아니에요", () => {
  assert.equal(openStayNights("2026-10-25", "2026-10-28", 1), 4);
  const f = planOpenFollow(mk602({ nights: 1, price: 110_000 }), [], "2026-10-28")!;
  assert.equal(f.plan.draft.nights, 4);
  assert.equal(f.plan.draft.price, 440_000);
});
test("방 보호는 박수·요금에 안 들어가고 방만 N일 앞까지 막아요", () => {
  const b = mk602({ holdAhead: 2 });
  assert.equal(b.nights, 4);
  assert.equal(holdNightsOf(b), 2);
  assert.equal(occupiesNight(b, "2026-10-28"), true);
  assert.equal(occupiesNight(b, "2026-10-29"), true, "보호 1일째 막힘");
  assert.equal(occupiesNight(b, "2026-10-30"), true, "보호 2일째 막힘");
  assert.equal(occupiesNight(b, "2026-10-31"), false);
  assert.equal(legsOf(b).reduce((n, l) => n + l.nights, 0), 6);
  assert.equal(holdNightsOf(mk602({ openEnded: false })), 0);
  assert.equal(occupiesNight(mk602({ openEnded: false }), "2026-10-29"), false);
  assert.equal(occupiesNight(mk602({ holdAhead: 0 }), "2026-10-29"), false);
});
test("조기 퇴실이면 방 보호도 풀려요", () => {
  assert.equal(holdNightsOf(mk602({ earlyOut: "2026-10-27" })), 0);
});
test("퇴실 미정 다시 저장하면 이미 쌓인 보호 밤(5박)이 4박으로 줄어요 (사용자가 직접 정정)", () => {
  const over = mk602({ nights: 5, price: 5 * 110_000 });
  const p = planStayEnd(over, null, "2026-10-28");
  assert.equal(p.patch!.nights, 4);
  assert.equal(p.patch!.price, 440_000);
});

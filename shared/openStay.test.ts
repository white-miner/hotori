import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_BADGE, openStayFields, openStayHint, openStayNights } from "./openStay";
import { CELL_BADGE_LABEL } from "./cellBadges";
import { planOpenFollow } from "./extend";
import type { Booking } from "./ledger";

test("오늘 입실한 미정 숙박: 오늘 밤 + 방 보호 1일 = 2박", () => {
  assert.equal(openStayNights("2026-10-28", "2026-10-28", 1), 2);
  assert.equal(openStayNights("2026-10-28", "2026-10-28", 0), 1);
});
test("지난 입실일이면 오늘 밤까지 이어서", () => {
  assert.equal(openStayNights("2026-10-25", "2026-10-28", 1), 5);
});
test("앞으로 올 예약은 첫 밤 + 방 보호", () => {
  assert.equal(openStayNights("2026-11-03", "2026-10-28", 1), 2);
});
test("366박 상한을 안 넘어요", () => {
  assert.equal(openStayNights("2024-01-01", "2026-10-28", 30), 366);
});
test("배지는 ∞ 미정, 힌트에 결제 주기 말이 없어요", () => {
  assert.equal(CELL_BADGE_LABEL.openEnded, OPEN_BADGE);
  assert.doesNotMatch(openStayHint(1), /주마다|월마다|결제 주기 \d/);
  assert.deepEqual(openStayFields("2026-10-28", "2026-10-28", 2), { nights: 3, openEnded: true, holdAhead: 2 });
});
test("만든 미정 예약은 다음 날 앱이 오늘 밤까지 이어요 (§8 재사용)", () => {
  const f = openStayFields("2026-10-28", "2026-10-28", 1);
  const b = { id: "b", kind: "stay", status: "active", checkIn: "2026-10-28", nights: f.nights, price: 200_000, arrived: true, checkedOutAt: null, openEnded: true, holdAhead: 1, stayMode: "standard", roomId: "r1", typeId: "t", segments: null, nightRates: null, platformId: "p", guestName: "x" } as unknown as Booking;
  assert.equal(planOpenFollow(b, [b], "2026-10-28"), null, "이미 충분");
  const next = planOpenFollow(b, [b], "2026-10-30");
  assert.ok(next && next.plan.draft.nights >= 4);
});

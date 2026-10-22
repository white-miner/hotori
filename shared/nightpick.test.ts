import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedNightsForRoom,
  monthGrid,
  nextPaintedFromClick,
  nightPickGlance,
  nightPickSummary,
  orderNights,
  paintedNightsFromStay,
  rangeHitsBlocked,
  stayFromPaintedNights,
} from "./nightpick.ts";
import { type Booking, checkOut } from "./ledger.ts";

const bk = (p: Partial<Booking> & Pick<Booking, "id" | "checkIn" | "nights" | "roomId">): Booking => ({
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 0,
  guestName: "손님",
  typeId: "t",
  segments: null,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  ...p,
});

test("monthGrid dow: 일=0…토=6, 1일이 목요일이어도 정렬", () => {
  // 2026-10-01 = 목 (UTC). 예전 (dow0+i)%7 버그는 화·수에 sa/su가 붙음
  const cells = monthGrid("2026-10-01");
  assert.equal(cells[0].dow, 0, "첫 칸은 일요일");
  assert.equal(cells[0].date, "2026-09-27");
  const oct1 = cells.find((c) => c.date === "2026-10-01")!;
  assert.equal(oct1.dow, 4, "10/1 목");
  const sat = cells.find((c) => c.date === "2026-10-03")!;
  const sun = cells.find((c) => c.date === "2026-10-04")!;
  assert.equal(sat.dow, 6);
  assert.equal(sun.dow, 0);
  for (const c of cells) {
    const [y, m, d] = c.date.split("-").map(Number);
    assert.equal(c.dow, new Date(Date.UTC(y, m - 1, d)).getUTCDay(), c.date);
  }
});

test("monthGrid: 5주면 끝 out 주 잘라 35칸 (요약줄 위 빈 밴드 방지)", () => {
  // 2026-10: 1=목 · 31=토 → 5주만 필요 · 예전 42칸 6주는 visibility:hidden 한 줄
  const oct = monthGrid("2026-10-01");
  assert.equal(oct.length, 35);
  assert.ok(oct.some((c) => c.date === "2026-10-31" && c.inMonth));
  assert.equal(oct.slice(-7).every((c) => !c.inMonth), false);
  // 6주가 필요한 달(예: 2026-08, 1=토)은 42 유지
  const aug = monthGrid("2026-08-01");
  assert.equal(aug.length, 42);
});

test("11~21 칠함 → 11박 · 입 11 · 퇴 22", () => {
  const s = stayFromPaintedNights("2026-10-11", "2026-10-21");
  assert.deepEqual(s, { checkIn: "2026-10-11", nights: 11, stayEnd: "2026-10-22" });
  assert.equal(s.stayEnd, checkOut({ checkIn: s.checkIn, nights: s.nights }));
});

test("1박: 같은 날만 → 퇴실 다음날 아침", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-11", "2026-10-11"), {
    checkIn: "2026-10-11",
    nights: 1,
    stayEnd: "2026-10-12",
  });
});

test("11~12 → 2박 · 퇴 13", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-11", "2026-10-12"), {
    checkIn: "2026-10-11",
    nights: 2,
    stayEnd: "2026-10-13",
  });
});

test("역순 선택(끝→시작)도 같은 매핑", () => {
  assert.deepEqual(stayFromPaintedNights("2026-10-21", "2026-10-11"), stayFromPaintedNights("2026-10-11", "2026-10-21"));
  assert.deepEqual(orderNights("2026-10-21", "2026-10-11"), { firstNight: "2026-10-11", lastNight: "2026-10-21" });
});

test("클릭: fresh → 1밤 / 밖 → 확장 / 끝 → 축소 / Shift → 앵커 범위", () => {
  const painted = { firstNight: "2026-10-11", lastNight: "2026-10-13" };
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-20", { shiftKey: false, anchor: null, fresh: true }),
    { firstNight: "2026-10-20", lastNight: "2026-10-20" },
  );
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-15", { shiftKey: false, anchor: null, fresh: false }),
    { firstNight: "2026-10-11", lastNight: "2026-10-15" },
  );
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-09", { shiftKey: false, anchor: null, fresh: false }),
    { firstNight: "2026-10-09", lastNight: "2026-10-13" },
  );
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-11", { shiftKey: false, anchor: null, fresh: false }),
    { firstNight: "2026-10-12", lastNight: "2026-10-13" },
  );
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-13", { shiftKey: false, anchor: null, fresh: false }),
    { firstNight: "2026-10-11", lastNight: "2026-10-12" },
  );
  assert.equal(nextPaintedFromClick(painted, "2026-10-12", { shiftKey: false, anchor: null, fresh: false }), null);
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-18", { shiftKey: true, anchor: "2026-10-15", fresh: false }),
    { firstNight: "2026-10-15", lastNight: "2026-10-18" },
  );
  assert.deepEqual(
    nextPaintedFromClick(painted, "2026-10-08", { shiftKey: true, anchor: null, fresh: false }),
    { firstNight: "2026-10-08", lastNight: "2026-10-11" },
  );
});

test("클릭 20→21→22 한 밤씩 연박 확장", () => {
  let cur = nextPaintedFromClick(
    { firstNight: "2026-10-01", lastNight: "2026-10-01" },
    "2026-10-20",
    { shiftKey: false, anchor: null, fresh: true },
  )!;
  assert.deepEqual(cur, { firstNight: "2026-10-20", lastNight: "2026-10-20" });
  cur = nextPaintedFromClick(cur, "2026-10-21", { shiftKey: false, anchor: "2026-10-20", fresh: false })!;
  assert.deepEqual(cur, { firstNight: "2026-10-20", lastNight: "2026-10-21" });
  cur = nextPaintedFromClick(cur, "2026-10-22", { shiftKey: false, anchor: "2026-10-21", fresh: false })!;
  assert.deepEqual(cur, { firstNight: "2026-10-20", lastNight: "2026-10-22" });
});

test("stay ↔ paint 왕복", () => {
  const paint = paintedNightsFromStay("2026-10-11", 11);
  assert.deepEqual(paint, { firstNight: "2026-10-11", lastNight: "2026-10-21" });
  const back = stayFromPaintedNights(paint.firstNight, paint.lastNight);
  assert.equal(back.checkIn, "2026-10-11");
  assert.equal(back.nights, 11);
  assert.equal(back.stayEnd, "2026-10-22");
});

test("요약 카피", () => {
  assert.equal(nightPickSummary("2026-10-20", "2026-10-24"), "10/20 ~ 10/24 · 5박 6일");
  assert.equal(nightPickSummary("2026-10-11", "2026-10-21"), "10/11 ~ 10/21 · 11박 12일");
  assert.equal(nightPickSummary("2026-10-11", "2026-10-11"), "10/11 ~ 10/11 · 1박 2일");
  assert.equal(nightPickGlance("2026-10-11", "2026-10-21"), "11박 · 10/22 아침 퇴실");
});

test("막힌 밤 포함 구간은 거부", () => {
  const blocked = new Set(["2026-10-15"]);
  assert.equal(rangeHitsBlocked("2026-10-11", "2026-10-21", blocked), true);
  assert.equal(rangeHitsBlocked("2026-10-11", "2026-10-14", blocked), false);
  assert.equal(rangeHitsBlocked("2026-10-15", "2026-10-15", blocked), true);
});

test("객체실 막힌 밤: 다른 예약만 · 자기는 제외", () => {
  const me = bk({ id: "me", checkIn: "2026-10-11", nights: 3, roomId: "r1" });
  const other = bk({ id: "o1", checkIn: "2026-10-20", nights: 2, roomId: "r1" });
  const otherRoom = bk({ id: "o2", checkIn: "2026-10-12", nights: 5, roomId: "r2" });
  const set = blockedNightsForRoom([me, other, otherRoom], "r1", {
    excludeId: "me",
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(set.has("2026-10-11"), false); // 자기 예약
  assert.equal(set.has("2026-10-20"), true);
  assert.equal(set.has("2026-10-21"), true);
  assert.equal(set.has("2026-10-22"), false); // stayEnd 아침
  assert.equal(set.has("2026-10-12"), false); // 다른 방
});

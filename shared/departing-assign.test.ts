// 퇴실예정 객실 당일 배정·예약 · 연장 겹침은 extend 쪽
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  emptySettings,
  freeRooms,
  legConflicts,
  normalizeSettings,
} from "./ledger";
import { isDepartingStatus, nowFlags } from "./nowboard";

const S = () =>
  normalizeSettings({
    ...emptySettings(),
    types: [{ id: "s", name: "스탠다드" }],
    floors: [
      {
        id: "f6",
        name: "6층",
        buildingId: emptySettings().buildings[0].id,
        rooms: [{ id: "r601", no: "601", typeId: "s" }],
      },
    ],
  });

let n = 0;
const bk = (p: Partial<Booking> = {}): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r601",
  checkIn: "2026-10-21",
  nights: 1,
  startTime: null,
  endTime: null,
  arrived: true,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  segments: null,
  earlyOut: null,
  refund: null,
  checkedOutAt: null,
  ...p,
});

const stayTimes = { checkIn: "15:00", checkOut: "11:00" };
const clock = (time: string, wallDate: string) => ({ time, wallDate });

test("A1: 퇴실예정 601 · 오늘 입실 초안 → freeRooms·legConflicts 허용", () => {
  const departing = bk({ id: "dep", guestName: "나감", checkIn: "2026-10-21", nights: 1 });
  const f = nowFlags(departing, "2026-10-22", {
    stayTimes,
    clock: clock("10:00", "2026-10-22"),
  });
  assert.equal(f.kind, "departing");
  assert.equal(isDepartingStatus(f.kind), true);

  const draft = { id: "new", kind: "stay" as const, checkIn: "2026-10-22", nights: 1, startTime: null, endTime: null };
  assert.equal(freeRooms(S(), [departing], draft).has("r601"), true);
  assert.deepEqual(
    legConflicts([departing], { ...departing, id: "new", guestName: "새손님", checkIn: "2026-10-22", nights: 1 }),
    [],
  );
});

test("당일 입실이 마지막 점유 밤과 겹치면 막힘", () => {
  // 아직 숙박 중(마지막 밤) — 퇴실예정 아님
  const live = bk({ id: "live", checkIn: "2026-10-21", nights: 2 }); // stayEnd 23 · 22는 점유
  const draft = { id: "new", kind: "stay" as const, checkIn: "2026-10-22", nights: 1, startTime: null, endTime: null };
  assert.equal(freeRooms(S(), [live], draft).has("r601"), false);
  assert.equal(
    legConflicts([live], { ...live, id: "new", checkIn: "2026-10-22", nights: 1 }).length,
    1,
  );
});

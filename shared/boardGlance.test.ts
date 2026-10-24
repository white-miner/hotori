import assert from "node:assert/strict";
import { test } from "node:test";
import {
  glanceMapKindFromNow,
  glanceMapKindNow,
  glanceMapKindPlacement,
} from "./boardGlance";
import type { Booking } from "./ledger";

function bk(p: Partial<Booking> & Pick<Booking, "id" | "checkIn" | "nights" | "roomId">): Booking {
  return {
    kind: "stay",
    status: "active",
    platformId: "p",
    price: 100000,
    guestName: "손님",
    typeId: "t",
    startTime: null,
    endTime: null,
    arrived: false,
    memo: null,
    cancelledAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    segments: null,
    earlyOut: null,
    refund: null,
    checkedOutAt: null,
    ...p,
  };
}

test("glanceMapKindFromNow: lateOut → departing 묶음", () => {
  assert.equal(glanceMapKindFromNow("empty"), "empty");
  assert.equal(glanceMapKindFromNow("unassigned"), "empty");
  assert.equal(glanceMapKindFromNow("arriving"), "arriving");
  assert.equal(glanceMapKindFromNow("inhouse"), "inhouse");
  assert.equal(glanceMapKindFromNow("departing"), "departing");
  assert.equal(glanceMapKindFromNow("lateOut"), "departing");
});

test("glanceMapKindNow: 공실·숙박예약·숙박", () => {
  const night = "2026-10-22";
  const beforeIn = {
    stayTimes: { checkIn: "16:00", checkOut: "12:00", checkInMode: "auto" as const },
    clock: { wallDate: night, time: "15:00" },
  };
  assert.equal(glanceMapKindNow(null, night, beforeIn), "empty");
  assert.equal(
    glanceMapKindNow(bk({ id: "1", checkIn: night, nights: 2, roomId: "r1", arrived: false }), night, beforeIn),
    "arriving",
  );
  assert.equal(
    glanceMapKindNow(bk({ id: "2", checkIn: night, nights: 2, roomId: "r1", arrived: true }), night, beforeIn),
    "inhouse",
  );
});

test("glanceMapKindPlacement: 퇴실처리면 공실 · 새 점유 우선", () => {
  const night = "2026-10-22";
  const beforeIn = {
    stayTimes: { checkIn: "16:00", checkOut: "12:00", checkInMode: "auto" as const },
    clock: { wallDate: night, time: "15:00" },
  };
  const checkedOut = bk({
    id: "old",
    checkIn: night,
    nights: 1,
    roomId: "r1",
    arrived: true,
    checkedOutAt: "2026-10-22T03:00:00.000Z",
  });
  assert.equal(glanceMapKindPlacement([checkedOut], "r1", night, beforeIn), "empty");

  const next = bk({
    id: "new",
    checkIn: night,
    nights: 1,
    roomId: "r1",
    arrived: false,
  });
  assert.equal(glanceMapKindPlacement([checkedOut, next], "r1", night, beforeIn), "arriving");
});

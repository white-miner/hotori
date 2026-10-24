import { test } from "node:test";
import assert from "node:assert/strict";
import { stayEnd, type Booking } from "./ledger";
import { nowFlags } from "./nowboard";
import {
  EDIT_COPY,
  commitEditStayDates,
  editNightsClearsDeparting,
  nightsUpOpensExtendPanel,
} from "./bookingEdit";

const stay = { checkIn: "16:00", checkOut: "12:00", checkInMode: "auto" as const };
const clock = (time: string, wallDate: string) => ({ wallDate, time });

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `e${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 80000,
  guestName: "손님",
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-20",
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

test("EDIT_COPY · 연장 가로채기 금지", () => {
  assert.equal(EDIT_COPY, "수정하기");
  assert.equal(nightsUpOpensExtendPanel(), false);
});

test("edit 1박→2박: nights·stayEnd 커밋 · openExtend false", () => {
  const r = commitEditStayDates({ nextNights: 2, nextCheckIn: "2026-10-20" });
  assert.equal(r.nights, 2);
  assert.equal(r.checkIn, "2026-10-20");
  assert.equal(r.stayEnd, "2026-10-22");
  assert.equal(r.openExtend, false);
  assert.equal(stayEnd({ kind: "stay", checkIn: r.checkIn, nights: r.nights, earlyOut: null }), "2026-10-22");
});

test("edit 입실 이동 + 박수: stayEnd 따라감", () => {
  const r = commitEditStayDates({ nextNights: 3, nextCheckIn: "2026-10-19" });
  assert.equal(r.stayEnd, "2026-10-22");
  assert.equal(r.openExtend, false);
});

test("1박→2박 수정 후 당일 퇴실예정 해제 (보드)", () => {
  const boardDate = "2026-10-21";
  const prev = bk({ checkIn: "2026-10-20", nights: 1, arrived: true });
  assert.equal(stayEnd(prev), boardDate);
  assert.equal(
    nowFlags(prev, boardDate, { stayTimes: stay, clock: clock("06:00", boardDate) }).kind,
    "departing",
  );

  const committed = commitEditStayDates({ nextNights: 2, nextCheckIn: prev.checkIn });
  assert.equal(editNightsClearsDeparting({ prev, nextNights: 2, boardDate }), true);
  const after = bk({ ...prev, nights: committed.nights, checkIn: committed.checkIn });
  assert.equal(stayEnd(after), "2026-10-22");
  assert.equal(
    nowFlags(after, boardDate, { stayTimes: stay, clock: clock("06:00", boardDate) }).kind,
    "inhouse",
  );
  assert.equal(
    nowFlags(after, boardDate, { stayTimes: stay, clock: clock("06:00", boardDate) }).label,
    "숙박",
  );
});

test("create와 동일: nights↑도 연장 패널 안 염", () => {
  // 정책 함수만 — UI applyStayNights는 이 값을 따름
  assert.equal(nightsUpOpensExtendPanel(), false);
  const r = commitEditStayDates({ nextNights: 5, nextCheckIn: "2026-10-18" });
  assert.equal(r.openExtend, false);
  assert.equal(r.nights, 5);
});

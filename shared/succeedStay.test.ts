import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  emptySettings,
  normalizeSettings,
  stayEnd,
} from "./ledger";
import {
  CONNECT_ALIGN_WARN,
  CONNECT_STAY_COPY,
  applyConnect,
  canConnectCandidate,
  canConnectPrior,
  isContinuous,
  listConnectCandidates,
  planConnect,
  successorsOf,
} from "./succeedStay";

const S = () =>
  normalizeSettings({
    ...emptySettings(),
    types: [
      { id: "s", name: "스탠다드" },
      { id: "d", name: "디럭스" },
    ],
    floors: [
      {
        id: "f6",
        name: "6층",
        buildingId: emptySettings().buildings[0].id,
        rooms: [
          { id: "r601", no: "601", typeId: "s" },
          { id: "r602", no: "602", typeId: "d" },
        ],
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
  checkIn: "2026-10-25",
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

const stayTimes = { checkIn: "15:00", checkOut: "11:00", checkInMode: "auto" as const };
const nowOpts = { stayTimes, clock: { time: "10:00", wallDate: "2026-10-26" } };

test("copy", () => {
  assert.equal(CONNECT_STAY_COPY, "이 투숙에 연결");
});

test("canConnectPrior: 숙박·퇴실예정만", () => {
  const departing = bk({ id: "a", checkIn: "2026-10-25", nights: 1, arrived: true });
  assert.equal(canConnectPrior(departing, "2026-10-26", nowOpts), true);

  const empty = bk({ id: "e", roomId: null });
  assert.equal(canConnectPrior(empty, "2026-10-26", nowOpts), false);

  const out = bk({ id: "o", checkedOutAt: "2026-10-26T02:00:00Z" });
  assert.equal(canConnectPrior(out, "2026-10-26", nowOpts), false);
});

test("candidates: continuous unassigned first · different name OK", () => {
  const a = bk({ id: "a", guestName: "김A", checkIn: "2026-10-25", nights: 1 });
  const b = bk({
    id: "b",
    guestName: "이B",
    checkIn: "2026-10-26",
    nights: 2,
    roomId: null,
    arrived: false,
  });
  const c = bk({
    id: "c",
    guestName: "박C",
    checkIn: "2026-10-27",
    nights: 1,
    roomId: null,
    arrived: false,
  });
  assert.equal(canConnectCandidate(a, b), true);
  assert.equal(isContinuous(a, b), true);
  assert.equal(isContinuous(a, c), false);
  const list = listConnectCandidates(a, [a, b, c]);
  assert.equal(list[0].booking.id, "b");
  assert.equal(list[0].continuous, true);
  assert.equal(list[0].unassigned, true);
});

test("planConnect: same room · succeeds · payments untouched", () => {
  const a = bk({ id: "a", guestName: "김A", checkIn: "2026-10-25", nights: 1, price: 90000 });
  const b = bk({
    id: "b",
    guestName: "이B",
    checkIn: "2026-10-26",
    nights: 2,
    roomId: null,
    price: 180000,
    arrived: false,
    payments: [{ id: "p1", bookingId: "b", kind: "deposit", method: "card", amount: 50000, bizDate: "2026-10-26", createdAt: "" }],
  });
  const plan = planConnect(S(), [a, b], a, b, { today: "2026-10-26", nowOpts });
  assert.ok(!("err" in plan));
  if ("err" in plan) return;
  const saved = applyConnect(plan);
  assert.equal(saved.roomId, "r601");
  assert.equal(saved.succeedsBookingId, "a");
  assert.equal(saved.guestName, "이B");
  assert.equal(saved.checkIn, stayEnd(a));
  assert.equal(saved.price, 180000);
  assert.equal(saved.payments?.length, 1);
  assert.equal(a.price, 90000);
  assert.equal(plan.typeMismatch, false);
});

test("planConnect: non-continuous needs align", () => {
  const a = bk({ id: "a", checkIn: "2026-10-25", nights: 1 });
  const b = bk({
    id: "b",
    guestName: "이B",
    checkIn: "2026-10-28",
    nights: 1,
    roomId: null,
    arrived: false,
  });
  const blocked = planConnect(S(), [a, b], a, b, { today: "2026-10-26", nowOpts });
  assert.ok("err" in blocked);
  if ("err" in blocked) assert.equal(blocked.err, CONNECT_ALIGN_WARN);

  const ok = planConnect(S(), [a, b], a, b, { alignCheckIn: true, today: "2026-10-26", nowOpts });
  assert.ok(!("err" in ok));
  if ("err" in ok) return;
  assert.equal(ok.draft.checkIn, "2026-10-26");
  assert.equal(ok.draft.alignedCheckIn, true);
});

test("planConnect: third booking clash hard block", () => {
  const a = bk({ id: "a", checkIn: "2026-10-25", nights: 1 });
  const other = bk({ id: "x", guestName: "다른", checkIn: "2026-10-26", nights: 2, roomId: "r601" });
  const b = bk({
    id: "b",
    guestName: "이B",
    checkIn: "2026-10-26",
    nights: 2,
    roomId: null,
    arrived: false,
  });
  const plan = planConnect(S(), [a, other, b], a, b, { today: "2026-10-26", nowOpts });
  assert.ok("err" in plan);
});

test("planConnect: type mismatch flag", () => {
  const a = bk({ id: "a", checkIn: "2026-10-25", nights: 1, roomId: "r601", typeId: "s" });
  const b = bk({
    id: "b",
    guestName: "이B",
    checkIn: "2026-10-26",
    nights: 1,
    roomId: null,
    typeId: "d",
    arrived: false,
  });
  const plan = planConnect(S(), [a, b], a, b, { today: "2026-10-26", nowOpts });
  assert.ok(!("err" in plan));
  if ("err" in plan) return;
  assert.equal(plan.typeMismatch, true);
});

test("successorsOf", () => {
  const a = bk({ id: "a" });
  const b = bk({ id: "b", succeedsBookingId: "a", roomId: null });
  assert.deepEqual(
    successorsOf("a", [a, b]).map((x) => x.id),
    ["b"],
  );
});

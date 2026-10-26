import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSubsForNight,
  hasSubsForNight,
  normalizeOverbookSubs,
  planOverbookSubs,
  qtyGivenTo,
  qtyTakenFrom,
  setSubsForNight,
  subsForNight,
} from "./overbookSub";
import { normalizeSettings, stockTable, type Booking } from "./ledger";

const DATE = "2026-10-26";

test("normalizeOverbookSubs: drop bad · skip self · clamp", () => {
  const list = normalizeOverbookSubs([
    { id: "a", date: DATE, overTypeId: "twin", fromTypeId: "dx", qty: 2, createdAt: "t" },
    { id: "b", date: "bad", overTypeId: "twin", fromTypeId: "dx", qty: 1 },
    { id: "c", date: DATE, overTypeId: "twin", fromTypeId: "twin", qty: 1 },
    { id: "a", date: DATE, overTypeId: "x", fromTypeId: "y", qty: 9 }, // dup id
    { id: "d", date: DATE, overTypeId: "twin", fromTypeId: "dx", qty: 0 },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 2);
});

test("set/clear · qty helpers", () => {
  let list = setSubsForNight(
    [],
    "twin",
    DATE,
    [
      { fromTypeId: "dx", qty: 2 },
      { fromTypeId: "fam", qty: 0 },
    ],
    "2026-10-26T00:00:00Z",
  );
  assert.equal(subsForNight(list, "twin", DATE).length, 1);
  assert.equal(qtyGivenTo(list, "twin", DATE), 2);
  assert.equal(qtyTakenFrom(list, "dx", DATE), 2);
  assert.equal(hasSubsForNight(list, "twin", DATE), true);
  list = clearSubsForNight(list, "twin", DATE);
  assert.equal(list.length, 0);
});

test("planOverbookSubs: spare + need caps", () => {
  const spare = new Map([
    ["dx", 2],
    ["fam", 1],
  ]);
  const ok = planOverbookSubs({
    overTypeId: "twin",
    date: DATE,
    overRem: -2,
    spareByType: spare,
    allocs: [{ fromTypeId: "dx", qty: 2 }],
  });
  assert.ok("ok" in ok);
  const tooMany = planOverbookSubs({
    overTypeId: "twin",
    date: DATE,
    overRem: -2,
    spareByType: spare,
    allocs: [{ fromTypeId: "dx", qty: 3 }],
  });
  assert.ok("err" in tooMany);
  const overNeed = planOverbookSubs({
    overTypeId: "twin",
    date: DATE,
    overRem: -2,
    spareByType: spare,
    allocs: [
      { fromTypeId: "dx", qty: 2 },
      { fromTypeId: "fam", qty: 1 },
    ],
  });
  assert.ok("err" in overNeed);
});

test("stockTable: substitute −qty · over +qty", () => {
  const s = normalizeSettings({
    types: [
      { id: "twin", name: "Twin" },
      { id: "dx", name: "Twin Deluxe" },
    ],
    floors: [
      {
        id: "f1",
        name: "1",
        buildingId: "b-main",
        rooms: [
          { id: "r1", no: "101", typeId: "twin" },
          { id: "r2", no: "102", typeId: "twin" },
          { id: "r3", no: "103", typeId: "twin" },
          { id: "r4", no: "104", typeId: "twin" },
          { id: "r5", no: "105", typeId: "twin" },
          { id: "r6", no: "106", typeId: "twin" },
          { id: "d1", no: "201", typeId: "dx" },
          { id: "d2", no: "202", typeId: "dx" },
          { id: "d3", no: "203", typeId: "dx" },
          { id: "d4", no: "204", typeId: "dx" },
        ],
      },
    ],
    overbookSubs: [
      {
        id: "obs1",
        date: DATE,
        overTypeId: "twin",
        fromTypeId: "dx",
        qty: 2,
        createdAt: "t",
      },
    ],
  });
  // Twin: 6 physical, 8 bookings → −2 raw; +2 relief → 0
  // Deluxe: 4 physical, 2 bookings → 2 spare; −2 → 0
  const bookings: Booking[] = [];
  for (let i = 0; i < 8; i++) {
    bookings.push({
      id: `b-t${i}`,
      kind: "stay",
      status: "active",
      platformId: "p",
      price: 0,
      guestName: `T${i}`,
      typeId: "twin",
      roomId: i < 6 ? `r${i + 1}` : null,
      checkIn: DATE,
      nights: 1,
      startTime: null,
      endTime: null,
      arrived: false,
      memo: null,
      cancelledAt: null,
      createdAt: "t",
      updatedAt: "t",
    });
  }
  for (let i = 0; i < 2; i++) {
    bookings.push({
      id: `b-d${i}`,
      kind: "stay",
      status: "active",
      platformId: "p",
      price: 0,
      guestName: `D${i}`,
      typeId: "dx",
      roomId: `d${i + 1}`,
      checkIn: DATE,
      nights: 1,
      startTime: null,
      endTime: null,
      arrived: false,
      memo: null,
      cancelledAt: null,
      createdAt: "t",
      updatedAt: "t",
    });
  }
  const raw = stockTable({ ...s, overbookSubs: [] }, bookings, [DATE]);
  assert.equal(raw.get("twin")!.get(DATE), -2);
  assert.equal(raw.get("dx")!.get(DATE), 2);
  const relieved = stockTable(s, bookings, [DATE]);
  assert.equal(relieved.get("twin")!.get(DATE), 0);
  assert.equal(relieved.get("dx")!.get(DATE), 0);
});

test("normalizeSettings: overbookSubs 보존", () => {
  const n = normalizeSettings({
    overbookSubs: [
      { id: "x", date: DATE, overTypeId: "a", fromTypeId: "b", qty: 1, createdAt: "t" },
    ],
  });
  assert.equal(n.overbookSubs.length, 1);
  assert.equal(n.overbookSubs[0].fromTypeId, "b");
});

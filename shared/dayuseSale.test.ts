import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSettings } from "./ledger";
import { buildDayuseSaleBooking, dayuseSalePlatformId, planDayuseSale, validateDayuseSale } from "./dayuseSale";

const s = normalizeSettings({
  buildings: [{ id: "b1", name: "본관" }],
  floors: [{ id: "f1", name: "6층", buildingId: "b1", rooms: [{ id: "r1", no: "601", typeId: "t1" }] }],
  types: [{ id: "t1", name: "S" }],
  platforms: [
    { id: "ota", name: "야놀자", abbr: "야" },
    { id: "walk", name: "현장·전화", abbr: "현", onsite: true },
  ],
  dayuseDefaults: { startTime: "13:00", endTime: "16:00", price: 40000 },
} as never);

test("dayuseSalePlatformId prefers onsite", () => {
  assert.equal(dayuseSalePlatformId(s), "walk");
});

test("planDayuseSale uses defaults-shaped input and optional collect", () => {
  const planned = planDayuseSale(s, {
    roomId: "r1",
    typeId: "t1",
    checkIn: "2026-10-22",
    startTime: "13:00",
    endTime: "16:00",
    price: 40000,
    guestName: "",
    platformId: "walk",
    collect: true,
    method: "card",
    bizDate: "2026-10-22",
  });
  assert.ok(!("err" in planned));
  assert.equal(planned.collectAmount, 40000);
  assert.equal(planned.method, "card");
  assert.match(planned.booking.guestName, /바로입실/);
  assert.equal(planned.booking.kind, "dayuse");
  assert.equal(planned.booking.arrived, true);
});

test("validateDayuseSale requires times", () => {
  const err = validateDayuseSale(s, {
    roomId: "r1",
    typeId: "t1",
    checkIn: "2026-10-22",
    startTime: "",
    endTime: "16:00",
    price: 0,
    guestName: "홍",
    platformId: "walk",
    collect: false,
    method: "card",
    bizDate: "2026-10-22",
  });
  assert.match(err ?? "", /이용 시간/);
});

test("buildDayuseSaleBooking sets room and times", () => {
  const b = buildDayuseSaleBooking(s, {
    roomId: "r1",
    typeId: "t1",
    checkIn: "2026-10-22",
    startTime: "12:00",
    endTime: "14:00",
    price: 10000,
    guestName: "테스트",
    platformId: "walk",
    collect: false,
    method: "cash",
    bizDate: "2026-10-22",
  });
  assert.equal(b.roomId, "r1");
  assert.equal(b.startTime, "12:00");
  assert.equal(b.guestName, "테스트");
});

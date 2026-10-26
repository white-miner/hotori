import assert from "node:assert/strict";
import { test } from "node:test";
import { hotelBizDisplayName, normalizeHotelBiz, normalizeSettings } from "./ledger";

test("normalizeHotelBiz: 빈·부분·절삭", () => {
  assert.deepEqual(normalizeHotelBiz(undefined), {
    businessName: "",
    businessNumber: "",
    address: "",
    phone: "",
    representative: "",
  });
  const n = normalizeHotelBiz({
    businessName: "  호토리호텔  ",
    businessNumber: "123-45-67890",
    address: "서울",
    phone: "02-123-4567",
    representative: "김대표",
    extra: "ignore",
  });
  assert.equal(n.businessName, "호토리호텔");
  assert.equal(n.businessNumber, "123-45-67890");
  assert.equal(n.representative, "김대표");
});

test("hotelBizDisplayName: 상호 비면 hotels.name", () => {
  assert.equal(hotelBizDisplayName(normalizeHotelBiz({}), "본관호텔"), "본관호텔");
  assert.equal(hotelBizDisplayName(normalizeHotelBiz({ businessName: "상호A" }), "본관호텔"), "상호A");
});

test("normalizeSettings: hotelBiz 보존", () => {
  const n = normalizeSettings({
    hotelBiz: { businessName: "A", businessNumber: "1", address: "x", phone: "y", representative: "z" },
  });
  assert.equal(n.hotelBiz.businessName, "A");
  assert.equal(n.hotelBiz.businessNumber, "1");
});

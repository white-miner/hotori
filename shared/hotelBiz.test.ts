import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hotelBizDisplayName,
  normalizeHotelBiz,
  normalizeSettings,
  stayConfirmDateRange,
  stayConfirmStrings,
  STAY_CONFIRM_COPY,
  STAY_CONFIRM_COPY_EN,
} from "./ledger";

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

test("stayConfirmStrings: ko/en titles + attest + amounts", () => {
  assert.equal(stayConfirmStrings("ko").title, STAY_CONFIRM_COPY);
  assert.equal(stayConfirmStrings("en").title, STAY_CONFIRM_COPY_EN);
  assert.match(stayConfirmStrings("en").attest, /certifies/i);
  assert.equal(stayConfirmStrings("ko").nights(2), "2박");
  assert.equal(stayConfirmStrings("en").nights(1), "1 night");
  assert.equal(stayConfirmStrings("en").nights(2), "2 nights");
  assert.equal(stayConfirmStrings("ko").sale, "판매가");
  assert.equal(stayConfirmStrings("en").paid, "Paid");
});

test("stayConfirmDateRange: EN ISO · KR dayLabel", () => {
  const koLabel = (d: string) => (d === "2026-10-20" ? "10/20(화)" : "10/22(목)");
  assert.equal(
    stayConfirmDateRange("ko", "2026-10-20", "2026-10-22", 2, koLabel),
    "10/20(화) ~ 10/22(목) · 2박",
  );
  assert.equal(
    stayConfirmDateRange("en", "2026-10-20", "2026-10-22", 2, koLabel),
    "2026-10-20 ~ 2026-10-22 · 2 nights",
  );
});

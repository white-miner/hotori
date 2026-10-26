import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOTEL_BIZ_GATE_COPY,
  hotelBizDisplayName,
  hotelBizIsReady,
  hotelBizMissingLabels,
  hotelBizUpjongUptaeLine,
  normalizeHotelBiz,
  normalizeSettings,
  printDateLabel,
  stayConfirmDateRange,
  stayConfirmStrings,
  STAY_CONFIRM_COPY,
  STAY_CONFIRM_COPY_EN,
} from "./ledger";

test("normalizeHotelBiz: 빈·부분·절삭 + upjong/uptae", () => {
  assert.deepEqual(normalizeHotelBiz(undefined), {
    businessName: "",
    businessNumber: "",
    address: "",
    phone: "",
    representative: "",
    upjong: "",
    uptae: "",
  });
  const n = normalizeHotelBiz({
    businessName: "  호토리호텔  ",
    businessNumber: "123-45-67890",
    address: "서울",
    phone: "02-123-4567",
    representative: "김대표",
    upjong: "  호텔  ",
    uptae: "숙박업",
    extra: "ignore",
  });
  assert.equal(n.businessName, "호토리호텔");
  assert.equal(n.businessNumber, "123-45-67890");
  assert.equal(n.representative, "김대표");
  assert.equal(n.upjong, "호텔");
  assert.equal(n.uptae, "숙박업");
});

test("hotelBizDisplayName: 상호 비면 hotels.name", () => {
  assert.equal(hotelBizDisplayName(normalizeHotelBiz({}), "본관호텔"), "본관호텔");
  assert.equal(hotelBizDisplayName(normalizeHotelBiz({ businessName: "상호A" }), "본관호텔"), "상호A");
});

test("normalizeSettings: hotelBiz 보존(업종·업태)", () => {
  const n = normalizeSettings({
    hotelBiz: {
      businessName: "A",
      businessNumber: "1",
      address: "x",
      phone: "y",
      representative: "z",
      upjong: "호텔",
      uptae: "숙박업",
    },
  });
  assert.equal(n.hotelBiz.businessName, "A");
  assert.equal(n.hotelBiz.businessNumber, "1");
  assert.equal(n.hotelBiz.upjong, "호텔");
  assert.equal(n.hotelBiz.uptae, "숙박업");
});

test("hotelBizIsReady / missing: 상호·사업자번호·업종·업태", () => {
  assert.equal(hotelBizIsReady(normalizeHotelBiz({}), ""), false);
  assert.deepEqual(hotelBizMissingLabels(normalizeHotelBiz({}), ""), ["상호", "사업자번호", "업종", "업태"]);
  // 상호 비어도 hotels.name 있으면 OK
  assert.deepEqual(
    hotelBizMissingLabels(normalizeHotelBiz({ businessNumber: "1", upjong: "호텔", uptae: "숙박업" }), "본관"),
    [],
  );
  assert.equal(
    hotelBizIsReady(normalizeHotelBiz({ businessNumber: "1", upjong: "호텔", uptae: "숙박업" }), "본관"),
    true,
  );
  assert.deepEqual(
    hotelBizMissingLabels(normalizeHotelBiz({ businessName: "A", businessNumber: "1", upjong: "호텔" }), ""),
    ["업태"],
  );
  // legacy JSON without upjong/uptae — no throw, fields missing
  assert.deepEqual(hotelBizMissingLabels({ businessName: "A", businessNumber: "1" } as never, ""), ["업종", "업태"]);
});

test("HOTEL_BIZ_GATE_COPY: lists missing fields · no 이(가) · settings hash", () => {
  const body = HOTEL_BIZ_GATE_COPY.body(["상호", "업태"]);
  assert.match(body, /· 상호/);
  assert.match(body, /· 업태/);
  assert.doesNotMatch(body, /이\(가\)/);
  assert.doesNotMatch(body, /상호·업태/);
  assert.equal(HOTEL_BIZ_GATE_COPY.settingsHash, "#/settings/hotel-biz");
  assert.equal(HOTEL_BIZ_GATE_COPY.confirmLabel, "설정으로 이동");
});

test("hotelBizUpjongUptaeLine", () => {
  const labels = { upjong: "업종", uptae: "업태" };
  assert.equal(hotelBizUpjongUptaeLine(normalizeHotelBiz({}), labels), "");
  assert.equal(
    hotelBizUpjongUptaeLine(normalizeHotelBiz({ upjong: "호텔", uptae: "숙박업" }), labels),
    "업종 호텔 · 업태 숙박업",
  );
  assert.equal(hotelBizUpjongUptaeLine(normalizeHotelBiz({ upjong: "호텔" }), labels), "업종 호텔");
});

test("stayConfirmStrings: ko/en titles + attest + amounts + upjong", () => {
  assert.equal(stayConfirmStrings("ko").title, STAY_CONFIRM_COPY);
  assert.equal(stayConfirmStrings("en").title, STAY_CONFIRM_COPY_EN);
  assert.match(stayConfirmStrings("en").attest, /certifies/i);
  assert.equal(stayConfirmStrings("ko").nights(2), "2박");
  assert.equal(stayConfirmStrings("en").nights(1), "1 night");
  assert.equal(stayConfirmStrings("en").nights(2), "2 nights");
  assert.equal(stayConfirmStrings("ko").sale, "판매가");
  assert.equal(stayConfirmStrings("en").paid, "Paid");
  assert.equal(stayConfirmStrings("ko").upjong, "업종");
  assert.equal(stayConfirmStrings("en").uptae, "Type of business");
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

test("printDateLabel: EN ISO · KR dayLabel", () => {
  const koLabel = (d: string) => (d === "2026-10-20" ? "10/20(화)" : d);
  assert.equal(printDateLabel("ko", "2026-10-20", koLabel), "10/20(화)");
  assert.equal(printDateLabel("en", "2026-10-20", koLabel), "2026-10-20");
});

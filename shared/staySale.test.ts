import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSettings } from "./ledger";
import { payState } from "./payment";
import {
  buildStaySaleDrafts,
  staySaleDraftSessionKey,
  staySaleNightsSummary,
  staySaleOtaPlatformId,
  staySaleOtaPlatforms,
  staySalePlatformId,
  staySalePlatformIdForMode,
  staySaleResolvePrice,
  validateStaySaleCreate,
} from "./staySale";

const s = normalizeSettings({
  buildings: [{ id: "b1", name: "본관" }],
  floors: [
    {
      id: "f1",
      name: "6층",
      buildingId: "b1",
      rooms: [
        { id: "r1", no: "601", typeId: "t1" },
        { id: "r2", no: "603", typeId: "t1" },
      ],
    },
  ],
  types: [{ id: "t1", name: "S" }],
  platforms: [
    { id: "walk", name: "현장·전화", abbr: "현", onsite: true },
    { id: "yanol", name: "야놀자", abbr: "야" },
    { id: "airbnb", name: "에어비앤비", abbr: "아" },
  ],
} as never);

test("staySalePlatformId prefers onsite · OTA helper prefers first non-onsite", () => {
  assert.equal(staySalePlatformId(s), "walk");
  assert.equal(staySaleOtaPlatformId(s), "yanol");
  assert.equal(staySalePlatformIdForMode(s, "onsite"), "walk");
  assert.equal(staySalePlatformIdForMode(s, "platform"), "yanol");
  assert.deepEqual(
    staySaleOtaPlatforms(s).map((p) => p.abbr),
    ["야", "아"],
  );
});

test("staySaleDraftSessionKey: stable across settings object churn (poll wipe guard)", () => {
  const a = staySaleDraftSessionKey(null, ["r1"]);
  const b = staySaleDraftSessionKey(undefined, ["r1"]);
  const c = staySaleDraftSessionKey(null, ["r1", "r2"]);
  const d = staySaleDraftSessionKey("bk1", ["r1"]);
  assert.equal(a, "new|r1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(d, "bk1|r1");
  // same rooms+booking → same key even if two settings objects differ by reference
  const s2 = normalizeSettings({ ...s, name: "other" } as never);
  assert.notEqual(s, s2);
  assert.equal(staySaleDraftSessionKey(null, ["r1"]), staySaleDraftSessionKey(null, ["r1"]));
});

test("staySaleNightsSummary: compact · 1박 / 같은달 연박 / 월넘김", () => {
  assert.equal(staySaleNightsSummary("2026-10-23", 1), "10/23 1박");
  assert.equal(staySaleNightsSummary("2026-10-23", 2), "10/23~24 2박");
  assert.equal(staySaleNightsSummary("2026-10-23", 4), "10/23~26 4박");
  assert.equal(staySaleNightsSummary("2026-10-30", 3), "10/30~11/1 3박");
});

test("staySaleResolvePrice: 총액 기본 · 박당×박 · 금액미정=0", () => {
  assert.equal(
    staySaleResolvePrice({ channel: "platform", salesMode: "total", total: 460000, perNight: 0, nights: 5 }),
    460000,
  );
  assert.equal(
    staySaleResolvePrice({ channel: "platform", salesMode: "perNight", total: 0, perNight: 90000, nights: 2 }),
    180000,
  );
  assert.equal(
    staySaleResolvePrice({
      channel: "platform",
      salesMode: "total",
      priceUnset: true,
      total: 460000,
      perNight: 0,
      nights: 5,
    }),
    0,
  );
  assert.equal(
    staySaleResolvePrice({ channel: "onsite", salesMode: "perNight", total: 100000, perNight: 50000, nights: 3 }),
    100000,
    "현장은 총액 필드 사용 (박당 무시)",
  );
});

test("플랫폼 저장: OTA platformId · phone 선택 · payState 잔금 없음", () => {
  const drafts = buildStaySaleDrafts(s, {
    roomIds: ["r1"],
    checkIn: "2026-10-23",
    nights: 2,
    guestName: "김OTA",
    guestPhone: "",
    guests: 2,
    price: 180000,
    platformId: "yanol",
    payMode: "postpaid",
    depAmt: "",
    depMethod: "card",
    bizDate: "2026-10-23",
  });
  assert.ok(!("err" in drafts));
  const b = drafts[0]!;
  assert.equal(b.platformId, "yanol");
  assert.equal(b.price, 180000);
  assert.equal(b.guestPhone, null);
  assert.equal(b.checkIn, "2026-10-23");
  assert.equal(b.nights, 2);
  const ota = s.platforms.find((p) => p.id === "yanol");
  const ps = payState(b, ota);
  assert.equal(ps.tracked, false);
  assert.equal(ps.left, 0);
});

test("플랫폼 빈 전화 허용 · 현장은 전화 필수", () => {
  assert.equal(
    validateStaySaleCreate(s, {
      roomIds: ["r1"],
      checkIn: "2026-10-23",
      nights: 1,
      guestName: "OTA",
      guestPhone: "",
      guests: 1,
      price: 90000,
      platformId: "yanol",
      payMode: "postpaid",
      depAmt: "",
      depMethod: "card",
      bizDate: "2026-10-23",
    }),
    null,
  );
  assert.match(
    validateStaySaleCreate(s, {
      roomIds: ["r1"],
      checkIn: "2026-10-23",
      nights: 1,
      guestName: "현장",
      guestPhone: "",
      guests: 1,
      price: 90000,
      platformId: "walk",
      payMode: "postpaid",
      depAmt: "",
      depMethod: "card",
      bizDate: "2026-10-23",
    }) ?? "",
    /연락처/,
  );
});

test("현장 회귀: 선금 검증 · 호실 고정 draft", () => {
  const ok = buildStaySaleDrafts(s, {
    roomIds: ["r1"],
    checkIn: "2026-10-23",
    nights: 1,
    guestName: "홍길동",
    guestPhone: "01012345678",
    guests: 1,
    price: 100000,
    platformId: "walk",
    payMode: "deposit",
    depAmt: "30000",
    depMethod: "card",
    bizDate: "2026-10-23",
  });
  assert.ok(!("err" in ok));
  assert.equal(ok[0]!.roomId, "r1");
  assert.equal(ok[0]!.platformId, "walk");
});

test("다실 바로입실: 객실마다 자기 요금 · 총액 나누기·대장 몰아주기 없음 · 같은 groupId", () => {
  const base = {
    roomIds: ["r1", "r2"],
    checkIn: "2026-10-23",
    nights: 1,
    guestName: "김다실",
    guestPhone: "01012345678",
    guests: 2,
    price: 280000,
    platformId: "walk",
    payMode: "prepaid" as const,
    depAmt: "",
    depMethod: "card" as const,
    bizDate: "2026-10-23",
    walkInImmediate: true,
  };
  // 객실 요금 없이는 2실을 저장하지 않아요
  assert.ok("err" in buildStaySaleDrafts(s, base) || validateStaySaleCreate(s, base) != null);
  const drafts = buildStaySaleDrafts(s, {
    ...base,
    roomRates: [{ nights: { "2026-10-23": 100000 } }, { nights: { "2026-10-23": 180000 } }],
  });
  assert.ok(!("err" in drafts));
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]!.price, 100000);
  assert.equal(drafts[1]!.price, 180000);
  assert.equal(drafts[0]!.groupId, drafts[1]!.groupId);
  assert.ok(drafts[0]!.groupId);
  assert.equal(drafts[0]!.roomId, "r1");
  assert.equal(drafts[1]!.roomId, "r2");
  assert.equal(drafts[0]!.arrived, true);
  assert.equal(drafts[1]!.arrived, true);
});

test("바로입실: 현장·플랫폼 빈 이름·전화 OK · arrived", () => {
  const onsite = buildStaySaleDrafts(s, {
    roomIds: ["r1"],
    checkIn: "2026-10-23",
    nights: 1,
    guestName: "",
    guestPhone: "",
    guests: 1,
    price: 90000,
    platformId: "walk",
    payMode: "postpaid",
    depAmt: "",
    depMethod: "card",
    bizDate: "2026-10-23",
    walkInImmediate: true,
  });
  assert.ok(!("err" in onsite));
  assert.equal(onsite[0]!.arrived, true);
  assert.match(onsite[0]!.guestName, /바로입실/);
  assert.equal(onsite[0]!.guestPhone, null);

  const ota = buildStaySaleDrafts(s, {
    roomIds: ["r1"],
    checkIn: "2026-10-23",
    nights: 1,
    guestName: "",
    guestPhone: "",
    guests: 1,
    price: 90000,
    platformId: "yanol",
    payMode: "postpaid",
    depAmt: "",
    depMethod: "card",
    bizDate: "2026-10-23",
    walkInImmediate: true,
  });
  assert.ok(!("err" in ota));
  assert.equal(ota[0]!.arrived, true);
  assert.equal(ota[0]!.platformId, "yanol");

  // 저장하기(비바로입실): 현장 빈 전화 차단
  assert.match(
    validateStaySaleCreate(s, {
      roomIds: ["r1"],
      checkIn: "2026-10-23",
      nights: 1,
      guestName: "현장",
      guestPhone: "",
      guests: 1,
      price: 90000,
      platformId: "walk",
      payMode: "postpaid",
      depAmt: "",
      depMethod: "card",
      bizDate: "2026-10-23",
      walkInImmediate: false,
    }) ?? "",
    /연락처/,
  );
});

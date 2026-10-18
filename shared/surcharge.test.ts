// 인원 추가금: 밤마다 그 밤 방의 타입 · 금·토·특별일 요금 · 최대 인원은 경고만 · 예전 설정 호환
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, normalizeSettings } from "./ledger";
import { DEFAULT_TIERS, isPeakNight, normalizeTiers, shortWon, surchargeOf, typeGuests } from "./surcharge";

const S = normalizeSettings({
  types: [
    { id: "s", name: "S", baseGuests: 2, maxGuests: 3 },
    { id: "t", name: "T", baseGuests: 2, maxGuests: 4 },
    { id: "h", name: "독채", baseGuests: 4, maxGuests: 8, tierId: "house" },
  ],
  platforms: [{ id: "p", name: "현장", abbr: "현" }],
  floors: [{ id: "f2", name: "2층", rooms: [{ id: "r201", no: "201", typeId: "s" }, { id: "r202", no: "202", typeId: "t" }, { id: "rh", no: "펜션1", typeId: "h" }] }],
  specialDates: ["2026-10-21", "bad", "2026-10-21"],
});
const bk = (p: Partial<Booking>): Booking => ({
  id: "b", kind: "stay", status: "active", platformId: "p", price: 300000, guestName: "손님", typeId: "t", roomId: "r202",
  checkIn: "2026-10-23", nights: 3, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: "", updatedAt: "", segments: null, earlyOut: null, refund: null, ...p,
});

test("기본 설정: 등급 일반 1만/2만 · 독채 2만/3만, 특별일은 날짜만 한 번씩", () => {
  assert.deepEqual(normalizeSettings({}).surchargeTiers, DEFAULT_TIERS);
  assert.deepEqual(S.specialDates, ["2026-10-21"]);
  assert.deepEqual(normalizeTiers([{ id: "x", name: "펜션", weekday: "15000", weekend: -1 }]), [{ id: "x", name: "펜션", weekday: 15000, weekend: 0 }]);
  assert.deepEqual(typeGuests({}), { base: 2, max: 4 });
  assert.deepEqual(typeGuests({ baseGuests: 4, maxGuests: 2 }), { base: 4, max: 4 });
});

test("금·토 밤과 특별일은 주말 요금", () => {
  assert.equal(isPeakNight("2026-10-23"), true); // 금
  assert.equal(isPeakNight("2026-10-24"), true); // 토
  assert.equal(isPeakNight("2026-10-25"), false); // 일
  assert.equal(isPeakNight("2026-10-21", S.specialDates), true); // 특별일 수
});

test("T 4명 금·토·일 3박: 2만×2 ×2박 + 1만×2 = 100,000", () => {
  const x = surchargeOf(S, bk({}), 4);
  assert.equal(x.total, 100000);
  assert.equal(x.extra, 2);
  assert.equal(x.over, false);
  assert.equal(x.line, "추가 2명 · 100,000원 (금·토 2박 2만×2 · 일 1박 1만×2)");
});

test("예시 줄: 금 1박 2만×2 · 일 1박 1만×2 = 60,000", () => {
  // 금 밤은 T, 토 밤은 독채(기본 4명이라 추가 없음), 일 밤은 T
  const b = bk({ roomId: "r202", segments: [{ roomId: "r202", nights: 1 }, { roomId: "rh", nights: 1 }, { roomId: "r202", nights: 1 }] });
  const x = surchargeOf(S, b, 4);
  assert.equal(x.total, 60000);
  assert.equal(x.line, "추가 2명 · 60,000원 (금 1박 2만×2 · 일 1박 1만×2)");
});

test("객실 이동: 그 밤 방의 타입으로 계산 (S→독채, 6명)", () => {
  const b = bk({ checkIn: "2026-10-19", nights: 2, typeId: "s", roomId: "r201", segments: [{ roomId: "r201", nights: 1 }, { roomId: "rh", nights: 1 }] });
  const x = surchargeOf(S, b, 6);
  // 월 S: 4명 × 1만 = 40,000 · 화 독채: 2명 × 2만 = 40,000
  assert.deepEqual(x.nights.map((n) => [n.typeId, n.extra, n.rate]), [["s", 4, 10000], ["h", 2, 20000]]);
  assert.equal(x.total, 80000);
  assert.equal(x.max, 3); // S 최대 3명 → 경고
  assert.equal(x.over, true);
});

test("특별일 밤은 주말 요금, 방이 없으면 예약 타입", () => {
  const x = surchargeOf(S, bk({ roomId: null, checkIn: "2026-10-21", nights: 1 }), 3);
  assert.equal(x.total, 20000);
  assert.equal(x.line, "추가 1명 · 20,000원 (수 1박 2만×1)");
});

test("기본 인원 이하 · 인원 모름이면 0원", () => {
  assert.equal(surchargeOf(S, bk({}), 2).total, 0);
  assert.equal(surchargeOf(S, bk({}), null).total, 0);
  assert.equal(surchargeOf(S, bk({}), 2).line, "");
});

test("대실은 간단히: 평일 요금 × 추가 인원 한 번", () => {
  const x = surchargeOf(S, bk({ kind: "dayuse", nights: null, checkIn: "2026-10-24", startTime: "13:00", endTime: "17:00" }), 3);
  assert.equal(x.total, 10000);
  assert.equal(x.line, "추가 1명 · 10,000원 (토 대실 1만×1)");
});

test("최대 인원을 넘어도 계산은 해요 (경고만)", () => {
  const x = surchargeOf(S, bk({ typeId: "s", roomId: "r201", nights: 1, checkIn: "2026-10-19" }), 5);
  assert.equal(x.over, true);
  assert.equal(x.total, 30000);
});

test("금액 줄임말", () => {
  assert.equal(shortWon(20000), "2만");
  assert.equal(shortWon(15000), "1.5만");
  assert.equal(shortWon(5000), "5천");
  assert.equal(shortWon(12345), "12,345");
});

test("타입 안의 새 칸(기본·최대 인원, 등급)은 설정을 다시 불러와도 남아요", () => {
  const again = normalizeSettings(JSON.parse(JSON.stringify(S)));
  assert.equal(again.types[2].tierId, "house");
  assert.equal(again.types[0].maxGuests, 3);
});

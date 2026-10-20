// 1박 연장 · 박수/가격 경고 · 단체 연장
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, type HotelSettings, emptySettings, normalizeSettings } from "./ledger";
import {
  NIGHTS_PRICE_WARN,
  applyExtend,
  canExtend,
  extendBlock,
  groupMemberRate,
  nightRate,
  nightsChangedWithoutPrice,
  planExtend,
  planGroupExtend,
  repriceForNights,
  roomNightRate,
  stayAddons,
  unusedNightRefund,
} from "./extend";

let n = 0;
const bk = (p: Partial<Booking> = {}): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-18",
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
  ...p,
});

const S = (): HotelSettings =>
  normalizeSettings({
    ...emptySettings(),
    types: [{ id: "s", name: "스탠다드" }, { id: "t", name: "트윈" }],
    floors: [
      {
        id: "f6",
        name: "6층",
        buildingId: emptySettings().buildings[0].id,
        rooms: [
          { id: "r301", no: "301", typeId: "s" },
          { id: "r302", no: "302", typeId: "s" },
          { id: "r303", no: "303", typeId: "t" },
        ],
      },
    ],
  });

test("1박 단가: 1박은 판매가, 연박은 평균, 타입 요금 우선", () => {
  assert.equal(nightRate(bk({ price: 120000, nights: 1 })), 120000);
  assert.equal(nightRate(bk({ price: 300000, nights: 3 })), 100000);
  assert.equal(nightRate(bk({ price: 300000, nights: 3 }), 80000), 80000);
  assert.equal(NIGHTS_PRICE_WARN.length > 10, true);
});

test("연장 가능: 활성 숙박만, 중도 퇴실·대실·취소 불가", () => {
  assert.equal(canExtend(bk()), true);
  assert.equal(canExtend(bk({ earlyOut: "2026-10-19", nights: 3 })), false);
  assert.equal(canExtend(bk({ kind: "dayuse", nights: null })), false);
  assert.equal(canExtend(bk({ status: "cancelled" })), false);
  assert.equal(canExtend(bk({ nights: 90 })), false);
});

test("applyExtend: 박수+1 · 가격+단가 · fitSegments로 마지막 방 연장", () => {
  const b = bk({
    nights: 2,
    price: 200000,
    roomId: "r301",
    segments: [
      { roomId: "r301", nights: 1 },
      { roomId: "r302", nights: 1 },
    ],
  });
  const d = applyExtend(b, 90000);
  assert.equal(d.nights, 3);
  assert.equal(d.price, 290000);
  assert.equal(d.rate, 90000);
  assert.equal(d.checkOut, "2026-10-21");
  assert.equal(d.extraNight, "2026-10-20");
  assert.deepEqual(d.segments, [
    { roomId: "r301", nights: 1 },
    { roomId: "r302", nights: 2 },
  ]);
});

test("연장 막힘: 다음 밤에 같은 방 예약", () => {
  const me = bk({ id: "me", checkIn: "2026-10-18", nights: 1, roomId: "r301", price: 100000 });
  const other = bk({ id: "ot", checkIn: "2026-10-19", nights: 1, roomId: "r301", price: 100000 });
  assert.match(extendBlock(S(), [me, other], me, 100000)!, /301/);
  assert.equal(extendBlock(S(), [me], me, 100000), null);
});

test("수납 제안: collect면 단가만큼, 아니면 0 (잔금)", () => {
  const b = bk({ price: 100000, nights: 1 });
  assert.equal(planExtend(b, 100000, true).collectAmount, 100000);
  assert.equal(planExtend(b, 100000, false).collectAmount, 0);
  assert.equal(planExtend(b, 100000, true).draft.price, 200000);
});

test("박수↑·가격 미변경만 경고 (박수↓는 자동 재계산)", () => {
  const a = bk({ nights: 1, price: 100000 });
  const up = { ...a, nights: 2, price: 100000 };
  const upOk = { ...a, nights: 2, price: 200000 };
  const down = { ...a, nights: 20, price: 1400000 };
  const shrunk = { ...down, nights: 12, price: 1400000 };
  assert.equal(nightsChangedWithoutPrice(a, up), true);
  assert.equal(nightsChangedWithoutPrice(a, upOk), false);
  assert.equal(nightsChangedWithoutPrice(down, shrunk), false);
});

test("repriceForNights: 70,000×20 → 12박이면 840,000 · 가산분 유지", () => {
  const b = bk({ nights: 20, price: 1_400_000, typeId: "s", checkIn: "2026-10-01" });
  const r = repriceForNights(b, 12, 70_000);
  assert.equal(r.rate, 70_000);
  assert.equal(r.price, 840_000);
  assert.equal(r.addons, 0);
  const withAdd = bk({
    nights: 20,
    price: 1_410_000,
    extraFee: 10_000,
    kind: "stay",
    checkIn: "2026-10-01",
  });
  const r2 = repriceForNights(withAdd, 12);
  assert.equal(stayAddons(withAdd), 10_000);
  assert.equal(roomNightRate(withAdd), 70_000);
  assert.equal(r2.price, 840_000 + 10_000);
});

test("repriceForNights: 방별 flat · 행렬 축소는 뒤 밤 drop", () => {
  const nights: Record<string, number> = {};
  for (let i = 0; i < 3; i++) nights[`2026-10-${19 + i}`] = i === 0 ? 70_000 : 80_000;
  const b = bk({
    checkIn: "2026-10-19",
    nights: 3,
    price: 230_000,
    nightRates: { flat: 70_000, nights },
  });
  assert.equal(roomNightRate(b, 80_000), 70_000);
  const r = repriceForNights(b, 2);
  assert.equal(r.price, 150_000);
  assert.deepEqual(r.nightRates?.nights, { "2026-10-19": 70_000, "2026-10-20": 80_000 });
});

test("applyExtend: 밤 셀 추가 · 이중 가산 없음", () => {
  const b = bk({
    checkIn: "2026-10-19",
    nights: 1,
    price: 70_000,
    roomId: "r301",
    nightRates: { flat: 70_000, nights: { "2026-10-19": 70_000 } },
  });
  const d = applyExtend(b, 80_000);
  assert.equal(d.nights, 2);
  assert.equal(d.price, 150_000);
  assert.equal(d.nightRates?.nights?.["2026-10-20"], 80_000);
});

test("unusedNightRefund: 20박 중 12박 이용 → 미사용 8박 × 단가", () => {
  const b = bk({ checkIn: "2026-10-01", nights: 20, price: 1_400_000 });
  assert.equal(unusedNightRefund(b, "2026-10-13", 70_000), 560_000);
  assert.equal(1_400_000 - 560_000, 840_000);
});

test("단체 연장: 타입 요금으로 방마다 가산, 겹치면 막음", () => {
  const s = S();
  const m1 = bk({ id: "g1", groupId: "g", roomId: "r301", typeId: "s", nights: 1, price: 100000, checkIn: "2026-10-18" });
  const m2 = bk({ id: "g2", groupId: "g", roomId: "r302", typeId: "s", nights: 1, price: 100000, checkIn: "2026-10-18" });
  assert.equal(groupMemberRate(m1, { s: 70000 }), 70000);
  const ok = planGroupExtend(s, [m1, m2], [m1, m2], { s: 70000 });
  assert.ok("ok" in ok);
  if ("ok" in ok) {
    assert.equal(ok.ok.members.length, 2);
    assert.equal(ok.ok.totalRate, 140000);
    assert.equal(ok.ok.members[0].draft.nights, 2);
    assert.equal(ok.ok.members[0].draft.price, 170000);
  }
  const blocker = bk({ id: "x", checkIn: "2026-10-19", nights: 1, roomId: "r301" });
  const bad = planGroupExtend(s, [m1, m2, blocker], [m1, m2], { s: 70000 });
  assert.ok("err" in bad);
});

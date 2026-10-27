// 1박 연장 · 박수/가격 경고 · 단체 연장
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking, type HotelSettings, emptySettings, normalizeSettings } from "./ledger";
import {
  NIGHTS_PRICE_WARN,
  applyExtend,
  canExtend,
  extendBlock,
  extendOverlaps,
  groupMemberRate,
  nightRate,
  nightsChangedWithoutPrice,
  planExtend,
  planOpsExtend,
  planGroupExtend,
  planThroughToday,
  skippedNote,
  throughOverlaps,
  repriceForNights,
  isOpenFollowable,
  openFollowBlocked,
  planOpenFollow,
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

test("연장 가능: 활성 숙박만, 조기 퇴실·대실·취소 불가", () => {
  assert.equal(canExtend(bk()), true);
  assert.equal(canExtend(bk({ earlyOut: "2026-10-19", nights: 3 })), false);
  assert.equal(canExtend(bk({ kind: "dayuse", nights: null })), false);
  assert.equal(canExtend(bk({ status: "cancelled" })), false);
  assert.equal(canExtend(bk({ nights: 366 })), false);
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

test("연장 겹침: 하드블록 아님 · extendOverlaps로 경고 대상", () => {
  const me = bk({ id: "me", checkIn: "2026-10-18", nights: 1, roomId: "r301", price: 100000 });
  const other = bk({ id: "ot", checkIn: "2026-10-19", nights: 1, roomId: "r301", price: 100000 });
  assert.equal(extendBlock(S(), [me, other], me, 100000), null);
  assert.deepEqual(
    extendOverlaps([me, other], me, 100000).map((x) => x.id),
    ["ot"],
  );
  assert.deepEqual(extendOverlaps([me], me, 100000), []);
});

test("퇴실예정 턴오버 후 연장: 오늘 새 예약과 겹치면 overlaps", () => {
  // A 10/21 1박 → 10/22 아침 퇴실예정 · B 10/22 입실 · A가 1박연장하면 10/22 밤 겹침
  const a = bk({ id: "a", checkIn: "2026-10-21", nights: 1, roomId: "r301", price: 100000 });
  const b = bk({ id: "b", checkIn: "2026-10-22", nights: 1, roomId: "r301", price: 100000 });
  assert.equal(extendBlock(S(), [a, b], a, 100000), null);
  assert.deepEqual(
    extendOverlaps([a, b], a, 100000).map((x) => x.id),
    ["b"],
  );
});

test("수납 제안: collect면 단가만큼, 아니면 0 (잔금)", () => {
  const b = bk({ price: 100000, nights: 1 });
  assert.equal(planExtend(b, 100000, true).collectAmount, 100000);
  assert.equal(planExtend(b, 100000, false).collectAmount, 0);
  assert.equal(planExtend(b, 100000, true).draft.price, 200000);
});

test("ops 1박 연장: 카드=받기 · 후불=잔금 · 서비스=0원", () => {
  const b = bk({ price: 100000, nights: 1, checkIn: "2026-10-18" });
  const card = planOpsExtend(b, { rate: 90000, method: "card", bizDate: "2026-10-19" });
  assert.ok(!("err" in card));
  if (!("err" in card)) {
    assert.equal(card.draft.nights, 2);
    assert.equal(card.draft.price, 190000);
    assert.equal(card.collectAmount, 90000);
    assert.equal(card.payMethod, "card");
  }
  const deferred = planOpsExtend(b, { rate: 90000, method: "deferred", bizDate: "2026-10-19" });
  assert.ok(!("err" in deferred));
  if (!("err" in deferred)) {
    assert.equal(deferred.draft.price, 190000);
    assert.equal(deferred.collectAmount, 0);
    assert.equal(deferred.payMethod, null);
  }
  const service = planOpsExtend(b, { rate: 90000, method: "service", bizDate: "2026-10-19" });
  assert.ok(!("err" in service));
  if (!("err" in service)) {
    assert.equal(service.effectiveRate, 0);
    assert.equal(service.draft.price, 100000);
    assert.equal(service.draft.nights, 2);
    assert.equal(service.collectAmount, 0);
  }
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
  // 한 방만 겹치면 그 방만 건너뛰고 나머지는 연장해요
  const part = planGroupExtend(s, [m1, m2, blocker], [m1, m2], { s: 70000 });
  assert.ok("ok" in part);
  if ("ok" in part) {
    assert.deepEqual(part.ok.members.map((m) => m.id), ["g2"]);
    assert.equal(part.ok.totalRate, 70000);
    assert.deepEqual(part.ok.skipped.map((k) => k.id), ["g1"]);
    assert.match(skippedNote(s, part.ok.skipped), /301호/);
  }
  // 전부 못 하면 안내
  const none = planGroupExtend(s, [m1, blocker], [m1], { s: 70000 });
  assert.ok("err" in none);
});

test("단체 연장: 조기 퇴실·객실 이동한 방은 건너뛰고 나머지 연장", () => {
  const s = S();
  const a = bk({ id: "a", groupId: "g", roomId: "r301", nights: 2, price: 200000, checkIn: "2026-10-18" });
  const e = bk({ id: "e", groupId: "g", roomId: "r302", nights: 2, price: 200000, checkIn: "2026-10-18", earlyOut: "2026-10-19" });
  const r = planGroupExtend(s, [a, e], [a, e], { s: 100000 });
  assert.ok("ok" in r);
  if ("ok" in r) {
    assert.deepEqual(r.ok.members.map((m) => m.id), ["a"]);
    assert.deepEqual(r.ok.skipped, [{ id: "e", roomId: "r302", reason: "조기 퇴실" }]);
  }
});

test("오늘까지 연장: 퇴실일이 오늘 이전이면 오늘 밤까지 박수·가격을 늘림", () => {
  const b = bk({ checkIn: "2026-10-20", nights: 3, price: 270000 }); // ~10/23 퇴실
  const p = planThroughToday(b, "2026-10-27")!;
  assert.equal(p.add, 5); // 10/23~10/27 밤 5개
  assert.equal(p.draft.nights, 8);
  assert.equal(p.rate, 90000);
  assert.equal(p.draft.price, 270000 + 5 * 90000);
  assert.equal(p.checkOut, "2026-10-28");
  assert.equal(p.draft.rate, 450000);
});
test("오늘까지 연장: 오늘이 퇴실일이면 +1박, 아직 남았으면 null, 박별 요금은 마지막 박 기준, 366 상한", () => {
  const b = bk({ checkIn: "2026-10-26", nights: 2, price: 200000 });
  assert.equal(planThroughToday(b, "2026-10-28")!.add, 1);
  assert.equal(planThroughToday(b, "2026-10-27"), null);
  const r = bk({ checkIn: "2026-10-20", nights: 2, price: 150000, nightRates: { nights: { "2026-10-20": 50000, "2026-10-21": 100000 } } as never });
  assert.equal(planThroughToday(r, "2026-10-22")!.rate, 100000);
  assert.equal(planThroughToday(r, "2026-10-22", 80000)!.rate, 80000);
  const big = bk({ checkIn: "2025-01-01", nights: 360, price: 3600000 });
  const cap = planThroughToday(big, "2026-10-28")!;
  assert.equal(cap.draft.nights, 366);
  assert.equal(planThroughToday(bk({ nights: 366 }), "2030-01-01"), null);
});
test("오늘까지 연장: 같은 방 겹침은 안내용으로 찾아줌 · 조기 퇴실은 불가", () => {
  const b = bk({ checkIn: "2026-10-20", nights: 3, price: 270000 });
  const other = bk({ checkIn: "2026-10-25", nights: 2, roomId: "r301" });
  const p = planThroughToday(b, "2026-10-27")!;
  assert.deepEqual(throughOverlaps([b, other], b, p).map((x) => x.id), [other.id]);
  assert.equal(throughOverlaps([b], b, p).length, 0);
  assert.equal(planThroughToday(bk({ checkIn: "2026-10-20", nights: 3, earlyOut: "2026-10-21" }), "2026-10-27"), null);
});

// ── §8 열린 숙박 따라가기 ──

test("열린 숙박: 오늘 밤 + 버퍼까지 절대값으로 맞추고, 두 번 해도 같음 (멱등)", () => {
  const b = bk({ id: "o", checkIn: "2026-10-20", nights: 3, price: 300000, arrived: true, openEnded: true, holdAhead: 1 } as never);
  const f = planOpenFollow(b, [b], "2026-10-28")!;
  // 10/20 입실, 오늘 10/28 → 오늘 밤까지 9박 + 버퍼 1 = 10박
  assert.equal(f.plan.draft.nights, 10);
  assert.equal(f.ahead, 1);
  const after = { ...b, nights: f.plan.draft.nights, price: f.plan.draft.price } as Booking;
  assert.equal(planOpenFollow(after, [after], "2026-10-28"), null);
  // 동시에 연 두 번째 기기가 같은 옛 값에서 계산해도 같은 결과
  assert.equal(planOpenFollow(b, [b], "2026-10-28")!.plan.draft.nights, 10);
  // 다음 날은 +1박만
  assert.equal(planOpenFollow(after, [after], "2026-10-29")!.plan.add, 1);
});

test("열린 숙박: 버퍼 0이면 오늘 밤까지만 · 끈 숙박·미입실·퇴실은 따라가지 않음", () => {
  const b = bk({ id: "o", checkIn: "2026-10-25", nights: 1, price: 100000, arrived: true, openEnded: true, holdAhead: 0 } as never);
  assert.equal(planOpenFollow(b, [b], "2026-10-28")!.plan.draft.nights, 4);
  assert.equal(isOpenFollowable({ ...b, openEnded: false } as Booking), false);
  assert.equal(isOpenFollowable({ ...b, arrived: false } as Booking), false);
  assert.equal(isOpenFollowable({ ...b, checkedOutAt: "2026-10-26T02:00:00Z" } as Booking), false);
});

test("열린 숙박: 버퍼 밤에만 겹치면 버퍼를 줄이고, 오늘 밤도 겹치면 건드리지 않음 (T12)", () => {
  const b = bk({ id: "o", checkIn: "2026-10-25", nights: 1, price: 100000, arrived: true, openEnded: true, holdAhead: 3 } as never);
  const next = bk({ id: "n", guestName: "다음", checkIn: "2026-10-30", nights: 2, price: 200000 });
  const f = planOpenFollow(b, [b, next], "2026-10-28")!;
  // 10/28 밤까지(4박) 확보, 10/29는 비어 있으니 1일 버퍼(5박)까지만, 10/30은 겹침
  assert.equal(f.plan.draft.nights, 5);
  const now = bk({ id: "m", guestName: "오늘", checkIn: "2026-10-28", nights: 1, price: 100000 });
  assert.equal(planOpenFollow(b, [b, now], "2026-10-28"), null);
  assert.equal(openFollowBlocked(b, [b, now], "2026-10-28").length, 1);
  assert.equal(openFollowBlocked(b, [b, next], "2026-10-28").length, 0);
});

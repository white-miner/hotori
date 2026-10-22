// 대실↔숙박 겹침 경고 · 동일 손님 스킵 · 설정 기본값 (dayuse-with-stay-plan A1–A4 · A6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayuseByRoom,
  dayuseEndsAfter,
  dayuseStayOverlapWarn,
  normalizeGuestName,
  normalizeGuestPhone,
  sameDayuseGuest,
} from "./dayuseOverlap";
import { type Booking, normalizeSettings } from "./ledger";
import { DEFAULT_DAYUSE_DEFAULTS, normalizeDayuseDefaults } from "./tiers";

const S = normalizeSettings({
  stayTimes: { checkIn: "16:00", checkOut: "12:00" },
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [{ id: "f6", name: "6층", rooms: [{ id: "r601", no: "601", typeId: "s" }, { id: "r602", no: "602", typeId: "s" }] }],
});

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: `손님${n}`,
  guestPhone: "01012345678",
  typeId: "s",
  roomId: "r601",
  checkIn: "2026-10-22",
  nights: 1,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  segments: null,
  ...p,
});

test("A6: dayuseDefaults 없거나 잘못되면 14:00–17:00 · 0원", () => {
  assert.deepEqual(normalizeDayuseDefaults(undefined), DEFAULT_DAYUSE_DEFAULTS);
  assert.deepEqual(normalizeDayuseDefaults({ startTime: "99:99", endTime: "x", price: -1 }), DEFAULT_DAYUSE_DEFAULTS);
  assert.deepEqual(normalizeDayuseDefaults({ startTime: "13:00", endTime: "15:30", price: 50000 }), {
    startTime: "13:00",
    endTime: "15:30",
    price: 50000,
  });
  assert.deepEqual(normalizeSettings({} as never).dayuseDefaults, DEFAULT_DAYUSE_DEFAULTS);
});

test("동일 손님: 이름+전화 둘 다 · 한쪽만/비면 실패", () => {
  assert.equal(normalizeGuestName("  Kim  Park "), "kim park");
  assert.equal(normalizeGuestPhone("010-1234-5678"), "01012345678");
  assert.equal(
    sameDayuseGuest({ guestName: "홍길동", guestPhone: "010-1111-2222" }, { guestName: "홍길동", guestPhone: "01011112222" }),
    true,
  );
  assert.equal(
    sameDayuseGuest({ guestName: "홍길동", guestPhone: "01011112222" }, { guestName: "김철수", guestPhone: "01011112222" }),
    false,
  );
  assert.equal(
    sameDayuseGuest({ guestName: "홍길동", guestPhone: "01011112222" }, { guestName: "홍길동", guestPhone: "01099999999" }),
    false,
  );
  assert.equal(sameDayuseGuest({ guestName: "홍길동", guestPhone: "" }, { guestName: "홍길동", guestPhone: "" }), false);
  assert.equal(sameDayuseGuest({ guestName: "바로입실601", guestPhone: null }, { guestName: "바로입실601", guestPhone: null }), false);
});

test("dayuseEndsAfter: 끝 > 입실만 겹침 (같으면 허용)", () => {
  assert.equal(dayuseEndsAfter("14:00", "16:00", "16:00"), false);
  assert.equal(dayuseEndsAfter("14:00", "17:00", "16:00"), true);
  assert.equal(dayuseEndsAfter("22:00", "01:00", "16:00"), true);
});

test("A1: 대실 14–16 + 입실 16 → 팝업 없음", () => {
  const stay = bk({ guestName: "박숙박", guestPhone: "01099998888" });
  const draft = bk({
    id: "du",
    kind: "dayuse",
    nights: null,
    startTime: "14:00",
    endTime: "16:00",
    guestName: "이대실",
    guestPhone: "01011112222",
  });
  assert.equal(dayuseStayOverlapWarn(S, [stay], draft).ok, true);
});

test("A2: 대실 14–17 + 입실 16 → 팝업", () => {
  const stay = bk({ guestName: "박숙박", guestPhone: "01099998888" });
  const draft = bk({
    id: "du",
    kind: "dayuse",
    nights: null,
    startTime: "14:00",
    endTime: "17:00",
    guestName: "이대실",
    guestPhone: "01011112222",
  });
  const w = dayuseStayOverlapWarn(S, [stay], draft);
  assert.equal(w.ok, false);
  if (!w.ok) {
    assert.equal(w.checkInTime, "16:00");
    assert.match(w.message, /14:00~17:00/);
    assert.match(w.message, /숙박예약/);
  }
});

test("A3: 동일 이름+번호면 A2 상황도 팝업 없음", () => {
  const stay = bk({ guestName: "같은손님", guestPhone: "010-3333-4444" });
  const draft = bk({
    id: "du",
    kind: "dayuse",
    nights: null,
    startTime: "14:00",
    endTime: "17:00",
    guestName: "같은손님",
    guestPhone: "01033334444",
  });
  assert.equal(dayuseStayOverlapWarn(S, [stay], draft).ok, true);
});

test("A4: 같은 방 대실 시간 겹침은 freeRooms 하드블록 (여기선 경고 대상 아님)", () => {
  // dayuseStayOverlapWarn는 숙박만 봄 — 대실↔대실은 freeRooms
  const other = bk({ id: "du2", kind: "dayuse", nights: null, startTime: "15:00", endTime: "18:00", roomId: "r601" });
  const draft = bk({
    id: "du",
    kind: "dayuse",
    nights: null,
    startTime: "14:00",
    endTime: "17:00",
    guestName: "이대실",
    guestPhone: "01011112222",
  });
  assert.equal(dayuseStayOverlapWarn(S, [other], draft).ok, true);
});

test("연박 중간 낮: 항상 주의", () => {
  const stay = bk({ checkIn: "2026-10-20", nights: 3, arrived: true, guestName: "연박", guestPhone: "01055556666" });
  const draft = bk({
    id: "du",
    kind: "dayuse",
    checkIn: "2026-10-21",
    nights: null,
    startTime: "10:00",
    endTime: "12:00",
    guestName: "낮손님",
    guestPhone: "01077778888",
  });
  assert.equal(dayuseStayOverlapWarn(S, [stay], draft).ok, false);
});

test("빠른 입실 반영: 입실 14:00이면 14–16도 경고", () => {
  const stay = bk({ earlyIn: 2, guestName: "빠른", guestPhone: "01012121212" }); // 16−2=14:00
  const draft = bk({
    id: "du",
    kind: "dayuse",
    nights: null,
    startTime: "12:00",
    endTime: "15:00",
    guestName: "낮",
    guestPhone: "01034343434",
  });
  const w = dayuseStayOverlapWarn(S, [stay], draft);
  assert.equal(w.ok, false);
  if (!w.ok) assert.equal(w.checkInTime, "14:00");
});

test("dayuseByRoom: 당일 활성만 방별", () => {
  const a = bk({ id: "d1", kind: "dayuse", nights: null, startTime: "15:00", endTime: "17:00", roomId: "r601" });
  const b = bk({ id: "d2", kind: "dayuse", nights: null, startTime: "10:00", endTime: "12:00", roomId: "r601" });
  const c = bk({ id: "d3", kind: "dayuse", nights: null, startTime: "11:00", endTime: "13:00", roomId: "r602", status: "cancelled" });
  const m = dayuseByRoom([a, b, c], "2026-10-22");
  assert.deepEqual(
    (m.get("r601") ?? []).map((x) => x.id),
    ["d2", "d1"],
  );
  assert.equal(m.has("r602"), false);
});

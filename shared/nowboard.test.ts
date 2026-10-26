// 현장 현황 보드: 영업일 기준 상태 파생 · 옆 패널 분류 · 퇴실 윈도우 · 밤 구간 날짜 · 자동 입실
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import {
  canCheckOut,
  canEndDayuse,
  checkInTimeReached,
  checkoutMorningVisible,
  departingWindowOpen,
  effectiveArrived,
  filterUnassignedByCheckIn,
  isDepartingStatus,
  latestPaymentOf,
  listUnassignedBookings,
  nowAmountGlance,
  nowAmountTone,
  nowBoardVisible,
  nowByRoom,
  nowCheckoutMark,
  nowDateLine,
  nowFlags,
  nowLists,
  nowMetaLine,
  nowNightRange,
  nowLatestPayMethodLabel,
  nowPayMethodGlance,
  nowPayMethodPrefix,
  nowNightsDays,
  nowStayChips,
  nowStayHint,
  nowStayNightIndex,
  nowStaySummary,
  shouldAutoArrive,
  simplePayGlance,
  unassignedTypeCounts,
  type NowClock,
} from "./nowboard";
import { emptyGroupInfo } from "./settle";

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: "손님",
  typeId: "s",
  roomId: "r301",
  checkIn: "2026-10-19",
  nights: 2,
  startTime: null,
  endTime: null,
  arrived: false,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  segments: null,
  earlyOut: null,
  refund: null,
  checkedOutAt: null,
  ...p,
});

const clock = (time: string, wallDate = "2026-10-21"): NowClock => ({ wallDate, time });
const stay = { checkIn: "16:00", checkOut: "12:00", checkInMode: "auto" as const };
const onsite = { name: "현장", onsite: true };

test("지금 상태: 숙박예약 · 숙박 · 마지막 밤은 숙박(퇴실예정 아님)", () => {
  const date = "2026-10-19";
  const beforeIn = { stayTimes: stay, clock: clock("15:00", date) };
  assert.equal(nowFlags(bk({ arrived: false, checkIn: date }), date, beforeIn).kind, "arriving");
  assert.equal(nowFlags(bk({ arrived: false, checkIn: date }), date, beforeIn).label, "숙박예약");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 3 }), date).kind, "inhouse");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 3 }), date).label, "숙박");
  // 1박: 입실일 밤은 숙박, 퇴실 아침(다음날)에 퇴실예정
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), date).kind, "inhouse");
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), "2026-10-20", { stayTimes: stay, clock: clock("06:00", "2026-10-20") }).kind,
    "departing",
  );
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), "2026-10-20", { stayTimes: stay, clock: clock("06:00", "2026-10-20") }).label,
    "퇴실예정",
  );
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1, lateOut: 2 }), "2026-10-20", { stayTimes: stay, clock: clock("08:00", "2026-10-20") }).kind,
    "lateOut",
  );
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1, lateOut: 2 }), "2026-10-20", { stayTimes: stay, clock: clock("08:00", "2026-10-20") }).label,
    "늦은 퇴실",
  );
  assert.equal(isDepartingStatus("lateOut"), true);
  assert.equal(isDepartingStatus("departing"), true);
  assert.equal(isDepartingStatus("inhouse"), false);
  assert.equal(nowFlags(bk({ arrived: true, tentative: true, checkIn: date, nights: 3 }), date).tentative, true);
  assert.equal(nowFlags(bk({ arrived: true, noClean: true, checkIn: date, nights: 3 }), date).noClean, true);
  assert.equal(nowFlags(bk({ roomId: null, checkIn: date }), date).kind, "unassigned");
  assert.equal(nowFlags(null, date).kind, "empty");
  assert.equal(nowFlags(null, date).label, "공실");
  assert.equal(nowFlags(null, date).noClean, false);
});

test("2박 3일: 마지막 밤은 숙박, 퇴실 아침 06:00부터 퇴실예정 · 시각 경과 후에도 유지", () => {
  // 입 10/19 · 2박 · 퇴실 아침 10/21 · 보드 밤 19~20
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2 });
  assert.equal(nowFlags(b, "2026-10-19").kind, "inhouse");
  assert.equal(nowFlags(b, "2026-10-20").kind, "inhouse"); // 마지막 점유 밤 — 퇴실예정 아님
  assert.equal(nowBoardVisible(b, "2026-10-21"), true);
  assert.equal(checkoutMorningVisible(b, "2026-10-21"), true);
  assert.equal(
    nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("05:59", "2026-10-21") }).kind,
    "inhouse",
  );
  assert.equal(
    nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("06:00", "2026-10-21") }).kind,
    "departing",
  );
  assert.equal(
    nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("15:00", "2026-10-21") }).kind,
    "departing",
  ); // 미처리면 계속 퇴실예정 · 자동 공실 금지
  assert.equal(nowNightsDays(b).label, "2박");
  assert.equal(nowNightsDays(b).days, 3);
});

test("늦은 퇴실: lateOut 반영한 윈도우 · 라벨 우선(슬롯 하나)", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2, lateOut: 2 }); // 실제 퇴실 14:00 → 08:00부터
  assert.equal(departingWindowOpen(b, "2026-10-21", stay, clock("07:59", "2026-10-21")), false);
  assert.equal(departingWindowOpen(b, "2026-10-21", stay, clock("08:00", "2026-10-21")), true);
  assert.equal(
    nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("08:00", "2026-10-21") }).kind,
    "lateOut",
  );
});

test("퇴실처리 후 빈 칸 · 되돌리기 전제 · 당일 다음 예약은 숙박예약", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2, checkedOutAt: "2026-10-21T03:00:00.000Z" });
  assert.equal(nowBoardVisible(b, "2026-10-21"), false);
  assert.equal(nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("10:00", "2026-10-21") }).kind, "empty");
  assert.equal(nowByRoom([b], "2026-10-21").has("r301"), false);
  assert.equal(canCheckOut(bk({ arrived: true, checkIn: "2026-10-19", nights: 2 }), "2026-10-21"), true);
  assert.equal(canCheckOut(b, "2026-10-21"), false);
  // 대실 이용 종료는 숙박 퇴실축과 분리 · checkedOutAt만
  assert.equal(canEndDayuse(bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00" })), true);
  assert.equal(canEndDayuse(bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00", checkedOutAt: "2026-10-22T08:00:00Z" })), false);
  assert.equal(canEndDayuse(bk({ kind: "stay", arrived: true })), false);
  assert.equal(canCheckOut(bk({ kind: "dayuse", nights: null, startTime: "14:00", endTime: "17:00" }), "2026-10-22"), false);

  // 퇴실처리된 아침 + 당일 입실 다음 예약 → 칸은 다음 예약(숙박예약)
  const next = bk({
    id: "next",
    roomId: "r301",
    checkIn: "2026-10-21",
    nights: 1,
    arrived: false,
    guestName: "다음",
  });
  const map = nowByRoom(
    [
      { ...b, id: "gone", checkedOutAt: "2026-10-21T03:00:00.000Z" },
      next,
    ],
    "2026-10-21",
  );
  assert.equal(map.get("r301")?.id, "next");
  assert.equal(
    nowFlags(map.get("r301"), "2026-10-21", { stayTimes: stay, clock: clock("10:00", "2026-10-21") }).kind,
    "arriving",
  );

  // 장기: 입실일부터 퇴실처리 가능 · 재고 창 끝나도 하단은 숙박(퇴실예정 자동 끔)
  assert.equal(canCheckOut(bk({ stayMode: "long_stay", checkIn: "2026-10-11", nights: 7, arrived: true }), "2026-10-15"), true);
  assert.equal(
    nowFlags(bk({ stayMode: "long_stay", checkIn: "2026-10-14", nights: 7, arrived: true, roomId: "r301" }), "2026-10-21", {
      stayTimes: stay,
      clock: clock("10:00", "2026-10-21"),
    }).kind,
    "inhouse",
  );
  assert.equal(
    nowFlags(bk({ stayMode: "long_stay", checkIn: "2026-10-14", nights: 7, arrived: true, roomId: "r301" }), "2026-10-21", {
      stayTimes: stay,
      clock: clock("10:00", "2026-10-21"),
    }).label,
    "숙박",
  );
  assert.equal(nowFlags(bk({ stayMode: "long_stay", checkIn: "2026-10-19", nights: 7, arrived: true, roomId: "r301" }), "2026-10-19").longStay, true);
});

test("중도 퇴실: stayEnd가 앞당겨진 날 아침에 퇴실예정", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-18", nights: 4, earlyOut: "2026-10-20" });
  // used nights → stayEnd 10/20. 마지막 점유 밤 10/19 = 숙박
  assert.equal(nowFlags(b, "2026-10-19").kind, "inhouse");
  assert.equal(nowFlags(b, "2026-10-20", { stayTimes: stay, clock: clock("06:00", "2026-10-20") }).kind, "departing");
  assert.equal(nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("10:00", "2026-10-21") }).kind, "empty");
});

test("자동 입실: 체크인 시각 전후 · 입실일 전날 금지 · 빠른 입실", () => {
  const date = "2026-10-19";
  const b = bk({ arrived: false, checkIn: date, nights: 2, roomId: "r301" });
  assert.equal(checkInTimeReached(date, stay, clock("15:59", date)), false);
  assert.equal(checkInTimeReached(date, stay, clock("16:00", date)), true);
  assert.equal(shouldAutoArrive(b, date, { stayTimes: stay, clock: clock("15:59", date) }), false);
  assert.equal(shouldAutoArrive(b, date, { stayTimes: stay, clock: clock("16:00", date) }), true);
  assert.equal(nowFlags(b, date, { stayTimes: stay, clock: clock("15:59", date) }).kind, "arriving");
  assert.equal(nowFlags(b, date, { stayTimes: stay, clock: clock("16:00", date) }).kind, "inhouse");
  assert.equal(nowFlags(b, date, { stayTimes: stay, clock: clock("16:00", date) }).arrived, true);
  // 입실일 전날: 시각만으로 숙박 전환 금지
  assert.equal(shouldAutoArrive(b, "2026-10-18", { stayTimes: stay, clock: clock("16:00", "2026-10-18") }), false);
  // 이미 점유 밤인데 미입실 → 체크인 시각 지난 뒤 자동
  const mid = bk({ arrived: false, checkIn: "2026-10-18", nights: 3, roomId: "r301" });
  assert.equal(shouldAutoArrive(mid, "2026-10-19", { stayTimes: stay, clock: clock("10:00", "2026-10-19") }), true);
  assert.equal(nowFlags(mid, "2026-10-19", { stayTimes: stay, clock: clock("10:00", "2026-10-19") }).kind, "inhouse");
  // 빠른 입실 = arrived true → 즉시 숙박
  assert.equal(effectiveArrived(bk({ arrived: true, checkIn: date }), date, { stayTimes: stay, clock: clock("10:00", date) }), true);
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date }), date, { stayTimes: stay, clock: clock("10:00", date) }).kind, "inhouse");
  // 이미 arrived면 자동 대상 아님
  assert.equal(shouldAutoArrive(bk({ arrived: true, checkIn: date }), date, { stayTimes: stay, clock: clock("16:00", date) }), false);
  // 수동 입실 전환: 시각 지나도 자동 금지 · 표시는 숙박예약 유지 · arrived면 숙박
  const manual = { ...stay, checkInMode: "manual" as const };
  assert.equal(shouldAutoArrive(b, date, { stayTimes: manual, clock: clock("16:00", date) }), false);
  assert.equal(nowFlags(b, date, { stayTimes: manual, clock: clock("16:00", date) }).kind, "arriving");
  assert.equal(nowFlags(b, date, { stayTimes: manual, clock: clock("16:00", date) }).label, "숙박예약");
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date }), date, { stayTimes: manual, clock: clock("10:00", date) }).kind,
    "inhouse",
  );
});

test("옆 패널: 임시·미배정·퇴실·늦은퇴실·숙박예약 분류 (퇴실일 기준)", () => {
  const date = "2026-10-20";
  const opts = { stayTimes: stay, clock: clock("10:00", date) };
  const list = [
    // 미배정: 오늘 점유 밤(연박 중간) · roomId 없음 — 퇴실 아침이 아님
    bk({ id: "u1", guestName: "미정", roomId: null, checkIn: "2026-10-19", nights: 3, arrived: true }),
    // 미래 입실 미배정 → 「현황」nowLists에는 안 넣고( today만 ) · listUnassignedBookings에는 있음
    bk({ id: "uf", guestName: "나중", roomId: null, checkIn: "2026-10-25", nights: 1 }),
    bk({ id: "t1", guestName: "임시", roomId: "r301", tentative: true, arrived: true, checkIn: "2026-10-18", nights: 3 }),
    bk({ id: "d1", guestName: "나감", roomId: "r302", arrived: true, checkIn: "2026-10-19", nights: 1 }),
    bk({ id: "l1", guestName: "늦음", roomId: "r303", arrived: true, checkIn: "2026-10-19", nights: 1, lateOut: 1 }),
    bk({ id: "a1", guestName: "올예", roomId: "r304", arrived: false, checkIn: date, nights: 2 }),
    bk({ id: "x1", guestName: "취소", status: "cancelled", checkIn: "2026-10-19", nights: 1 }),
  ];
  const m = nowLists(list, date, opts);
  assert.equal(m.unassigned.length, 1);
  assert.equal(m.unassigned[0]?.id, "u1");
  assert.equal(m.tentative.length, 1);
  assert.equal(m.departing.map((b) => b.guestName).join(), "나감");
  assert.equal(m.lateOut.map((b) => b.guestName).join(), "늦음");
  assert.equal(m.arriving.map((b) => b.guestName).join(), "올예");
});

test("배치 미배정 풀: listUnassigned · 입실일 칩 건수 분기", () => {
  const today = "2026-10-20";
  const list = [
    bk({ id: "past", roomId: null, checkIn: "2026-10-18" }),
    bk({ id: "td", roomId: null, checkIn: today }),
    bk({ id: "w", roomId: null, checkIn: "2026-10-25" }),
    bk({ id: "m", roomId: null, checkIn: "2026-11-10" }),
    bk({ id: "far", roomId: null, checkIn: "2026-12-01" }),
    bk({ id: "roomed", roomId: "r1", checkIn: today }),
  ];
  const all = listUnassignedBookings(list);
  assert.deepEqual(all.map((b) => b.id).sort(), ["far", "m", "past", "td", "w"]);
  assert.deepEqual(filterUnassignedByCheckIn(all, today, "today").map((b) => b.id).sort(), ["past", "td"]);
  assert.deepEqual(filterUnassignedByCheckIn(all, today, "week").map((b) => b.id).sort(), ["td", "w"]);
  assert.deepEqual(filterUnassignedByCheckIn(all, today, "month").map((b) => b.id).sort(), ["m", "td", "w"]);
});

test("nowByRoom: 퇴실 아침에도 마지막 방 칸에 남김", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2, roomId: "r601" });
  assert.equal(nowByRoom([b], "2026-10-20").get("r601")?.id, b.id);
  assert.equal(nowByRoom([b], "2026-10-21").get("r601")?.id, b.id);
  assert.equal(nowByRoom([{ ...b, checkedOutAt: "2026-10-21T01:00:00Z" }], "2026-10-21").get("r601"), undefined);
});

test("미배정 타입 카운트: 단체·타입별", () => {
  const list = [
    bk({ roomId: null, typeId: "s", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "s", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "t", groupId: "g", groupName: "한빛", guestName: "한빛" }),
    bk({ roomId: null, typeId: "s", guestName: "개인" }),
  ];
  const c = unassignedTypeCounts(list);
  assert.equal(c.find((x) => x.groupName === "한빛" && x.typeId === "s")?.n, 2);
  assert.equal(c.find((x) => x.groupName === "한빛" && x.typeId === "t")?.n, 1);
  assert.equal(c.find((x) => !x.groupName && x.typeId === "s")?.n, 1);
});

test("상단 숙박 요약: N박 · K/N박 · 1박·숙박예약은 진행 숨김", () => {
  const b = bk({ checkIn: "2026-10-10", nights: 11, arrived: true });
  assert.equal(nowStayNightIndex(b, "2026-10-18"), 9);
  assert.equal(nowStayNightIndex(b, "2026-10-10"), 1);
  assert.equal(nowStayNightIndex(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), null);
  // 숙박 중: 진행/전체
  assert.equal(nowStaySummary(b, "2026-10-18"), "9/11박");
  assert.equal(nowStaySummary(b, "2026-10-10"), "1/11박");
  // 1박: 진행 없음
  assert.equal(nowStaySummary(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), "1박");
  // 숙박예약(입실 전): 진행 숨김 · 길이만
  assert.equal(nowStaySummary(bk({ checkIn: "2026-10-19", nights: 2, arrived: false }), "2026-10-19", false), "2박");
  assert.equal(nowStaySummary(bk({ checkIn: "2026-10-19", nights: 2, arrived: true }), "2026-10-19", true), "1/2박");
  // 퇴실 아침 = 마지막 박
  assert.equal(nowStaySummary(b, "2026-10-21"), "11/11박");
  assert.equal(nowStayHint(b, "2026-10-18"), "9/11박");
  assert.equal(nowStayHint(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), "1박");
  // 레거시 칩 배열 → 압축 한 토큰
  assert.deepEqual(nowStayChips(b, "2026-10-18"), ["9/11박"]);
  assert.deepEqual(nowStayChips(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), []);
});

test("점유 밤 구간: 2박 입19·퇴21 → 보드 19~20 (퇴실 아침 제외)", () => {
  const b2 = bk({ checkIn: "2026-10-19", nights: 2, arrived: true });
  assert.equal(nowNightRange(b2).label, "10/19~20");
  assert.equal(nowDateLine(b2), "10/19~20");
  const b8 = bk({ checkIn: "2026-10-20", nights: 8, arrived: true });
  assert.equal(nowNightRange(b8).label, "10/20~27"); // 퇴실 아침 10/28
  const one = bk({ checkIn: "2026-10-19", nights: 1, arrived: true });
  assert.equal(nowNightRange(one).label, "10/19");
  const eo = bk({ checkIn: "2026-10-18", nights: 4, earlyOut: "2026-10-20", arrived: true });
  assert.equal(nowNightRange(eo).label, "10/18~19"); // stayEnd=20 → 마지막 밤 19
});

test("간단 예약 입실일 필터: 오늘(기한초과 포함) · 일주일 · 한달", () => {
  const list = [
    bk({ id: "past", checkIn: "2026-10-18", roomId: null }),
    bk({ id: "td", checkIn: "2026-10-20", roomId: null }),
    bk({ id: "w", checkIn: "2026-10-25", roomId: null }),
    bk({ id: "m", checkIn: "2026-11-10", roomId: null }),
    bk({ id: "far", checkIn: "2026-12-01", roomId: null }),
  ];
  const today = "2026-10-20";
  assert.deepEqual(
    filterUnassignedByCheckIn(list, today, "today").map((b) => b.id),
    ["past", "td"],
  );
  assert.deepEqual(
    filterUnassignedByCheckIn(list, today, "week").map((b) => b.id),
    ["td", "w"],
  );
  assert.deepEqual(
    filterUnassignedByCheckIn(list, today, "month").map((b) => b.id),
    ["td", "w", "m"],
  );
});

test("금액 글랜스 · 톤 · 메타 줄", () => {
  assert.equal(nowAmountGlance(bk({ price: 180000 }), null), "₩180,000");
  assert.equal(nowAmountTone(bk({ price: 180000 }), null), "paid");
  assert.equal(nowAmountGlance(bk({ price: 0, priceUnset: true }), onsite), "금액미정");
  assert.equal(nowAmountTone(bk({ price: 0, priceUnset: true }), onsite), "neutral");
  assert.equal(simplePayGlance(bk({ price: 180000, payments: [] }), true), "후불");
  assert.equal(
    simplePayGlance(bk({ price: 180000, payments: [{ id: "1", bookingId: "b", kind: "balance", method: "card", amount: 180000, bizDate: "2026-10-19", createdAt: "" }] }), true),
    "완납",
  );
  // 미수(수납 0) = due · 선금·일부 = partial · 완납 = paid
  assert.equal(nowAmountTone(bk({ price: 180000, payments: [] }), onsite), "due");
  assert.equal(
    nowAmountGlance(bk({ price: 180000, payments: [{ id: "1", bookingId: "b", kind: "deposit", method: "cash", amount: 50000, bizDate: "2026-10-19", createdAt: "" }] }), onsite),
    "잔금 ₩130,000",
  );
  assert.equal(
    nowAmountTone(bk({ price: 180000, payments: [{ id: "1", bookingId: "b", kind: "deposit", method: "cash", amount: 50000, bizDate: "2026-10-19", createdAt: "" }] }), onsite),
    "partial",
  );
  assert.equal(
    nowAmountTone(bk({ price: 180000, payments: [{ id: "1", bookingId: "b", kind: "balance", method: "card", amount: 180000, bizDate: "2026-10-19", createdAt: "" }] }), onsite),
    "paid",
  );
  // OTA: 판매금만 · 결제 줄이 있어도 잔금 라벨·due/partial 톤 금지 (완납/검정)
  const ota = { name: "야놀자" };
  assert.equal(nowAmountGlance(bk({ price: 140000, payments: [] }), ota), "₩140,000");
  assert.equal(nowAmountTone(bk({ price: 140000, payments: [] }), ota), "paid");
  assert.equal(
    nowAmountGlance(bk({ price: 140000, payments: [{ id: "1", bookingId: "b", kind: "balance", method: "card", amount: 70000, bizDate: "2026-10-22", createdAt: "" }] }), ota),
    "₩140,000",
  );
  assert.equal(
    nowAmountTone(bk({ price: 140000, payments: [{ id: "1", bookingId: "b", kind: "balance", method: "card", amount: 70000, bizDate: "2026-10-22", createdAt: "" }] }), ota),
    "paid",
  );
  assert.equal(
    nowAmountGlance(
      bk({
        stayMode: "long_stay",
        price: 0,
        charges: [{ id: "c1", bookingId: "b", nightDate: "2026-10-19", amount: 80000, createdAt: "" }],
        payments: [],
      }),
      onsite,
    ),
    "미수 ₩80,000",
  );
  assert.equal(
    nowAmountTone(
      bk({
        stayMode: "long_stay",
        price: 0,
        charges: [{ id: "c1", bookingId: "b", nightDate: "2026-10-19", amount: 80000, createdAt: "" }],
        payments: [],
      }),
      onsite,
    ),
    "due",
  );
  assert.equal(nowAmountGlance(bk({ stayMode: "long_stay", price: 0, charges: [], payments: [] }), onsite), null);
  // 단체: 방 payments 비어 있어도 단체 줄 완납 → 잔금 금지 · 최근=단체납 금액(판매가 대체)
  {
    const a = bk({ id: "ga", groupId: "g1", price: 80000, payments: [] });
    const b = bk({ id: "gb", groupId: "g1", price: 70000, payments: [], roomId: "r302" });
    const info = {
      ...emptyGroupInfo("g1"),
      payments: [{ id: "gp", bookingId: "", kind: "balance" as const, method: "card" as const, amount: 150000, bizDate: "2026-10-22", createdAt: "t" }],
    };
    const ctx = { members: [a, b], info };
    assert.equal(nowAmountGlance(a, onsite, ctx), "₩150,000");
    assert.equal(nowAmountTone(a, onsite, ctx), "paid");
    assert.equal(nowAmountGlance(b, onsite, ctx), "₩150,000");
    assert.equal(nowAmountTone(b, onsite, ctx), "paid");
    assert.equal(nowPayMethodGlance(a, info.payments), "카드");
    // 완납: 수단+최근액 OK · 「잔금」 금지
    assert.equal(nowPayMethodPrefix("₩150,000", "카드"), "카드");
    // 단체 수납 없으면 방만 볼 때와 같이 잔금(단체 합) · 수단+잔금 합침 금지
    const unpaid = { members: [a, b], info: emptyGroupInfo("g1") };
    assert.equal(nowAmountGlance(a, onsite, unpaid), "잔금 ₩150,000");
    assert.equal(nowAmountTone(a, onsite, unpaid), "due");
    assert.equal(nowPayMethodPrefix("잔금 ₩150,000", "카드"), null);
  }
  // 수단+잔금 합침 금지 · 완납은 최근 결제액(이체 ₩…) · 판매가 아님
  {
    const partial = bk({
      price: 180000,
      payments: [{ id: "1", bookingId: "b", kind: "deposit", method: "transfer", amount: 50000, bizDate: "2026-10-19", createdAt: "" }],
    });
    const leftAmt = nowAmountGlance(partial, onsite);
    assert.equal(leftAmt, "잔금 ₩130,000");
    assert.equal(nowPayMethodGlance(partial), "이체");
    assert.equal(nowPayMethodPrefix(leftAmt, "이체"), null);
    const paid = bk({
      price: 180000,
      payments: [
        { id: "1", bookingId: "b", kind: "deposit", method: "cash", amount: 50000, bizDate: "2026-10-19", createdAt: "2026-10-19T10:00:00Z" },
        { id: "2", bookingId: "b", kind: "balance", method: "transfer", amount: 130000, bizDate: "2026-10-22", createdAt: "2026-10-22T12:00:00Z" },
      ],
    });
    const paidAmt = nowAmountGlance(paid, onsite);
    assert.equal(paidAmt, "₩130,000"); // 최근 줄 · 판매가 180k 아님
    assert.equal(nowLatestPayMethodLabel(paid), "이체");
    assert.equal(nowPayMethodGlance(paid), "이체·현금"); // 고유 수단(참고)
    assert.equal(nowPayMethodPrefix(paidAmt, nowLatestPayMethodLabel(paid)), "이체");
    assert.equal(nowPayMethodPrefix("미수 ₩80,000", "현금"), null);
    assert.equal(nowPayMethodPrefix(null, "카드"), "카드");
    // 대납: 형제 방만 수납 · 이 방·단체 줄 없음 → left=0이어도 최근 후보 없음 → 판매가 폴백
    {
      const a = bk({ id: "da", groupId: "gd", price: 80000, payments: [] });
      const b = bk({
        id: "db",
        groupId: "gd",
        price: 70000,
        roomId: "r302",
        payments: [{ id: "bp", bookingId: "db", kind: "balance", method: "cash", amount: 150000, bizDate: "2026-10-22", createdAt: "t" }],
      });
      const ctx = { members: [a, b], info: emptyGroupInfo("gd") };
      assert.equal(nowAmountGlance(a, onsite, ctx), "₩80,000");
      assert.equal(nowAmountTone(a, onsite, ctx), "paid");
      assert.equal(nowAmountGlance(b, onsite, ctx), "₩150,000");
    }
  }
  assert.equal(nowMetaLine({ memo: "금연", guests: 2 }), "금연");
  assert.equal(nowMetaLine({ memo: null, guests: 3 }), null);
  assert.equal(nowMetaLine({ memo: null, guests: null }), null);
  assert.equal(nowMetaLine({ memo: "[추가금·늦은 퇴실]", guests: 3 }), null);
  assert.equal(nowMetaLine({ memo: "[추가금.늦은 퇴실]\n금연", guests: 2 }), "금연");
  assert.equal(nowMetaLine({ memo: "금연\n[추가금·늦은 퇴실] 합의", guests: 2 }), "금연");
});

test("칸 마크: 늦은 퇴실 → N시 퇴실 · 결제수단 글랜스", () => {
  const s = { stayTimes: { checkIn: "15:00", checkOut: "11:00", checkInMode: "auto" as const } };
  assert.equal(nowCheckoutMark(s, { kind: "stay", lateOut: 0 }), null);
  assert.equal(nowCheckoutMark(s, { kind: "dayuse", lateOut: 3 }), null);
  assert.equal(nowCheckoutMark(s, { kind: "stay", lateOut: 3 }), "14시 퇴실");
  assert.equal(nowPayMethodGlance({ payments: [] }), null);
  assert.equal(
    nowPayMethodGlance({
      payments: [
        { id: "1", bookingId: "b", kind: "balance", method: "card", amount: 1, bizDate: "2026-10-22", createdAt: "2026-10-22T10:00:00Z" },
        { id: "2", bookingId: "b", kind: "deposit", method: "cash", amount: 1, bizDate: "2026-10-22", createdAt: "2026-10-22T12:00:00Z" },
      ],
    }),
    "현금·카드",
  );
});

test("latestPaymentOf: createdAt 최신 · 동률 bizDate · 단체 줄 포함", () => {
  assert.equal(latestPaymentOf({ payments: [] }), null);
  const older = { id: "1", bookingId: "b", kind: "deposit" as const, method: "cash" as const, amount: 10000, bizDate: "2026-10-20", createdAt: "2026-10-20T09:00:00Z" };
  const newer = { id: "2", bookingId: "b", kind: "balance" as const, method: "card" as const, amount: 70000, bizDate: "2026-10-21", createdAt: "2026-10-21T11:00:00Z" };
  assert.equal(latestPaymentOf({ payments: [older, newer] })?.id, "2");
  // createdAt 동률 → bizDate desc
  const a = { id: "a", bookingId: "b", kind: "deposit" as const, method: "cash" as const, amount: 1, bizDate: "2026-10-19", createdAt: "" };
  const c = { id: "c", bookingId: "b", kind: "balance" as const, method: "card" as const, amount: 2, bizDate: "2026-10-22", createdAt: "" };
  assert.equal(latestPaymentOf({ payments: [a, c] })?.id, "c");
  const groupPay = { id: "gp", bookingId: "", kind: "balance" as const, method: "transfer" as const, amount: 90000, bizDate: "2026-10-23", createdAt: "2026-10-23T08:00:00Z" };
  assert.equal(latestPaymentOf({ payments: [older] }, [groupPay])?.id, "gp");
  // credit 포함
  const credit = { id: "cr", bookingId: "b", kind: "balance" as const, method: "credit" as const, amount: 30000, bizDate: "2026-10-24", createdAt: "2026-10-24T01:00:00Z" };
  assert.equal(latestPaymentOf({ payments: [newer, credit] })?.method, "credit");
});

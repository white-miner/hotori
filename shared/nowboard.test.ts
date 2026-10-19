// 현장 현황 보드: 영업일 기준 상태 파생 · 옆 패널 분류 · 퇴실 윈도우 · 밤 구간 날짜
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Booking } from "./ledger";
import {
  canCheckOut,
  checkoutMorningVisible,
  departingWindowOpen,
  nowBoardVisible,
  nowByRoom,
  nowDateLine,
  nowFlags,
  nowLists,
  nowStayChips,
  nowStayDates,
  nowStayHint,
  unassignedTypeCounts,
  type NowClock,
} from "./nowboard";

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
const stay = { checkOut: "12:00" };

test("지금 상태: 입실 예정 · 투숙 · 마지막 밤은 투숙(퇴실 예정 아님)", () => {
  const date = "2026-10-19";
  assert.equal(nowFlags(bk({ arrived: false, checkIn: date }), date).kind, "arriving");
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 3 }), date).kind, "inhouse");
  // 1박: 입실일 밤은 투숙, 퇴실 아침(다음날)에 퇴실 예정
  assert.equal(nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), date).kind, "inhouse");
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1 }), "2026-10-20", { stayTimes: stay, clock: clock("06:00", "2026-10-20") }).kind,
    "departing",
  );
  assert.equal(
    nowFlags(bk({ arrived: true, checkIn: date, nights: 1, lateOut: 2 }), "2026-10-20", { stayTimes: stay, clock: clock("08:00", "2026-10-20") }).kind,
    "lateOut",
  );
  assert.equal(nowFlags(bk({ arrived: true, tentative: true, checkIn: date, nights: 3 }), date).tentative, true);
  assert.equal(nowFlags(bk({ arrived: true, noClean: true, checkIn: date, nights: 3 }), date).noClean, true);
  assert.equal(nowFlags(bk({ roomId: null, checkIn: date }), date).kind, "unassigned");
  assert.equal(nowFlags(null, date).kind, "empty");
  assert.equal(nowFlags(null, date).noClean, false);
});

test("2박 3일: 마지막 밤은 투숙, 퇴실 아침 06:00부터 퇴실 예정", () => {
  // 입 10/19 · 2박 · 퇴실 아침 10/21 · 보드 밤 19~20
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2 });
  assert.equal(nowFlags(b, "2026-10-19").kind, "inhouse");
  assert.equal(nowFlags(b, "2026-10-20").kind, "inhouse"); // 마지막 점유 밤 — 퇴실 예정 아님
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
  ); // 미처리면 계속 퇴실 예정
});

test("늦은 퇴실: lateOut 반영한 윈도우 · 라벨 우선", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2, lateOut: 2 }); // 실제 퇴실 14:00 → 08:00부터
  assert.equal(departingWindowOpen(b, "2026-10-21", stay, clock("07:59", "2026-10-21")), false);
  assert.equal(departingWindowOpen(b, "2026-10-21", stay, clock("08:00", "2026-10-21")), true);
  assert.equal(
    nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("08:00", "2026-10-21") }).kind,
    "lateOut",
  );
});

test("퇴실처리 후 빈 칸 · 되돌리기 전제", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-19", nights: 2, checkedOutAt: "2026-10-21T03:00:00.000Z" });
  assert.equal(nowBoardVisible(b, "2026-10-21"), false);
  assert.equal(nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("10:00", "2026-10-21") }).kind, "empty");
  assert.equal(nowByRoom([b], "2026-10-21").has("r301"), false);
  assert.equal(canCheckOut(bk({ arrived: true, checkIn: "2026-10-19", nights: 2 }), "2026-10-21"), true);
  assert.equal(canCheckOut(b, "2026-10-21"), false);
});

test("중도 퇴실: stayEnd가 앞당겨진 날 아침에 퇴실 예정", () => {
  const b = bk({ arrived: true, checkIn: "2026-10-18", nights: 4, earlyOut: "2026-10-20" });
  // used nights → stayEnd 10/20. 마지막 점유 밤 10/19 = 투숙
  assert.equal(nowFlags(b, "2026-10-19").kind, "inhouse");
  assert.equal(nowFlags(b, "2026-10-20", { stayTimes: stay, clock: clock("06:00", "2026-10-20") }).kind, "departing");
  assert.equal(nowFlags(b, "2026-10-21", { stayTimes: stay, clock: clock("10:00", "2026-10-21") }).kind, "empty");
});

test("옆 패널: 임시·미배정·퇴실·늦은퇴실·입실예정 분류 (퇴실일 기준)", () => {
  const date = "2026-10-20";
  const opts = { stayTimes: stay, clock: clock("10:00", date) };
  const list = [
    // 미배정: 오늘 점유 밤(연박 중간) · roomId 없음 — 퇴실 아침이 아님
    bk({ id: "u1", guestName: "미정", roomId: null, checkIn: "2026-10-19", nights: 3, arrived: true }),
    bk({ id: "t1", guestName: "임시", roomId: "r301", tentative: true, arrived: true, checkIn: "2026-10-18", nights: 3 }),
    bk({ id: "d1", guestName: "나감", roomId: "r302", arrived: true, checkIn: "2026-10-19", nights: 1 }),
    bk({ id: "l1", guestName: "늦음", roomId: "r303", arrived: true, checkIn: "2026-10-19", nights: 1, lateOut: 1 }),
    bk({ id: "a1", guestName: "올예", roomId: "r304", arrived: false, checkIn: date, nights: 2 }),
    bk({ id: "x1", guestName: "취소", status: "cancelled", checkIn: "2026-10-19", nights: 1 }),
  ];
  const m = nowLists(list, date, opts);
  assert.equal(m.unassigned.length, 1);
  assert.equal(m.tentative.length, 1);
  assert.equal(m.departing.map((b) => b.guestName).join(), "나감");
  assert.equal(m.lateOut.map((b) => b.guestName).join(), "늦음");
  assert.equal(m.arriving.map((b) => b.guestName).join(), "올예");
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

test("연박 칩: 총 박수 + 몇 박째, 1박은 빈 배열 · 퇴실 아침은 마지막 박", () => {
  const b = bk({ checkIn: "2026-10-10", nights: 11, arrived: true });
  assert.deepEqual(nowStayChips(b, "2026-10-18"), ["11박", "9박째"]);
  assert.deepEqual(nowStayChips(b, "2026-10-10"), ["11박", "1박째"]);
  assert.deepEqual(nowStayChips(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), []);
  assert.equal(nowStayHint(b, "2026-10-18"), "11박 · 9박째");
  assert.equal(nowStayHint(bk({ nights: 1, checkIn: "2026-10-19" }), "2026-10-19"), "1박");
  // stayEnd = 10/21, 퇴실 아침 칩 = 11박째
  assert.deepEqual(nowStayChips(b, "2026-10-21"), ["11박", "11박째"]);
});

test("보드 날짜: 점유 밤 구간 (퇴실일 끝 금지)", () => {
  // 입 10/19 · 2박 · 퇴 21 → 보드 19~20
  const b = bk({ checkIn: "2026-10-19", nights: 2, arrived: true });
  const d = nowStayDates(b);
  assert.equal(d.checkOut, "2026-10-21");
  assert.equal(d.lastNight, "2026-10-20");
  assert.equal(d.rangeLabel, "10/19~20");
  assert.equal(nowDateLine(b), "10/19~20");
  // 1박 → 단일 날짜
  assert.equal(nowStayDates(bk({ checkIn: "2026-10-19", nights: 1 })).rangeLabel, "10/19");
  // 중도 퇴실: 실제 stayEnd 기준 밤 구간
  const eo = bk({ checkIn: "2026-10-18", nights: 4, earlyOut: "2026-10-20", arrived: true });
  assert.equal(nowStayDates(eo).rangeLabel, "10/18~19");
  assert.equal(nowDateLine(eo), "10/18~19");
  // 8박: 입 20 · 퇴 28 → 밤 20~27
  const long = bk({ checkIn: "2026-10-20", nights: 8, arrived: true });
  assert.equal(nowStayDates(long).rangeLabel, "10/20~27");
  assert.equal(nowDateLine(long), "10/20~27");
});

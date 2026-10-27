// 취소 · 노쇼 · 중도 퇴실: 밤마다 재고 · 매출 · 환불 날짜 · 되돌리기 · 비운 밤 다시 팔기 · 객실 이동과 함께
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  boardMoveTargets,
  canEarlyOutToday,
  earlyOutDates,
  earlyOutUndoBlock,
  freeRooms,
  freedLegsOf,
  fullLegsOf,
  isCancelledRefilled,
  legConflicts,
  legsOf,
  nightBoard,
  normalizeSettings,
  occupiesNight,
  revenueOf,
  roomMap,
  roomOnNight,
  roomRevenue,
  stayEnd,
  stockTable,
  usedLabel,
  usedNights,
  validateEarlyOut,
} from "./ledger";
import { calendarLayout } from "./calendar";

const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [{ id: "f3", name: "3층", rooms: [{ id: "r305", no: "305", typeId: "s" }, { id: "r306", no: "306", typeId: "s" }, { id: "r307", no: "307", typeId: "s" }] }],
});
let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`, kind: "stay", status: "active", platformId: "p", price: 300000, guestName: `손님${n}`, typeId: "s", roomId: "r305",
  checkIn: "2026-10-18", nights: 3, startTime: null, endTime: null, arrived: true, memo: null, cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", segments: null, earlyOut: null, refund: null, ...p,
});
const D = ["2026-10-18", "2026-10-19", "2026-10-20"];
const left = (bs: Booking[]) => D.map((d) => stockTable(S, bs, D).get("s")!.get(d));

test("305호 3박, 셋째 날 2박 이용 후 퇴실: 1~2박은 그대로, 3박째는 바로 비어요", () => {
  const b = bk({ earlyOut: "2026-10-20" });
  assert.equal(usedNights(b), 2);
  assert.equal(stayEnd(b), "2026-10-20");
  assert.equal(usedLabel(b), "3박 중 2박 이용");
  assert.deepEqual(left([b]), [2, 2, 3]); // 방 3개: 셋째 밤은 다시 3개
  assert.deepEqual(D.map((d) => roomOnNight(b, d)), ["r305", "r305", undefined]);
  assert.equal(occupiesNight(b, "2026-10-19"), true);
  assert.equal(occupiesNight(b, "2026-10-20"), false);
  // 객실 배치: 그 밤 305호는 빈 방
  assert.equal(nightBoard(S, [b], "2026-10-20").byRoom.has("r305"), false);
  assert.equal(nightBoard(S, [b], "2026-10-19").byRoom.get("r305")?.id, b.id);
  // 처음 예약한 구간은 그대로 남아요 (캘린더 꼬리용)
  assert.deepEqual(fullLegsOf(b).map((l) => l.nights), [3]);
  assert.deepEqual(freedLegsOf(b), [{ roomId: "r305", checkIn: "2026-10-20", nights: 1, idx: 0 }]);
});

test("비운 밤은 다시 팔 수 있어요: 겹침 오류 없이 305호가 빈 방으로 나와요", () => {
  const b = bk({ earlyOut: "2026-10-20" });
  const draft = bk({ id: "new", checkIn: "2026-10-20", nights: 1, roomId: "r305" });
  assert.equal(freeRooms(S, [b], draft).has("r305"), true);
  assert.deepEqual(legConflicts([b], draft), []);
  // 중도 퇴실이 없으면 겹쳐요
  assert.equal(legConflicts([{ ...b, earlyOut: null }], draft).length, 1);
  // 캘린더: 묵은 2박은 막대, 비운 1박은 흐린 꼬리, 새 예약과 겹침 표시 없음
  const lay = calendarLayout(S, [b, draft], "2026-10-17", "2026-10-22");
  const bars = lay.rooms.get("r305")!;
  assert.equal(lay.conflicts, 0);
  const mine = bars.filter((x) => x.b.id === b.id).sort((a, c) => a.span.start - c.span.start);
  assert.deepEqual(mine.map((x) => [x.span.start, x.span.len, !!x.freed, !!x.endsEarly]), [[1, 2, false, true], [3, 1, true, false]]);
  // 꼬리는 밑에 그려요
  assert.equal(bars[0].freed, true);
});

test("잘못된 날짜는 중도 퇴실이 아니에요 (첫 날·퇴실일·1박·대실)", () => {
  assert.equal(usedNights(bk({ earlyOut: "2026-10-18" })), 3);
  assert.equal(usedNights(bk({ earlyOut: "2026-10-21" })), 3);
  assert.equal(usedNights(bk({ nights: 1, earlyOut: "2026-10-19" })), 1);
  assert.deepEqual(earlyOutDates(bk({})), ["2026-10-19", "2026-10-20"]);
  const b = bk({});
  assert.match(validateEarlyOut(b, "2026-10-18", null)!, /입실 다음 날/);
  assert.match(validateEarlyOut(b, "2026-10-21", null)!, /입실 다음 날/);
  assert.match(validateEarlyOut(b, "2026-10-20", 400000)!, /결제 금액/);
  assert.equal(validateEarlyOut(b, "2026-10-20", 100000), null);
  assert.match(validateEarlyOut(bk({ nights: 1 }), "2026-10-19", null)!, /2박 이상/);
  assert.match(validateEarlyOut(bk({ status: "noshow" }), "2026-10-19", null)!, /취소·노쇼/);
});

test("중도 퇴실 단추는 첫 밤 다음 날부터 퇴실 전날까지만 (2박 이상 정상 숙박)", () => {
  const b = bk({});
  assert.deepEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"].map((t) => canEarlyOutToday(b, t)), [false, true, true, false]);
  assert.equal(canEarlyOutToday(bk({ nights: 1 }), "2026-10-18"), false);
  assert.equal(canEarlyOutToday(bk({ status: "cancelled" }), "2026-10-19"), false);
  assert.equal(canEarlyOutToday(bk({ earlyOut: "2026-10-19" }), "2026-10-19"), false); // 이미 했으면 되돌리기만
});

test("매출: 취소 0 · 노쇼는 결제 금액 그대로 · 중도 퇴실은 결제 − 환불", () => {
  assert.equal(revenueOf(bk({ status: "cancelled" })), 0);
  assert.equal(revenueOf(bk({ status: "noshow" })), 300000);
  assert.equal(revenueOf(bk({ earlyOut: "2026-10-20", refund: 100000 })), 200000);
  assert.equal(revenueOf(bk({ earlyOut: "2026-10-20" })), 300000); // 환불 없음
  assert.equal(revenueOf(bk({ refund: 100000 })), 300000); // 날짜 없는 환불은 무시
  // 재고: 취소·노쇼는 전부 돌려줘요
  assert.deepEqual(left([bk({ status: "noshow" })]), [3, 3, 3]);
  assert.deepEqual(left([bk({ status: "cancelled" })]), [3, 3, 3]);
  // 기간 합계
  const list = [bk({ status: "cancelled" }), bk({ status: "noshow", price: 80000 }), bk({ earlyOut: "2026-10-20", refund: 100000 }), bk({ price: 50000 })];
  assert.deepEqual(roomRevenue(list, "2026-10-01", "2026-10-31"), { sales: 430000, refunds: 100000, net: 330000 });
});

test("환불은 중도 퇴실한 날짜의 달에 빠져요 (9/30 입실 · 10/2 퇴실)", () => {
  const b = bk({ checkIn: "2026-09-30", nights: 4, earlyOut: "2026-10-02", refund: 120000, price: 400000 });
  assert.deepEqual(roomRevenue([b], "2026-09-01", "2026-09-30"), { sales: 400000, refunds: 0, net: 400000 });
  assert.deepEqual(roomRevenue([b], "2026-10-01", "2026-10-31"), { sales: 0, refunds: 120000, net: -120000 });
  // 노쇼·취소된 예약의 남은 환불 값은 세지 않아요
  assert.equal(roomRevenue([{ ...b, status: "noshow" }], "2026-10-01", "2026-10-31").refunds, 0);
});

test("되돌리기: 비운 밤이 비어 있으면 되고, 다른 예약이 그 방에 들어왔으면 막아요", () => {
  const b = bk({ earlyOut: "2026-10-20", guestName: "문지호" });
  assert.equal(earlyOutUndoBlock(S, [b], b), null);
  const resold = bk({ checkIn: "2026-10-20", nights: 1, roomId: "r305", guestName: "새손님" });
  const msg = earlyOutUndoBlock(S, [b, resold], b, (id) => (id ? id.slice(1) : null));
  assert.match(msg!, /10\/20\(화\) 밤 305호에 새손님 님 예약/);
  // 새 예약을 다른 방으로 옮기면 되돌릴 수 있어요
  assert.equal(earlyOutUndoBlock(S, [b, { ...resold, roomId: "r306" }], b), null);
  // 방 미배정으로 팔려서 그 밤 잔여 객실이 모자라면 막아요 (방 3개 중 3개가 그 밤에 팔림)
  const others = [bk({ checkIn: "2026-10-20", nights: 1, roomId: "r306" }), bk({ checkIn: "2026-10-20", nights: 1, roomId: "r307" }), bk({ checkIn: "2026-10-20", nights: 1, roomId: null })];
  assert.match(earlyOutUndoBlock(S, [b, ...others], b)!, /잔여 객실이 없어서/);
  // 되돌린 뒤 모양: 원래 3박 그대로
  const back = { ...b, earlyOut: null, refund: null };
  assert.equal(usedNights(back), 3);
  assert.deepEqual(left([back]), [2, 2, 2]);
});

test("객실 이동과 함께: 밤마다 실제로 쓴 방에서 재고를 빼고, 비운 밤은 그 방에서 비어요", () => {
  // 305 1박 → 306 3박, 셋째 날(10/20) 퇴실 → 10/18 305, 10/19 306 묵음, 10/20·21 306 비움
  const b = bk({ nights: 4, roomId: "r305", segments: [{ roomId: "r305", nights: 1 }, { roomId: "r306", nights: 3 }], earlyOut: "2026-10-20" });
  assert.deepEqual(legsOf(b).map((l) => [l.roomId, l.checkIn, l.nights]), [["r305", "2026-10-18", 1], ["r306", "2026-10-19", 1]]);
  assert.deepEqual(freedLegsOf(b).map((l) => [l.roomId, l.checkIn, l.nights]), [["r306", "2026-10-20", 2]]);
  assert.deepEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"].map((d) => roomOnNight(b, d)), ["r305", "r306", undefined, undefined]);
  assert.deepEqual(left([b]), [2, 2, 3]);
  const draft = bk({ id: "x", checkIn: "2026-10-20", nights: 2, roomId: "r306" });
  assert.deepEqual(legConflicts([b], draft), []);
  // 다시 판 뒤 되돌리기는 막혀요
  assert.match(earlyOutUndoBlock(S, [b, draft], b)!, /306/);
  // 이동 전 방에서 퇴실(둘째 날): 306 구간은 통째로 비어요
  const b2 = { ...b, earlyOut: "2026-10-19" };
  assert.deepEqual(legsOf(b2).map((l) => l.roomId), ["r305"]);
  assert.deepEqual(freedLegsOf(b2).map((l) => [l.roomId, l.checkIn, l.nights]), [["r306", "2026-10-19", 3]]);
  // 객실 배치에서 옮기기: 묵은 밤까지만 비어 있으면 돼요
  const b3 = bk({ nights: 3, roomId: "r305", earlyOut: "2026-10-20" });
  const sold307 = bk({ checkIn: "2026-10-20", nights: 1, roomId: "r307" });
  assert.equal(boardMoveTargets(S, [b3, sold307], b3, "2026-10-19").has("r307"), true);
});

test("노쇼·취소 자리는 새 예약이 채우면 사라져요 (예전 그대로), 중도 퇴실 손님의 묵은 밤만 자리를 막아요", () => {
  const rooms = roomMap(S);
  const ns = bk({ status: "noshow", cancelledAt: "2026-10-18T10:00:00Z" });
  const fill = bk({ checkIn: "2026-10-19", nights: 1, roomId: "r305" });
  assert.equal(isCancelledRefilled(ns, [ns, fill], rooms), true);
  assert.equal(nightBoard(S, [ns, fill], "2026-10-19").byRoom.get("r305")?.id, fill.id);
  // 방 미배정 노쇼: 같은 타입 새 숙박이 묵는 밤과 겹치면 사라져요. 중도 퇴실한 숙박은 묵은 밤까지만 봐요
  const nsLoose = bk({ roomId: null, status: "noshow", checkIn: "2026-10-20", nights: 1, cancelledAt: "2026-10-02T00:00:00Z" });
  const eo = bk({ roomId: "r306", createdAt: "2026-10-05T00:00:00Z", earlyOut: "2026-10-20" });
  assert.equal(isCancelledRefilled(nsLoose, [nsLoose, eo], rooms), false);
  assert.equal(isCancelledRefilled(nsLoose, [nsLoose, { ...eo, earlyOut: null }], rooms), true);
});

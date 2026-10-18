import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  type HotelSettings,
  addDays,
  businessDate,
  firstOverbooking,
  freeRooms,
  nightBoard,
  perNight,
  previewChange,
  remaining,
  stockLevel,
  stockTable,
  validateBooking,
} from "./ledger.ts";

const S: HotelSettings = {
  lowThreshold: 2,
  types: [
    { id: "s", code: "S", name: "스탠다드" },
    { id: "sd", code: "SD", name: "스탠다드 디럭스" },
    { id: "bg", code: "BG", name: "방갈로" },
  ],
  platforms: [
    { id: "ya", name: "야놀자", abbr: "야" },
    { id: "hy", name: "현장·전화", abbr: "현" },
  ],
  floors: [
    {
      id: "f2",
      name: "2층",
      color: "#DDE8F3",
      rooms: [
        { id: "r201", no: "201", typeId: "s" },
        { id: "r202", no: "202", typeId: "s" },
        { id: "r203", no: "203", typeId: "sd" },
      ],
    },
    { id: "f6", name: "6층", rooms: [{ id: "rbg", no: "방갈로", typeId: "bg" }] },
  ],
};

let seq = 0;
function bk(p: Partial<Booking>): Booking {
  seq++;
  return {
    id: `b${seq}`,
    kind: "stay",
    status: "active",
    platformId: "ya",
    price: 100000,
    guestName: `손님${seq}`,
    typeId: "s",
    roomId: null,
    checkIn: "2026-10-18",
    nights: 1,
    startTime: null,
    endTime: null,
    arrived: false,
    memo: null,
    cancelledAt: null,
    createdAt: `2026-10-18T00:00:${String(seq).padStart(2, "0")}Z`,
    updatedAt: `2026-10-18T00:00:${String(seq).padStart(2, "0")}Z`,
    ...p,
  };
}

test("연박: 입실한 날부터 N박만 차지하고 퇴실하는 밤은 비어요", () => {
  const list = [bk({ nights: 3 })]; // 10/18 입실 3박4일
  assert.equal(remaining(S, list, "s", "2026-10-17"), 2);
  assert.equal(remaining(S, list, "s", "2026-10-18"), 1);
  assert.equal(remaining(S, list, "s", "2026-10-19"), 1);
  assert.equal(remaining(S, list, "s", "2026-10-20"), 1);
  assert.equal(remaining(S, list, "s", "2026-10-21"), 2, "퇴실날(10/21) 밤은 다시 팔 수 있어요");
});

test("퇴실하는 날 같은 방에 다른 손님을 받을 수 있어요", () => {
  const a = bk({ roomId: "r201", nights: 2 });
  const free = freeRooms(S, [a], { id: "new", kind: "stay", checkIn: "2026-10-20", nights: 1, startTime: null, endTime: null });
  assert.ok(free.has("r201"));
  const busy = freeRooms(S, [a], { id: "new", kind: "stay", checkIn: "2026-10-19", nights: 1, startTime: null, endTime: null });
  assert.ok(!busy.has("r201"));
});

test("대실은 남은 객실 계산에 들어가지 않아요", () => {
  const list = [
    bk({ kind: "dayuse", nights: null, startTime: "12:00", endTime: "14:00", roomId: "r201" }),
    bk({ kind: "dayuse", nights: null, startTime: "15:00", endTime: "17:00" }),
  ];
  assert.equal(remaining(S, list, "s", "2026-10-18"), 2);
});

test("취소·노쇼는 재고를 돌려줘요", () => {
  const a = bk({ nights: 2 });
  const b = bk({});
  assert.equal(remaining(S, [a, b], "s", "2026-10-18"), 0);
  const cancelled = [{ ...a, status: "cancelled" as const, cancelledAt: "2026-10-18T01:00:00Z" }, { ...b, status: "noshow" as const }];
  assert.equal(remaining(S, cancelled, "s", "2026-10-18"), 2);
  assert.equal(remaining(S, cancelled, "s", "2026-10-19"), 2);
});

test("방을 정하면 실제 들어간 방의 타입에서 빠져요 (S로 팔고 SD 방 배정)", () => {
  const up = bk({ typeId: "s", roomId: "r203" });
  assert.equal(remaining(S, [up], "s", "2026-10-18"), 2, "판 타입 S는 그대로");
  assert.equal(remaining(S, [up], "sd", "2026-10-18"), 0, "실제 방 타입 SD에서 빠져요");
  const noRoom = bk({ typeId: "s", roomId: null });
  assert.equal(remaining(S, [noRoom], "s", "2026-10-18"), 1, "방이 없으면 판 타입에서 빠져요");
});

test("오버부킹은 마이너스, 가장 가까운 날짜를 알려 줘요", () => {
  const list = [bk({ typeId: "bg", checkIn: "2026-10-20" }), bk({ typeId: "bg", checkIn: "2026-10-20" })];
  const dates = [0, 1, 2, 3].map((i) => addDays("2026-10-18", i));
  const t = stockTable(S, list, dates);
  assert.equal(t.get("bg")!.get("2026-10-20"), -1);
  const o = firstOverbooking(S, t, dates);
  assert.deepEqual([o?.date, o?.type.code, o?.over], ["2026-10-20", "BG", 1]);
});

test("표시 단계: 여유 / 적음 / 만실 / 초과", () => {
  assert.equal(stockLevel(5, 14, 2), "ok");
  assert.equal(stockLevel(2, 14, 2), "low");
  assert.equal(stockLevel(1, 1, 2), "ok", "1실짜리 타입은 '적음'을 쓰지 않아요");
  assert.equal(stockLevel(0, 14, 2), "full");
  assert.equal(stockLevel(-1, 14, 2), "over");
  assert.equal(stockLevel(3, 14, 3), "low", "기준은 설정에서 바꿀 수 있어요");
});

test("취소한 숙박은 줄 그어 보이다가, 새 예약이 그 방을 채우면 보드에서 사라져요", () => {
  const c = bk({ roomId: "r201", nights: 2, status: "cancelled", cancelledAt: "2026-10-18T02:00:00Z" });
  let board = nightBoard(S, [c], "2026-10-18");
  assert.equal(board.byRoom.get("r201")?.id, c.id, "취소한 예약이 줄 그어 보여요");
  const n = bk({ roomId: "r201", checkIn: "2026-10-19", nights: 1, createdAt: "2026-10-18T03:00:00Z" });
  board = nightBoard(S, [c, n], "2026-10-18");
  assert.equal(board.byRoom.get("r201"), undefined, "겹치는 밤을 새 예약이 채우면 취소 예약은 사라져요");
  assert.equal(nightBoard(S, [c, n], "2026-10-19").byRoom.get("r201")?.id, n.id);
});

test("방 없는 취소 숙박은 같은 타입 새 예약이 들어오면 사라져요", () => {
  const c = bk({ typeId: "s", status: "noshow", cancelledAt: "2026-10-18T02:00:00Z", createdAt: "2026-10-17T00:00:00Z" });
  const older = bk({ typeId: "s", createdAt: "2026-10-17T05:00:00Z" });
  assert.equal(nightBoard(S, [c, older], "2026-10-18").unassigned.length, 2, "취소 전에 있던 예약은 자리를 채운 게 아니에요");
  const newer = bk({ typeId: "s", createdAt: "2026-10-18T03:00:00Z" });
  const u = nightBoard(S, [c, older, newer], "2026-10-18").unassigned;
  assert.deepEqual(u.map((b) => b.id).sort(), [older.id, newer.id].sort());
});

test("영업일: 새벽 6시 전 도착은 전날 밤으로 쳐요 (서울 시간)", () => {
  assert.equal(businessDate(new Date("2026-10-18T16:30:00Z")), "2026-10-18", "10/19 01:30 KST → 10/18 밤");
  assert.equal(businessDate(new Date("2026-10-18T20:59:00Z")), "2026-10-18", "10/19 05:59 KST → 10/18 밤");
  assert.equal(businessDate(new Date("2026-10-18T21:00:00Z")), "2026-10-19", "10/19 06:00 KST부터 새 영업일");
  assert.equal(businessDate(new Date("2026-10-18T09:00:00Z")), "2026-10-18");
});

test("미리보기: 저장하면 'S 남은 객실 2 → 1'처럼 바뀌는 밤만 보여 줘요", () => {
  const draft = bk({ nights: 2 });
  const pv = previewChange(S, [], draft);
  assert.deepEqual(pv.map((r) => [r.date, r.typeId, r.before, r.after]), [
    ["2026-10-18", "s", 2, 1],
    ["2026-10-19", "s", 2, 1],
  ]);
  // 수정: S 방 없음 → SD 방(203) 배정
  const saved = bk({});
  const edit = { ...saved, roomId: "r203" };
  const pv2 = previewChange(S, [saved], edit);
  assert.deepEqual(pv2.map((r) => [r.typeId, r.before, r.after]), [
    ["s", 1, 2],
    ["sd", 1, 0],
  ]);
});

test("총액으로 적고 1박 평균은 자동 계산", () => {
  assert.equal(perNight({ price: 148000, nights: 2 }), 74000);
  assert.equal(perNight({ price: 80000, nights: 1 }), null);
});

test("대실은 이용시간이 꼭 있어야 저장돼요", () => {
  const d = bk({ kind: "dayuse", nights: null, startTime: null, endTime: null });
  assert.match(validateBooking(d, S) ?? "", /이용시간/);
  assert.equal(validateBooking({ ...d, startTime: "12:00", endTime: "14:00" }, S), null);
  assert.equal(validateBooking(bk({ nights: 2 }), S), null);
});

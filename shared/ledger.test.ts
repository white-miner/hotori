import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Booking,
  type HotelSettings,
  addDays,
  businessDate,
  firstOverbooking,
  TYPE_NAME_MAX,
  parseTime,
  addMinutesToTime,
  dayuseMinutes,
  nowRounded,
  typeLabel,
  usableTypes,
  addRoomsToFloor,
  addFloorOnTop,
  allRooms,
  duplicateRoomNos,
  floorsOf,
  freeRooms,
  moveFloor,
  nightBoard,
  normalizeSettings,
  orderedFloors,
  parseRoomInput,
  removeBuilding,
  roomLabel,
  perNight,
  previewChange,
  remaining,
  stockLevel,
  stockTable,
  validateBooking,
} from "./ledger.ts";

// 건물 정보가 없던 예전 형식 그대로 (normalizeSettings가 '본관' 하나로 채워요)
const S: HotelSettings = normalizeSettings({
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
});

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
  assert.deepEqual([o?.date, o?.type.name, o?.over], ["2026-10-20", "BG", 1]);
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

// ---------- 건물 (본관·별관) ----------
/** 본관 2층(201~203) + 별관 2층(201·202): 방 번호가 건물마다 겹쳐요 */
const M: HotelSettings = normalizeSettings({
  lowThreshold: 2,
  buildings: [
    { id: "b-main", name: "본관" },
    { id: "b-annex", name: "별관" },
  ],
  types: S.types,
  platforms: S.platforms,
  floors: [
    { ...S.floors[0], buildingId: "b-main" },
    {
      id: "fa2",
      name: "2층",
      buildingId: "b-annex",
      rooms: [
        { id: "ra201", no: "201", typeId: "s" },
        { id: "ra202", no: "202", typeId: "sd" },
      ],
    },
  ],
});

test("건물 마이그레이션: 예전 설정은 그대로 두고 '본관' 하나에 모든 층을 넣어요", () => {
  assert.deepEqual(S.buildings, [{ id: "b-main", name: "본관" }]);
  assert.deepEqual(
    S.floors.map((f) => [f.id, f.buildingId, f.rooms.length]),
    [
      ["f2", "b-main", 3],
      ["f6", "b-main", 1],
    ],
  );
  assert.equal(S.floors[0].color, "#DDE8F3", "층 색·방 정보는 그대로");
  assert.equal(roomLabel(S, "r201"), "201", "건물이 하나면 예전처럼 번호만 보여요");
  // DB 마이그레이션 결과(JSON)를 다시 읽어도 똑같아요
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(S))), S);
  // 모르는 건물을 가리키는 층은 첫 건물로
  const odd = normalizeSettings({ buildings: [{ id: "x", name: "A동" }], floors: [{ id: "f", name: "1층", buildingId: "gone", rooms: [] }] });
  assert.equal(odd.floors[0].buildingId, "x");
  assert.deepEqual(normalizeSettings(null).buildings, [{ id: "b-main", name: "본관" }]);
});

test("건물이 달라도 같은 방 번호를 쓸 수 있고, 이름은 '별관 201'로 보여요", () => {
  assert.deepEqual(duplicateRoomNos(M), []);
  assert.equal(roomLabel(M, "r201"), "본관 201");
  assert.equal(roomLabel(M, "ra201"), "별관 201");
  assert.deepEqual(
    allRooms(M).map((r) => `${r.buildingId}:${r.no}`),
    ["b-main:201", "b-main:202", "b-main:203", "b-annex:201", "b-annex:202"],
  );
});

test("방 추가(601~610 범위)는 그대로, 같은 건물 안 번호만 건너뛰어요", () => {
  assert.deepEqual(parseRoomInput("601~610"), ["601", "602", "603", "604", "605", "606", "607", "608", "609", "610"]);
  assert.deepEqual(parseRoomInput("201-203, 펜션1"), ["201", "202", "203", "펜션1"]);
  let n = 0;
  const id = () => `new${++n}`;
  const a = addRoomsToFloor(M, "fa2", "201~204", "s", id);
  assert.deepEqual(a.added, ["203", "204"], "별관에 이미 있는 201·202만 건너뛰어요 (본관 201~203과는 상관없어요)");
  assert.deepEqual(a.skipped, ["201", "202"]);
  assert.deepEqual(duplicateRoomNos(a.settings), []);
  assert.equal(floorsOf(a.settings, "b-annex")[0].rooms.length, 4);
  assert.equal(floorsOf(a.settings, "b-main")[0].rooms.length, 3, "본관은 그대로");
});

test("겹치는 예약 확인은 방 번호가 아니라 그 건물의 그 방 기준이에요", () => {
  const main201 = bk({ roomId: "r201", nights: 2 });
  const free = freeRooms(M, [main201], { id: "new", kind: "stay", checkIn: "2026-10-19", nights: 1, startTime: null, endTime: null });
  assert.ok(!free.has("r201"), "본관 201은 찼어요");
  assert.ok(free.has("ra201"), "별관 201은 비어 있어요");
  const board = nightBoard(M, [main201], "2026-10-18");
  assert.equal(board.byRoom.get("r201")?.id, main201.id);
  assert.equal(board.byRoom.get("ra201"), undefined);
  // 남은 객실은 건물과 상관없이 타입별 합계 (S: 본관 2 + 별관 1 = 3)
  assert.equal(remaining(M, [], "s", "2026-10-18"), 3);
  assert.equal(remaining(M, [main201], "s", "2026-10-18"), 2);
  const annexSd = bk({ typeId: "s", roomId: "ra202" });
  assert.equal(remaining(M, [annexSd], "sd", "2026-10-18"), 1, "별관 SD 방에 배정하면 SD에서 빠져요");
});

test("층 순서는 같은 건물 안에서만 바뀌고, 건물을 지우면 그 층·방도 지워져요", () => {
  const two = normalizeSettings({
    ...M,
    floors: [...M.floors, { id: "fm3", name: "3층", buildingId: "b-main", rooms: [] }],
  });
  assert.deepEqual(orderedFloors(two).map((f) => f.id), ["f2", "fm3", "fa2"], "건물 순서 → 층 순서");
  const moved = moveFloor(two, "fm3", -1);
  assert.deepEqual(orderedFloors(moved).map((f) => f.id), ["fm3", "f2", "fa2"]);
  assert.deepEqual(orderedFloors(moveFloor(two, "fa2", -1)).map((f) => f.id), ["f2", "fm3", "fa2"], "다른 건물로 넘어가지 않아요");
  const gone = removeBuilding(M, "b-annex");
  assert.deepEqual(gone.buildings.map((b) => b.name), ["본관"]);
  assert.equal(allRooms(gone).length, 3);
  assert.equal(removeBuilding(gone, "b-main"), gone, "마지막 건물은 지울 수 없어요");
});

test("객실 타입은 이름 하나(최대 12글자) — 옛 약자 데이터는 화면에 보이던 약자를 이름으로", () => {
  assert.equal(TYPE_NAME_MAX, 12);
  const long = { id: "long", name: "스탠다드디럭스오션뷰트윈" };
  assert.equal(long.name.length, 12);
  const s2 = normalizeSettings({
    ...M,
    types: [
      ...M.types,
      long,
      { id: "old1", code: "스탠다드", name: "새 타입" },
      { id: "old2", code: "N", name: "새 타입" },
      { id: "old3", code: "", name: "트윈" },
      { id: "old4", code: "", name: "새 타입" },
      { id: "new", name: "" },
    ],
  });
  const byId = new Map(s2.types.map((t) => [t.id, t]));
  assert.equal(byId.get("long")?.name, long.name, "저장·불러오기에서 잘리지 않아요");
  assert.equal(byId.get("sd")?.name, "SD", "약자가 있던 타입은 보이던 약자 그대로");
  assert.equal(byId.get("old1")?.name, "스탠다드");
  assert.equal(byId.get("old2")?.name, "N");
  assert.equal(byId.get("old3")?.name, "트윈", "약자가 없으면 예전 이름");
  assert.equal(byId.get("old4")?.name, "", "'새 타입' 기본값은 비워서 '객실 타입' 안내가 보이게");
  assert.equal(normalizeSettings(s2).types.find((t) => t.id === "sd")?.name, "SD", "다시 불러와도 그대로");
  assert.deepEqual(usableTypes(s2.types).map((t) => t.id).includes("new"), false, "빈 타입은 고를 수 없어요");
  assert.equal(typeLabel(byId.get("old1")), "스탠다드");
  assert.equal(validateBooking(bk({ typeId: "long" }), s2), null);
  assert.equal(validateBooking(bk({ typeId: "new" }), s2), "객실 타입을 골라 주세요.");
});

test("층 추가: 새 층은 그 건물 맨 위에, 이름은 가장 큰 층 + 1", () => {
  const two = normalizeSettings({
    ...M,
    floors: [{ id: "fm5", name: "5층", buildingId: "b-main", rooms: [] }, ...M.floors],
  });
  const before = floorsOf(two, "b-main").map((f) => f.id);
  const added = addFloorOnTop(two, "b-main", "fnew");
  const main = floorsOf(added, "b-main");
  assert.deepEqual(main.map((f) => f.id), ["fnew", ...before], "본관 맨 위에 생겨요");
  assert.equal(main[0].name, "6층");
  assert.deepEqual(floorsOf(added, "b-annex").map((f) => f.id), floorsOf(two, "b-annex").map((f) => f.id), "별관은 그대로");
  const annex = floorsOf(addFloorOnTop(two, "b-annex", "fa3"), "b-annex");
  assert.equal(annex[0].id, "fa3");
  assert.deepEqual(orderedFloors(moveFloor(added, "fnew", 1)).filter((f) => f.buildingId === "b-main")[1].id, "fnew", "이동 버튼도 그대로");
  const empty = normalizeSettings({ buildings: [{ id: "x", name: "A동" }], floors: [] });
  const first = addFloorOnTop(empty, "x", "f1");
  assert.equal(first.floors[0].name, "1층");
});

test("대실 시간: 사람이 적은 그대로 알아들어요", () => {
  const cases: [string, string][] = [
    ["13:30", "13:30"], ["1330", "13:30"], ["930", "09:30"], ["9:5", "09:05"], ["13", "13:00"], ["9", "09:00"],
    ["13시 30분", "13:30"], ["13시", "13:00"], ["오후 1:30", "13:30"], ["1:30 PM", "13:30"], ["오전 12:10", "00:10"], ["13.30", "13:30"],
    ["24:00", "00:00"], ["2400", "00:00"], ["2460", ""], ["25:00", ""], ["13:60", ""], ["abc", ""], ["", ""], ["13305", ""],
  ];
  for (const [i, o] of cases) assert.equal(parseTime(i), o, i);
  assert.equal(addMinutesToTime("13:30", 120), "15:30");
  assert.equal(addMinutesToTime("23:30", 120), "01:30", "자정을 넘겨요");
  assert.equal(dayuseMinutes("13:30", "15:30"), 120);
  assert.equal(dayuseMinutes("23:30", "01:30"), 120);
  assert.equal(nowRounded(new Date(2026, 9, 18, 13, 32)), "13:30");
  assert.equal(nowRounded(new Date(2026, 9, 18, 13, 33)), "13:35");
  assert.equal(nowRounded(new Date(2026, 9, 18, 23, 58)), "00:00");
});

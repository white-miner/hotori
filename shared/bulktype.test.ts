// 객실 배치 · 여러 개 선택: 층·건물이 달라도 · 층 전체 · shift 범위 · 한 번 저장 · 되돌리기 · 알림 글
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "./ledger";
import { addRooms, applyType, bulkToast, floorAllSelected, roomRange, roomsLabel, toggleFloor, toggleRoom, undoType, withRo } from "./bulktype";

const room = (no: string, typeId: string | null = "s") => ({ id: `r${no}`, no, typeId });
const S = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }, { id: "p", name: "스탠다드 2PC" }, { id: "t", name: "트윈" }],
  floors: [
    { id: "f3", name: "3층", rooms: ["301", "302", "303", "304", "305"].map((n) => room(n)) },
    { id: "f5", name: "5층", rooms: ["501", "502", "503", "504", "505", "506", "507", "508", "509"].map((n) => room(n)) },
    { id: "f6", name: "6층", rooms: ["605", "606", "607", "608"].map((n) => room(n, n === "606" ? "p" : "s")) },
  ],
});

test("층이 달라도 띄엄띄엄 고르기 (503 · 507 · 509 · 303 · 305)", () => {
  let sel = new Set<string>();
  for (const n of ["503", "507", "509", "303", "305"]) sel = toggleRoom(sel, `r${n}`);
  assert.equal(sel.size, 5);
  sel = toggleRoom(sel, "r507");
  assert.equal(sel.has("r507"), false);
  const r = applyType(S, toggleRoom(sel, "r507"), "t");
  assert.equal(r.changed, 5);
  const types = new Map(r.settings.floors.flatMap((f) => f.rooms.map((x) => [x.no, x.typeId])));
  assert.deepEqual(["503", "507", "509", "303", "305", "504", "301"].map((n) => types.get(n)), ["t", "t", "t", "t", "t", "s", "s"]);
});
test("층 전체: 다 골라져 있으면 빼고, 아니면 모두", () => {
  let sel = toggleFloor(S, new Set(["r301"]), "f3");
  assert.equal(sel.size, 5);
  assert.equal(floorAllSelected(S, sel, "f3"), true);
  sel = toggleFloor(S, sel, "f3");
  assert.equal(sel.size, 0);
});
test("shift-클릭 범위: 화면 순서로 층을 넘어도", () => {
  assert.deepEqual(roomRange(S, "r304", "r502"), ["r304", "r305", "r501", "r502"]);
  assert.deepEqual(roomRange(S, "r502", "r304"), ["r304", "r305", "r501", "r502"]);
  assert.equal(addRooms(new Set(["r301"]), roomRange(S, "r304", "r305")).size, 3);
});
test("이미 그 타입인 방은 그대로 · 되돌리기는 바꾼 방만 예전 타입으로", () => {
  const sel = new Set(["r605", "r606", "r607", "r608"]);
  const r = applyType(S, sel, "p");
  assert.equal(r.changed, 3); // 606은 원래 2PC
  assert.deepEqual([...r.prev.entries()], [["r605", "s"], ["r607", "s"], ["r608", "s"]]);
  const back = undoType(r.settings, r.prev);
  assert.deepEqual(back.floors[2].rooms.map((x) => x.typeId), ["s", "p", "s", "s"]);
  assert.equal(applyType(S, new Set(["r606"]), "p").settings, S); // 바뀐 게 없으면 저장할 것도 없음
  assert.equal(applyType(S, new Set(["r301"]), null).settings.floors[0].rooms[0].typeId, null); // 타입 없음
});
test("알림 글: '605–608호 4개를 스탠다드 2PC로 바꿨어요'", () => {
  assert.equal(bulkToast(S, ["r605", "r606", "r607", "r608"], 4, "스탠다드 2PC"), "605–608호 4개를 스탠다드 2PC로 바꿨어요");
  assert.equal(roomsLabel(S, ["r503", "r507", "r303"]), "303 · 503 · 507호");
  assert.equal(roomsLabel(S, ["r501", "r502", "r503", "r504", "r505", "r506", "r507", "r508"]), "501–508호");
  assert.equal(roomsLabel(S, ["r301", "r303", "r501", "r503", "r505", "r507", "r509"]), "301 · 303 · 501 · 503 · 505 · 507호 외 1개");
  assert.equal(withRo("트윈"), "트윈으로");
  assert.equal(withRo("온돌VIP"), "온돌VIP로");
  assert.equal(withRo("스탠다드 욕조"), "스탠다드 욕조로");
  assert.equal(withRo("패밀리룸"), "패밀리룸으로");
  assert.equal(withRo("호텔"), "호텔로");
  assert.equal(bulkToast(S, ["r301"], 1, null), "301호 1개를 타입 없음으로 바꿨어요");
});

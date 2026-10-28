import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRAG_MOUSE_PX, DRAG_TOUCH_HOLD_MS, DRAG_TOUCH_SLOP_PX, dragIntent, dragStartNight, edgeScrollDelta, resolveDrop } from "./dragTarget";
import { type Booking, normalizeSettings } from "./ledger";
import { cancelledCardsByRoom } from "./nowboard";

describe("dragIntent", () => {
  it("마우스: 조금 움직인 건 클릭, 기준 넘으면 시작", () => {
    assert.equal(dragIntent({ pointerType: "mouse", dx: 2, dy: 2, heldMs: 900 }), "wait");
    assert.equal(dragIntent({ pointerType: "mouse", dx: DRAG_MOUSE_PX, dy: 0, heldMs: 10 }), "start");
    assert.equal(dragIntent({ pointerType: "pen", dx: 0, dy: -20, heldMs: 0 }), "start");
  });
  it("터치: 꾹 누르면 시작, 그 전에 움직이면 스크롤(취소)", () => {
    assert.equal(dragIntent({ pointerType: "touch", dx: 0, dy: 0, heldMs: 100 }), "wait");
    assert.equal(dragIntent({ pointerType: "touch", dx: DRAG_TOUCH_SLOP_PX, dy: 0, heldMs: 100 }), "wait"); // 손 떨림
    assert.equal(dragIntent({ pointerType: "touch", dx: 0, dy: DRAG_TOUCH_SLOP_PX + 1, heldMs: 100 }), "cancel");
    assert.equal(dragIntent({ pointerType: "touch", dx: 1, dy: 0, heldMs: DRAG_TOUCH_HOLD_MS }), "start");
  });
});

describe("resolveDrop", () => {
  const base = { from: "r1", targets: new Set(["r2", "r3"]), swapTargets: new Map([["r4", {}]]), bookedTypeId: "t-s", typeOf: (id: string) => (id === "r3" ? "t-d" : "t-s") };
  it("빈 같은 타입 방 = 바로 이동", () => {
    assert.deepEqual(resolveDrop({ ...base, roomId: "r2" }), { kind: "move", roomId: "r2", confirm: false });
  });
  it("빈 다른 타입 방 = 확인 필요", () => {
    assert.deepEqual(resolveDrop({ ...base, roomId: "r3" }), { kind: "move", roomId: "r3", confirm: true });
  });
  it("점유 방 = 맞교환", () => {
    assert.deepEqual(resolveDrop({ ...base, roomId: "r4" }), { kind: "swap", roomId: "r4" });
  });
  it("놓을 수 없는 곳: 칸 밖·원래 방·후보 아님 = 취소", () => {
    assert.deepEqual(resolveDrop({ ...base, roomId: null }), { kind: "none", reason: "outside" });
    assert.deepEqual(resolveDrop({ ...base, roomId: "r1" }), { kind: "none", reason: "source" });
    assert.deepEqual(resolveDrop({ ...base, roomId: "r9" }), { kind: "none", reason: "blocked" });
  });
  it("타입 미정 예약은 방 타입이 있으면 확인", () => {
    assert.deepEqual(resolveDrop({ ...base, bookedTypeId: null, roomId: "r2" }), { kind: "move", roomId: "r2", confirm: true });
  });
});

describe("edgeScrollDelta", () => {
  it("가운데 0, 위 가장자리 음수, 아래 가장자리 양수, 끝에 갈수록 빠름", () => {
    assert.equal(edgeScrollDelta(400, 0, 800), 0);
    assert.ok(edgeScrollDelta(30, 0, 800) < 0);
    assert.ok(edgeScrollDelta(780, 0, 800) > 0);
    assert.ok(edgeScrollDelta(0, 0, 800) <= edgeScrollDelta(40, 0, 800));
    assert.equal(edgeScrollDelta(-50, 0, 800), -22);
  });
  it("영역이 비정상이면 0", () => {
    assert.equal(edgeScrollDelta(5, 10, 10), 0);
  });
});

// ─── 현황 카드 끌기: 어느 밤부터 · 취소 카드 (옛 「배치」와 같은 규칙) ───
const SX = normalizeSettings({
  types: [{ id: "s", name: "스탠다드" }],
  platforms: [{ id: "p", name: "야놀자", abbr: "야" }],
  floors: [{ id: "f6", name: "6층", rooms: [{ id: "r601", no: "601", typeId: "s" }, { id: "r602", no: "602", typeId: "s" }, { id: "r603", no: "603", typeId: "s" }] }],
});
let nx = 0;
const bx = (p: Partial<Booking>): Booking => ({
  id: `x${++nx}`, kind: "stay", status: "active", platformId: "p", price: 300000, guestName: `손님${nx}`, typeId: "s", roomId: "r601",
  checkIn: "2026-10-26", nights: 3, startTime: null, endTime: null, arrived: false, memo: null, cancelledAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", segments: null, ...p,
});

it("끌기 시작 밤: 입실일·퇴실하는 날은 숙박 전체(입실일), 묵는 중이면 보는 밤부터", () => {
  const b = bx({}); // 10/26 3박 → 밤 26·27·28, 퇴실 29
  assert.equal(dragStartNight(b, "2026-10-26"), "2026-10-26");
  assert.equal(dragStartNight(b, "2026-10-27"), "2026-10-27");
  assert.equal(dragStartNight(b, "2026-10-28"), "2026-10-28");
  assert.equal(dragStartNight(b, "2026-10-29"), "2026-10-26"); // 퇴실하는 날 카드
});

it("취소 카드: 살아 있는 카드가 없는 방에만 · 새 예약이 같은 자리를 채우면 사라져요", () => {
  const live = bx({ roomId: "r601" });
  const cx = bx({ roomId: "r602", status: "cancelled", cancelledAt: "2026-10-20T00:00:00Z" });
  const ns = bx({ roomId: "r603", status: "noshow", cancelledAt: "2026-10-20T00:00:00Z" });
  const refilled = bx({ roomId: "r603" }); // r603 을 새 예약이 채움
  const all = [live, cx, ns];
  const m = cancelledCardsByRoom(SX, all, "2026-10-27", "2026-10-27", new Set(["r601"]));
  assert.deepEqual([...m.keys()].sort(), ["r602", "r603"]);
  assert.equal(m.get("r602")!.status, "cancelled");
  assert.equal(m.get("r603")!.status, "noshow");
  // 살아 있는 카드가 있는 방은 빼요
  assert.equal(cancelledCardsByRoom(SX, all, "2026-10-27", "2026-10-27", new Set(["r601", "r602"])).has("r602"), false);
  // 새 예약이 같은 자리를 채우면 취소 카드는 안 나와요
  assert.equal(cancelledCardsByRoom(SX, [...all, refilled], "2026-10-27", "2026-10-27", new Set(["r601", "r603"])).has("r603"), false);
  // 취소 예약이 없는 밤엔 없어요
  assert.equal(cancelledCardsByRoom(SX, all, "2026-11-20", "2026-10-27", new Set()).size, 0);
});

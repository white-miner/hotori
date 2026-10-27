import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRAG_MOUSE_PX, DRAG_TOUCH_HOLD_MS, DRAG_TOUCH_SLOP_PX, dragIntent, edgeScrollDelta, resolveDrop } from "./dragTarget";

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

import test from "node:test";
import assert from "node:assert/strict";
import { escSidebarAction, parsePinned, resolveSidebarSwitch, selectionAfterFilter, visibleNowRoomIds } from "./sidebar";

test("스위치: 기본값은 켜짐 (주소 인자·저장값 없음)", () => {
  assert.deepEqual(resolveSidebarSwitch("", null), { on: true, store: null, cleanSearch: null });
  assert.equal(resolveSidebarSwitch("?x=1", null).on, true);
});

test("스위치: 저장값 '0' 만 끔, 옛 저장값 '1' 과 알 수 없는 저장값은 켬", () => {
  assert.deepEqual(resolveSidebarSwitch("", "0"), { on: false, store: null, cleanSearch: null });
  assert.equal(resolveSidebarSwitch("", "1").on, true);
  assert.equal(resolveSidebarSwitch("?x=1", "abc").on, true);
});

test("스위치: ?sidebar=0 은 끄고 '0' 저장, 주소에서 인자를 뺀다", () => {
  assert.deepEqual(resolveSidebarSwitch("?sidebar=0", null), { on: false, store: "0", cleanSearch: "" });
  assert.deepEqual(resolveSidebarSwitch("?a=b&sidebar=0", "1"), { on: false, store: "0", cleanSearch: "?a=b" });
});

test("스위치: ?sidebar=1 은 켜고 저장값(0)을 지운다", () => {
  assert.deepEqual(resolveSidebarSwitch("?sidebar=1", "0"), { on: true, store: "remove", cleanSearch: "" });
  assert.deepEqual(resolveSidebarSwitch("?a=b&sidebar=1", null), { on: true, store: "remove", cleanSearch: "?a=b" });
});

test("스위치: 알 수 없는 인자 값은 무시하고 저장값을 따른다", () => {
  assert.deepEqual(resolveSidebarSwitch("?sidebar=abc", "0"), { on: false, store: null, cleanSearch: null });
  assert.deepEqual(resolveSidebarSwitch("?sidebar=abc", null), { on: true, store: null, cleanSearch: null });
  assert.deepEqual(resolveSidebarSwitch("?sidebar=", null), { on: true, store: null, cleanSearch: null });
});

test("고정 저장값은 '1' 만 고정", () => {
  assert.equal(parsePinned("1"), true);
  assert.equal(parsePinned("0"), false);
  assert.equal(parsePinned(null), false);
});

test("Esc: 다른 곳이 처리했거나 열린 창이 있으면 사이드바는 안 닫는다", () => {
  const base = { defaultPrevented: false, modalOpen: false, menuOpen: false, expanded: true, pinned: false };
  assert.equal(escSidebarAction({ ...base, defaultPrevented: true }), null);
  assert.equal(escSidebarAction({ ...base, modalOpen: true }), null);
});

test("Esc: 계정 메뉴가 먼저, 그다음 임시 펼침. 고정은 Esc 로 안 닫힘", () => {
  const base = { defaultPrevented: false, modalOpen: false, menuOpen: false, expanded: true, pinned: false };
  assert.equal(escSidebarAction({ ...base, menuOpen: true }), "menu");
  assert.equal(escSidebarAction(base), "collapse");
  assert.equal(escSidebarAction({ ...base, pinned: true }), null);
  assert.equal(escSidebarAction({ ...base, expanded: false }), null);
});

test("선택 자동 해제: 필터로 사라진 객실만 선택에서 빠진다", () => {
  const vis = new Set(["r1", "r2"]);
  assert.deepEqual(selectionAfterFilter(["r1", "r3"], vis), ["r1"]);
  assert.deepEqual(selectionAfterFilter(["r3"], vis), []);
});

test("선택 자동 해제: 변화가 없으면 같은 배열(불필요한 갱신 없음)", () => {
  const sel = ["r1", "r2"];
  assert.equal(selectionAfterFilter(sel, new Set(["r1", "r2", "r9"])), sel);
  const none: string[] = [];
  assert.equal(selectionAfterFilter(none, new Set()), none);
});

test("현황 보이는 객실: 건물·층·임시만 필터만 감춘다", () => {
  const floors = [
    { id: "f1", buildingId: "b1", rooms: [{ id: "101" }, { id: "102" }] },
    { id: "f2", buildingId: "b2", rooms: [{ id: "201" }] },
  ];
  const base = { buildingScope: null, floorTab: "all", tentativeOnly: false, isTentative: () => false };
  assert.deepEqual([...visibleNowRoomIds(floors, base)].sort(), ["101", "102", "201"]);
  assert.deepEqual([...visibleNowRoomIds(floors, { ...base, buildingScope: "b2" })], ["201"]);
  assert.deepEqual([...visibleNowRoomIds(floors, { ...base, floorTab: "f1" })].sort(), ["101", "102"]);
  assert.deepEqual([...visibleNowRoomIds(floors, { ...base, tentativeOnly: true, isTentative: (id) => id === "102" })], ["102"]);
});

test("필터로 감춰진 선택은 빠지고, 그대로면 같은 배열", () => {
  const sel = ["101", "201"];
  assert.equal(selectionAfterFilter(sel, new Set(["101", "201"])), sel);
  assert.deepEqual(selectionAfterFilter(sel, new Set(["201"])), ["201"]);
  assert.deepEqual(selectionAfterFilter(sel, new Set()), []);
});

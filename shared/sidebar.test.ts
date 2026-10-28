import test from "node:test";
import assert from "node:assert/strict";
import { escSidebarAction, parsePinned, resolveSidebarSwitch, selectionAfterFilter } from "./sidebar";

test("스위치: 기본값은 꺼짐", () => {
  assert.deepEqual(resolveSidebarSwitch("", null), { on: false, store: null, cleanSearch: null });
  assert.equal(resolveSidebarSwitch("", "0").on, false);
  assert.equal(resolveSidebarSwitch("?x=1", "abc").on, false);
});

test("스위치: ?sidebar=1 은 켜고 저장, 주소에서 인자를 뺀다", () => {
  assert.deepEqual(resolveSidebarSwitch("?sidebar=1", null), { on: true, store: "1", cleanSearch: "" });
  assert.deepEqual(resolveSidebarSwitch("?a=b&sidebar=1", null), { on: true, store: "1", cleanSearch: "?a=b" });
});

test("스위치: 저장값이 켜져 있으면 인자 없이도 켜짐, ?sidebar=0 은 끄고 저장을 지운다", () => {
  assert.deepEqual(resolveSidebarSwitch("", "1"), { on: true, store: null, cleanSearch: null });
  assert.deepEqual(resolveSidebarSwitch("?sidebar=0", "1"), { on: false, store: "remove", cleanSearch: "" });
});

test("스위치: 알 수 없는 인자 값은 무시하고 저장값을 따른다", () => {
  assert.deepEqual(resolveSidebarSwitch("?sidebar=abc", "1"), { on: true, store: null, cleanSearch: null });
  assert.deepEqual(resolveSidebarSwitch("?sidebar=", null), { on: false, store: null, cleanSearch: null });
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

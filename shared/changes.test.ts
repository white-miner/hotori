import { test } from "node:test";
import assert from "node:assert/strict";
import { type Change, atLabel, changesFor, cleanNote, extendSummary, joinSummary, leaveSummary, noteBookingIds, pinnedNote } from "./changes.ts";

const c = (id: string, kind: Change["kind"], at: string, o: Partial<Change> = {}): Change => ({ id, groupId: "g1", bookingId: null, kind, summary: id, effectiveOn: null, pinned: false, at, ...o });

test("cleanNote: 공백 정리 · 300자 · 빈 값은 null", () => {
  assert.equal(cleanNote("   "), null);
  assert.equal(cleanNote("  602호   2인으로  "), "602호 2인으로");
  assert.equal(cleanNote("가".repeat(400))!.length, 300);
});
test("changesFor: 최신이 위 · 고정 메모가 맨 위 · 다른 단체는 안 나옴", () => {
  const list = [c("a", "money", "2026-10-28T01:00:00Z"), c("b", "note", "2026-10-28T02:00:00Z"), c("p", "note", "2026-10-20T02:00:00Z", { pinned: true }), c("x", "money", "2026-10-28T03:00:00Z", { groupId: "g2" })];
  assert.deepEqual(changesFor(list, { groupId: "g1" }).map((x) => x.id), ["p", "b", "a"]);
  assert.deepEqual(changesFor(list, { groupId: "g1" }, "money").map((x) => x.id), ["a"]);
  assert.deepEqual(changesFor(list, { groupId: "g1" }, "note").map((x) => x.id), ["p", "b"]);
});
test("changesFor: 단체 없이 예약 id로도 찾고, 객실 필터에 연장이 들어와요", () => {
  const list = [c("s", "stay", "2026-10-28T01:00:00Z", { groupId: null, bookingId: "b1" }), c("r", "room", "2026-10-28T02:00:00Z", { groupId: null, bookingId: "b1" })];
  assert.deepEqual(changesFor(list, { bookingIds: ["b1"] }, "room").map((x) => x.id), ["r", "s"]);
  assert.equal(changesFor(list, { bookingIds: ["zz"] }).length, 0);
});
test("pinnedNote · noteBookingIds", () => {
  const list = [c("p", "note", "2026-10-20T02:00:00Z", { pinned: true, summary: "602호 2인 예정" }), c("m", "money", "2026-10-21T02:00:00Z", { summary: "602호 결제" })];
  assert.equal(pinnedNote(list, { groupId: "g1" })?.id, "p");
  assert.deepEqual([...noteBookingIds(list, "2인", () => ["b1", "b2"])], ["b1", "b2"]);
  assert.equal(noteBookingIds(list, "결제", () => ["b1"]).size, 0, "메모만 검색");
  assert.equal(noteBookingIds(list, "2", () => ["b1"]).size, 0, "한 글자는 검색 안 함");
});
test("문장 만들기 · KST 시각", () => {
  assert.equal(atLabel("2026-10-28T05:10:00Z"), "10/28 14:10");
  assert.equal(joinSummary({ roomNo: "302", checkIn: "2026-10-31", nights: 10, rate: 90000 }), "302호 객실 추가 · 10/31부터 10박 · 1박 90,000원");
  assert.equal(leaveSummary({ roomNo: "301", leaveDate: "2026-11-06", nights: 9, price: 720000 }), "301호 조기 퇴실 처리 · 11/6 퇴실 · 9박 720,000원");
  assert.equal(extendSummary({ roomNo: "301", fromNights: 3, toNights: 5, throughDate: "2026-10-30" }), "301호 3박 → 5박 연장 (~10/30)");
});

import { boardGuestSearch } from "./guestSearch.ts";
test("보드 검색: 메모 본문에 든 예약도 찾아요", () => {
  const bk = { id: "b1", guestName: "김", guestPhone: "", groupName: "", groupId: null, status: "active", kind: "stay", checkIn: "2026-10-28", nights: 3, roomId: "r1" } as never;
  const r = boardGuestSearch({ slots: [{ roomId: "r1", booking: bk }], queryRaw: "휠체어", roomLabel: () => "301", noteIds: new Set(["b1"]) });
  assert.deepEqual([...r.roomIds], ["r1"]);
  const none = boardGuestSearch({ slots: [{ roomId: "r1", booking: bk }], queryRaw: "휠체어", roomLabel: () => "301" });
  assert.equal(none.roomIds.size, 0);
});

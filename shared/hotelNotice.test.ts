import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noticeRelativeTime,
  noticeWasEdited,
  sortNoticeFeed,
  unresolvedNoticeCount,
  validateHotelNoticeDraft,
  type HotelNotice,
} from "./hotelNotice";

let n = 0;
const notice = (p: Partial<HotelNotice> & Pick<HotelNotice, "body">): HotelNotice => ({
  id: `n${++n}`,
  status: "open",
  resolvedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: `2026-10-21T0${n}:00:00.000Z`,
  updatedAt: `2026-10-21T0${n}:00:00.000Z`,
  ...p,
});

test("validateHotelNoticeDraft", () => {
  assert.equal(validateHotelNoticeDraft({ body: "" }), "공지를 적어 주세요");
  assert.equal(validateHotelNoticeDraft({ body: "   " }), "공지를 적어 주세요");
  assert.equal(validateHotelNoticeDraft({ body: "겨울 대비 난방 확인" }), null);
  assert.equal(validateHotelNoticeDraft({ body: "x".repeat(281) }), "공지는 280자까지예요");
});

test("unresolvedNoticeCount: open+in_progress only (ack irrelevant)", () => {
  const list = [
    notice({ body: "a", status: "open" }),
    notice({ body: "b", status: "in_progress" }),
    notice({ body: "c", status: "resolved", resolvedAt: "2026-10-21T12:00:00.000Z" }),
    notice({ body: "d", status: "open", ackedAt: "2026-10-21T11:00:00.000Z" }),
  ];
  assert.equal(unresolvedNoticeCount(list), 3);
});

test("sortNoticeFeed: unresolved first · newest · optional resolved", () => {
  const list = [
    notice({ body: "옛 미해결", status: "open", createdAt: "2026-10-20T01:00:00.000Z", updatedAt: "2026-10-20T01:00:00.000Z" }),
    notice({
      body: "해결",
      status: "resolved",
      resolvedAt: "2026-10-21T12:00:00.000Z",
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T12:00:00.000Z",
    }),
    notice({ body: "새 진행", status: "in_progress", createdAt: "2026-10-21T09:00:00.000Z", updatedAt: "2026-10-21T09:00:00.000Z" }),
  ];
  const open = sortNoticeFeed(list, false);
  assert.deepEqual(
    open.map((x) => x.body),
    ["새 진행", "옛 미해결"],
  );
  const all = sortNoticeFeed(list, true);
  assert.deepEqual(
    all.map((x) => x.body),
    ["새 진행", "옛 미해결", "해결"],
  );
});

test("noticeRelativeTime · noticeWasEdited", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  assert.equal(noticeRelativeTime("2026-10-21T11:59:30.000Z", now), "방금");
  assert.equal(noticeRelativeTime("2026-10-21T11:50:00.000Z", now), "10분 전");
  assert.equal(noticeRelativeTime("2026-10-21T10:00:00.000Z", now), "2시간 전");
  assert.equal(
    noticeWasEdited({
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T10:00:00.500Z",
    }),
    false,
  );
  assert.equal(
    noticeWasEdited({
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T11:00:00.000Z",
    }),
    true,
  );
});

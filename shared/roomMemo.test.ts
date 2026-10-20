import { test } from "node:test";
import assert from "node:assert/strict";
import {
  memosForRoom,
  openForHandoff,
  openMemoCounts,
  openMemoGlances,
  validateRoomMemoDraft,
  type RoomMemo,
} from "./roomMemo";

let n = 0;
const memo = (p: Partial<RoomMemo> & Pick<RoomMemo, "roomId" | "body">): RoomMemo => ({
  id: `m${++n}`,
  status: "open",
  kind: "issue",
  resolvedAt: null,
  createdAt: `2026-10-20T0${n}:00:00.000Z`,
  updatedAt: `2026-10-20T0${n}:00:00.000Z`,
  ...p,
});

test("validateRoomMemoDraft: 빈 본문·길이", () => {
  assert.equal(validateRoomMemoDraft({ roomId: "r601", body: "" }), "특이사항을 적어 주세요");
  assert.equal(validateRoomMemoDraft({ roomId: "", body: "인터넷 안됨" }), "방을 확인해 주세요");
  assert.equal(validateRoomMemoDraft({ roomId: "r601", body: "인터넷 안됨" }), null);
  assert.equal(validateRoomMemoDraft({ roomId: "r601", body: "x".repeat(121) }), "특이사항은 120자까지예요");
});

test("openMemoCounts: 미해결만 방마다 센다", () => {
  const list = [
    memo({ roomId: "r601", body: "인터넷 안됨" }),
    memo({ roomId: "r601", body: "리모컨 없음" }),
    memo({ roomId: "r502", body: "변기 막힘", status: "resolved", resolvedAt: "2026-10-20T12:00:00.000Z" }),
    memo({ roomId: "r306", body: "마우스 추가지급", kind: "delivery" }),
  ];
  const c = openMemoCounts(list);
  assert.equal(c.get("r601"), 2);
  assert.equal(c.has("r502"), false);
  assert.equal(c.get("r306"), 1);
});

test("openMemoGlances: 최신 미해결 미리보기 + 건수", () => {
  const list = [
    memo({ roomId: "r601", body: "인터넷 안됨", createdAt: "2026-10-20T01:00:00.000Z" }),
    memo({ roomId: "r601", body: "리모컨 없음", createdAt: "2026-10-20T03:00:00.000Z" }),
    memo({ roomId: "r502", body: "변기 막힘", status: "resolved", resolvedAt: "2026-10-20T12:00:00.000Z" }),
    memo({ roomId: "r306", body: "마우스 추가지급", kind: "delivery" }),
  ];
  const g = openMemoGlances(list);
  assert.equal(g.get("r601")?.count, 2);
  assert.equal(g.get("r601")?.preview, "리모컨 없음");
  assert.match(g.get("r601")?.title ?? "", /인터넷 안됨/);
  assert.equal(g.has("r502"), false);
  assert.equal(g.get("r306")?.preview, "마우스 추가지급");
  assert.equal(g.get("r306")?.count, 1);
});

test("memosForRoom: 미해결 위 · 최신순", () => {
  const list = [
    memo({ roomId: "r601", body: "옛", createdAt: "2026-10-19T10:00:00.000Z" }),
    memo({ roomId: "r601", body: "해결됨", status: "resolved", createdAt: "2026-10-20T11:00:00.000Z", resolvedAt: "2026-10-20T12:00:00.000Z" }),
    memo({ roomId: "r601", body: "새", createdAt: "2026-10-20T09:00:00.000Z" }),
    memo({ roomId: "r502", body: "다른 방" }),
  ];
  const rows = memosForRoom(list, "r601");
  assert.deepEqual(
    rows.map((x) => x.body),
    ["새", "옛", "해결됨"],
  );
});

test("openForHandoff: 미해결 특이사항·전달사항만", () => {
  const list = [
    memo({ roomId: "r601", body: "인터넷 안됨", kind: "issue" }),
    memo({ roomId: "r502", body: "변기 막힘", kind: "issue", status: "resolved", resolvedAt: "x" }),
    memo({ roomId: "r306", body: "마우스 추가지급", kind: "delivery" }),
    memo({ roomId: "r201", body: "열쇠 전달", kind: "delivery", status: "resolved", resolvedAt: "x" }),
  ];
  const { issues, deliveries } = openForHandoff(list);
  assert.deepEqual(
    issues.map((x) => x.body),
    ["인터넷 안됨"],
  );
  assert.deepEqual(
    deliveries.map((x) => x.body),
    ["마우스 추가지급"],
  );
});

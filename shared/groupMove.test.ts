import assert from "node:assert/strict";
import { test } from "node:test";
import { groupMoveRow, groupMoveSummary, groupMoveTargets } from "./groupMove";
import type { Booking } from "./ledger";

const bk = (id: string, groupId: string | null, name: string | null, roomId: string, status: "active" | "cancelled" = "active"): Booking =>
  ({ id, kind: "stay", status, groupId, groupName: name, roomId, checkIn: "2026-10-25", nights: 3, price: 0 }) as unknown as Booking;

test("옮길 수 있는 단체: 자기 단체·취소된 객실만 있는 단체는 빠져요", () => {
  const list = [bk("1", "A", "가나", "r1"), bk("2", "B", "다라", "r2"), bk("3", "B", "다라", "r3"), bk("4", "C", "마바", "r4", "cancelled"), bk("5", null, null, "r5")];
  const t = groupMoveTargets(list, "A");
  assert.deepEqual(t.map((x) => x.groupId), ["B"]);
  assert.deepEqual(t[0]!.roomIds, ["r2", "r3"]);
  assert.equal(groupMoveTargets(list, null).length, 2);
});
test("저장값은 group_id·group_name이 같이 있거나 같이 없어요", () => {
  assert.deepEqual(groupMoveRow(null), { group_id: null, group_name: null });
  assert.deepEqual(groupMoveRow({ groupId: "B", name: "  " }), { group_id: "B", group_name: "단체" });
  assert.equal(groupMoveRow({ groupId: "B", name: "가".repeat(60) }).group_name!.length, 40);
});
test("변경 기록 문장", () => {
  assert.match(groupMoveSummary("602호", "가나", "다라"), /가나 → 다라/);
  assert.match(groupMoveSummary("602호", "가나", null), /단체에서 뺌/);
});

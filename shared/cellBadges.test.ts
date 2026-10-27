import { test } from "node:test";
import assert from "node:assert/strict";
import { cellBadgeKinds, groupDisplayColor } from "./cellBadges";
import { hashGroupBadgeColor } from "./group";

test("뱃지 순서: 청소X → 바로입실 → 임시 → 장기", () => {
  assert.deepEqual(cellBadgeKinds({ longStay: true, tentative: true, walkIn: true, noClean: true }), [
    "noClean",
    "walkIn",
    "tentative",
    "longStay",
  ]);
});
test("해당 없는 뱃지는 빠짐 · 아무것도 없으면 빈 배열(줄 자체를 그리지 않음)", () => {
  assert.deepEqual(cellBadgeKinds({}), []);
  assert.deepEqual(cellBadgeKinds({ tentative: true }), ["tentative"]);
});
test("단체 색: 저장값 우선, 없으면 해시색(항상 같은 값)", () => {
  assert.equal(groupDisplayColor("g-abc", "g3"), "g3");
  assert.equal(groupDisplayColor("g-abc", null), hashGroupBadgeColor("g-abc"));
  assert.equal(groupDisplayColor("g-abc", undefined), groupDisplayColor("g-abc", null));
  assert.match(groupDisplayColor("zzz", null), /^g[1-6]$/);
});

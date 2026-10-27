import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PF_ONSITE,
  PF_OTHER,
  normalizePlatformFilter,
  platformChips,
  platformMatch,
  togglePlatformChoice,
} from "./platformFilter";

const plats = [
  { id: "p1", name: "야놀자" },
  { id: "p2", name: "아고다" },
  { id: "p3", name: "현장" },
  { id: "p4", name: "전화예약" },
  { id: "p5", name: "자체 예약", onsite: true },
  { id: "p6", name: "현장 제휴", onsite: false },
];
const bk = (platformId: string) => ({ platformId });

test("선택이 비어 있으면 모두 통과", () => {
  assert.equal(platformMatch(bk("p1"), [], plats), true);
  assert.equal(platformMatch(bk("없는id"), [], plats), true);
});
test("플랫폼 id 단일·복수 선택", () => {
  assert.equal(platformMatch(bk("p1"), ["p1"], plats), true);
  assert.equal(platformMatch(bk("p2"), ["p1"], plats), false);
  assert.equal(platformMatch(bk("p2"), ["p1", "p2"], plats), true);
});
test("직접 = 현장·전화·onsite 플랫폼 전부 (onsite=false 명시는 제외)", () => {
  assert.equal(platformMatch(bk("p3"), [PF_ONSITE], plats), true);
  assert.equal(platformMatch(bk("p4"), [PF_ONSITE], plats), true);
  assert.equal(platformMatch(bk("p5"), [PF_ONSITE], plats), true);
  assert.equal(platformMatch(bk("p6"), [PF_ONSITE], plats), false);
  assert.equal(platformMatch(bk("p1"), [PF_ONSITE], plats), false);
});
test("알 수 없는 플랫폼 = 기타", () => {
  assert.equal(platformMatch(bk("deleted"), [PF_OTHER], plats), true);
  assert.equal(platformMatch(bk("deleted"), ["p1"], plats), false);
  assert.equal(platformMatch(bk("p1"), [PF_OTHER], plats), false);
});
test("직접 + 플랫폼 혼합 선택", () => {
  assert.equal(platformMatch(bk("p4"), [PF_ONSITE, "p1"], plats), true);
  assert.equal(platformMatch(bk("p1"), [PF_ONSITE, "p1"], plats), true);
  assert.equal(platformMatch(bk("p2"), [PF_ONSITE, "p1"], plats), false);
});
test("platformChips: 직접 → 나머지 순서 · 기타는 필요할 때만", () => {
  const c = platformChips(plats, [bk("p1")]);
  assert.deepEqual(c.map((x) => x.id), [PF_ONSITE, "p1", "p2", "p6"]);
  assert.equal(c[0].label, "직접");
  const c2 = platformChips(plats, [bk("zzz")]);
  assert.equal(c2[c2.length - 1].id, PF_OTHER);
  assert.equal(platformChips([{ id: "a", name: "야놀자" }], []).some((x) => x.id === PF_ONSITE), false);
});
test("normalizePlatformFilter: 사라진 id·깨진 값 제거, onsite id는 직접으로", () => {
  assert.deepEqual(normalizePlatformFilter(null, plats), []);
  assert.deepEqual(normalizePlatformFilter(["p1", "gone", 3, "p1"], plats), ["p1"]);
  assert.deepEqual(normalizePlatformFilter(["p3", "p4", PF_ONSITE], plats), [PF_ONSITE]);
  assert.deepEqual(normalizePlatformFilter([PF_ONSITE], [{ id: "a", name: "야놀자" }]), []);
  assert.deepEqual(normalizePlatformFilter([PF_OTHER], plats), [PF_OTHER]);
});
test("togglePlatformChoice", () => {
  assert.deepEqual(togglePlatformChoice([], "p1"), ["p1"]);
  assert.deepEqual(togglePlatformChoice(["p1", "p2"], "p1"), ["p2"]);
});

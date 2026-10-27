import { test } from "node:test";
import assert from "node:assert/strict";
import type { Booking } from "./ledger";
import { normalizeUaSort, sortUnassigned, toggleUaSort, UA_SORT_DEFAULT } from "./uaSort";

const bk = (id: string, name: string, checkIn: string, createdAt: string, typeId = "t1"): Booking =>
  ({ id, guestName: name, checkIn, createdAt, typeId }) as unknown as Booking;

const A = bk("a", "가나다", "2026-11-03", "2026-10-01T09:00:00Z");
const B = bk("b", "나다라", "2026-10-28", "2026-10-05T09:00:00Z");
const C = bk("c", "다라마", "2026-10-30", "2026-10-02T09:00:00Z");
const ids = (l: Booking[]) => l.map((x) => x.id).join("");

test("기본 = 입실일 오름차순 (이름순 아님)", () => {
  assert.equal(ids(sortUnassigned([A, B, C])), "bca");
  assert.equal(ids(sortUnassigned([A, B, C], UA_SORT_DEFAULT)), "bca");
});
test("입실일 내림차순", () => {
  assert.equal(ids(sortUnassigned([A, B, C], { key: "checkIn", dir: "desc" })), "acb");
});
test("예약일순 오름/내림", () => {
  assert.equal(ids(sortUnassigned([A, B, C], { key: "booked", dir: "asc" })), "acb");
  assert.equal(ids(sortUnassigned([A, B, C], { key: "booked", dir: "desc" })), "bca");
});
test("예약일이 같으면(일괄 등록) 입실일 → 타입 → 이름 순", () => {
  const t = "2026-10-20T00:00:00Z";
  const x = bk("x", "하", "2026-11-02", t);
  const y = bk("y", "가", "2026-11-01", t);
  const z = bk("z", "나", "2026-11-01", t, "t0");
  assert.equal(ids(sortUnassigned([x, y, z], { key: "booked", dir: "asc" })), "zyx");
});
test("입력 배열은 바뀌지 않음", () => {
  const src = [A, B, C];
  sortUnassigned(src);
  assert.equal(ids(src), "abc");
});
test("toggleUaSort: 같은 키 반전 · 다른 키는 오름차순", () => {
  assert.deepEqual(toggleUaSort({ key: "checkIn", dir: "asc" }, "checkIn"), { key: "checkIn", dir: "desc" });
  assert.deepEqual(toggleUaSort({ key: "checkIn", dir: "desc" }, "booked"), { key: "booked", dir: "asc" });
});
test("normalizeUaSort: 깨진 값은 기본값", () => {
  assert.deepEqual(normalizeUaSort(null), UA_SORT_DEFAULT);
  assert.deepEqual(normalizeUaSort({ key: "zzz", dir: "x" }), UA_SORT_DEFAULT);
  assert.deepEqual(normalizeUaSort({ key: "booked", dir: "desc" }), { key: "booked", dir: "desc" });
});

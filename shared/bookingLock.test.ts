import { test } from "node:test";
import assert from "node:assert/strict";
import { BookingConflictError, bookingConflictMessage, planBookingMerge } from "./bookingLock";

test("다른 직원이 다른 칸을 고쳤으면 내가 고친 칸만 써요 (상대 값 보존)", () => {
  const opened = { price: 140_000, nights: 2, memo: null };
  const draft = { price: 160_000, nights: 2, memo: null }; // 나: 판매가
  const current = { price: 140_000, nights: 3, memo: null }; // 상대: 박수
  const p = planBookingMerge(opened, draft, current);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.write, { price: 160_000 }, "박수(상대가 고친 값)는 덮어쓰지 않아요");
});

test("같은 칸을 둘 다 다르게 고쳤으면 저장하지 않고 알려요", () => {
  const p = planBookingMerge({ price: 140_000, nights: 2 }, { price: 160_000, nights: 3 }, { price: 150_000, nights: 2 });
  assert.deepEqual(p.conflicts, ["price"]);
  const e = new BookingConflictError(p.conflicts);
  assert.match(e.message, /다른 직원이 먼저 이 예약을 고쳤어요 \(판매가\)/);
  assert.match(e.message, /덮어쓰지 않았어요/);
});

test("같은 값으로 고쳤거나 아무것도 안 고쳤으면 충돌 아님", () => {
  assert.deepEqual(planBookingMerge({ a: 1 }, { a: 2 }, { a: 2 }), { conflicts: [], write: {} });
  assert.deepEqual(planBookingMerge({ a: 1, r: { x: 1 } }, { a: 1, r: { x: 1 } }, { a: 5, r: { x: 2 } }), { conflicts: [], write: {} });
  assert.match(bookingConflictMessage(["unknown_col"]), /예약 내용/);
});

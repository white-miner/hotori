import assert from "node:assert/strict";
import test from "node:test";
import { saveFailMessage } from "./errors";

test("saveFailMessage: Error with Postgrest-like fields", () => {
  const e = Object.assign(new Error("cannot get array length of a non-array"), {
    code: "22023",
    details: null,
    hint: null,
  });
  assert.match(saveFailMessage(e), /cannot get array length/);
  assert.match(saveFailMessage(e), /\[22023\]/);
});

test("saveFailMessage: plain object (thrown supabase error)", () => {
  const e = { message: "new row violates check constraint", code: "23514", details: "bookings_night_rates_shape", hint: "" };
  const s = saveFailMessage(e);
  assert.match(s, /violates check/);
  assert.match(s, /\[23514\]/);
  assert.match(s, /bookings_night_rates_shape/);
});

test("saveFailMessage: unknown → fallback only", () => {
  assert.equal(saveFailMessage(null), "저장하지 못했어요");
  assert.equal(saveFailMessage(42), "저장하지 못했어요");
});

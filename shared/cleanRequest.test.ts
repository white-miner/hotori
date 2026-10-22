import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEAN_REQUEST_OPTIONS, cleanRequestNoClean } from "./cleanRequest";

test("cleanRequest options map to noClean", () => {
  assert.equal(cleanRequestNoClean("clean"), false);
  assert.equal(cleanRequestNoClean("no_clean"), true);
  assert.deepEqual(
    CLEAN_REQUEST_OPTIONS.map((o) => o.noClean),
    [false, true],
  );
});

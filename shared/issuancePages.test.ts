import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkIssuanceLines, issuancePreviewChunkIndex, issuanceSlideCount } from "./issuancePages";

test("chunkIssuanceLines pages of 5", () => {
  const chunks = chunkIssuanceLines([1, 2, 3, 4, 5, 6, 7], 5);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], [1, 2, 3, 4, 5]);
  assert.deepEqual(chunks[1], [6, 7]);
});

test("issuanceSlideCount compose + body", () => {
  assert.equal(issuanceSlideCount({ compose: true, lineCount: 12 }), 1 + 3);
  assert.equal(issuanceSlideCount({ compose: false, lineCount: 3 }), 1);
  assert.equal(issuancePreviewChunkIndex(0, true), null);
  assert.equal(issuancePreviewChunkIndex(2, true), 1);
});

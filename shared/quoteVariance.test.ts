import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuoteCompare, findLinkedQuote } from "./quoteVariance";

test("buildQuoteCompare: invoice − quote", () => {
  const c = buildQuoteCompare({
    quoteId: "q1",
    quoteTitle: "학교 견적",
    quoteTotal: 1_000_000,
    invoiceTotal: 1_150_000,
  });
  assert.equal(c.diff, 150_000);
  assert.equal(c.quoteTotal, 1_000_000);
});

test("findLinkedQuote by groupId prefers latest issued", () => {
  const q = findLinkedQuote(
    [
      {
        id: "old",
        status: "issued",
        groupId: "g1",
        bookingIds: [],
        total: 100,
        title: "old",
        issuedAt: "2026-10-01T00:00:00Z",
        createdAt: "2026-10-01T00:00:00Z",
      },
      {
        id: "new",
        status: "issued",
        groupId: "g1",
        bookingIds: [],
        total: 200,
        title: "new",
        issuedAt: "2026-10-20T00:00:00Z",
        createdAt: "2026-10-20T00:00:00Z",
      },
      {
        id: "draft",
        status: "draft",
        groupId: "g1",
        bookingIds: [],
        total: 999,
        title: "draft",
        issuedAt: null,
        createdAt: "2026-10-21T00:00:00Z",
      },
    ],
    { groupId: "g1" },
  );
  assert.equal(q?.id, "new");
  assert.equal(q?.total, 200);
});

test("findLinkedQuote by booking overlap", () => {
  const q = findLinkedQuote(
    [
      {
        id: "q",
        status: "issued",
        groupId: null,
        bookingIds: ["b1", "b2"],
        total: 50,
        title: "단실",
        issuedAt: "2026-10-10T00:00:00Z",
        createdAt: "2026-10-10T00:00:00Z",
      },
    ],
    { bookingIds: ["b2"] },
  );
  assert.equal(q?.id, "q");
});

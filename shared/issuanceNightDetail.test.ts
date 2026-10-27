import assert from "node:assert/strict";
import { test } from "node:test";
import {
  issuanceNightCells,
  patchIssuanceNightCell,
  quoteAmountFromNightCells,
  redistributeIssuanceNights,
  sumIssuanceNightCells,
  unitRateFromCells,
} from "./issuanceNightDetail";

test("issuanceNightCells distributes total when no matrix", () => {
  const cells = issuanceNightCells({
    checkIn: "2026-11-05",
    nights: 2,
    total: 570_000,
    nightRates: null,
  });
  assert.equal(cells.length, 2);
  assert.equal(sumIssuanceNightCells(cells), 570_000);
  assert.equal(cells[0]!.date, "2026-11-05");
  assert.equal(cells[1]!.date, "2026-11-06");
  assert.equal(unitRateFromCells(cells), 285_000);
});

test("issuanceNightCells prefers full night_rates matrix", () => {
  const cells = issuanceNightCells({
    checkIn: "2026-11-05",
    nights: 2,
    total: 999_999,
    nightRates: { flat: 200_000, nights: { "2026-11-05": 200_000, "2026-11-06": 300_000 } },
  });
  assert.deepEqual(
    cells.map((c) => c.amount),
    [200_000, 300_000],
  );
});

test("patchIssuanceNightCell keeps total on last night", () => {
  const base = redistributeIssuanceNights("2026-11-05", 3, 300_000);
  const next = patchIssuanceNightCell(base, 0, 150_000, 300_000);
  assert.equal(sumIssuanceNightCells(next), 300_000);
  assert.equal(next[0]!.amount, 150_000);
});

test("quoteAmountFromNightCells = rooms × Σ nights", () => {
  const cells = [
    { date: "2026-11-05", amount: 100_000 },
    { date: "2026-11-06", amount: 120_000 },
  ];
  assert.equal(quoteAmountFromNightCells(2, cells), 440_000);
});

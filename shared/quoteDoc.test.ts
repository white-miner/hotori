import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyQuoteLine,
  freezeQuoteSnapshot,
  lineAmount,
  quoteLinePrintLabel,
  quotePrintStrings,
  quoteTotal,
  validateQuoteDraft,
} from "./quoteDoc";

test("lineAmount / quoteTotal", () => {
  assert.equal(lineAmount(2, 3, 50_000), 300_000);
  const a = emptyQuoteLine("t1");
  a.rooms = 2;
  a.nights = 1;
  a.rate = 80_000;
  a.amount = lineAmount(a.rooms, a.nights, a.rate);
  assert.equal(quoteTotal([a]), 160_000);
});

test("validateQuoteDraft: 제목·줄 필요", () => {
  assert.equal(
    validateQuoteDraft({
      title: "",
      clientName: "",
      clientPhone: "",
      notes: "",
      checkIn: null,
      nights: 1,
      guestCount: 2,
      lines: [],
      showRoomNos: false,
    }),
    "견적 제목 또는 견적처를 입력해 주세요.",
  );
  const line = emptyQuoteLine("t1");
  line.label = "스탠다드";
  line.amount = 100_000;
  assert.equal(
    validateQuoteDraft({
      title: "",
      clientName: "OO학교",
      clientPhone: "",
      notes: "",
      checkIn: "2026-11-01",
      nights: 2,
      guestCount: 40,
      lines: [line],
      showRoomNos: false,
    }),
    null,
  );
});

test("freezeQuoteSnapshot locks total + showRoomNos", () => {
  const line = emptyQuoteLine("t1");
  line.label = "A";
  line.amount = 50_000;
  line.roomIds = ["r1"];
  const snap = freezeQuoteSnapshot(
    {
      title: "견적",
      clientName: "학교",
      clientPhone: "010",
      notes: "",
      checkIn: "2026-11-01",
      nights: 1,
      guestCount: 10,
      lines: [line],
      showRoomNos: true,
    },
    "2026-10-27T00:00:00Z",
  );
  assert.equal(snap.total, 50_000);
  assert.equal(snap.showRoomNos, true);
  assert.deepEqual(snap.lines[0]!.roomIds, ["r1"]);
});

test("quoteLinePrintLabel: default type only · opt-in room nos", () => {
  const line = emptyQuoteLine("t1");
  line.label = "스탠다드";
  line.roomIds = ["r1", "r2"];
  const noOf = (id: string) => (id === "r1" ? "301" : id === "r2" ? "302" : null);
  assert.equal(quoteLinePrintLabel(line, false, noOf), "스탠다드");
  assert.equal(quoteLinePrintLabel(line, true, noOf), "스탠다드 · 301·302호");
  assert.equal(quoteLinePrintLabel(line, true, noOf, "en"), "스탠다드 · 301, 302");
  assert.equal(quoteLinePrintLabel({ ...line, roomIds: [] }, true, noOf), "스탠다드");
});

test("quotePrintStrings: ko/en titles", () => {
  assert.equal(quotePrintStrings("ko").title, "견적서");
  assert.equal(quotePrintStrings("en").title, "Quote");
  assert.match(quotePrintStrings("en").attest, /quote/i);
  assert.equal(quotePrintStrings("en").nights(2), "2 nights");
});

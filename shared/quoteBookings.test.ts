import assert from "node:assert/strict";
import { test } from "node:test";
import { planQuoteTypeHoldBookings, validateQuoteForBookings } from "./quoteBookings";
import { emptyQuoteLine, freezeQuoteSnapshot, quotePriceSummary, quoteLineWithRates, type QuoteDraft } from "./quoteDoc";
import { quoteTemplateFromDraft, quoteTemplateLines, readQuoteTemplates } from "./quoteTemplates";
import type { HotelSettings } from "./ledger";

const s = {
  types: [
    { id: "t1", name: "스탠다드" },
    { id: "t2", name: "패밀리" },
  ],
  buildings: [{ id: "b1", name: "본관" }],
  floors: [
    {
      id: "f1",
      name: "3층",
      buildingId: "b1",
      rooms: [
        { id: "r1", no: "301", typeId: "t1" },
        { id: "r2", no: "302", typeId: "t1" },
      ],
    },
  ],
  platforms: [{ id: "onsite", name: "현장", onsite: true }],
} as unknown as HotelSettings;

function draft(over: Partial<QuoteDraft> = {}): QuoteDraft {
  const line = emptyQuoteLine("t1");
  line.label = "스탠다드";
  line.rooms = 2;
  line.nights = 2;
  line.rate = 50_000;
  line.amount = 200_000;
  line.pax = 2;
  return {
    title: "학교 견적",
    clientName: "OO중",
    clientPhone: "02-1",
    notes: "",
    checkIn: "2026-11-10",
    nights: 2,
    guestCount: 4,
    lines: [line],
    showRoomNos: false,
    ...over,
  };
}

test("validateQuoteForBookings needs type + checkIn", () => {
  const bad = draft({ checkIn: null });
  assert.match(validateQuoteForBookings(bad, s) ?? "", /입실/);
  const noType = draft();
  noType.lines[0]!.typeId = "";
  assert.match(validateQuoteForBookings(noType, s) ?? "", /타입/);
});

test("planQuoteTypeHoldBookings: multi → group Path A (roomId null)", () => {
  const plan = planQuoteTypeHoldBookings({ draft: draft(), quoteId: "q1", s });
  assert.equal(plan.kind, "group");
  if (plan.kind !== "group") return;
  assert.equal(plan.drafts.length, 2);
  assert.ok(plan.drafts.every((b) => b.roomId === null));
  assert.ok(plan.drafts.every((b) => b.typeId === "t1"));
  assert.equal(plan.drafts.reduce((n, b) => n + b.price, 0), 200_000);
  assert.equal(plan.info.payerCompany, "OO중");
});

test("planQuoteTypeHoldBookings: roomIds match → Path B assigned", () => {
  const d = draft();
  d.lines[0]!.roomIds = ["r1", "r2"];
  const plan = planQuoteTypeHoldBookings({ draft: d, quoteId: "q1", s });
  assert.equal(plan.kind, "group");
  if (plan.kind !== "group") return;
  assert.deepEqual(
    plan.drafts.map((b) => b.roomId).sort(),
    ["r1", "r2"],
  );
});

test("planQuoteTypeHoldBookings: single → one booking", () => {
  const line = emptyQuoteLine("t2");
  line.rooms = 1;
  line.nights = 1;
  line.rate = 80_000;
  line.amount = 80_000;
  const plan = planQuoteTypeHoldBookings({
    draft: draft({ lines: [line], clientName: "개인" }),
    quoteId: "q2",
    s,
  });
  assert.equal(plan.kind, "single");
  if (plan.kind !== "single") return;
  assert.equal(plan.booking.roomId, null);
  assert.equal(plan.booking.price, 80_000);
  assert.equal(plan.booking.typeId, "t2");
});

test("template re-use preserves each arrival offset, duration, rate, headcount and VAT through issue", () => {
  const rows = [
    quoteLineWithRates({ ...emptyQuoteLine("t1"), pax: 2, roomIds: ["r1"] }, "2026-11-05", [90_000, 100_000]),
    quoteLineWithRates({ ...emptyQuoteLine("t1"), pax: 3, detail: "추가 이불", roomIds: ["r2"] }, "2026-11-06", [110_000]),
    quoteLineWithRates({ ...emptyQuoteLine("t2"), pax: 4, rooms: 2 }, "2026-11-05", [79_999, 95_001, 120_003]),
  ];
  const saved = quoteTemplateFromDraft("목·금 단체", draft({ checkIn: "2026-11-05", lines: rows, taxMode: "excluded" }));
  const [template] = readQuoteTemplates(JSON.stringify([saved]));
  assert.ok(template);
  const checkIn = "2026-11-12";
  const lines = quoteTemplateLines(template, checkIn);
  assert.deepEqual(lines.map((line) => line.roomIds), [[], [], []]);
  assert.notDeepEqual(lines.map((line) => line.id), rows.map((line) => line.id));
  assert.deepEqual(lines.map((line) => [line.checkIn, line.nights, line.pax]), [
    ["2026-11-12", 2, 2], ["2026-11-13", 1, 3], ["2026-11-12", 3, 4],
  ]);
  lines[0]!.roomIds = ["r1"];
  lines[1]!.roomIds = ["r2"];
  const reused = draft({ checkIn, lines, taxMode: template.taxMode });
  const plan = planQuoteTypeHoldBookings({ draft: reused, quoteId: "group-test", s });
  assert.equal(plan.kind, "group");
  if (plan.kind !== "group") return;
  assert.deepEqual(plan.drafts.map((booking) => [booking.roomId, booking.checkIn, booking.nights, booking.guests]), [
    ["r1", "2026-11-12", 2, 2], ["r2", "2026-11-13", 1, 3],
    [null, "2026-11-12", 3, 4], [null, "2026-11-12", 3, 4],
  ]);
  assert.deepEqual(plan.drafts[0]!.nightRates?.nights, { "2026-11-12": 99_000, "2026-11-13": 110_000 });
  assert.equal(plan.drafts[1]!.price, 121_000);
  assert.match(plan.drafts[1]!.memo ?? "", /추가 이불/);
  assert.equal(plan.drafts.reduce((total, booking) => total + booking.price, 0), 979_007);
  assert.equal(freezeQuoteSnapshot(reused, "2026-11-05T00:00:00Z").total, 979_007);
  assert.equal(quotePriceSummary(rows, "included").grandTotal, 890_006);
  assert.equal(quotePriceSummary(rows, "exempt").vatAmount, 0);
  lines[1]!.roomIds = ["r1"];
  assert.match(validateQuoteForBookings(reused, s) ?? "", /기간이 겹쳐요/);
});

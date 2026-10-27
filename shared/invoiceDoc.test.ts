import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInvoiceSnapshot,
  formatInvoiceNumber,
  invoiceEligible,
  invoiceIsMidStay,
  invoicePayLabel,
  invoicePrintStrings,
  invoiceRoomDisplay,
  invoiceSurchargeLabel,
  defaultInvoicePayer,
  mergeInvoiceGroupInfo,
  resolveInvoicePick,
} from "./invoiceDoc";
import type { Booking, HotelSettings } from "./ledger";
import { emptyGroupInfo } from "./settle";

const s = {
  types: [{ id: "t1", name: "스탠다드", short: "S" }],
  buildings: [{ id: "b1", name: "본관" }],
  floors: [{ id: "f1", name: "3층", buildingId: "b1", rooms: [{ id: "r1", no: "301", typeId: "t1" }] }],
  platforms: [{ id: "onsite", name: "현장", onsite: true }],
} as unknown as HotelSettings;

const book = (over: Partial<Booking> = {}): Booking =>
  ({
    id: "b1",
    kind: "stay",
    status: "active",
    platformId: "onsite",
    price: 200_000,
    guestName: "학교단체",
    typeId: "t1",
    roomId: "r1",
    checkIn: "2026-10-20",
    nights: 2,
    startTime: null,
    endTime: null,
    arrived: true,
    memo: null,
    payments: [
      {
        id: "pay1",
        bookingId: "b1",
        kind: "deposit",
        method: "transfer",
        amount: 50_000,
        bizDate: "2026-10-19",
        createdAt: "2026-10-19T00:00:00Z",
      },
    ],
    ...over,
  }) as Booking;

test("formatInvoiceNumber: YYYY-NNN", () => {
  assert.equal(formatInvoiceNumber(2026, 1), "2026-001");
  assert.equal(formatInvoiceNumber(2026, 42), "2026-042");
});

test("invoiceEligible / mid-stay", () => {
  assert.equal(invoiceEligible([book()]), true);
  assert.equal(invoiceIsMidStay([book()]), true);
  assert.equal(invoiceIsMidStay([book({ checkedOutAt: "2026-10-22T10:00:00Z" })]), false);
  assert.equal(invoiceEligible([book({ status: "cancelled", arrived: false })]), false);
});

test("buildInvoiceSnapshot matches settle totals", () => {
  const members = [book()];
  const info = emptyGroupInfo("g1");
  const snap = buildInvoiceSnapshot({
    s,
    members,
    info,
    plat: { name: "현장", onsite: true },
    payerName: "OO중학교",
    payerPhone: "02-111",
    issueNumber: "2026-001",
    issuedAt: "2026-10-27T12:00:00Z",
  });
  assert.equal(snap.issueNumber, "2026-001");
  assert.equal(snap.payerName, "OO중학교");
  assert.equal(snap.total, 200_000);
  assert.equal(snap.paid, 50_000);
  assert.equal(snap.left, 150_000);
  assert.equal(snap.isMidStay, true);
  assert.equal(snap.rooms.length, 1);
  assert.equal(snap.rooms[0]!.roomNo, "301");
});

test("defaultInvoicePayer prefers company", () => {
  const info = emptyGroupInfo("g1");
  info.payerCompany = "여행사A";
  info.payerPhone = "010-1";
  const p = defaultInvoicePayer([book()], info);
  assert.equal(p.payerName, "여행사A");
  assert.equal(p.payerPhone, "010-1");
});

test("invoicePrintStrings + pay/room EN helpers", () => {
  assert.equal(invoicePrintStrings("ko").title, "청구서");
  assert.equal(invoicePrintStrings("en").title, "Invoice");
  assert.equal(invoicePayLabel("card", "en"), "Card");
  assert.equal(invoicePayLabel("card", "ko"), "카드");
  assert.equal(invoiceSurchargeLabel("추가 인원", "en"), "Extra guests");
  assert.equal(invoiceRoomDisplay("301", "en", ""), "301");
  assert.equal(invoiceRoomDisplay("301", "ko", "호"), "301호");
  assert.equal(invoiceRoomDisplay("미배정", "en", ""), "Unassigned");
});

test("buildInvoiceSnapshot keeps quoteCompare (P1.3)", () => {
  const snap = buildInvoiceSnapshot({
    s,
    members: [book()],
    info: emptyGroupInfo("g1"),
    plat: { name: "현장", onsite: true },
    payerName: "학교",
    payerPhone: "",
    issueNumber: "2026-002",
    issuedAt: "2026-10-27T12:00:00Z",
    quoteCompare: {
      quoteId: "q1",
      quoteTitle: "견적A",
      quoteTotal: 180_000,
      invoiceTotal: 200_000,
      diff: 20_000,
    },
  });
  assert.equal(snap.quoteCompare?.quoteTotal, 180_000);
  assert.equal(snap.quoteCompare?.diff, 20_000);
});

test("mergeInvoiceGroupInfo sums extras+payments; postpaid wins", () => {
  const a = emptyGroupInfo("g1");
  a.payMode = "prepaid";
  a.payerCompany = "여행사A";
  a.extras = [{ name: "버스", amount: 10_000 }];
  a.payments = [
    {
      id: "gp1",
      bookingId: "",
      groupId: "g1",
      kind: "deposit",
      method: "transfer",
      amount: 30_000,
      bizDate: "2026-10-19",
      createdAt: "2026-10-19T00:00:00Z",
    },
  ];
  const b = emptyGroupInfo("g2");
  b.payMode = "postpaid";
  b.dueOn = "2026-11-01";
  b.extras = [{ name: "식사", amount: 20_000 }];
  b.payments = [
    {
      id: "gp2",
      bookingId: "",
      groupId: "g2",
      kind: "balance",
      method: "card",
      amount: 40_000,
      bizDate: "2026-10-20",
      createdAt: "2026-10-20T00:00:00Z",
    },
  ];
  const m = mergeInvoiceGroupInfo([a, b]);
  assert.equal(m.payMode, "postpaid");
  assert.equal(m.dueOn, "2026-11-01");
  assert.equal(m.payerCompany, "여행사A");
  assert.equal(m.extras.length, 2);
  assert.equal(m.payments.reduce((n, p) => n + p.amount, 0), 70_000);
});

test("resolveInvoicePick + buildInvoiceSnapshot merges multi group/booking lines", () => {
  const b1 = book({ id: "b1", groupId: "g1", guestName: "A", price: 100_000, payments: [] });
  const b2 = book({
    id: "b2",
    groupId: "g1",
    guestName: "A2",
    roomId: "r1",
    price: 100_000,
    payments: [],
  });
  const b3 = book({
    id: "b3",
    groupId: null,
    guestName: "개인",
    price: 80_000,
    payments: [
      {
        id: "p3",
        bookingId: "b3",
        kind: "deposit",
        method: "cash",
        amount: 80_000,
        bizDate: "2026-10-20",
        createdAt: "2026-10-20T00:00:00Z",
      },
    ],
  });
  const g1 = emptyGroupInfo("g1");
  g1.payments = [
    {
      id: "gp1",
      bookingId: "",
      groupId: "g1",
      kind: "deposit",
      method: "transfer",
      amount: 50_000,
      bizDate: "2026-10-19",
      createdAt: "2026-10-19T00:00:00Z",
    },
  ];
  const resolved = resolveInvoicePick({
    selection: { groupIds: ["g1"], bookingIds: ["b3"] },
    bookingsById: new Map([
      ["b1", b1],
      ["b2", b2],
      ["b3", b3],
    ]),
    groupMembers: new Map([["g1", [b1, b2]]]),
    groupInfos: new Map([["g1", g1]]),
  });
  assert.equal(resolved.members.length, 3);
  assert.equal(resolved.groupId, null);
  const snap = buildInvoiceSnapshot({
    s,
    members: resolved.members,
    info: resolved.groupInfo,
    plat: { name: "현장", onsite: true },
    payerName: "합산청구",
    payerPhone: "",
    issueNumber: "2026-010",
    issuedAt: "2026-10-27T12:00:00Z",
  });
  assert.equal(snap.rooms.length, 3);
  assert.equal(snap.total, 280_000);
  assert.equal(snap.paid, 130_000);
  assert.equal(snap.left, 150_000);
});

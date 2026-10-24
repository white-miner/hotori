import assert from "node:assert/strict";
import { test } from "node:test";
import type { Booking } from "./ledger";
import {
  deskPaymentLines,
  opsPayHistoryLines,
  paymentDeskGlance,
  planClearResidualBalance,
  planPaymentDeskPay,
  sameGroupId,
} from "./paymentDesk";
import { emptyGroupInfo } from "./settle";

const stay = (over: Partial<Booking>): Booking =>
  ({
    id: "b1",
    kind: "stay",
    status: "active",
    platformId: "walk",
    price: 100000,
    guestName: "홍",
    typeId: "t1",
    roomId: "r1",
    checkIn: "2026-10-20",
    nights: 1,
    startTime: null,
    endTime: null,
    arrived: true,
    memo: null,
    payments: [],
    cancelledAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Booking;

test("sameGroupId requires shared non-null groupId", () => {
  assert.equal(sameGroupId([stay({ groupId: "g1" }), stay({ id: "b2", groupId: "g1" })]), "g1");
  assert.equal(sameGroupId([stay({ groupId: "g1" }), stay({ id: "b2", groupId: "g2" })]), null);
  assert.equal(sameGroupId([stay({ groupId: null }), stay({ id: "b2", groupId: null })]), null);
});

test("paymentDeskGlance single onsite left", () => {
  const g = paymentDeskGlance([stay({ payments: [{ id: "p", bookingId: "b1", kind: "deposit", method: "card", amount: 30000, bizDate: "2026-10-20", createdAt: "" }] })], {
    name: "현장·전화",
    onsite: true,
  });
  assert.equal(g.group, false);
  assert.equal(g.tracked, true);
  assert.equal(g.left, 70000);
});

test("paymentDeskGlance group uses settle", () => {
  const members = [
    stay({ id: "a", groupId: "g1", groupName: "단체", price: 50000, roomId: "r1" }),
    stay({ id: "b", groupId: "g1", groupName: "단체", price: 50000, roomId: "r2" }),
  ];
  const info = emptyGroupInfo("g1");
  const g = paymentDeskGlance(members, { name: "현장·전화", onsite: true }, info);
  assert.equal(g.group, true);
  assert.equal(g.memberCount, 2);
  assert.equal(g.due, 100000);
  assert.equal(g.left, 100000);
});

test("paymentDeskGlance single groupId + group pay → left 0 (칸/ops SoT)", () => {
  const plat = { name: "현장·전화", onsite: true };
  const members = [
    stay({ id: "a", groupId: "g1", price: 50000, roomId: "r1", payments: [] }),
    stay({ id: "b", groupId: "g1", price: 50000, roomId: "r2", payments: [] }),
  ];
  const info = {
    ...emptyGroupInfo("g1"),
    payments: [{ id: "gp", bookingId: "", kind: "balance" as const, method: "card" as const, amount: 100000, bizDate: "2026-10-22", createdAt: "" }],
  };
  const g = paymentDeskGlance(members, plat, info);
  assert.equal(g.left, 0);
  assert.equal(g.full, true);
  assert.equal(g.paid, 100000);
});

test("planPaymentDeskPay validates amount", () => {
  const glance = paymentDeskGlance([stay({})], { name: "현장·전화", onsite: true });
  const bad = planPaymentDeskPay(glance, { amount: 0, method: "card", kind: "balance", bizDate: "2026-10-22" });
  assert.ok("err" in bad);
  const ok = planPaymentDeskPay(glance, { amount: 10000, method: "cash", kind: "deposit", bizDate: "2026-10-22" });
  assert.ok(!("err" in ok));
  assert.equal(ok.kind, "deposit");
  assert.equal(ok.asGroup, false);
});

test("planClearResidualBalance zeros left via price adjust", () => {
  const b = stay({
    price: 110000,
    payments: [{ id: "p", bookingId: "b1", kind: "balance", method: "card", amount: 100000, bizDate: "2026-10-20", createdAt: "" }],
  });
  const plat = { name: "현장·전화", onsite: true };
  const planned = planClearResidualBalance(b, plat);
  assert.ok(!("err" in planned));
  assert.equal(planned.cleared, 10000);
  assert.equal(planned.newPrice, 100000);
  const none = planClearResidualBalance(stay({ price: 100000, payments: [{ id: "p", bookingId: "b1", kind: "balance", method: "card", amount: 100000, bizDate: "2026-10-20", createdAt: "" }] }), plat);
  assert.ok("err" in none);
});

test("late-out auto 1만 오잔금: clear → price=paid · timeFee 0 (서비스)", () => {
  // repro: 숙박 6만 완납 후 늦은퇴실(+1h) auto extraHourFee=1만 → due 7만 · left 1만 · 추가금 0 의도
  const b = stay({
    price: 70000,
    lateOut: 1,
    timeFee: 10000,
    payments: [{ id: "p", bookingId: "b1", kind: "balance", method: "card", amount: 60000, bizDate: "2026-10-20", createdAt: "" }],
  });
  const planned = planClearResidualBalance(b, { name: "현장·전화", onsite: true });
  assert.ok(!("err" in planned));
  assert.equal(planned.cleared, 10000);
  assert.equal(planned.newPrice, 60000);
  assert.equal(planned.timeFee, 0);
});

test("deskPaymentLines merges booking + group pays", () => {
  const members = [
    stay({
      id: "a",
      groupId: "g1",
      payments: [{ id: "p1", bookingId: "a", kind: "deposit", method: "cash", amount: 10000, bizDate: "2026-10-20", createdAt: "1" }],
    }),
  ];
  const info = { ...emptyGroupInfo("g1"), payments: [{ id: "gp", bookingId: "", kind: "balance" as const, method: "card" as const, amount: 50000, bizDate: "2026-10-21", createdAt: "2" }] };
  const lines = deskPaymentLines(members, info);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.scope, "booking");
  assert.equal(lines[1]!.scope, "group");
});

test("opsPayHistoryLines newest first · limit", () => {
  const members = [
    stay({
      id: "a",
      payments: [
        { id: "p1", bookingId: "a", kind: "deposit", method: "cash", amount: 10000, bizDate: "2026-10-20", createdAt: "1" },
        { id: "p2", bookingId: "a", kind: "balance", method: "card", amount: 20000, bizDate: "2026-10-21", createdAt: "2" },
        { id: "p3", bookingId: "a", kind: "balance", method: "transfer", amount: 30000, bizDate: "2026-10-22", createdAt: "3" },
      ],
    }),
  ];
  const hist = opsPayHistoryLines(members, null, 2);
  assert.equal(hist.length, 2);
  assert.equal(hist[0]!.pay.id, "p3");
  assert.equal(hist[1]!.pay.id, "p2");
});

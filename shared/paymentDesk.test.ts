import assert from "node:assert/strict";
import { test } from "node:test";
import type { Booking } from "./ledger";
import { paymentDeskGlance, planPaymentDeskPay, sameGroupId } from "./paymentDesk";
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

test("planPaymentDeskPay validates amount", () => {
  const glance = paymentDeskGlance([stay({})], { name: "현장·전화", onsite: true });
  const bad = planPaymentDeskPay(glance, { amount: 0, method: "card", kind: "balance", bizDate: "2026-10-22" });
  assert.ok("err" in bad);
  const ok = planPaymentDeskPay(glance, { amount: 10000, method: "cash", kind: "deposit", bizDate: "2026-10-22" });
  assert.ok(!("err" in ok));
  assert.equal(ok.kind, "deposit");
  assert.equal(ok.asGroup, false);
});

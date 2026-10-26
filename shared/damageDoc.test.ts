import assert from "node:assert/strict";
import { test } from "node:test";
import {
  damagePrintStrings,
  damageRoomDisplay,
  damageTotal,
  emptyDamageLine,
  freezeDamageSnapshot,
  normalizeDamageLines,
  validateDamageDraft,
  type DamageDraft,
} from "./damageDoc";

test("damageTotal sums amounts", () => {
  const a = emptyDamageLine();
  a.item = "TV";
  a.amount = 100_000;
  const b = emptyDamageLine();
  b.item = "침구";
  b.amount = 30_000;
  assert.equal(damageTotal([a, b]), 130_000);
});

test("validateDamageDraft requires item lines", () => {
  const draft: DamageDraft = {
    guestName: "홍길동",
    guestPhone: "",
    roomNo: "301",
    typeLabel: "스탠다드",
    notes: "",
    lines: [emptyDamageLine()],
    bookingId: "b1",
  };
  assert.equal(validateDamageDraft(draft), "손해 항목을 한 줄 이상 적어 주세요.");
  draft.lines[0]!.item = "TV";
  draft.lines[0]!.amount = 50_000;
  assert.equal(validateDamageDraft(draft), null);
});

test("freezeDamageSnapshot trims empty lines", () => {
  const draft: DamageDraft = {
    guestName: "홍길동",
    guestPhone: "010",
    roomNo: "301",
    typeLabel: "S",
    notes: "파손",
    lines: [
      { id: "1", item: "TV", description: "화면 깨짐", amount: 200_000 },
      emptyDamageLine(),
    ],
    bookingId: "b1",
  };
  const snap = freezeDamageSnapshot(draft, "2026-10-27T12:00:00Z");
  assert.equal(snap.lines.length, 1);
  assert.equal(snap.total, 200_000);
  assert.equal(snap.guestName, "홍길동");
  assert.equal(snap.roomNo, "301");
});

test("normalizeDamageLines recovers bad input", () => {
  assert.equal(normalizeDamageLines(null).length, 1);
  const n = normalizeDamageLines([{ id: "x", item: "문", description: "찍힘", amount: 10 }]);
  assert.equal(n[0]!.item, "문");
  assert.equal(n[0]!.amount, 10);
});

test("damagePrintStrings: ko/en titles + room display", () => {
  assert.equal(damagePrintStrings("ko").title, "손해내역서");
  assert.equal(damagePrintStrings("en").title, "Damage Assessment");
  assert.match(damagePrintStrings("en").attest, /damage/i);
  assert.equal(damageRoomDisplay("301", "ko", "호"), "301호");
  assert.equal(damageRoomDisplay("301", "en", ""), "301");
  assert.equal(damageRoomDisplay("미배정", "en", ""), "Unassigned");
});

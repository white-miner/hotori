import { test } from "node:test";
import assert from "node:assert/strict";
import { nowCompanyOf, nowNightRate, nowPayParts, nowPayText, nowRangeFull, nowRateText } from "./nowCard";

const base = { kind: "stay" as const, nights: 3, checkIn: "2026-10-25", extraFee: 0, earlyIn: false, lateOut: false, timeFee: 0, arrival: null, carFee: 0, walkOff: 0, priceUnset: false, earlyOut: null };

test("이용기간은 10/25~10/27 모양이에요", () => {
  assert.equal(nowRangeFull(base as never), "10/25~10/27");
  assert.equal(nowRangeFull({ ...base, nights: 1 } as never), "10/25");
});

test("카드에는 총액이 아니라 그 객실의 하루 요금이에요", () => {
  const b = { ...base, price: 210_000, nightRates: { flat: 70_000, nights: { "2026-10-25": 70_000, "2026-10-26": 70_000, "2026-10-27": 70_000 } } };
  const r = nowNightRate(b as never, "2026-10-26");
  assert.equal(r.amount, 70_000);
  assert.equal(r.varies, false);
  assert.equal(nowRateText(r), "₩70,000");
});

test("박마다 다르면 보는 날짜의 요금과 변동 표시", () => {
  const b = { ...base, price: 330_000, nightRates: { flat: 100_000, nights: { "2026-10-25": 100_000, "2026-10-26": 150_000, "2026-10-27": 80_000 } } };
  assert.equal(nowNightRate(b as never, "2026-10-26").amount, 150_000);
  assert.equal(nowNightRate(b as never, "2026-10-26").varies, true);
  assert.equal(nowNightRate(b as never, "2026-10-28").amount, 80_000); // 퇴실 아침 → 마지막 밤
  assert.equal(nowNightRate(b as never, "2026-10-20").amount, 100_000); // 입실 전 → 첫 밤
});

test("추가 항목은 하루 요금에 섞지 않아요 · 요금표가 없으면 객실료÷박수", () => {
  const b = { ...base, price: 250_000, nightRates: { flat: null, nights: { "2026-10-25": 70_000 }, extras: [{ name: "이불", amount: 40_000 }] } };
  const r = nowNightRate(b as never, "2026-10-25");
  assert.equal(r.basis, "avg");
  assert.equal(r.amount, 70_000);
  assert.equal(nowNightRate({ ...base, price: 0, nightRates: null, priceUnset: true } as never, "2026-10-25").amount, null);
});

test("결제는 수단+금액 (이체690,000) · 같은 수단은 합쳐요", () => {
  assert.equal(nowPayText(nowPayParts([{ method: "transfer", amount: 690_000 }])), "이체690,000");
  const t = nowPayText(nowPayParts([{ method: "transfer", amount: 300_000 }, { method: "transfer", amount: 390_000 }], [{ method: "card", amount: 100_000 }]));
  assert.equal(t, "이체690,000 · 카드100,000");
  assert.equal(nowPayText(nowPayParts([])), null);
  assert.equal(nowPayText(nowPayParts([{ method: "card", amount: 1 }, { method: "cash", amount: 2 }, { method: "transfer", amount: 3 }]), 2), "카드1 · 현금2 외 1건");
});

test("회사명은 단체 정산 정보의 회사", () => {
  assert.equal(nowCompanyOf(null, { payerCompany: " (주)호토리 " }), "(주)호토리");
  assert.equal(nowCompanyOf({}, { payerCompany: "" }), null);
  assert.equal(nowCompanyOf(null, null), null);
  // 예약 회사명이 먼저 · 비면 단체 회사명으로
  assert.equal(nowCompanyOf({ company: " 오서건설 " }, { payerCompany: "(주)호토리" }), "오서건설");
  assert.equal(nowCompanyOf({ company: "  " }, { payerCompany: "(주)호토리" }), "(주)호토리");
  assert.equal(nowCompanyOf({ company: "오서건설" }, null), "오서건설");
});

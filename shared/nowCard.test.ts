import { test } from "node:test";
import assert from "node:assert/strict";
import { nowCompanyOf, nowNightRate, nowPlatformPayPart, nowPayParts, nowPayText, nowRangeFull, nowRateText } from "./nowCard";

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

test("추가 항목은 하루 요금에 섞지 않아요 · 적어 둔 박만 보여요", () => {
  const b = { ...base, price: 250_000, nightRates: { flat: null, nights: { "2026-10-25": 70_000 }, extras: [{ name: "이불", amount: 40_000 }] } };
  const r = nowNightRate(b as never, "2026-10-25");
  assert.equal(r.basis, "night");
  assert.equal(r.amount, 70_000);
  // 적어 두지 않은 박은 평균으로 메우지 않아요
  assert.equal(nowNightRate(b as never, "2026-10-26").amount, null);
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

// ── 색 규칙: 객실 가격=빨강 · 받은 돈=검정 · 받아야 할 돈(미수금, 오늘 밤 기준)=파랑 ──
import { readFileSync } from "node:fs";
import { nowDueAmount, nowMetaLine } from "./nowboard";
import type { Booking } from "./ledger";

const open = (id: string, roomId: string, per: number, checkIn: string, nights: number): Booking =>
  ({ id, kind: "stay", status: "active", groupId: "g", checkIn, nights, price: per * nights, arrived: true, checkedOutAt: null, openEnded: true, holdAhead: 1, stayMode: "standard", roomId, typeId: "t", segments: null, nightRates: null, platformId: "p", guestName: "x", payments: [], priceUnset: false }) as unknown as Booking;
const grp602 = (legacy: boolean): Booking[] => [
  open("a", "r602", 70_000, "2026-10-25", legacy ? 5 : 4),
  open("b", "r501", 80_000, "2026-10-25", legacy ? 5 : 4),
  open("c", "r301", 80_000, "2026-10-25", legacy ? 5 : 4),
  open("d", "r502", 80_000, "2026-10-27", legacy ? 3 : 2),
];

test("받아야 할 돈: 602 단체는 대표객실에만 오늘 밤 기준 미수금 310,000 (예정 청구 제외)", () => {
  for (const legacy of [false, true]) {
    const members = grp602(legacy);
    const info = { payments: [{ id: "p1", method: "transfer", amount: 770_000 }], extras: [] } as never;
    const ctx = { members, info };
    assert.equal(nowDueAmount(members[0]!, null, ctx, "2026-10-28", true), 310_000, `legacy=${legacy}`);
    assert.equal(nowDueAmount(members[1]!, null, ctx, "2026-10-28", false), 0, "대표 아닌 멤버 칸에는 안 보여요");
  }
});

test("받아야 할 돈: 다 냈거나 금액미정·장기면 0 → 카드에 안 나와요", () => {
  const members = grp602(false);
  const paid = { members, info: { payments: [{ id: "p1", method: "transfer", amount: 1_080_000 }], extras: [] } as never };
  assert.equal(nowDueAmount(members[0]!, null, paid, "2026-10-28", true), 0);
  assert.equal(nowDueAmount({ ...members[0]!, priceUnset: true } as Booking, null, null, "2026-10-28", false), 0);
  assert.equal(nowDueAmount({ ...members[0]!, stayMode: "long_stay" } as Booking, null, null, "2026-10-28", false), 0);
});

test("받아야 할 돈: 단실은 청구 − 받은 돈", () => {
  const s = { ...open("s", "r1", 70_000, "2026-10-27", 2), groupId: null, openEnded: false, payments: [{ id: "x", bookingId: "s", kind: "deposit", method: "cash", amount: 40_000, bizDate: "2026-10-27", createdAt: "" }] } as unknown as Booking;
  const due = nowDueAmount(s, { name: "현장", onsite: true }, null, "2026-10-27", false);
  assert.equal(due, 100_000);
  assert.equal(nowDueAmount(s, null, null, "2026-10-27", false), 0, "수납을 추적하지 않는 플랫폼은 받을 돈을 만들지 않아요");
});

test("색은 항목 고정: 가격 빨강 · 받은 돈 검정 · 받아야 할 돈 파랑 (CSS 변수 + 다크 모드)", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /--amt-rate:\s*#c8102e/);
  assert.match(css, /--amt-paid:\s*#111111/);
  assert.match(css, /--amt-due:\s*#1d4ed8/);
  assert.match(css, /\[data-theme="dark"\][^{]*\{[^}]*--amt-rate[^}]*--amt-paid[^}]*--amt-due/);
  assert.match(css, /\.amt-rate[^{]*\{\s*color:\s*var\(--amt-rate\)/);
  assert.match(css, /\.amt-due[^{]*\{\s*color:\s*var\(--amt-due\)/);
  assert.doesNotMatch(css, /\.nowamt\.tone-(due|partial|paid)/, "결제 줄에 상태색이 남지 않아요");
  const facts = readFileSync(new URL("../src/RoomCardFacts.tsx", import.meta.url), "utf8");
  assert.match(facts, /rc-rate amt-rate/);
  assert.match(facts, /rc-pay amt-paid/);
  assert.match(facts, /rc-due amt-due/);
});

// ── 야놀자 3박 예약: 플랫폼 결제금액 · 예약번호 숨김 · 평균 추정 금지 ──
const ota = { ...base, status: "active" as const, groupId: null, stayMode: "standard" as const, price: 270_000, memo: "야놀자 예약번호 YN-1001 · 스탠다드" };
const yanolja = { name: "야놀자", onsite: false };
const walkin = { name: "현장", onsite: true };

test("플랫폼(OTA) 결제금액: 예약에 적힌 판매가 그대로 `플랫폼270,000` — 현장 결제 예약은 안 붙어요", () => {
  const part = nowPlatformPayPart(ota as never, yanolja);
  assert.deepEqual(part, { method: "플랫폼", amount: 270_000 });
  assert.equal(nowPayText([part!]), "플랫폼270,000");
  assert.equal(nowPayText([part!, ...nowPayParts([{ method: "card", amount: 20_000 }])]), "플랫폼270,000 · 카드20,000");
  assert.equal(nowPlatformPayPart(ota as never, walkin), null);
  assert.equal(nowPlatformPayPart({ ...ota, status: "cancelled" } as never, yanolja), null);
  assert.equal(nowPlatformPayPart({ ...ota, priceUnset: true, price: 0 } as never, yanolja), null);
  assert.equal(nowPlatformPayPart({ ...ota, groupId: "g" } as never, yanolja), null);
});

test("OTA 연박: 박별 요금이 있으면 박마다 자기 요금 · 없으면 평균 추정을 만들지 않고 비워요", () => {
  const withRates = { ...ota, nightRates: { flat: null, nights: { "2026-10-25": 80_000, "2026-10-26": 100_000, "2026-10-27": 90_000 } } };
  assert.equal(nowNightRate(withRates as never, "2026-10-25").amount, 80_000);
  assert.equal(nowNightRate(withRates as never, "2026-10-26").amount, 100_000);
  assert.equal(nowNightRate(withRates as never, "2026-10-26").varies, true);
  const r = nowNightRate({ ...ota, nightRates: null } as never, "2026-10-26");
  assert.equal(r.amount, null);
  assert.equal(r.basis, "none");
  assert.equal(nowRateText(r), null);
  assert.equal(nowNightRate({ ...ota, nights: 1, price: 70_000, nightRates: null } as never, "2026-10-25").amount, 70_000);
});

test("카드 메모 줄에는 플랫폼 예약번호가 안 보여요 (메모 원문은 그대로)", () => {
  assert.equal(nowMetaLine({ memo: ota.memo, guests: 2 }), "스탠다드");
  assert.equal(nowMetaLine({ memo: "야놀자 예약번호 YN-1001", guests: 2 }), null);
  assert.equal(nowMetaLine({ memo: "아고다 예약번호 2610211864975519\n금연 층", guests: 2 }), "금연 층");
  assert.equal(nowMetaLine({ memo: "야놀자(아고다) 예약번호 AG-9 · 디럭스\n조식 포함", guests: 2 }), "디럭스\n조식 포함");
  assert.equal(nowMetaLine({ memo: "금연", guests: 2 }), "금연");
  assert.equal(ota.memo, "야놀자 예약번호 YN-1001 · 스탠다드");
});

test("카드 순서: 이용기간·결제는 이름 위(top), 회사·하루 요금은 이름 아래(who)", () => {
  const dash = readFileSync(new URL("../src/Dashboard.tsx", import.meta.url), "utf8");
  const facts = readFileSync(new URL("../src/RoomCardFacts.tsx", import.meta.url), "utf8");
  assert.match(facts, /slot\?: "top" \| "who" \| "all"/);
  assert.ok(!/추정/.test(facts.replace(/\/\*[\s\S]*?\*\//g, "")), "카드에 추정 뱃지 없음");
  const iTop = dash.indexOf('factsEl("top")');
  const iName = dash.indexOf('<span className="gn">{b.guestName}</span>', iTop);
  const iWho = dash.indexOf('factsEl("who")', iName);
  assert.ok(iTop > 0 && iName > iTop && iWho > iName, "배치 카드: top → 이름 → who");
  const iTop2 = dash.indexOf('slot="top"', dash.indexOf("const cardRate"));
  const iName2 = dash.indexOf('<span className="gn">{b.guestName}</span>', iTop2);
  const iWho2 = dash.indexOf('slot="who"', iName2);
  assert.ok(iTop2 > 0 && iName2 > iTop2 && iWho2 > iName2, "현황 카드: top → 이름 → who");
});

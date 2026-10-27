// 장기숙박(퇴실 미정): 요금표 · 박별 누적 · 미수 · 재고 창 롤링
import { type Booking, addDays, dayLabel, fitSegments, won } from "./ledger";
import { applyExtend, canExtend, extendBlock, extendOverlaps, type ExtendDraft } from "./extend";
import type { HotelSettings } from "./ledger";

const PAY_MAX = 100_000_000;

export type StayMode = "standard" | "long_stay";
export type SettleCycle = "weekly" | "adhoc";

export const LONG_STAY_WINDOW_DEFAULT = 7;
export const WINDOW_EXTEND_DEFAULT = 7;

export interface LongStayRate {
  kind: "flat" | "dow";
  flatAmount?: number;
  /** 0=일 … 6=토 (호텔 캘린더 요일) */
  dowAmounts?: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number>>;
  currency: "KRW";
}

export interface NightCharge {
  id: string;
  bookingId: string;
  nightDate: string;
  amount: number;
  createdAt: string;
}

export const isLongStay = (b: Pick<Booking, "stayMode"> | null | undefined): boolean => b?.stayMode === "long_stay";

/** YYYY-MM-DD → 요일 0=일…6=토 (타임존 무관) */
export function nightDow(ymd: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function flatRate(amount: number): LongStayRate {
  return { kind: "flat", flatAmount: Math.max(0, Math.round(amount)), currency: "KRW" };
}

/** 요금표에서 밤 D의 단가. 검증 실패 시 null */
export function nightAmount(rate: LongStayRate | null | undefined, nightDate: string): number | null {
  if (!rate) return null;
  if (rate.kind === "flat") {
    if (rate.flatAmount == null || !Number.isInteger(rate.flatAmount) || rate.flatAmount < 0) return null;
    return rate.flatAmount;
  }
  const dow = nightDow(nightDate);
  const a = rate.dowAmounts?.[dow];
  if (a == null || !Number.isInteger(a) || a < 0) return null;
  return a;
}

export function validateLongStayRate(rate: LongStayRate | null | undefined): string | null {
  if (!rate) return "장기 요금표를 입력해 주세요.";
  if (rate.kind === "flat") {
    if (rate.flatAmount == null || !Number.isInteger(rate.flatAmount) || rate.flatAmount < 0) return "매일 단가를 입력해 주세요.";
    if (rate.flatAmount > PAY_MAX) return "단가가 너무 커요 (1억 원까지).";
    return null;
  }
  if (rate.kind === "dow") {
    for (let d = 0; d <= 6; d++) {
      const a = rate.dowAmounts?.[d as 0 | 1 | 2 | 3 | 4 | 5 | 6];
      if (a == null || !Number.isInteger(a) || a < 0) return "요일별 단가를 모두 입력해 주세요.";
      if (a > PAY_MAX) return "단가가 너무 커요 (1억 원까지).";
    }
    return null;
  }
  return "요금표 종류를 골라 주세요.";
}

/** 재고 창의 점유 밤 목록 (입실부터 nights개) */
export function windowNights(checkIn: string, nights: number): string[] {
  const n = Math.max(0, Math.min(90, Math.round(nights)));
  return Array.from({ length: n }, (_, i) => addDays(checkIn, i));
}

export function accruedOf(b: Pick<Booking, "charges"> | { charges?: NightCharge[] | null }): number {
  return (b.charges ?? []).reduce((n, x) => n + x.amount, 0);
}

/** 미수 = max(0, 누적 − 수납액). 과입금은 0 클램프 */
export function balanceDue(b: Pick<Booking, "charges" | "payments">): number {
  const paid = (b.payments ?? []).reduce((n, x) => n + x.amount, 0);
  return Math.max(0, accruedOf(b) - paid);
}

export interface LongPayState {
  accrued: number;
  paid: number;
  balanceDue: number;
  full: boolean;
}

export function longPayState(b: Pick<Booking, "charges" | "payments" | "status">): LongPayState {
  const accrued = accruedOf(b);
  const paid = (b.payments ?? []).reduce((n, x) => n + x.amount, 0);
  const due = Math.max(0, accrued - paid);
  return { accrued, paid, balanceDue: due, full: b.status === "active" && accrued > 0 && due === 0 };
}

/** 누락 밤 줄 초안 (id는 저장 전 빈 값) */
export function planMissingCharges(
  checkIn: string,
  nights: number,
  rate: LongStayRate,
  existing: Pick<NightCharge, "nightDate">[] = [],
): { nightDate: string; amount: number }[] | { err: string } {
  const rv = validateLongStayRate(rate);
  if (rv) return { err: rv };
  const have = new Set(existing.map((x) => x.nightDate));
  const out: { nightDate: string; amount: number }[] = [];
  for (const d of windowNights(checkIn, nights)) {
    if (have.has(d)) continue;
    const amount = nightAmount(rate, d);
    if (amount == null) return { err: `${dayLabel(d)} 단가를 계산할 수 없어요.` };
    out.push({ nightDate: d, amount });
  }
  return out;
}

/** 창 밖(축소) 줄 id — 삭제 대상 */
export function chargesOutsideWindow(
  checkIn: string,
  nights: number,
  charges: NightCharge[],
): NightCharge[] {
  const ok = new Set(windowNights(checkIn, nights));
  return charges.filter((c) => !ok.has(c.nightDate));
}

/** 장기 price 캐시 = 누적 합 */
export function priceCacheFromCharges(charges: Pick<NightCharge, "amount">[]): number {
  return charges.reduce((n, x) => n + x.amount, 0);
}

/** 로컬에서 누락 줄을 붙인 뒤의 charges · price (저장 전 미리보기) */
export function withPlannedCharges(
  b: Booking,
  rate: LongStayRate,
): { charges: NightCharge[]; price: number } | { err: string } {
  const planned = planMissingCharges(b.checkIn, b.nights ?? 0, rate, b.charges ?? []);
  if ("err" in planned) return planned;
  const extra: NightCharge[] = planned.map((p, i) => ({
    id: `__plan_${i}_${p.nightDate}`,
    bookingId: b.id,
    nightDate: p.nightDate,
    amount: p.amount,
    createdAt: "",
  }));
  const ok = new Set(windowNights(b.checkIn, b.nights ?? 0));
  const keep = (b.charges ?? []).filter((c) => ok.has(c.nightDate));
  const charges = [...keep, ...extra].sort((a, c) => a.nightDate.localeCompare(c.nightDate));
  return { charges, price: priceCacheFromCharges(charges) };
}

export interface WindowExtendDraft {
  nights: number;
  price: number;
  segments: ReturnType<typeof fitSegments>;
  checkOut: string;
  /** 새로 점유하는 밤들 */
  extraNights: string[];
  /** 박별 단가 (줄 적재용) */
  lines: { nightDate: string; amount: number }[];
  totalRate: number;
}

/** 재고 창 +N · 원장 줄 초안 (충돌·한도는 호출 측에서 extendBlock 반복) */
export function planWindowExtend(b: Booking, addNights: number, rate: LongStayRate): WindowExtendDraft | { err: string } {
  const add = Math.round(addNights);
  if (!Number.isInteger(add) || add < 1) return { err: "늘릴 박수를 입력해 주세요." };
  if (!canExtend(b)) return { err: "재고 창을 늘릴 수 없어요." };
  if ((b.nights ?? 0) + add > 90) return { err: "박수가 너무 많아요 (90박까지)." };
  const rv = validateLongStayRate(rate);
  if (rv) return { err: rv };
  const lines: { nightDate: string; amount: number }[] = [];
  let nights = b.nights ?? 0;
  let segments = b.segments ?? null;
  let roomId = b.roomId;
  for (let i = 0; i < add; i++) {
    const nightDate = addDays(b.checkIn, nights);
    const amount = nightAmount(rate, nightDate);
    if (amount == null) return { err: `${dayLabel(nightDate)} 단가를 계산할 수 없어요.` };
    lines.push({ nightDate, amount });
    nights += 1;
    segments = fitSegments(segments, roomId, nights);
  }
  const existing = b.charges ?? [];
  const merged = [
    ...existing.filter((c) => !chargesOutsideWindow(b.checkIn, nights, [c]).length),
    ...lines.map((l, i) => ({ id: `__x_${i}`, bookingId: b.id, nightDate: l.nightDate, amount: l.amount, createdAt: "" })),
  ];
  return {
    nights,
    price: priceCacheFromCharges(merged),
    segments,
    checkOut: addDays(b.checkIn, nights),
    extraNights: lines.map((l) => l.nightDate),
    lines,
    totalRate: lines.reduce((n, x) => n + x.amount, 0),
  };
}

/** 장기 1박 연장: applyExtend + 스케줄 단가(원장). price는 캐시 */
export function planLongStayExtend(b: Booking, rate: LongStayRate): { draft: ExtendDraft; line: { nightDate: string; amount: number } } | { err: string } {
  const amount = nightAmount(rate, addDays(b.checkIn, b.nights ?? 0));
  if (amount == null) {
    const rv = validateLongStayRate(rate);
    return { err: rv ?? "오늘 단가를 계산할 수 없어요." };
  }
  const draft = applyExtend(b, amount);
  // price 캐시 = 기존 누적 + 새 줄 (기존 price가 어긋나도 원장 기준)
  const accrued = accruedOf(b) + amount;
  return {
    draft: { ...draft, rate: amount, price: accrued },
    line: { nightDate: draft.extraNight, amount },
  };
}

export function windowExtendBlock(
  s: HotelSettings,
  bookings: Booking[],
  b: Booking,
  addNights: number,
  rate: LongStayRate,
  label: (id: string | null) => string | null,
): string | null {
  const plan = planWindowExtend(b, addNights, rate);
  if ("err" in plan) return plan.err;
  // 밤마다 겹침 검사 (순차 반영)
  let working = bookings.map((x) => ({ ...x }));
  let cur: Booking = { ...b };
  for (const night of plan.extraNights) {
    const amt = nightAmount(rate, night) ?? 0;
    const block = extendBlock(s, working, cur, amt, label);
    if (block) return block;
    const hits = extendOverlaps(working, cur, amt);
    if (hits.length) {
      const rooms = [...new Set(hits.map((x) => `${label(x.roomId) ?? "?"}호`))].join(", ");
      return `${rooms}는 ${dayLabel(night)} 밤에 다른 예약이 있어요. 방을 옮기거나 비운 뒤 연장해 주세요.`;
    }
    const d = applyExtend(cur, amt);
    cur = { ...cur, nights: d.nights, price: d.price, segments: d.segments };
    working = working.map((x) => (x.id === b.id ? cur : x));
  }
  return null;
}

/** 퇴실처리 시 실제 투숙 박수: 퇴실 아침 today → nights = checkIn~today */
export function nightsAtCheckout(checkIn: string, today: string): number {
  const raw = Math.round((Date.parse(today) - Date.parse(checkIn)) / 864e5);
  return Math.max(1, Math.min(90, raw));
}

/** 주간 정산 안내 카피 */
export function settleHint(cycle: SettleCycle | null | undefined, balance: number): string {
  if (cycle === "adhoc") return balance > 0 ? `수시 정산 · 미수 ${won(balance)}원` : "수시 정산 · 정산됨";
  return balance > 0 ? `주간 정산 권장 · 미수 ${won(balance)}원` : "주간 정산 · 정산됨";
}

export function normalizeLongStayRate(raw: unknown): LongStayRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "flat") {
    const flatAmount = Math.round(Number(o.flatAmount));
    if (!Number.isFinite(flatAmount) || flatAmount < 0) return null;
    return { kind: "flat", flatAmount, currency: "KRW" };
  }
  if (o.kind === "dow") {
    const src = o.dowAmounts && typeof o.dowAmounts === "object" ? (o.dowAmounts as Record<string, unknown>) : {};
    const dowAmounts: LongStayRate["dowAmounts"] = {};
    for (let d = 0; d <= 6; d++) {
      const a = Math.round(Number(src[String(d)] ?? src[d as 0 | 1 | 2 | 3 | 4 | 5 | 6]));
      if (!Number.isFinite(a) || a < 0) return null;
      dowAmounts[d as 0 | 1 | 2 | 3 | 4 | 5 | 6] = a;
    }
    return { kind: "dow", dowAmounts, currency: "KRW" };
  }
  return null;
}

/** JSONB 저장 형태 */
export function longStayRateToJson(rate: LongStayRate | null | undefined): LongStayRate | null {
  if (!rate) return null;
  if (rate.kind === "flat") return { kind: "flat", flatAmount: Math.round(rate.flatAmount ?? 0), currency: "KRW" };
  const dowAmounts: Record<string, number> = {};
  for (let d = 0; d <= 6; d++) dowAmounts[String(d)] = Math.round(rate.dowAmounts?.[d as 0 | 1 | 2 | 3 | 4 | 5 | 6] ?? 0);
  return { kind: "dow", dowAmounts: dowAmounts as LongStayRate["dowAmounts"], currency: "KRW" };
}

export function parseStayMode(v: unknown): StayMode {
  return v === "long_stay" ? "long_stay" : "standard";
}

export function parseSettleCycle(v: unknown): SettleCycle | null {
  if (v === "weekly" || v === "adhoc") return v;
  return null;
}

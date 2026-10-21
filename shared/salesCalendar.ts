/**
 * 판매 캘린더 — 타입×숙박일 기본 요금 · 판매중지.
 * 재고 숫자는 stockTable 재사용. 예약 저장 후 요금 진실은 bookings.night_rates / price.
 * (ledger와 순환 import 금지 — 날짜 헬퍼는 여기 최소 복제)
 */
import { defaultNightAmount, isWeekendNight, occupiedNightDates } from "./nightrates";

export interface TypeRateDefaults {
  weekday?: number | null;
  weekend?: number | null;
  flat?: number | null;
}

/** typeId → 평일/주말/기본 1박 */
export type TypeRatesMap = Record<string, TypeRateDefaults>;
/** typeId → YYYY-MM-DD → 금액 */
export type TypeRateOverridesMap = Record<string, Record<string, number>>;
/** typeId → YYYY-MM-DD → true (판매 중지) */
export type TypeStopSellMap = Record<string, Record<string, true>>;

type SalesSettings = {
  typeRates?: TypeRatesMap;
  typeRateOverrides?: TypeRateOverridesMap;
  typeStopSell?: TypeStopSellMap;
  specialDates?: string[];
};

const PAY_MAX = 100_000_000;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function numAmt(v: unknown): number | null {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > PAY_MAX) return null;
  return n;
}

export function normalizeTypeRates(raw: unknown): TypeRatesMap {
  if (!raw || typeof raw !== "object") return {};
  const out: TypeRatesMap = {};
  for (const [tid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!tid || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const weekday = numAmt(o.weekday);
    const weekend = numAmt(o.weekend);
    const flat = numAmt(o.flat);
    if (weekday == null && weekend == null && flat == null) continue;
    out[tid] = { weekday, weekend, flat };
  }
  return out;
}

export function normalizeTypeRateOverrides(raw: unknown): TypeRateOverridesMap {
  if (!raw || typeof raw !== "object") return {};
  const out: TypeRateOverridesMap = {};
  for (const [tid, days] of Object.entries(raw as Record<string, unknown>)) {
    if (!tid || !days || typeof days !== "object") continue;
    const row: Record<string, number> = {};
    for (const [d, amt] of Object.entries(days as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const n = numAmt(amt);
      if (n != null) row[d] = n;
    }
    if (Object.keys(row).length) out[tid] = row;
  }
  return out;
}

export function normalizeTypeStopSell(raw: unknown): TypeStopSellMap {
  if (!raw || typeof raw !== "object") return {};
  const out: TypeStopSellMap = {};
  for (const [tid, days] of Object.entries(raw as Record<string, unknown>)) {
    if (!tid || !days || typeof days !== "object") continue;
    const row: Record<string, true> = {};
    for (const [d, v] of Object.entries(days as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v === true) row[d] = true;
    }
    if (Object.keys(row).length) out[tid] = row;
  }
  return out;
}

export function typeRateDefaults(s: Pick<SalesSettings, "typeRates">, typeId: string): TypeRateDefaults {
  return s.typeRates?.[typeId] ?? {};
}

/** 타입×숙박일 기본 판매 단가 (오버라이드 → 평일/주말 → flat) */
export function baseRateFor(s: SalesSettings, typeId: string, date: string): number {
  const ov = s.typeRateOverrides?.[typeId]?.[date];
  if (ov != null && ov > 0) return Math.round(ov);
  const d = typeRateDefaults(s, typeId);
  return defaultNightAmount(date, { weekday: d.weekday, weekend: d.weekend, flat: d.flat }, s.specialDates ?? []);
}

export function isStopSell(s: Pick<SalesSettings, "typeStopSell">, typeId: string, date: string): boolean {
  return s.typeStopSell?.[typeId]?.[date] === true;
}

/** 판매 가능 칸: 판매중지면 0, 아니면 remaining */
export function sellableRemaining(remaining: number, stopped: boolean): number {
  return stopped ? 0 : remaining;
}

/** stockTable 점유 수 = 타입 총실 − remaining (오버면 total보다 큼) */
export function bookedCount(total: number, remaining: number): number {
  return total - remaining;
}

/** 판매 가능: 남은 재고 있고 판매중지 아님 */
export function isSellOpen(remaining: number, stopped: boolean): boolean {
  return !stopped && remaining > 0;
}

/** 카드 상태 삼위: 판매 / 매진(재고0·중지아님) / 마감(판매중지) */
export type SellStatus = "sell" | "soldout" | "closed";

export function sellStatus(remaining: number, stopped: boolean): SellStatus {
  if (stopped) return "closed";
  if (remaining <= 0) return "soldout";
  return "sell";
}

/** 입실·퇴실 시각 짧은 힌트 (16:00→16, 12:30→12:30) */
export function shortStayHint(checkIn: string, checkOut: string): string {
  const short = (t: string) => {
    const [h, m] = t.split(":");
    if (!h) return t;
    return m === "00" ? String(Number(h)) : `${Number(h)}:${m}`;
  };
  return `${short(checkIn)}–${short(checkOut)}`;
}

export type BulkSalesPatch = {
  /** undefined = 요금 유지 · null = 오버라이드 삭제 · number = 설정 */
  rate?: number | null;
  /** undefined = 판매상태 유지 */
  stopSell?: boolean;
};

/** 선택한 타입×숙박일에 요금·판매중지 일괄 적용 */
export function applyBulkTypeDates<T extends SalesSettings>(
  s: T,
  typeIds: string[],
  dates: string[],
  patch: BulkSalesPatch,
): T {
  let next = s;
  for (const typeId of typeIds) {
    for (const date of dates) {
      if (patch.rate !== undefined) next = setTypeDateRate(next, typeId, date, patch.rate);
      if (patch.stopSell !== undefined) next = setTypeStopSell(next, typeId, date, patch.stopSell);
    }
  }
  return next;
}

/** 예약이 점유하는 숙박일 중 판매중지된 날짜 (타입 기준) */
export function stopSellDatesForStay(
  s: Pick<SalesSettings, "typeStopSell">,
  typeId: string,
  checkIn: string,
  nights: number,
): string[] {
  return occupiedNightDates(checkIn, nights).filter((d) => isStopSell(s, typeId, d));
}

export function setTypeRateDefaults<T extends SalesSettings>(s: T, typeId: string, next: TypeRateDefaults): T {
  const cur = { ...(s.typeRates ?? {}) };
  const weekday = next.weekday != null && next.weekday > 0 ? Math.round(next.weekday) : null;
  const weekend = next.weekend != null && next.weekend > 0 ? Math.round(next.weekend) : null;
  const flat = next.flat != null && next.flat > 0 ? Math.round(next.flat) : null;
  if (weekday == null && weekend == null && flat == null) delete cur[typeId];
  else cur[typeId] = { weekday, weekend, flat };
  return { ...s, typeRates: cur };
}

export function setTypeDateRate<T extends SalesSettings>(s: T, typeId: string, date: string, amount: number | null): T {
  const all = { ...(s.typeRateOverrides ?? {}) };
  const row = { ...(all[typeId] ?? {}) };
  if (amount == null || amount <= 0) delete row[date];
  else row[date] = Math.min(PAY_MAX, Math.round(amount));
  if (Object.keys(row).length) all[typeId] = row;
  else delete all[typeId];
  return { ...s, typeRateOverrides: all };
}

export function setTypeStopSell<T extends SalesSettings>(s: T, typeId: string, date: string, on: boolean): T {
  const all = { ...(s.typeStopSell ?? {}) };
  const row = { ...(all[typeId] ?? {}) };
  if (on) row[date] = true;
  else delete row[date];
  if (Object.keys(row).length) all[typeId] = row;
  else delete all[typeId];
  return { ...s, typeStopSell: all };
}

/** 구간 판매중지 (from·to 포함, 숙박일) */
export function setTypeStopSellRange<T extends SalesSettings>(s: T, typeId: string, from: string, to: string, on: boolean): T {
  let next = s;
  const end = to < from ? from : to;
  let d = to < from ? to : from;
  while (d <= end) {
    next = setTypeStopSell(next, typeId, d, on);
    d = addDays(d, 1);
  }
  return next;
}

export { isWeekendNight, occupiedNightDates };

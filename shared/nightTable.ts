// 박별 요금표 (총액 ⇄ 박별 금액 양방향): 모든 예약창이 같은 계산을 써요.
//  · 총액을 적으면 박수대로 나눠요 (몫은 floor, 남는 원은 마지막 박) → 박별 줄이 채워져요
//  · 박별 금액을 고치면 총액이 합으로 바뀌어요
//  · 박수·입실일이 바뀌면 이미 적은 박은 그대로, 새 박만 기본 요금으로 채워요
import { weekday } from "./ledger";
import { type NightAmountMap, type StayNightRates, nightRatesFromTotal, occupiedNightDates, setNightAmount, sumNightAmounts, syncStayNightRates } from "./nightrates";
import { isPeakNight } from "./surcharge";

export interface NightRow {
  date: string;
  weekday: string;
  amount: number;
  /** 금·토(특별일) 밤 */
  peak: boolean;
}

/** 박별 줄 (rates에 없는 박은 fallback 1박 요금으로) */
export function tableRows(checkIn: string, nights: number, rates: StayNightRates | null | undefined, fallbackPerNight = 0, special: readonly string[] = []): NightRow[] {
  const synced = syncStayNightRates(checkIn, nights, rates ?? null, { typeRate: fallbackPerNight }, special);
  return occupiedNightDates(checkIn, nights).map((date) => ({
    date,
    weekday: weekday(date),
    amount: Math.max(0, Math.round(Number(synced.nights?.[date]) || 0)),
    peak: isPeakNight(date, special),
  }));
}

export const tableTotal = (rows: readonly NightRow[]): number => rows.reduce((n, r) => n + r.amount, 0);

/** 평균 1박 (반올림) */
export const tableAverage = (rows: readonly NightRow[]): number => (rows.length ? Math.round(tableTotal(rows) / rows.length) : 0);

/** 한 박 금액 고치기 → 새 요금 (총액 = 합) */
export function withNight(checkIn: string, nights: number, rates: StayNightRates | null | undefined, fallbackPerNight: number, date: string, amount: number, special: readonly string[] = []): StayNightRates {
  const base = syncStayNightRates(checkIn, nights, rates ?? null, { typeRate: fallbackPerNight }, special);
  return setNightAmount(base, date, amount);
}

/** 총액 적기 → 박수대로 나눔 (남는 원은 마지막 박) */
export function withTotal(checkIn: string, nights: number, total: number): StayNightRates {
  return nightRatesFromTotal(checkIn, nights, total);
}

/** 모든 박을 같은 금액으로 */
export function withAllSame(checkIn: string, nights: number, perNight: number): StayNightRates {
  const a = Math.max(0, Math.round(perNight));
  const dates = occupiedNightDates(checkIn, nights);
  return { flat: a > 0 ? a : null, weekday: null, weekend: null, nights: Object.fromEntries(dates.map((d) => [d, a])) };
}

/** 평일·주말(금·토)을 한 번에 */
export function withWeekdayWeekend(checkIn: string, nights: number, wd: number, we: number, special: readonly string[] = []): StayNightRates {
  const dates = occupiedNightDates(checkIn, nights);
  return {
    flat: wd > 0 ? Math.round(wd) : we > 0 ? Math.round(we) : null,
    weekday: wd > 0 ? Math.round(wd) : null,
    weekend: we > 0 ? Math.round(we) : null,
    nights: Object.fromEntries(dates.map((d) => [d, Math.max(0, Math.round(isPeakNight(d, special) ? we : wd))])),
  };
}

/** 방 총액 = 박별 금액 합 (+ 가산분) */
export const roomTotal = (rates: StayNightRates | null | undefined, addons = 0): number => sumNightAmounts(rates?.nights) + Math.max(0, addons);

/** 박별 요금이 전부 같은지 (같으면 "1박 N원 × M박"으로 짧게 보여 줘요) */
export function isUniform(rows: readonly NightRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.amount === rows[0]!.amount);
}

/** 한 줄 요약: `3박 · 1박 230,000원` / `3박 · 평균 76,667원 (박마다 달라요)` */
export function tableSummary(rows: readonly NightRow[]): string {
  if (!rows.length) return "";
  const f = (n: number) => n.toLocaleString("ko-KR");
  return isUniform(rows) ? `${rows.length}박 · 1박 ${f(rows[0]!.amount)}원` : `${rows.length}박 · 평균 ${f(tableAverage(rows))}원 (박마다 달라요)`;
}

// ── 기록 정정: 적은 박만 진실 (빈 박은 비어 있어요 · 총액을 나눠 채우지 않아요) ──

/** 점유 밤 중 실제로 적힌 박만 (0원 포함, 비어 있으면 빠져요) */
export function enteredNightMap(checkIn: string, nights: number, map: Record<string, number | null | undefined> | null | undefined): NightAmountMap {
  const out: NightAmountMap = {};
  for (const d of occupiedNightDates(checkIn, nights)) {
    const v = map?.[d];
    if (v != null && Number.isFinite(Number(v)) && Number(v) >= 0) out[d] = Math.round(Number(v));
  }
  return out;
}

/** 빈 박만 제안값(타입 요금)으로 채워요 · 적어 둔 박은 그대로 */
export function fillBlankNights(checkIn: string, nights: number, map: Record<string, number | null | undefined> | null | undefined, suggestions: Record<string, number>): NightAmountMap {
  const out = enteredNightMap(checkIn, nights, map);
  for (const d of occupiedNightDates(checkIn, nights)) if (out[d] == null && suggestions[d] != null && suggestions[d]! > 0) out[d] = Math.round(suggestions[d]!);
  return out;
}

/**
 * 입실일·박수를 바꿀 때 적어 둔 박 옮기기. 새로 생긴 박은 비워 둬요 (기본 요금으로 채우지 않아요).
 *  · move: 1박째는 새 1박째로 (순번 따라)
 *  · keep: 같은 날짜는 그 금액 그대로
 */
export function shiftEnteredNights(map: Record<string, number | null | undefined> | null | undefined, oldCheckIn: string, oldNights: number, newCheckIn: string, newNights: number, mode: "move" | "keep"): NightAmountMap {
  const old = enteredNightMap(oldCheckIn, oldNights, map);
  if (mode === "keep") return enteredNightMap(newCheckIn, newNights, old);
  const od = occupiedNightDates(oldCheckIn, oldNights);
  const nd = occupiedNightDates(newCheckIn, newNights);
  const out: NightAmountMap = {};
  for (let i = 0; i < Math.min(od.length, nd.length); i++) if (old[od[i]!] != null) out[nd[i]!] = old[od[i]!]!;
  return out;
}

/** 옮기기/그대로 두기 결과가 다른 박이 있나 (있을 때만 직원에게 물어봐요) */
export function nightShiftAmbiguous(map: Record<string, number | null | undefined> | null | undefined, oldCheckIn: string, oldNights: number, newCheckIn: string, newNights: number): boolean {
  if (oldCheckIn === newCheckIn) return false;
  const a = shiftEnteredNights(map, oldCheckIn, oldNights, newCheckIn, newNights, "move");
  const b = shiftEnteredNights(map, oldCheckIn, oldNights, newCheckIn, newNights, "keep");
  return occupiedNightDates(newCheckIn, newNights).some((d) => (a[d] ?? -1) !== (b[d] ?? -1));
}

/**
 * 기록 정정 저장 계산.
 *  · 예약 금액(판매가)은 기본 그대로 — 추가 항목이 바뀐 만큼만 더해요
 *  · 박별 합계가 판매가와 다르면 `차액`을 알려 주고, `useSum`을 켠 때만 예약 금액을 박별 합계로 바꿔요
 *  · 모든 박을 적은 경우에만 합계로 바꿀 수 있어요 (일부만 적은 합은 총액이 아니에요)
 */
export function nightEditPlan(p: { entered: NightAmountMap; nightCount: number; oldPrice: number; oldExtras: number; newExtras: number; addons: number; useSum: boolean }): {
  sum: number;
  count: number;
  allEntered: boolean;
  keepPrice: number;
  sumTotal: number;
  /** 박별 합계 − 판매가 (모든 박을 적었을 때만) */
  diff: number | null;
  price: number;
  usesSum: boolean;
} {
  const count = Object.keys(p.entered).length;
  const sum = sumNightAmounts(p.entered);
  const allEntered = p.nightCount > 0 && count === p.nightCount;
  const keepPrice = Math.max(0, Math.round(p.oldPrice) + Math.round(p.newExtras) - Math.round(p.oldExtras));
  const sumTotal = sum + Math.max(0, p.newExtras) + Math.max(0, p.addons);
  const diff = allEntered ? sumTotal - keepPrice : null;
  const usesSum = allEntered && diff !== 0 && p.useSum;
  return { sum, count, allEntered, keepPrice, sumTotal, diff, price: usesSum ? sumTotal : keepPrice, usesSum };
}

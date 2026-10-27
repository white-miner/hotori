// 박별 요금표 (총액 ⇄ 박별 금액 양방향): 모든 예약창이 같은 계산을 써요.
//  · 총액을 적으면 박수대로 나눠요 (몫은 floor, 남는 원은 마지막 박) → 박별 줄이 채워져요
//  · 박별 금액을 고치면 총액이 합으로 바뀌어요
//  · 박수·입실일이 바뀌면 이미 적은 박은 그대로, 새 박만 기본 요금으로 채워요
import { weekday } from "./ledger";
import { type StayNightRates, nightRatesFromTotal, occupiedNightDates, setNightAmount, sumNightAmounts, syncStayNightRates } from "./nightrates";
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

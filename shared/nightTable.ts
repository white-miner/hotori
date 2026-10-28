// 박별 요금표: 모든 예약창이 같은 계산을 써요. 박별 표가 진실이에요.
//  · 총액을 박수로 나누지 않아요 — 안 적은 박은 비어 있고, 타입 요금은 회색 제안이에요
//  · 「타입 요금으로 채우기」·「박당 금액으로 채우기」는 빈 박만 채워요 (채운 뒤에도 고칠 수 있어요)
//  · 박별 합계가 판매금과 다르면 차액을 알려 주기만 하고, 체크했을 때만 판매금을 합계로 바꿔요
import { weekday } from "./ledger";
import { type NightAmountMap, type StayNightRates, extrasTotal, fillNightAmounts, occupiedNightDates, setNightAmount, sumNightAmounts, syncStayNightRates } from "./nightrates";
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

/** 한 박 금액 고치기 (예약 이동 예약 등 — 빈 박은 fallback 요금으로 채워요) */
export function withNight(checkIn: string, nights: number, rates: StayNightRates | null | undefined, fallbackPerNight: number, date: string, amount: number, special: readonly string[] = []): StayNightRates {
  const base = syncStayNightRates(checkIn, nights, rates ?? null, { typeRate: fallbackPerNight }, special);
  return setNightAmount(base, date, amount);
}

export const tableTotal = (rows: readonly NightRow[]): number => rows.reduce((n, r) => n + r.amount, 0);

/** 평균 1박 (반올림) */
export const tableAverage = (rows: readonly NightRow[]): number => (rows.length ? Math.round(tableTotal(rows) / rows.length) : 0);

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

/** 「박당 금액으로 채우기」: 한 박 금액을 빈 박에만 넣어요 (적어 둔 박은 그대로 · 채운 뒤에도 고칠 수 있어요) */
export function fillBlankWithAmount(checkIn: string, nights: number, map: Record<string, number | null | undefined> | null | undefined, amount: number): NightAmountMap {
  const out = enteredNightMap(checkIn, nights, map);
  const a = Math.max(0, Math.round(amount));
  if (!(a > 0)) return out;
  for (const d of occupiedNightDates(checkIn, nights)) if (out[d] == null) out[d] = a;
  return out;
}

/** 박별 표 상태 (판매금과 비교) — 적은 박 수·합계·차액. 차액은 모든 박을 적었을 때만 */
export function nightTableStatus(p: { checkIn: string; nights: number; rates: StayNightRates | null | undefined; price: number; addons: number }): { entered: NightAmountMap; count: number; total: number; sum: number; allEntered: boolean; sumTotal: number; diff: number | null } {
  const entered = enteredNightMap(p.checkIn, p.nights, p.rates?.nights);
  const count = Object.keys(entered).length;
  const sum = sumNightAmounts(entered);
  const extras = extrasTotal(p.rates);
  const allEntered = occupiedNightDates(p.checkIn, p.nights).length > 0 && count === occupiedNightDates(p.checkIn, p.nights).length;
  const sumTotal = sum + extras + Math.max(0, p.addons);
  return { entered, count, total: occupiedNightDates(p.checkIn, p.nights).length, sum, allEntered, sumTotal, diff: allEntered ? sumTotal - Math.max(0, Math.round(p.price)) : null };
}

/**
 * 박당 요금(평일·주말)을 바꿀 때: 직원이 손으로 고친 박은 그대로 두고, 자동으로 채워졌던 박만 새 금액으로 바꿔요.
 * 손으로 고친 박 = 이전 기본 금액과 다른 박. 전부 덮어쓰려면 overwrite=true (별도 「모두 이 금액으로 덮어쓰기」 버튼).
 */
export function refillKeepingEdits(
  checkIn: string,
  nights: number,
  old: StayNightRates | null | undefined,
  next: { flat?: number | null; weekday?: number | null; weekend?: number | null },
  overwrite = false,
): NightAmountMap {
  const fresh = fillNightAmounts(checkIn, nights, next, null);
  if (overwrite) return fresh;
  const oldDef = fillNightAmounts(checkIn, nights, { flat: old?.flat, weekday: old?.weekday, weekend: old?.weekend }, null);
  const out: NightAmountMap = {};
  for (const d of occupiedNightDates(checkIn, nights)) {
    const cur = old?.nights?.[d];
    const have = cur != null && Number.isFinite(Number(cur));
    const hand = have && Math.round(Number(cur)) !== oldDef[d] && Number(cur) > 0;
    out[d] = hand ? Math.round(Number(cur)) : fresh[d]!;
  }
  return out;
}

/** 손으로 고친 박이 있나 (덮어쓰기 버튼 노출 판단) */
export function hasHandEditedNights(checkIn: string, nights: number, rates: StayNightRates | null | undefined): boolean {
  if (!rates?.nights) return false;
  const def = fillNightAmounts(checkIn, nights, { flat: rates.flat, weekday: rates.weekday, weekend: rates.weekend }, null);
  return occupiedNightDates(checkIn, nights).some((d) => {
    const c = rates.nights?.[d];
    return c != null && Number(c) > 0 && Math.round(Number(c)) !== def[d];
  });
}

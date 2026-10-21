// 표준 숙박: 방별 1박 + 점유 밤(날짜)별 요금 행렬. 총액 = Σ 밤 금액 (+ 가산분).
// 장기 booking_night_charges 원장과 별축 — 확정 LOS 스냅샷.
import { addDays } from "./ledger";
import { isPeakNight } from "./surcharge";

const PAY_MAX = 100_000_000;

/** 점유 밤 날짜 → 그날 객실료 */
export type NightAmountMap = Record<string, number>;

/**
 * bookings.night_rates jsonb
 * · flat: 방별 기본 1박 (타입 rates 위)
 * · weekday / weekend: 채움 기본값 (금·토·특별일 = weekend)
 * · nights: 점유 밤 셀 — 있으면 총액 진실
 */
export interface StayNightRates {
  flat?: number | null;
  weekday?: number | null;
  weekend?: number | null;
  nights?: NightAmountMap | null;
}

export function occupiedNightDates(checkIn: string, nights: number): string[] {
  const n = Math.max(0, Math.min(90, Math.round(nights)));
  return Array.from({ length: n }, (_, i) => addDays(checkIn, i));
}

/** 금·토 밤 (특별일 목록 없으면 isPeakNight와 동일) */
export function isWeekendNight(date: string, special: readonly string[] = []): boolean {
  return isPeakNight(date, special);
}

export function defaultNightAmount(
  date: string,
  d: { flat?: number | null; weekday?: number | null; weekend?: number | null; typeRate?: number | null },
  special: readonly string[] = [],
): number {
  const peak = isWeekendNight(date, special);
  if (peak && d.weekend != null && d.weekend > 0) return Math.round(d.weekend);
  if (!peak && d.weekday != null && d.weekday > 0) return Math.round(d.weekday);
  if (d.flat != null && d.flat > 0) return Math.round(d.flat);
  if (d.typeRate != null && d.typeRate > 0) return Math.round(d.typeRate);
  return 0;
}

export function sumNightAmounts(nights: NightAmountMap | null | undefined): number {
  if (!nights) return 0;
  let s = 0;
  for (const v of Object.values(nights)) s += Math.max(0, Math.round(Number(v) || 0));
  return s;
}

/** 행렬이 LOS를 모두 덮으면 true */
export function hasFullNightMatrix(checkIn: string, nights: number, rates: StayNightRates | null | undefined): boolean {
  const map = rates?.nights;
  if (!map) return false;
  const dates = occupiedNightDates(checkIn, nights);
  if (!dates.length) return false;
  return dates.every((d) => map[d] != null && Number.isFinite(Number(map[d])));
}

export function fillNightAmounts(
  checkIn: string,
  nights: number,
  defaults: { flat?: number | null; weekday?: number | null; weekend?: number | null; typeRate?: number | null },
  prev?: NightAmountMap | null,
  special: readonly string[] = [],
): NightAmountMap {
  const out: NightAmountMap = {};
  for (const d of occupiedNightDates(checkIn, nights)) {
    if (prev && prev[d] != null && Number.isFinite(Number(prev[d]))) {
      out[d] = Math.max(0, Math.round(Number(prev[d])));
    } else {
      out[d] = defaultNightAmount(d, defaults, special);
    }
  }
  return out;
}

/**
 * 박수·입실 변경 시 행렬 맞춤.
 * · 축소: 새 점유 밤만 유지 (뒤 밤 drop)
 * · 확장: 새 셀은 기본 단가로 채움 (기존 셀 유지)
 */
export function syncStayNightRates(
  checkIn: string,
  nights: number,
  prev: StayNightRates | null | undefined,
  fallbacks: { typeRate?: number | null } = {},
  special: readonly string[] = [],
): StayNightRates {
  const flat = prev?.flat != null && prev.flat > 0 ? Math.round(prev.flat) : fallbacks.typeRate != null && fallbacks.typeRate > 0 ? Math.round(fallbacks.typeRate) : null;
  const weekday = prev?.weekday != null && prev.weekday > 0 ? Math.round(prev.weekday) : null;
  const weekend = prev?.weekend != null && prev.weekend > 0 ? Math.round(prev.weekend) : null;
  const defaults = { flat, weekday, weekend, typeRate: fallbacks.typeRate };
  const map = fillNightAmounts(checkIn, nights, defaults, prev?.nights ?? null, special);
  return {
    flat: flat ?? (Object.values(map)[0] != null ? Object.values(map)[0]! : null),
    weekday,
    weekend,
    nights: map,
  };
}

/** 1박 연장: 새 점유 밤 셀 추가 */
export function appendNightAmount(rates: StayNightRates | null | undefined, nightDate: string, amount: number): StayNightRates {
  const a = Math.max(0, Math.round(amount));
  const nights = { ...(rates?.nights ?? {}), [nightDate]: a };
  return {
    flat: rates?.flat ?? a,
    weekday: rates?.weekday ?? null,
    weekend: rates?.weekend ?? null,
    nights,
  };
}

export function setNightAmount(rates: StayNightRates, nightDate: string, amount: number): StayNightRates {
  const a = Math.max(0, Math.min(PAY_MAX, Math.round(amount)));
  return { ...rates, nights: { ...(rates.nights ?? {}), [nightDate]: a } };
}

/** 평일·주말 기본을 바꾸고 셀을 기본값으로 다시 채움(이미 있던 셀도 덮음 — 일괄 적용) */
export function refillFromDefaults(
  checkIn: string,
  nights: number,
  rates: StayNightRates,
  special: readonly string[] = [],
): StayNightRates {
  const defaults = {
    flat: rates.flat,
    weekday: rates.weekday,
    weekend: rates.weekend,
  };
  return {
    ...rates,
    nights: fillNightAmounts(checkIn, nights, defaults, null, special),
  };
}

export function priceFromNightMatrix(rates: StayNightRates | null | undefined, addons = 0): number {
  return Math.max(0, sumNightAmounts(rates?.nights) + Math.max(0, addons));
}

/** DB jsonb → StayNightRates. 잘못된 값은 null */
export function parseStayNightRates(raw: unknown): StayNightRates | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= PAY_MAX ? n : null;
  };
  const flat = num(o.flat);
  const weekday = num(o.weekday);
  const weekend = num(o.weekend);
  let nights: NightAmountMap | null = null;
  if (o.nights && typeof o.nights === "object" && !Array.isArray(o.nights)) {
    nights = {};
    for (const [k, v] of Object.entries(o.nights as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const a = num(v);
      if (a != null) nights[k] = a;
    }
    if (!Object.keys(nights).length) nights = null;
  }
  if (flat == null && weekday == null && weekend == null && !nights) return null;
  return { flat, weekday, weekend, nights };
}

export function stayNightRatesToJson(r: StayNightRates | null | undefined): StayNightRates | null {
  if (!r) return null;
  const out: StayNightRates = {};
  if (r.flat != null && r.flat > 0) out.flat = Math.round(r.flat);
  if (r.weekday != null && r.weekday > 0) out.weekday = Math.round(r.weekday);
  if (r.weekend != null && r.weekend > 0) out.weekend = Math.round(r.weekend);
  if (r.nights && Object.keys(r.nights).length) {
    const nights: NightAmountMap = {};
    for (const [k, v] of Object.entries(r.nights)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(v)) nights[k] = Math.max(0, Math.round(v));
    }
    if (Object.keys(nights).length) out.nights = nights;
  }
  return out.flat != null || out.weekday != null || out.weekend != null || out.nights ? out : null;
}

/** 방별 플랫 단가 (행렬 평균 아님 — flat 우선) */
export function memberFlatRate(
  rates: StayNightRates | null | undefined,
  typeRate?: number | null,
  priceNights?: { price: number; nights: number; addons?: number },
): number {
  if (rates?.flat != null && rates.flat > 0) return Math.round(rates.flat);
  if (typeRate != null && typeRate > 0) return Math.round(typeRate);
  if (priceNights && priceNights.nights >= 1) {
    const room = Math.max(0, priceNights.price - (priceNights.addons ?? 0));
    return Math.max(0, Math.round(room / priceNights.nights));
  }
  return 0;
}

/**
 * 총액을 n칸으로 나눔. 몫은 floor, **남는 원은 마지막 칸**.
 * (플랫폼 OTA 총액 → 박·호실 분배용. 균등 강제 금지.)
 */
export function splitAmountLast(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Math.max(0, Math.round(Number(total) || 0));
  const per = Math.floor(t / n);
  const rem = t - per * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? per + rem : per));
}

/**
 * 플랫폼 총액 → StayNightRates. `price` 진실 = total, 행렬 Σ = total (나머지 마지막 박).
 * UI에 박당을 강요하지 않기 위한 저장용 분배.
 */
export function nightRatesFromTotal(checkIn: string, nights: number, total: number): StayNightRates {
  const dates = occupiedNightDates(checkIn, nights);
  if (!dates.length) return { flat: null, weekday: null, weekend: null, nights: null };
  const amounts = splitAmountLast(total, dates.length);
  const map: NightAmountMap = {};
  dates.forEach((d, i) => {
    map[d] = amounts[i]!;
  });
  const flat = amounts.length ? Math.floor(Math.max(0, Math.round(total)) / amounts.length) : 0;
  return {
    flat: flat > 0 ? flat : null,
    weekday: null,
    weekend: null,
    nights: map,
  };
}

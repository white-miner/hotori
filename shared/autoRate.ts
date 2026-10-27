// 간단 예약 자동 요금: 타입 × 박마다 요금(특별일 > 시즌 > 평일/주말 > 기본)을 더해요.
// 저장은 박별 요금표(night_rates)로 — 직원이 총액이나 박 하나를 고치면 그 값이 먼저예요.
import { type NightAmountMap, type StayNightRates, occupiedNightDates } from "./nightrates";
import { resolveNightRate } from "./salesCalendar";
import type { RateSource } from "./seasonRates";

type RateSettings = Parameters<typeof resolveNightRate>[0];

export type AutoNightSource = RateSource | "manual";
export interface AutoNight {
  date: string;
  amount: number;
  source: AutoNightSource;
  seasonName?: string;
  weekend: boolean;
}
export interface AutoTypeLine {
  typeId: string;
  rooms: number;
  nights: AutoNight[];
  /** 방 1개의 박 합계 */
  perRoom: number;
  /** 요금이 없는 박 수 */
  missing: number;
}
export interface AutoStay {
  lines: AutoTypeLine[];
  /** 모든 방 합계 */
  total: number;
  /** 모든 박에 요금이 있어 총액을 자동으로 채울 수 있음 */
  ready: boolean;
  /** 요금이 하나도/일부 없는 타입 */
  missingTypeIds: string[];
  /** 날짜별 모든 방 합계 (대표 예약 night_rates용) */
  nightMap: NightAmountMap;
}
/** typeId → 날짜 → 직접 고친 금액 */
export type ManualNightRates = Record<string, Record<string, number>>;

export function autoStayRates(
  s: RateSettings,
  picks: ReadonlyArray<{ typeId: string; count: number }>,
  checkIn: string,
  nights: number,
  manual: ManualNightRates = {},
): AutoStay {
  const dates = occupiedNightDates(checkIn, nights);
  const lines: AutoTypeLine[] = [];
  const nightMap: NightAmountMap = {};
  for (const d of dates) nightMap[d] = 0;
  for (const p of picks) {
    if (!p.typeId || !(p.count > 0)) continue;
    const row = dates.map((date): AutoNight => {
      const m = manual[p.typeId]?.[date];
      if (m != null && m > 0) return { date, amount: Math.round(m), source: "manual", weekend: resolveNightRate(s, p.typeId, date).weekend };
      const r = resolveNightRate(s, p.typeId, date);
      return { date, amount: r.amount, source: r.source, seasonName: r.seasonName, weekend: r.weekend };
    });
    const perRoom = row.reduce((a, n) => a + n.amount, 0);
    for (const n of row) nightMap[n.date] = (nightMap[n.date] ?? 0) + n.amount * p.count;
    lines.push({ typeId: p.typeId, rooms: p.count, nights: row, perRoom, missing: row.filter((n) => n.amount <= 0).length });
  }
  const total = lines.reduce((a, l) => a + l.perRoom * l.rooms, 0);
  const missingTypeIds = lines.filter((l) => l.missing > 0).map((l) => l.typeId);
  return { lines, total, ready: lines.length > 0 && missingTypeIds.length === 0, missingTypeIds, nightMap };
}

/** 저장용: 날짜별 합계 행렬 (Σ = total) */
export function autoNightRates(stay: AutoStay, nights: number): StayNightRates {
  const flat = nights > 0 ? Math.floor(stay.total / nights) : 0;
  return { flat: flat > 0 ? flat : null, weekday: null, weekend: null, nights: { ...stay.nightMap } };
}

/**
 * 판매 캘린더 ‘요금 설정’ 시트 로직 (화면 없이 테스트 가능).
 * 같은 데이터(typeRates · typeSeasons · weekendDays · typeRateOverrides)를 설정 › 객실 요금과 함께 써요.
 * 요금 우선순위: 특별일 > 시즌 > 요일/평일·주말 > 기본. 저장된 예약 요금은 건드리지 않아요.
 */
import { type RateSeason, type RateSource, DOW_KO, SEASONS_PER_TYPE_MAX, normalizeWeekendDays, validateSeasonList } from "./seasonRates";
import { type TypeRateDefaults, type TypeRatesMap, normalizeDow, setTypeRateDefaults } from "./salesCalendar";
import type { TypeSeasonsMap } from "./seasonRates";

export interface RateDraft {
  weekday: number | null;
  weekend: number | null;
  flat: number | null;
  /** 0=일 … 6=토. 비면 평일/주말을 따라요 */
  dow: Array<number | null>;
  seasons: RateSeason[];
}

type Src = { typeRates?: TypeRatesMap; typeSeasons?: TypeSeasonsMap; weekendDays?: number[] };

/** 화면 열 순서: 월 화 수 목 금 토 일 (값은 0=일 … 6=토 인덱스) */
export const GRID_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
export const dayName = (i: number) => DOW_KO[i];

export function draftFromSettings(s: Src, typeId: string): RateDraft {
  const r: TypeRateDefaults = s.typeRates?.[typeId] ?? {};
  return {
    weekday: r.weekday && r.weekday > 0 ? r.weekday : null,
    weekend: r.weekend && r.weekend > 0 ? r.weekend : null,
    flat: r.flat && r.flat > 0 ? r.flat : null,
    dow: Array.from({ length: 7 }, (_, i) => (r.dow?.[i] && r.dow[i]! > 0 ? r.dow[i]! : null)),
    seasons: (s.typeSeasons?.[typeId] ?? []).map((z) => ({ ...z })),
  };
}

export const hasDowValues = (d: Pick<RateDraft, "dow">) => d.dow.some((v) => v != null && v > 0);

/** 요일 칸에 흐리게 보여 줄 값: 칸이 비었을 때 따르는 평일/주말/기본 요금 */
export function dowFallback(d: Pick<RateDraft, "weekday" | "weekend" | "flat">, dayIdx: number, weekendDays: readonly number[]): number | null {
  const we = normalizeWeekendDays(weekendDays).includes(dayIdx);
  const v = we ? d.weekend : d.weekday;
  return v && v > 0 ? v : d.flat && d.flat > 0 ? d.flat : null;
}

export function isDraftChanged(s: Src, typeId: string, d: RateDraft): boolean {
  return JSON.stringify(normalizeDraft(draftFromSettings(s, typeId))) !== JSON.stringify(normalizeDraft(d));
}

function normalizeDraft(d: RateDraft) {
  return {
    weekday: d.weekday || null,
    weekend: d.weekend || null,
    flat: d.flat || null,
    dow: d.dow.map((v) => (v && v > 0 ? v : null)),
    seasons: [...d.seasons].map((z) => ({ id: z.id, name: z.name, from: z.from, to: z.to, weekday: z.weekday || null, weekend: z.weekend || null })).sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id)),
  };
}

/** 시즌 칸이 전부 빈 새 줄은 버려요 (이름·날짜·요금 중 하나라도 있으면 검사) */
const isBlankSeason = (z: RateSeason) => !z.name.trim() && !z.from && !z.to && !z.weekday && !z.weekend;

/**
 * 초안을 설정에 반영한 새 설정. 시즌에 문제가 있으면 error(한국어)만 돌려주고 설정은 그대로.
 * 바뀌는 건 typeRates / typeSeasons 뿐이에요 (예약·결제 데이터는 건드리지 않아요).
 */
export function applyRateDraft<T extends Src>(s: T, typeId: string, d: RateDraft): { next: T; error: string | null } {
  const seasons = d.seasons.filter((z) => !isBlankSeason(z));
  if (seasons.length > SEASONS_PER_TYPE_MAX) return { next: s, error: `시즌은 타입마다 최대 ${SEASONS_PER_TYPE_MAX}개까지예요` };
  const err = validateSeasonList(seasons);
  if (err) return { next: s, error: err };
  let next = setTypeRateDefaults(s as T & { typeRates?: TypeRatesMap }, typeId, {
    weekday: d.weekday,
    weekend: d.weekend,
    flat: d.flat,
    dow: normalizeDow(d.dow) ?? [null, null, null, null, null, null, null],
  }) as T;
  const map: TypeSeasonsMap = { ...(s.typeSeasons ?? {}) };
  if (seasons.length) map[typeId] = [...seasons].sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));
  else delete map[typeId];
  next = { ...next, typeSeasons: map };
  return { next, error: null };
}

/** 칸에 붙이는 출처 태그: 시즌/주말/특별일만 (평일·기본은 조용히) */
export function sourceTag(source: RateSource): { text: string; tone: "date" | "season" | "weekend" } | null {
  if (source === "date") return { text: "특별일", tone: "date" };
  if (source === "season") return { text: "시즌", tone: "season" };
  if (source === "weekend") return { text: "주말", tone: "weekend" };
  return null;
}

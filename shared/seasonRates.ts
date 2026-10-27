/**
 * 시즌 요금 · 주말 요일 — 타입마다 이름 붙은 기간(성수기 등)에 평일/주말 요금을 따로 정해요.
 * 요금 우선순위: 특별일 요금(날짜별 금액) > 시즌 > 평일/주말 > 기본.
 * ledger와 순환 import 금지 — 날짜 계산만 여기 최소로 둬요.
 */

export interface RateSeason {
  id: string;
  name: string;
  /** 첫 숙박일 (그날 밤 포함) */
  from: string;
  /** 마지막 숙박일 (그날 밤 포함) */
  to: string;
  weekday: number | null;
  /** 비우면 시즌 평일 요금과 같아요 */
  weekend: number | null;
}
/** typeId → 시즌 목록 (기간 겹침 없음, from 순) */
export type TypeSeasonsMap = Record<string, RateSeason[]>;

export const SEASON_NAME_MAX = 12;
export const SEASONS_PER_TYPE_MAX = 24;
export const RATE_MAX = 100_000_000;
/** 요일 번호: 0=일 … 6=토. 기본 주말 = 금·토 밤 */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [5, 6];
export const DOW_KO = "일월화수목금토";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (d: unknown): d is string => {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

const dayNum = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
};
export function dowOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const rangeText = (a: string, b: string) => (a === b ? md(a) : `${md(a)}~${md(b)}`);

const amt = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= RATE_MAX ? n : null;
};

/** 주말로 칠 요일 (중복 없이 0~6, 비었거나 잘못이면 금·토) */
export function normalizeWeekendDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WEEKEND_DAYS];
  const set = new Set<number>();
  for (const v of raw) if (Number.isInteger(v) && v >= 0 && v <= 6) set.add(v);
  return set.size ? [...set].sort((a, b) => a - b) : [...DEFAULT_WEEKEND_DAYS];
}
export const weekendDaysText = (days: readonly number[]) => days.map((d) => DOW_KO[d]).join("·");

/** 그 밤이 주말 요금인가: 정한 요일이거나 특별일 */
export function isWeekendNightIn(date: string, special: readonly string[] = [], weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS): boolean {
  return weekendDays.includes(dowOf(date)) || special.includes(date);
}

/** 두 시즌 기간이 겹치면 true (from~to 양 끝 날짜 포함) */
export const seasonsOverlap = (a: Pick<RateSeason, "from" | "to">, b: Pick<RateSeason, "from" | "to">) => a.from <= b.to && b.from <= a.to;

/** 시즌 하나 검사: 문제가 있으면 한국어 안내, 없으면 null. others = 같은 타입의 다른 시즌 */
export function validateSeason(season: RateSeason, others: readonly RateSeason[]): string | null {
  if (!season.name.trim()) return "시즌 이름을 적어 주세요";
  if (!isIsoDate(season.from) || !isIsoDate(season.to)) return "시작일과 끝나는 날을 골라 주세요";
  if (season.from > season.to) return "끝나는 날이 시작일보다 빨라요";
  if (dayNum(season.to) - dayNum(season.from) > 365) return "시즌은 최대 1년까지예요";
  if (season.weekday == null && season.weekend == null) return "평일 또는 주말 요금을 적어 주세요";
  for (const o of others) {
    if (o.id === season.id) continue;
    if (seasonsOverlap(season, o)) return `‘${o.name || "다른 시즌"}’(${rangeText(o.from, o.to)})과 기간이 겹쳐요. 날짜를 겹치지 않게 바꿔 주세요`;
  }
  return null;
}
/** 목록 전체 검사 (첫 문제만) */
export function validateSeasonList(list: readonly RateSeason[]): string | null {
  for (let i = 0; i < list.length; i++) {
    const err = validateSeason(list[i], list.filter((_, j) => j !== i));
    if (err) return err;
  }
  return null;
}

/** 읽을 때: 잘못된 줄은 버리고, 겹치면 빠른 시즌을 남겨요 (항상 같은 결과) */
export function normalizeTypeSeasons(raw: unknown): TypeSeasonsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TypeSeasonsMap = {};
  for (const [tid, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!tid || !Array.isArray(list)) continue;
    const rows: RateSeason[] = [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const x = r as Record<string, unknown>;
      if (!isIsoDate(x.from) || !isIsoDate(x.to) || x.from > x.to) continue;
      const weekday = amt(x.weekday);
      const weekend = amt(x.weekend);
      if (weekday == null && weekend == null) continue;
      const name = typeof x.name === "string" ? x.name.trim().slice(0, SEASON_NAME_MAX) : "";
      const id = typeof x.id === "string" && x.id ? x.id : `ss-${tid}-${x.from}`;
      rows.push({ id, name: name || "시즌", from: x.from, to: x.to, weekday, weekend });
    }
    rows.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.id < b.id ? -1 : 1));
    const kept: RateSeason[] = [];
    for (const r of rows) if (kept.length < SEASONS_PER_TYPE_MAX && !kept.some((k) => seasonsOverlap(k, r))) kept.push(r);
    if (kept.length) out[tid] = kept;
  }
  return out;
}

export function seasonOn(list: readonly RateSeason[] | undefined, date: string): RateSeason | null {
  return list?.find((s) => s.from <= date && date <= s.to) ?? null;
}

/** 시즌의 그 밤 요금 (주말 비면 시즌 평일과 같음 · 시즌 평일이 비면 0 → 평일/주말 기본으로) */
export function seasonAmount(season: RateSeason, weekend: boolean): number {
  const v = weekend ? (season.weekend ?? season.weekday) : season.weekday;
  return v != null && v > 0 ? Math.round(v) : 0;
}

export type RateSource = "date" | "season" | "weekend" | "weekday" | "flat" | "none";
export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  date: "특별일",
  season: "시즌",
  weekend: "주말",
  weekday: "평일",
  flat: "기본",
  none: "미설정",
};
export interface ResolvedRate {
  amount: number;
  source: RateSource;
  /** 시즌 이름 (source가 season일 때) */
  seasonName?: string;
  weekend: boolean;
}

/** 시즌을 저장/교체한 새 목록 (from 순). 겹치면 Korean 오류 문자열을 돌려줘요 */
export function upsertSeason(list: readonly RateSeason[], next: RateSeason): { list: RateSeason[]; error: string | null } {
  const others = list.filter((x) => x.id !== next.id);
  const error = validateSeason(next, others);
  if (error) return { list: [...list], error };
  if (others.length >= SEASONS_PER_TYPE_MAX) return { list: [...list], error: `시즌은 타입마다 최대 ${SEASONS_PER_TYPE_MAX}개까지예요` };
  return { list: [...others, next].sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id)), error: null };
}

/** 시즌 하나를 다른 타입들에 복사 (겹치는 타입은 건너뛰고 이유를 알려줘요). newId는 복사본마다 새 id */
export function copySeasonTo(
  map: TypeSeasonsMap,
  season: RateSeason,
  targetTypeIds: readonly string[],
  newId: () => string,
): { map: TypeSeasonsMap; copied: string[]; skipped: { typeId: string; reason: string }[] } {
  const out: TypeSeasonsMap = { ...map };
  const copied: string[] = [];
  const skipped: { typeId: string; reason: string }[] = [];
  for (const tid of targetTypeIds) {
    const r = upsertSeason(out[tid] ?? [], { ...season, id: newId() });
    if (r.error) skipped.push({ typeId: tid, reason: r.error });
    else {
      out[tid] = r.list;
      copied.push(tid);
    }
  }
  return { map: out, copied, skipped };
}

// 간단 예약 날짜 입력: 오늘/내일/모레 칩 · 박수 칩/증감 · 입실→퇴실 요약 · 달력 두 번 누르기
import { STAY_NIGHTS_MAX, STAY_NIGHTS_MIN, addDays, clampStayNights, daysBetween, md, weekday } from "./ledger";

export interface DateChip {
  id: "today" | "tomorrow" | "after";
  label: string;
  date: string;
}

/** 입실일 빠른 칩. today는 영업일(새벽 6시 전은 전날)이라 칩도 그 기준이에요 */
export function quickDateChips(today: string): DateChip[] {
  return [
    { id: "today", label: "오늘", date: today },
    { id: "tomorrow", label: "내일", date: addDays(today, 1) },
    { id: "after", label: "모레", date: addDays(today, 2) },
  ];
}
/** 지금 입실일이 칩 중 하나면 그 id */
export function activeDateChip(today: string, checkIn: string): DateChip["id"] | null {
  return quickDateChips(today).find((c) => c.date === checkIn)?.id ?? null;
}

/** 박수 칩 (1~7박) */
export const NIGHT_CHIPS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
/** 박수 + / − (1~90박으로 맞춰요) */
export function stepNights(nights: number, delta: number): number {
  return clampStayNights((Number.isFinite(nights) ? nights : STAY_NIGHTS_MIN) + delta);
}
/** 칸에 입력한 박수 글자 → 박수 (비었거나 숫자가 아니면 null) */
export function parseNightsInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= STAY_NIGHTS_MIN ? Math.min(STAY_NIGHTS_MAX, n) : null;
}

export interface StayRangeSummary {
  checkIn: string;
  checkOut: string;
  inLabel: string; // 10/30(금)
  outLabel: string; // 11/1(일)
  nights: number;
  /** 10/30(금) 입실 → 11/1(일) 퇴실 · 2박 3일 */
  text: string;
}
export function stayRangeSummary(checkIn: string, nights: number): StayRangeSummary {
  const n = clampStayNights(nights);
  const checkOut = addDays(checkIn, n);
  const inLabel = `${md(checkIn)}(${weekday(checkIn)})`;
  const outLabel = `${md(checkOut)}(${weekday(checkOut)})`;
  return { checkIn, checkOut, inLabel, outLabel, nights: n, text: `${inLabel} 입실 → ${outLabel} 퇴실 · ${n}박 ${n + 1}일` };
}

/** 달력 눌림 상태: start가 있으면 입실일만 눌렀고 퇴실일을 기다려요 */
export interface RangePickState {
  start: string | null;
}
export interface RangePickResult {
  checkIn: string;
  nights: number;
  state: RangePickState;
}
/**
 * 달력 두 번 누르기.
 * 첫 번째: 입실일 (그 날부터 1박으로 바로 잡아요 → 날짜가 멀어도 '선택 해제' 필요 없어요)
 * 두 번째: 퇴실일 (입실일 뒤 날짜). 같은 날을 다시 누르면 1박 확정, 앞 날짜를 누르면 그 날을 새 입실일로.
 */
export function pickRangeClick(state: RangePickState, clicked: string): RangePickResult {
  const start = state.start;
  if (start == null || clicked < start) return { checkIn: clicked, nights: 1, state: { start: clicked } };
  if (clicked === start) return { checkIn: start, nights: 1, state: { start: null } };
  const raw = daysBetween(start, clicked);
  return { checkIn: start, nights: clampStayNights(raw), state: { start: null } };
}

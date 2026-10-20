// 캘린더 「묵는 밤」칠하기 → checkIn / nights / stayEnd 매핑 (보드 점유 밤과 동일)
import {
  type Booking,
  STAY_NIGHTS_MAX,
  STAY_NIGHTS_MIN,
  addDays,
  clampStayNights,
  daysBetween,
  isActive,
  md,
  roomOnNight,
} from "./ledger";

export interface PaintedNightRange {
  firstNight: string;
  lastNight: string;
}

export interface StayFromPaint {
  checkIn: string;
  nights: number;
  stayEnd: string;
}

/** 두 날짜를 오름차순으로 맞춤 */
export function orderNights(a: string, b: string): PaintedNightRange {
  return a <= b ? { firstNight: a, lastNight: b } : { firstNight: b, lastNight: a };
}

/**
 * 칠한 연속 밤 → 저장 필드.
 * first~last 밤 → checkIn=first, nights=count, stayEnd=last+1
 */
export function stayFromPaintedNights(firstNight: string, lastNight: string): StayFromPaint {
  const { firstNight: first, lastNight: last } = orderNights(firstNight, lastNight);
  const raw = daysBetween(first, last) + 1;
  const nights = clampStayNights(raw);
  // 클램프되면 끝을 잘라 맞춤 (90박 초과 드래그)
  const cappedLast = nights < raw ? addDays(first, nights - 1) : last;
  return { checkIn: first, nights, stayEnd: addDays(cappedLast, 1) };
}

/** checkIn + nights → 칠해야 할 점유 밤 구간 (보드와 동일: checkIn ~ stayEnd−1) */
export function paintedNightsFromStay(checkIn: string, nights: number): PaintedNightRange {
  const n = clampStayNights(nights);
  return { firstNight: checkIn, lastNight: addDays(checkIn, n - 1) };
}

/** 요약: `11~21밤 · 11박 · 입 11 · 퇴 22아침` / 1박은 `11밤 · 1박 · …` */
export function nightPickSummary(firstNight: string, lastNight: string): string {
  const { checkIn, nights, stayEnd } = stayFromPaintedNights(firstNight, lastNight);
  const last = addDays(checkIn, nights - 1);
  const range = nights === 1 ? `${md(checkIn)}밤` : `${md(checkIn)}~${md(last)}밤`;
  return `${range} · ${nights}박 · 입 ${md(checkIn)} · 퇴 ${md(stayEnd)}아침`;
}

/** 짧은 요약 바: `N박 · M/D 아침 퇴실` */
export function nightPickGlance(firstNight: string, lastNight: string): string {
  const { nights, stayEnd } = stayFromPaintedNights(firstNight, lastNight);
  return `${nights}박 · ${md(stayEnd)} 아침 퇴실`;
}

/** date가 [first, last] 점유 밤 안인가 */
export function isNightInRange(date: string, firstNight: string, lastNight: string): boolean {
  const { firstNight: a, lastNight: b } = orderNights(firstNight, lastNight);
  return date >= a && date <= b;
}

/** 구간이 막힌 밤을 하나라도 포함하면 true */
export function rangeHitsBlocked(firstNight: string, lastNight: string, blocked: ReadonlySet<string>): boolean {
  const { checkIn, nights } = stayFromPaintedNights(firstNight, lastNight);
  for (let i = 0; i < nights; i++) {
    if (blocked.has(addDays(checkIn, i))) return true;
  }
  return false;
}

/**
 * 특정 객실에서 다른 예약이 점유한 밤 (자기 예약·비활성 제외).
 * roomId가 없으면 빈 집합.
 */
export function blockedNightsForRoom(
  bookings: Booking[],
  roomId: string | null | undefined,
  opts: { excludeId?: string; from: string; to: string },
): Set<string> {
  const out = new Set<string>();
  if (!roomId) return out;
  const { excludeId, from, to } = opts;
  for (const b of bookings) {
    if (b.id === excludeId || !isActive(b) || b.kind !== "stay" || !b.nights) continue;
    // from~to 한 칸씩: 그 밤에 이 방이면 막힘
    let d = from;
    while (d <= to) {
      if (roomOnNight(b, d) === roomId) out.add(d);
      d = addDays(d, 1);
    }
  }
  return out;
}

export interface MonthCell {
  date: string;
  inMonth: boolean;
  dow: number; // 0=일 … 6=토
}

/** YYYY-MM-01 기준 달력 그리드 (일~토, 앞·뒤 빈칸 포함) */
export function monthGrid(monthStart: string): MonthCell[] {
  const [y, m] = monthStart.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const [fy, fm, fd] = first.split("-").map(Number);
  const dow0 = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay(); // 0=일
  const start = addDays(first, -dow0);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const [, cm] = date.split("-").map(Number);
    cells.push({ date, inMonth: cm === m, dow: (dow0 + i) % 7 });
  }
  // 다음 달이 5주만 쓰면 마지막 주 전부 out → 35칸으로 줄여도 되지만 42 고정이 터치에 안정적
  return cells;
}

/** 월 시작일(YYYY-MM-01)에 n개월 */
export function addMonths(monthStart: string, n: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

export function monthLabelKo(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** 날짜의 월 시작 */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export { STAY_NIGHTS_MIN, STAY_NIGHTS_MAX };

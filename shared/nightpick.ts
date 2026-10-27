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

/** 요약: `10/20 ~ 10/24 · 5박 6일` (점유 밤 구간 · 박수 · 달력 일수=박+1) */
export function nightPickSummary(firstNight: string, lastNight: string): string {
  const { checkIn, nights } = stayFromPaintedNights(firstNight, lastNight);
  const last = addDays(checkIn, nights - 1);
  const days = nights + 1;
  return `${md(checkIn)} ~ ${md(last)} · ${nights}박 ${days}일`;
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

/**
 * 클릭/Shift-클릭으로 다음 연속 밤 구간 계산 (드래그 없음).
 * - fresh: 그 밤만
 * - Shift: anchor(없으면 현재 시작) → 클릭일 범위
 * - 밖: 연속 구간으로 확장
 * - 양끝: 한 밤 줄임 (1박은 유지)
 * - 중간: 변경 없음
 */
export function nextPaintedFromClick(
  painted: PaintedNightRange,
  clicked: string,
  opts: { shiftKey: boolean; anchor: string | null; fresh: boolean },
): PaintedNightRange | null {
  const { firstNight, lastNight } = orderNights(painted.firstNight, painted.lastNight);

  if (opts.fresh) return { firstNight: clicked, lastNight: clicked };

  if (opts.shiftKey) {
    const from = opts.anchor ?? firstNight;
    return orderNights(from, clicked);
  }

  if (clicked < firstNight || clicked > lastNight) {
    return orderNights(
      clicked < firstNight ? clicked : firstNight,
      clicked > lastNight ? clicked : lastNight,
    );
  }

  if (clicked === firstNight && clicked === lastNight) return null;

  if (clicked === firstNight) {
    return { firstNight: addDays(firstNight, 1), lastNight };
  }
  if (clicked === lastNight) {
    return { firstNight, lastNight: addDays(lastNight, -1) };
  }
  return null;
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

/** YYYY-MM-01 기준 달력 그리드 (일~토, 앞 빈칸 포함). 끝 주가 전부 타월이면 잘라 요약줄 위 빈 밴드를 없앰. */
export function monthGrid(monthStart: string): MonthCell[] {
  const [y, m] = monthStart.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const [fy, fm, fd] = first.split("-").map(Number);
  const dow0 = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay(); // 0=일
  const start = addDays(first, -dow0); // 항상 일요일부터
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const [, cm] = date.split("-").map(Number);
    // 그리드가 일요일부터라 i%7이 요일. (dow0+i)%7은 1일이 일요일이 아니면 화·수에 토·일 색이 붙음
    cells.push({ date, inMonth: cm === m, dow: i % 7 });
  }
  // 6주차 전부 out이면 visibility:hidden 셀이 한 줄 높이를 먹어 요약과 그리드 사이 빈 밴드가 생김 → 35로 자름
  while (cells.length > 7) {
    const tail = cells.slice(-7);
    if (tail.every((c) => !c.inMonth)) cells.splice(-7, 7);
    else break;
  }
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

/**
 * Entry 숙박 날짜 UX (Option D absorb #1).
 * - 신규 표준 숙박 = night-pick only (간단 예약과 동일 · 이중 탭 없음)
 * - 수정 표준 숙박 = 기간 입력 | 날짜 선택 탭 유지 (연장·조기 퇴실 등)
 * - 대실·장기 = period-only (night-pick 숨김)
 */
export type EntryStayDateUx = "night-pick" | "period-tabs" | "period-only";

export function entryStayDateUx(opts: {
  isNew: boolean;
  kind: string;
  longStay: boolean;
}): EntryStayDateUx {
  if (opts.kind !== "stay" || opts.longStay) return "period-only";
  if (opts.isNew) return "night-pick";
  return "period-tabs";
}

export { STAY_NIGHTS_MIN, STAY_NIGHTS_MAX };

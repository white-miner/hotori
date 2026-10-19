// 현장 현황 보드(「지금」): 영업일 기준 상태 파생 (저장 필드가 아니라 규칙)
import { clampHours } from "./extratime";
import { type Booking, addDays, HOTEL_TIME_ZONE, isActive, md, occupiesNight, roomOnNight, stayEnd, usedNights } from "./ledger";
import { DEFAULT_STAY_TIMES, type StayTimes, shiftTime } from "./tiers";

/** 칸·옆 패널에 쓰는 현장 상태 (우선순위 높은 것부터 판별) */
export type NowKind = "lateOut" | "departing" | "arriving" | "inhouse" | "unassigned" | "empty";

export interface NowFlags {
  kind: NowKind;
  tentative: boolean;
  group: boolean;
  /** 청소X: 이 투숙은 청소하지 않음 */
  noClean: boolean;
  /** 한글 짧은 라벨 */
  label: string;
}

/** 퇴실 예정 윈도우: 실제 퇴실 시각 − 이 시간(상수, 설정 UI 없음) */
export const DEPARTING_LEAD_HOURS = 6;

/** 벽시계 (호텔 TZ). 보드 영업일과 다를 수 있음 */
export interface NowClock {
  /** YYYY-MM-DD (Asia/Seoul 캘린더일) */
  wallDate: string;
  /** HH:MM 24h */
  time: string;
}

export interface NowOpts {
  stayTimes?: Pick<StayTimes, "checkOut">;
  clock?: NowClock;
}

const emptyFlags = (): NowFlags => ({ kind: "empty", tentative: false, group: false, noClean: false, label: "빈 방" });

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 호텔(서울) 벽시계 */
export function hotelWallClock(now: Date = new Date()): NowClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { wallDate: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function isCheckedOut(b: Pick<Booking, "checkedOutAt"> | null | undefined): boolean {
  return !!(b?.checkedOutAt);
}

/**
 * 「지금」칸에 올릴지: 점유 밤이거나 퇴실일 아침(처리 전).
 * 재고 occupiesNight 식은 바꾸지 않음 — 보드 가시성만 분리.
 */
export function nowBoardVisible(b: Booking | null | undefined, date: string): boolean {
  if (!b || !isActive(b) || b.kind !== "stay" || isCheckedOut(b)) return false;
  return occupiesNight(b, date) || stayEnd(b) === date;
}

/** 퇴실일 아침 가시성 (점유와 분리) */
export function checkoutMorningVisible(b: Booking | null | undefined, date: string): boolean {
  if (!b || !isActive(b) || b.kind !== "stay" || isCheckedOut(b)) return false;
  return stayEnd(b) === date && !occupiesNight(b, date);
}

/** 「지금」칸에 쓸 호실: 점유 밤이면 그날 방, 퇴실 아침이면 마지막 점유 밤 방 */
export function roomForNowBoard(b: Booking, date: string): string | null | undefined {
  if (occupiesNight(b, date)) return roomOnNight(b, date);
  if (stayEnd(b) === date) return roomOnNight(b, addDays(stayEnd(b), -1));
  return undefined;
}

/**
 * 퇴실 예정 윈도우 열림: 보드일 D === stayEnd 이고
 * 벽시계 ≥ (checkOut + lateOut) − 6시간.
 */
export function departingWindowOpen(
  b: Pick<Booking, "lateOut" | "earlyOut" | "checkIn" | "nights" | "kind" | "checkedOutAt">,
  boardDate: string,
  stayTimes: Pick<StayTimes, "checkOut"> = DEFAULT_STAY_TIMES,
  clock: NowClock,
): boolean {
  if (isCheckedOut(b) || stayEnd(b) !== boardDate) return false;
  const out = shiftTime(stayTimes.checkOut, clampHours(b.lateOut));
  const win = shiftTime(out.time, -DEPARTING_LEAD_HOURS);
  const winDate = addDays(boardDate, out.days + win.days);
  if (clock.wallDate > winDate) return true;
  if (clock.wallDate < winDate) return false;
  return minutesOf(clock.time) >= minutesOf(win.time);
}

/** 오늘 밤·퇴실 아침을 점유/표시하는 활성 숙박의 현장 상태 */
export function nowFlags(b: Booking | null | undefined, date: string, opts?: NowOpts): NowFlags {
  if (!nowBoardVisible(b, date)) return emptyFlags();
  const booking = b!;
  const tentative = !!booking.tentative;
  const group = !!booking.groupId;
  const noClean = !!booking.noClean;
  const stayTimes = opts?.stayTimes ?? DEFAULT_STAY_TIMES;
  const clock = opts?.clock ?? hotelWallClock();
  const onCheckoutMorning = stayEnd(booking) === date;

  const rid = roomForNowBoard(booking, date);
  // 호실 없으면 미배정 우선 (퇴실 뱃지보다 배정이 먼저)
  if (!booking.roomId || !rid) {
    return { kind: "unassigned", tentative, group, noClean, label: "미배정" };
  }

  if (onCheckoutMorning) {
    if (departingWindowOpen(booking, date, stayTimes, clock)) {
      if (clampHours(booking.lateOut)) {
        return { kind: "lateOut", tentative, group, noClean, label: "늦은 퇴실" };
      }
      return { kind: "departing", tentative, group, noClean, label: "퇴실 예정" };
    }
    // 윈도우 전: 투숙 중 유지 (뱃지 안 켬)
    if (booking.arrived) {
      return { kind: "inhouse", tentative, group, noClean, label: "투숙 중" };
    }
    return { kind: "arriving", tentative, group, noClean, label: "입실 예정" };
  }

  // 점유 밤 (마지막 밤 포함): 퇴실 예정 아님
  if (booking.checkIn === date && !booking.arrived) {
    return { kind: "arriving", tentative, group, noClean, label: "입실 예정" };
  }
  if (booking.arrived) {
    return { kind: "inhouse", tentative, group, noClean, label: "투숙 중" };
  }
  return { kind: "arriving", tentative, group, noClean, label: "입실 예정" };
}

export interface NowLists {
  unassigned: Booking[];
  tentative: Booking[];
  departing: Booking[];
  lateOut: Booking[];
  arriving: Booking[];
}

/** 오늘 「지금」에 보이는 활성 숙박을 옆 패널용으로 분류 */
export function nowLists(bookings: Booking[], date: string, opts?: NowOpts): NowLists {
  const active = bookings.filter((b) => nowBoardVisible(b, date));
  const unassigned: Booking[] = [];
  const tentative: Booking[] = [];
  const departing: Booking[] = [];
  const lateOut: Booking[] = [];
  const arriving: Booking[] = [];
  for (const b of active) {
    const f = nowFlags(b, date, opts);
    if (f.tentative) tentative.push(b);
    if (f.kind === "unassigned") unassigned.push(b);
    else if (f.kind === "lateOut") lateOut.push(b);
    else if (f.kind === "departing") departing.push(b);
    else if (f.kind === "arriving") arriving.push(b);
  }
  const byName = (a: Booking, b: Booking) => a.guestName.localeCompare(b.guestName, "ko");
  return {
    unassigned: unassigned.sort(byName),
    tentative: tentative.sort(byName),
    departing: departing.sort(byName),
    lateOut: lateOut.sort(byName),
    arriving: arriving.sort(byName),
  };
}

/**
 * 「지금」보드 방→예약 맵.
 * nightBoard(재고) 위에 퇴실일 아침 가시성을 얹고, 퇴실처리된 칸은 비움.
 */
export function nowByRoom(bookings: Booking[], date: string): Map<string, Booking> {
  const byRoom = new Map<string, Booking>();
  for (const b of bookings) {
    if (!nowBoardVisible(b, date)) continue;
    const rid = roomForNowBoard(b, date);
    if (!rid) continue;
    const cur = byRoom.get(rid);
    if (!cur) {
      byRoom.set(rid, b);
      continue;
    }
    // 점유 밤 예약을 퇴실 아침 표시보다 우선
    if (occupiesNight(b, date) && !occupiesNight(cur, date)) byRoom.set(rid, b);
  }
  return byRoom;
}

/** 타입만 미배정: 단체명·타입별 개수 묶음 */
export function unassignedTypeCounts(list: Booking[]): { key: string; groupName: string | null; typeId: string; n: number; bookings: Booking[] }[] {
  const m = new Map<string, { groupName: string | null; typeId: string; bookings: Booking[] }>();
  for (const b of list) {
    const key = `${b.groupId ?? ""}|${b.typeId}`;
    let g = m.get(key);
    if (!g) {
      g = { groupName: b.groupName ?? null, typeId: b.typeId, bookings: [] };
      m.set(key, g);
    }
    g.bookings.push(b);
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v, n: v.bookings.length }));
}

export const NOW_KIND_LABEL: Record<NowKind, string> = {
  lateOut: "늦은 퇴실",
  departing: "퇴실 예정",
  arriving: "입실 예정",
  inhouse: "투숙 중",
  unassigned: "미배정",
  empty: "빈 방",
};

/** 테스트·표시용: 이용 박수 라벨 */
export function nowStayHint(b: Booking, date: string): string {
  const chips = nowStayChips(b, date);
  if (!chips.length) return "1박";
  if (chips.length === 1) return chips[0]!;
  return `${chips[0]} · ${chips[1]}`;
}

/**
 * 「지금」 칸 화이트보드 칩 (사실만 · 액션 아님).
 * 연박: `11박` + `9박째` (「11박 중 9박째」를 칩 둘로). 1박은 칩 없음.
 * 퇴실일 아침에는 마지막 박수로 고정.
 */
export function nowStayChips(b: Booking, date: string): string[] {
  const u = usedNights(b) ?? b.nights ?? 0;
  if (u <= 1) return [];
  const end = stayEnd(b);
  const chipDate = date === end ? addDays(end, -1) : date;
  const raw = Math.round((Date.parse(chipDate) - Date.parse(b.checkIn)) / 864e5) + 1;
  const night = Math.min(Math.max(raw, 1), u);
  return [`${u}박`, `${night}박째`];
}

/** 보드 점유 밤 구간 끝일 축약: 같은 달이면 일만 (`20`), 아니면 `M/D` */
function nightRangeEndLabel(from: string, to: string): string {
  const [, m0] = from.split("-");
  const [, m1, d1] = to.split("-");
  if (m0 === m1) return String(Number(d1));
  return md(to);
}

/**
 * 「지금」 칸 날짜: 점유 밤 구간 `checkIn ~ (stayEnd−1)`.
 * Entry용 입·퇴는 checkIn/checkOut 필드로 유지.
 */
export function nowStayDates(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  checkIn: string;
  checkOut: string;
  lastNight: string;
  inLabel: string;
  outLabel: string;
  rangeLabel: string;
} {
  const out = stayEnd(b);
  const lastNight = addDays(out, -1);
  const inLabel = md(b.checkIn);
  const outLabel = md(out);
  const rangeLabel = b.checkIn === lastNight ? inLabel : `${inLabel}~${nightRangeEndLabel(b.checkIn, lastNight)}`;
  return { checkIn: b.checkIn, checkOut: out, lastNight, inLabel, outLabel, rangeLabel };
}

/** 화이트보드용 한 줄: `10/20~27` (점유 밤) */
export function nowDateLine(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): string {
  return nowStayDates(b).rangeLabel;
}

/** 퇴실처리 가능: 활성 숙박 · 영업일 ≥ 퇴실일 (중도 퇴실 earlyOut 경로와 분리) */
export function canCheckOut(b: Booking, today: string): boolean {
  return isActive(b) && b.kind === "stay" && !isCheckedOut(b) && stayEnd(b) <= today;
}

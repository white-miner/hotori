// 현장 현황 보드(「지금」): 영업일 기준 상태 파생 (저장 필드가 아니라 규칙)
import { clampHours } from "./extratime";
import { type Booking, type Platform, addDays, HOTEL_TIME_ZONE, isActive, md, occupiesNight, roomOnNight, stayEnd, usedNights, won } from "./ledger";
import { payState } from "./payment";
import { DEFAULT_STAY_TIMES, type StayTimes, shiftTime } from "./tiers";

/** 칸·옆 패널에 쓰는 현장 상태 (우선순위 높은 것부터 판별) */
export type NowKind = "lateOut" | "departing" | "arriving" | "inhouse" | "unassigned" | "empty";

export interface NowFlags {
  kind: NowKind;
  tentative: boolean;
  group: boolean;
  /** 청소X: 이 투숙은 청소하지 않음 */
  noClean: boolean;
  /** 장기(퇴실 미정) */
  longStay: boolean;
  /** 한글 짧은 라벨 (하단 단일 상태) */
  label: string;
  /** 표시상 입실 완료 (저장 arrived 또는 체크인 시각 자동) */
  arrived: boolean;
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
  stayTimes?: Pick<StayTimes, "checkIn" | "checkOut">;
  clock?: NowClock;
}

const emptyFlags = (): NowFlags => ({
  kind: "empty",
  tentative: false,
  group: false,
  noClean: false,
  longStay: false,
  label: "공실",
  arrived: false,
});

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
 * 체크아웃 시각이 지나도 checked_out_at 없으면 칸에 남김 (자동 공실 금지).
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

/**
 * 설정 체크인 시각 도달: 벽일 ≥ 입실일 이고,
 * 입실일 당일이면 시각 ≥ stayTimes.checkIn.
 * 입실일 전날에는 false (체크인 시각만으로 숙박 전환 금지).
 */
export function checkInTimeReached(
  checkInDate: string,
  stayTimes: Pick<StayTimes, "checkIn"> = DEFAULT_STAY_TIMES,
  clock: NowClock,
): boolean {
  if (clock.wallDate > checkInDate) return true;
  if (clock.wallDate < checkInDate) return false;
  return minutesOf(clock.time) >= minutesOf(stayTimes.checkIn);
}

/**
 * 자동 입실 대상: 활성 숙박 · 보드 가시 · 미입실 · 입실일≤보드일 · 체크인 시각 도달.
 * 효과는 표시상 숙박 + (UI가) arrived 저장. 퇴실/공실은 절대 자동이 아님.
 */
export function shouldAutoArrive(b: Booking | null | undefined, boardDate: string, opts?: NowOpts): boolean {
  if (!b || !isActive(b) || b.kind !== "stay" || b.arrived || isCheckedOut(b)) return false;
  if (!nowBoardVisible(b, boardDate)) return false;
  if (boardDate < b.checkIn) return false;
  const stayTimes = opts?.stayTimes ?? DEFAULT_STAY_TIMES;
  const clock = opts?.clock ?? hotelWallClock();
  return checkInTimeReached(b.checkIn, stayTimes, clock);
}

/** 저장 arrived 또는 자동 입실 조건 */
export function effectiveArrived(b: Booking | null | undefined, boardDate: string, opts?: NowOpts): boolean {
  if (!b) return false;
  return !!b.arrived || shouldAutoArrive(b, boardDate, opts);
}

/** 오늘 밤·퇴실 아침을 점유/표시하는 활성 숙박의 현장 상태 */
export function nowFlags(b: Booking | null | undefined, date: string, opts?: NowOpts): NowFlags {
  if (!nowBoardVisible(b, date)) return emptyFlags();
  const booking = b!;
  const tentative = !!booking.tentative;
  const group = !!booking.groupId;
  const noClean = !!booking.noClean;
  const longStay = booking.stayMode === "long_stay";
  const stayTimes = opts?.stayTimes ?? DEFAULT_STAY_TIMES;
  const clock = opts?.clock ?? hotelWallClock();
  const arrived = effectiveArrived(booking, date, opts);
  const onCheckoutMorning = stayEnd(booking) === date;
  const base = { tentative, group, noClean, longStay, arrived };

  const rid = roomForNowBoard(booking, date);
  // 호실 없으면 미배정 우선 (퇴실 뱃지보다 배정이 먼저)
  if (!booking.roomId || !rid) {
    return { kind: "unassigned", ...base, label: "미배정" };
  }

  // 장기: 약속 퇴실 없음 → 하단은 숙박 유지 (재고 창 종료로 퇴실예정 자동 켜지 않음)
  if (longStay) {
    if (!arrived) return { kind: "arriving", ...base, label: "숙박예약" };
    return { kind: "inhouse", ...base, label: "숙박" };
  }

  if (onCheckoutMorning) {
    if (departingWindowOpen(booking, date, stayTimes, clock)) {
      if (clampHours(booking.lateOut)) {
        // 슬롯은 하나 · 라벨만 「늦은 퇴실」
        return { kind: "lateOut", ...base, label: "늦은 퇴실" };
      }
      return { kind: "departing", ...base, label: "퇴실예정" };
    }
    // 윈도우 전: 투숙 중 유지 (뱃지 안 켬)
    if (arrived) {
      return { kind: "inhouse", ...base, label: "숙박" };
    }
    return { kind: "arriving", ...base, label: "숙박예약" };
  }

  // 점유 밤 (마지막 밤 포함): 퇴실 예정 아님
  if (arrived) {
    return { kind: "inhouse", ...base, label: "숙박" };
  }
  return { kind: "arriving", ...base, label: "숙박예약" };
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
 * 같은 날 다음 예약(점유 밤)이 있으면 그쪽을 우선 → 퇴실처리 후 숙박예약으로 이어짐.
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
  departing: "퇴실예정",
  arriving: "숙박예약",
  inhouse: "숙박",
  unassigned: "미배정",
  empty: "공실",
};

/** 하단 단일 상태가 퇴실처리 탭 대상인가 (lateOut 포함 · 슬롯 하나) */
export function isDepartingStatus(kind: NowKind): boolean {
  return kind === "departing" || kind === "lateOut";
}

/**
 * 오늘이 몇 번째 점유 밤인지 (1..nights).
 * 1박·산출 불가 → null. 퇴실 아침(stayEnd)은 마지막 박으로 고정.
 */
export function nowStayNightIndex(b: Booking, date: string): number | null {
  const u = usedNights(b) ?? b.nights ?? 0;
  if (u <= 1) return null;
  const end = stayEnd(b);
  const chipDate = date === end ? addDays(end, -1) : date;
  const raw = Math.round((Date.parse(chipDate) - Date.parse(b.checkIn)) / 864e5) + 1;
  if (!Number.isFinite(raw)) return null;
  return Math.min(Math.max(raw, 1), u);
}

/** N박 N일 (박 = 진실, 일 = 박+1) */
export function nowNightsDays(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  nights: number;
  days: number;
  label: string;
} {
  const nights = usedNights(b) ?? b.nights ?? 0;
  const days = nights > 0 ? nights + 1 : 0;
  return { nights, days, label: nights > 0 ? `${nights}박 ${days}일` : "" };
}

/**
 * 「지금」 상단 숙박 요약 (#4): `{nights}박 {days}일` (+ 해당 시 ` · {k}박째`).
 * 1박 · 숙박예약(입실 전) · 진행 불가 → 총박·일만. 손님 줄 박 칩과 중복하지 않음.
 */
export function nowStaySummary(b: Booking, date: string, showProgress = true): string {
  const nd = nowNightsDays(b);
  if (!nd.label) return "";
  if (!showProgress || nd.nights <= 1) return nd.label;
  const k = nowStayNightIndex(b, date);
  if (k == null) return nd.label;
  return `${nd.label} · ${k}박째`;
}

/** @deprecated 상단 요약은 nowStaySummary. 레거시: 총박·박째 칩 둘 */
export function nowStayChips(b: Booking, date: string): string[] {
  const u = usedNights(b) ?? b.nights ?? 0;
  if (u <= 1) return [];
  const k = nowStayNightIndex(b, date);
  if (k == null) return [`${u}박`];
  return [`${u}박`, `${k}박째`];
}

/** 테스트·표시용: 이용 박수 라벨 (상단 요약과 동일 문법, 진행 포함) */
export function nowStayHint(b: Booking, date: string): string {
  const summary = nowStaySummary(b, date, true);
  return summary || "1박";
}

/**
 * 「지금」 칸 날짜: **점유 밤** 구간 `checkIn ~ (stayEnd−1)`.
 * 퇴실 아침(stayEnd)은 구간에 넣지 않음 (예: 2박 입19·퇴21 → `10/19~20`).
 * Entry는 입·퇴·박을 쓰고, 보드는 밤 구간만 쓴다.
 */
export function nowNightRange(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  /** 1박은 `10/19`, 연박은 `10/19~20` */
  label: string;
} {
  const lastNight = addDays(stayEnd(b), -1);
  const fromLabel = md(b.checkIn);
  const toLabel = md(lastNight);
  // 같은 달이면 `10/19~20`, 달 넘기면 `10/30~11/2`
  const sameMonth = b.checkIn.slice(0, 7) === lastNight.slice(0, 7);
  const rangeEnd = sameMonth ? String(Number(lastNight.slice(8, 10))) : toLabel;
  return {
    from: b.checkIn,
    to: lastNight,
    fromLabel,
    toLabel,
    label: b.checkIn === lastNight ? fromLabel : `${fromLabel}~${rangeEnd}`,
  };
}

/** Entry용 입·퇴 라벨. 보드 주 표기는 nowNightRange */
export function nowStayDates(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  checkIn: string;
  checkOut: string;
  inLabel: string;
  outLabel: string;
} {
  const out = stayEnd(b);
  return { checkIn: b.checkIn, checkOut: out, inLabel: md(b.checkIn), outLabel: md(out) };
}

/** 화이트보드용 한 줄 = 점유 밤 구간 */
export function nowDateLine(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): string {
  return nowNightRange(b).label;
}

/**
 * 칸 금액 글랜스.
 * 일반: 잔금 있으면 `잔금 ₩X`, 없으면 `₩price`.
 * 장기: `미수 ₩X` (0이면 생략).
 */
export function nowAmountGlance(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
): string | null {
  if (b.stayMode === "long_stay") {
    const left = payState(b, plat).left;
    return left > 0 ? `미수 ₩${won(left)}` : null;
  }
  const ps = payState(b, plat);
  if (ps.tracked && ps.left > 0) return `잔금 ₩${won(ps.left)}`;
  if (b.price > 0) return `₩${won(b.price)}`;
  return null;
}

/** 메모 · 인원 (연락처 필드 없음 → 있는 것만) */
export function nowMetaLine(b: Pick<Booking, "memo" | "guests">): string | null {
  const parts: string[] = [];
  const memo = b.memo?.trim();
  if (memo) parts.push(memo);
  if (b.guests != null && b.guests > 0) parts.push(`${b.guests}명`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * 퇴실처리 가능: 활성 숙박 · 영업일 ≥ 퇴실일 (중도 퇴실 earlyOut 경로와 분리).
 * 장기: 약속 퇴실 없음 → 입실일 이후(당일 포함) 언제든 퇴실처리로 종료.
 */
export function canCheckOut(b: Booking, today: string): boolean {
  if (!isActive(b) || b.kind !== "stay" || isCheckedOut(b)) return false;
  if (b.stayMode === "long_stay") return b.checkIn <= today;
  return stayEnd(b) <= today;
}

// 현장 현황 보드(「현황」): 영업일 기준 상태 파생 (저장 필드가 아니라 규칙)
import { clampHours, outTimeOf } from "./extratime";
import { type Booking, type HotelSettings, type Platform, addDays, HOTEL_TIME_ZONE, isActive, md, occupiesNight, roomOnNight, stayEnd, usedNights, won } from "./ledger";
import { PAYMENT_METHOD_LABEL, payState, type Payment, type PaymentMethod } from "./payment";
import { type GroupInfo, settle } from "./settle";
import { DEFAULT_STAY_TIMES, type StayTimes, shiftTime } from "./tiers";

/**
 * 단체 칸/정산: PaymentDesk `addGroupPayment`는 단체 내역에만 쌓이므로
 * 방 `payState`만 보면 완납 후에도 「잔금」이 남음 → settle 스냅샷 사용.
 */
export type NowPayGroupCtx = {
  members: Booking[];
  info?: GroupInfo | null;
};

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
  stayTimes?: Pick<StayTimes, "checkIn" | "checkOut"> & Partial<Pick<StayTimes, "checkInMode">>;
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
 * 「현황」칸에 올릴지: 점유 밤이거나 퇴실일 아침(처리 전).
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

/** 「현황」칸에 쓸 호실: 점유 밤이면 그날 방, 퇴실 아침이면 마지막 점유 밤 방 */
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
 * checkInMode=manual 이면 항상 false (칸 「숙박예약」탭·빠른입실만 arrived).
 * 효과는 표시상 숙박 + (UI가) arrived 저장. 퇴실/공실은 절대 자동이 아님.
 */
export function shouldAutoArrive(b: Booking | null | undefined, boardDate: string, opts?: NowOpts): boolean {
  if (!b || !isActive(b) || b.kind !== "stay" || b.arrived || isCheckedOut(b)) return false;
  if (!nowBoardVisible(b, boardDate)) return false;
  if (boardDate < b.checkIn) return false;
  const stayTimes = opts?.stayTimes ?? DEFAULT_STAY_TIMES;
  if (stayTimes.checkInMode === "manual") return false;
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

/**
 * Path A 미배정 전건 (입실일 필터 전).
 * 「배치」사이드 오늘/일주일/한달 칩의 소스. 「현황」은 today만 씀.
 */
export function listUnassignedBookings(bookings: Booking[]): Booking[] {
  return bookings.filter(
    (b) => isActive(b) && b.kind === "stay" && !b.roomId && !isCheckedOut(b),
  );
}

/** 오늘 「현황」에 보이는 활성 숙박을 옆 패널용으로 분류 */
export function nowLists(bookings: Booking[], date: string, opts?: NowOpts): NowLists {
  const active = bookings.filter((b) => nowBoardVisible(b, date));
  const tentative: Booking[] = [];
  const departing: Booking[] = [];
  const lateOut: Booking[] = [];
  const arriving: Booking[] = [];
  for (const b of active) {
    const f = nowFlags(b, date, opts);
    // 임시 = 방 점유 후 신호만 (미배정·타입 홀드와 분리)
    if (f.tentative && b.roomId) tentative.push(b);
    // 미배정은 아래 today 입실 필터로 별도 수집 (보드 가시일 ≠ 입실일 큐)
    if (f.kind === "unassigned") continue;
    else if (f.kind === "lateOut") lateOut.push(b);
    else if (f.kind === "departing") departing.push(b);
    else if (f.kind === "arriving") arriving.push(b);
  }
  const byName = (a: Booking, b: Booking) => a.guestName.localeCompare(b.guestName, "ko");
  // 「현황」= 오늘만 (기한초과 포함 · checkIn ≤ date)
  const unassigned = filterUnassignedByCheckIn(listUnassignedBookings(bookings), date, "today").sort(byName);
  return {
    unassigned,
    tentative: tentative.sort(byName),
    departing: departing.sort(byName),
    lateOut: lateOut.sort(byName),
    arriving: arriving.sort(byName),
  };
}

/**
 * 「현황」보드 방→예약 맵.
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

/** 박수 (+ 일 = 박+1 참고). 칸 표기는 `label` = `N박` (화이트보드 · 일 수 생략). */
export function nowNightsDays(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  nights: number;
  days: number;
  label: string;
} {
  const nights = usedNights(b) ?? b.nights ?? 0;
  const days = nights > 0 ? nights + 1 : 0;
  return { nights, days, label: nights > 0 ? `${nights}박` : "" };
}

/**
 * 「현황」·「배치」칸 숙박 칩: `N박` · 연박 진행 시 `K/N박`.
 * 1박 · 숙박예약(입실 전) · 진행 불가 → 길이만. 풀 문구(`N박 M일` · `N박 중 K박째`) 금지.
 */
export function nowStaySummary(b: Booking, date: string, showProgress = true): string {
  const nd = nowNightsDays(b);
  if (!nd.label) return "";
  if (!showProgress || nd.nights <= 1) return nd.label;
  const k = nowStayNightIndex(b, date);
  if (k == null) return nd.label;
  return `${k}/${nd.nights}박`;
}

/** @deprecated 상단 요약은 nowStaySummary. 레거시 칩 배열 → 압축 한 토큰 */
export function nowStayChips(b: Booking, date: string): string[] {
  const s = nowStaySummary(b, date, true);
  if (!s || s === "1박") return [];
  return [s];
}

/** 테스트·표시용: 이용 박수 라벨 (상단 요약과 동일 문법, 진행 포함) */
export function nowStayHint(b: Booking, date: string): string {
  const summary = nowStaySummary(b, date, true);
  return summary || "1박";
}

/** 칸 금액 글자색: 미수=빨강 · 선금·일부=파랑 · 완납=검정 (배경 칠 금지) */
export type NowAmountTone = "due" | "partial" | "paid" | "neutral";

/** 단실=payState · 단체=settle(방+단체 수납). 장기·금액미정은 방 단위. */
function nowPaySnap(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  group?: NowPayGroupCtx | null,
): { tracked: boolean; paid: number; left: number; full: boolean } {
  if (
    group &&
    b.groupId &&
    b.stayMode !== "long_stay" &&
    !b.priceUnset &&
    group.members.length > 0
  ) {
    const st = settle(group.members, group.info ?? null, plat);
    return { tracked: st.tracked, paid: st.paid, left: st.left, full: st.settled };
  }
  const ps = payState(b, plat);
  return { tracked: ps.tracked, paid: ps.paid, left: ps.left, full: ps.full };
}

export function nowAmountTone(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  group?: NowPayGroupCtx | null,
): NowAmountTone {
  if (b.priceUnset) return "neutral";
  const ps = nowPaySnap(b, plat, group);
  if (ps.tracked && ps.left > 0 && ps.paid > 0) return "partial";
  if (ps.tracked && ps.left > 0) return "due";
  if (b.price > 0 || ps.full || (ps.tracked && ps.paid > 0)) return "paid";
  return "neutral";
}

/**
 * 「현황」 칸 날짜: **점유 밤** 구간 `checkIn ~ (stayEnd−1)`.
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
 * 최근 결제 1줄: 방 payments ∪ extra(단체 내역) · `createdAt` desc · 동률 `bizDate` desc.
 * 「현황」완납 칸 · 운영 「최근」과 동일 시계열.
 */
export function latestPaymentOf(
  b: Pick<Booking, "payments">,
  extraPays?: readonly Payment[] | null,
): Payment | null {
  const pays = [...(b.payments ?? []), ...(extraPays ?? [])];
  if (!pays.length) return null;
  return [...pays].sort((a, c) => {
    const byCreated = (c.createdAt || "").localeCompare(a.createdAt || "");
    if (byCreated) return byCreated;
    return (c.bizDate || "").localeCompare(a.bizDate || "");
  })[0]!;
}

/**
 * 칸 금액 글랜스 (하이브리드).
 * tracked · left>0 → `잔금 ₩X` (1순위 · 잔금 숨기지 않음).
 * tracked · left=0 · 결제 내역 있음 → 최근 1줄 금액 `₩amount`(판매가 대체 · 수단은 prefix).
 * tracked · left=0 · 결제 없음 → `₩price` 폴백.
 * OTA(tracked=false): 항상 `₩price` · 최근 현장수납 강조 금지.
 * 단체: settle left + 최근 후보에 단체 내역 포함.
 * 장기: `미수 ₩X` (0이면 생략).
 * 색은 nowAmountTone · 수단은 nowPayMethodPrefix (`이체 잔금` 합침 금지).
 */
export function nowAmountGlance(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  group?: NowPayGroupCtx | null,
): string | null {
  if (b.priceUnset) return "금액미정";
  if (b.stayMode === "long_stay") {
    const left = payState(b, plat).left;
    return left > 0 ? `미수 ₩${won(left)}` : null;
  }
  const ps = nowPaySnap(b, plat, group);
  if (ps.tracked && ps.left > 0) return `잔금 ₩${won(ps.left)}`;
  if (ps.tracked && ps.left === 0) {
    const latest = latestPaymentOf(b, group?.info?.payments);
    if (latest) return `₩${won(latest.amount)}`;
    if (b.price > 0) return `₩${won(b.price)}`;
    return null;
  }
  if (b.price > 0) return `₩${won(b.price)}`;
  return null;
}

/**
 * 칸에서 결제수단을 금액 **앞**에 둘지.
 * left>0(`잔금`/`미수` 라벨)이면 수단 병기 금지 → `이체 잔금`/`카드 잔금` 합침 방지.
 * 완납(left=0) 하이브리드: 최근 1줄 수단만 (`이체 ₩…`).
 */
export function nowPayMethodPrefix(amount: string | null, method: string | null): string | null {
  if (!method) return null;
  // 한글에는 JS `\b`가 안 먹음 → startsWith
  if (amount && (amount.startsWith("잔금") || amount.startsWith("미수"))) return null;
  return method;
}

/** 칸 수단 prefix용: 최근 결제 1건 라벨 (하이브리드 완납 줄과 짝) */
export function nowLatestPayMethodLabel(
  b: Pick<Booking, "payments">,
  extraPays?: readonly Payment[] | null,
): string | null {
  const p = latestPaymentOf(b, extraPays);
  return p ? PAYMENT_METHOD_LABEL[p.method] : null;
}

/** 「배치」사이드 미배정 범위 칩. 「현황」은 today만(입실일≤오늘). */
export type UaCheckInFilter = "today" | "week" | "month";

/** 범위 칩 라벨 (배치 사이드 · 현황에는 없음) */
export const UA_CHECKIN_FILTERS: { id: UaCheckInFilter; label: string }[] = [
  { id: "today", label: "오늘" },
  { id: "week", label: "일주일" },
  { id: "month", label: "한달" },
];

/**
 * 「현황」미배정: 입실일(checkIn) 기준.
 * 오늘: 당일 + 기한 지난 미배정 · 일주일/한달: today ~ today+6 / +29.
 */
export function filterUnassignedByCheckIn(list: Booking[], today: string, filter: UaCheckInFilter): Booking[] {
  if (filter === "today") return list.filter((b) => b.checkIn <= today);
  const end = addDays(today, filter === "week" ? 6 : 29);
  return list.filter((b) => b.checkIn >= today && b.checkIn <= end);
}

/**
 * 「배치」미배정: 보드 숙박일(`boardDate`=selDate) 점유 밤 기준 (nightBoard와 동일).
 * 오늘 칩 = 그 밤만 · 일주일/한달 = boardDate ~ +6/+29 중 어느 밤이라도 점유.
 */
export function filterUnassignedForPlacement(
  list: Booking[],
  boardDate: string,
  filter: UaCheckInFilter,
): Booking[] {
  if (filter === "today") return list.filter((b) => occupiesNight(b, boardDate));
  const end = addDays(boardDate, filter === "week" ? 6 : 29);
  return list.filter((b) => {
    if (b.kind !== "stay" || !b.nights) return false;
    const last = addDays(b.checkIn, (usedNights(b) ?? b.nights) - 1);
    return b.checkIn <= end && last >= boardDate;
  });
}

/** 미배정/간단 예약 목록용 결제 모드 글랜스 (현장·전화) */
export function simplePayGlance(b: Booking, onsite: boolean): string | null {
  if (!onsite || b.priceUnset) return null;
  const paid = (b.payments ?? []).reduce((n, x) => n + x.amount, 0);
  if (paid <= 0) return "후불";
  if (b.price > 0 && paid >= b.price) return "완납";
  if ((b.payments ?? []).some((p) => p.kind === "deposit")) return "선금";
  return null;
}

/**
 * 칸 메타: 메모만 (인원 `n명`은 TypeRow 우측 — 하단 중복 금지).
 * `[추가금·늦은 퇴실]` 등 할증 태그는 comark·하단 상태와 중복 → 표시에서 제거(저장 메모는 유지).
 */
export function nowMetaLine(b: Pick<Booking, "memo" | "guests">): string | null {
  const memo = b.memo?.trim();
  if (!memo) return null;
  const cleaned = memo
    .replace(/\[추가금[·.][^\]]*\][^\n]*/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return cleaned || null;
}

/**
 * 칸 상단 퇴실 시각 마크 (`dumark`급 타이포).
 * 늦은 퇴실(lateOut>0)일 때만 · 예: `14시 퇴실`. 칸 박스·비율 미터치.
 */
export function nowCheckoutMark(
  s: Pick<HotelSettings, "stayTimes">,
  b: Pick<Booking, "kind" | "lateOut">,
): string | null {
  if (b.kind !== "stay") return null;
  if (!clampHours(b.lateOut)) return null;
  const hhmm = outTimeOf(s, b);
  const m = /^(\d{1,2}):/.exec(hhmm);
  if (!m) return null;
  return `${Number(m[1])}시 퇴실`;
}

/**
 * 칸 결제수단 글랜스: 받은 결제 기준 · 최신→고유 라벨 · `카드` / `카드·이체`.
 * 단체 내역(`group.payments`)도 합쳐 완납 후 수단이 보이게.
 * 시계열 = latestPaymentOf와 동일(createdAt · bizDate).
 */
export function nowPayMethodGlance(
  b: Pick<Booking, "payments">,
  extraPays?: readonly Payment[] | null,
): string | null {
  const pays = [...(b.payments ?? []), ...(extraPays ?? [])];
  if (!pays.length) return null;
  const ordered = [...pays].sort((a, c) => {
    const byCreated = (c.createdAt || "").localeCompare(a.createdAt || "");
    if (byCreated) return byCreated;
    return (c.bizDate || "").localeCompare(a.bizDate || "");
  });
  const seen = new Set<PaymentMethod>();
  const labels: string[] = [];
  for (const p of ordered) {
    if (seen.has(p.method)) continue;
    seen.add(p.method);
    labels.push(PAYMENT_METHOD_LABEL[p.method]);
  }
  return labels.length ? labels.join("·") : null;
}

/** 현황·데스크: 같은 groupId 활성 숙박 형제 */
export function groupStayPeers(list: readonly Booking[], groupId: string | null | undefined): Booking[] {
  if (!groupId) return [];
  return list.filter((x) => x.groupId === groupId && isActive(x) && x.kind === "stay");
}

/**
 * 퇴실처리 가능: 활성 숙박 · 영업일 ≥ 퇴실일 (조기 퇴실 earlyOut 경로와 분리).
 * 장기: 약속 퇴실 없음 → 입실일 이후(당일 포함) 언제든 퇴실처리로 종료.
 */
export function canCheckOut(b: Booking, today: string): boolean {
  if (!isActive(b) || b.kind !== "stay" || isCheckedOut(b)) return false;
  if (b.stayMode === "long_stay") return b.checkIn <= today;
  return stayEnd(b) <= today;
}

/**
 * 대실 이용 종료: 활성 대실 · 미퇴실.
 * SoT = `checkedOutAt` (`occupiesRoom` / `dayuseByRoom`과 동일) · 취소(status)와 분리 · 숙박 canCheckOut과 별축.
 */
export function canEndDayuse(b: Pick<Booking, "kind" | "status" | "checkedOutAt">): boolean {
  return b.kind === "dayuse" && isActive(b) && !isCheckedOut(b);
}

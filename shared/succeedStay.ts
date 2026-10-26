/**
 * Cross-name 연박 연결 (succeed prior).
 * Two bookings + succeedsBookingId · same room · continuous nights.
 * Amend-A nights↑ / rename = out of scope (OTA identity).
 */
import {
  type Booking,
  type HotelSettings,
  addDays,
  dayLabel,
  isActive,
  legConflicts,
  roomLabel,
  stayEnd,
} from "./ledger";
import { nowFlags } from "./nowboard";

export const CONNECT_STAY_COPY = "이 투숙에 연결";
export const CONNECT_STAY_TITLE = "이 투숙에 연결";
export const CONNECT_ALIGN_WARN =
  "선택 예약의 입실일이 이전 투숙 퇴실일과 달라요. 퇴실일에 맞춰 연결할까요?";

export type ConnectPriorFlags = {
  kind?: string;
};

/** Prior A: active stay with room · inhouse / departing / lateOut */
export function canConnectPrior(
  b: Booking,
  today: string,
  nowOpts?: Parameters<typeof nowFlags>[2],
): boolean {
  if (!isActive(b) || b.kind !== "stay" || !b.roomId || !b.nights || b.nights < 1) return false;
  if (b.checkedOutAt) return false;
  const f = nowFlags(b, today, nowOpts);
  return f.kind === "inhouse" || f.kind === "departing" || f.kind === "lateOut";
}

/** Successor candidate B (may be unassigned) */
export function canConnectCandidate(prior: Booking, b: Booking): boolean {
  if (b.id === prior.id) return false;
  if (!isActive(b) || b.kind !== "stay" || !b.nights || b.nights < 1) return false;
  if (b.checkedOutAt) return false;
  return true;
}

export function isContinuous(prior: Booking, next: Booking): boolean {
  return !!prior.checkIn && !!next.checkIn && stayEnd(prior) === next.checkIn;
}

export interface ConnectCandidate {
  booking: Booking;
  continuous: boolean;
  /** Already points at another prior */
  relink: boolean;
  unassigned: boolean;
}

/**
 * Candidates near prior end: continuous · same room · checkIn within ±3d of stayEnd(A)
 * (includes unassigned in that window). Prefer continuous · then unassigned · then checkIn asc.
 */
export function listConnectCandidates(prior: Booking, bookings: Booking[]): ConnectCandidate[] {
  const end = stayEnd(prior);
  const out: ConnectCandidate[] = [];
  for (const b of bookings) {
    if (!canConnectCandidate(prior, b)) continue;
    const continuous = isContinuous(prior, b);
    const unassigned = !b.roomId;
    const sameRoom = !!b.roomId && b.roomId === prior.roomId;
    const inWindow = b.checkIn >= addDays(end, -3) && b.checkIn <= addDays(end, 3);
    const near = continuous || sameRoom || inWindow;
    if (!near) continue;
    out.push({
      booking: b,
      continuous,
      relink: !!b.succeedsBookingId && b.succeedsBookingId !== prior.id,
      unassigned,
    });
  }
  out.sort((a, b) => {
    if (a.continuous !== b.continuous) return a.continuous ? -1 : 1;
    if (a.unassigned !== b.unassigned) return a.unassigned ? -1 : 1;
    return a.booking.checkIn.localeCompare(b.booking.checkIn) || a.booking.guestName.localeCompare(b.booking.guestName);
  });
  return out;
}

export interface ConnectDraft {
  next: Booking;
  priorId: string;
  roomId: string;
  alignedCheckIn: boolean;
  checkIn: string;
  priorEnd: string;
}

export interface ConnectPlanOk {
  draft: ConnectDraft;
  typeMismatch: boolean;
  roomTypeId: string | null;
  clashes: Booking[];
}

export type ConnectPlan = ConnectPlanOk | { err: string };

/**
 * Plan connect B → A. Does not mutate payments on either booking.
 * alignCheckIn: snap B.checkIn to stayEnd(A) when not continuous.
 */
export function planConnect(
  s: HotelSettings,
  bookings: Booking[],
  prior: Booking,
  next: Booking,
  opts: { alignCheckIn?: boolean; today?: string; nowOpts?: Parameters<typeof nowFlags>[2] } = {},
): ConnectPlan {
  const today = opts.today ?? prior.checkIn;
  if (!canConnectPrior(prior, today, opts.nowOpts)) {
    return { err: "숙박·퇴실예정 투숙만 연결할 수 있어요." };
  }
  if (!canConnectCandidate(prior, next)) {
    return { err: "연결할 숙박 예약을 골라 주세요." };
  }
  const roomId = prior.roomId;
  if (!roomId) return { err: "이전 투숙에 호실이 없어요." };

  const priorEnd = stayEnd(prior);
  const continuous = isContinuous(prior, next);
  const align = opts.alignCheckIn === true;
  if (!continuous && !align) {
    return { err: CONNECT_ALIGN_WARN };
  }
  const checkIn = continuous ? next.checkIn : priorEnd;
  const nights = next.nights ?? 1;

  const patched: Booking = {
    ...next,
    roomId,
    segments: null,
    tentative: false,
    checkIn,
    nights,
    succeedsBookingId: prior.id,
  };

  // Clash vs others · ignore prior (nights abut → no overlap with A)
  const peers = bookings.filter((x) => x.id !== prior.id && x.id !== next.id);
  const clashLegs = legConflicts(peers, patched);
  const clashBookings = peers.filter((x) => {
    if (!isActive(x) || x.kind !== "stay") return false;
    return legConflicts([x], patched).length > 0;
  });
  if (clashLegs.length) {
    const labels = [...new Set(clashLegs.map((l) => roomLabel(s, l.roomId) ?? l.roomId).filter(Boolean))].slice(0, 3);
    return {
      err: labels.length
        ? `그 기간에 ${labels.join("·")}호에 다른 예약이 있어요.`
        : "그 기간에 이 호실에 다른 예약이 있어요.",
    };
  }

  const room = s.floors.flatMap((f) => f.rooms).find((r) => r.id === roomId);
  const roomTypeId = room?.typeId ?? null;
  const typeMismatch = !!roomTypeId && !!next.typeId && roomTypeId !== next.typeId;

  return {
    draft: {
      next: patched,
      priorId: prior.id,
      roomId,
      alignedCheckIn: !continuous && align,
      checkIn,
      priorEnd,
    },
    typeMismatch,
    roomTypeId,
    clashes: clashBookings,
  };
}

/** Apply planned draft onto next booking (payments untouched). */
export function applyConnect(plan: ConnectPlanOk): Booking {
  return plan.draft.next;
}

export function connectSummaryLine(prior: Booking, next: Booking): string {
  const end = dayLabel(stayEnd(prior));
  const n = next.nights ?? 0;
  return `${prior.guestName} → ${next.guestName} · ${end}부터 ${n}박 · 같은 호실`;
}

/** Ops glance: bookings that succeed this prior */
export function successorsOf(priorId: string, bookings: Booking[]): Booking[] {
  return bookings.filter((b) => isActive(b) && b.succeedsBookingId === priorId);
}

export function priorOf(b: Booking, bookings: Booking[]): Booking | null {
  if (!b.succeedsBookingId) return null;
  return bookings.find((x) => x.id === b.succeedsBookingId) ?? null;
}

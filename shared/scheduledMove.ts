// 객실 이동 예약: "화요일에 입실한 511호 손님이 수요일에 608호로 옮기기로 했어요".
// 예약은 하나로 이어지고(같은 손님·같은 단체·같은 결제), 이동일부터 남은 밤이 다른 방 구간(leg)이 돼요.
//  · 요금은 날짜별(nightRates)이라 구간을 나눠도 그대로 따라가요 — 이동 후 요금만 따로 바꿀 수도 있어요
//  · 결제·미수금은 예약에 붙어 있어서 구간이 늘어도 달라지지 않아요 (총액이 같으면 미수금도 같아요)
//  · 어떤 호실이든 고를 수 있어요. 겹치면 막지 않고 경고만 — 한 번에 풀 길은 화면이 보여 줘요
import { type Booking, type HotelSettings, type Leg, addDays, daysBetween, fullLegsOf, isActive, md, moveStay, normalizeSegments, stayEnd, undoMove } from "./ledger";
import { type RoomClash, roomClashes } from "./roomClash";
import { type StayNightRates } from "./nightrates";
import { tableRows, tableTotal, withNight } from "./nightTable";
import type { Change } from "./changes";

export interface MovePlan {
  ok: true;
  /** 새 구간들 */
  segments: NonNullable<Booking["segments"]>;
  /** 이동일이 몇 박째인지 (2부터) */
  fromNight: number;
  /** 이동해서 묵는 남은 밤 수 */
  nightsMoved: number;
  fromRoomId: string;
  toRoomId: string;
  moveDate: string;
  /** 남은 밤 동안 그 방과 겹치는 다른 예약·임시마감 (비면 비어 있어요) */
  clashes: RoomClash[];
}
export interface MoveRefusal {
  ok: false;
  reason: string;
}

/** 이동일로 고를 수 있는 날: 입실 다음 날부터 마지막 밤까지 */
export function moveDateRange(b: Pick<Booking, "checkIn" | "nights" | "earlyOut">): { min: string; max: string } | null {
  const n = b.nights ?? 0;
  if (n < 2) return null;
  return { min: addDays(b.checkIn, 1), max: addDays(stayEnd(b as Booking), -1) };
}

/** 이동 예약 계획 — 저장은 하지 않아요 */
export function planScheduledMove(
  s: HotelSettings,
  bookings: readonly Booking[],
  b: Booking,
  moveDate: string,
  toRoomId: string,
  today: string,
): MovePlan | MoveRefusal {
  if (b.kind !== "stay" || !isActive(b) || !b.roomId) return { ok: false, reason: "객실 배정된 숙박만 이동을 예약할 수 있어요" };
  if (b.checkedOutAt) return { ok: false, reason: "이미 퇴실한 예약이에요" };
  const range = moveDateRange(b);
  if (!range) return { ok: false, reason: "2박 이상이어야 중간에 옮길 수 있어요 (1박이면 「객실 이동」을 써 주세요)" };
  if (!toRoomId) return { ok: false, reason: "옮길 객실을 골라 주세요" };
  if (moveDate < range.min || moveDate > range.max) return { ok: false, reason: `이동일은 ${md(range.min)}~${md(range.max)} 사이로 골라 주세요` };
  const fromNight = daysBetween(b.checkIn, moveDate) + 1;
  const nights = b.nights ?? 0;
  const nightsMoved = nights - fromNight + 1;
  const legs = fullLegsOf(b);
  const cur = legs.find((l) => l.checkIn <= moveDate && moveDate < addDays(l.checkIn, l.nights));
  const fromRoomId = (cur?.roomId ?? b.roomId) as string;
  if (fromRoomId === toRoomId) return { ok: false, reason: "지금 쓰는 객실과 같아요" };
  const segs = moveStay(b, fromNight, toRoomId);
  if (!segs) return { ok: false, reason: "이동 구간을 만들지 못했어요" };
  const clashes = roomClashes(s, bookings, toRoomId, moveDate, nightsMoved, today, new Set([b.id]));
  return { ok: true, segments: segs, fromNight, nightsMoved, fromRoomId, toRoomId, moveDate, clashes };
}

/** 앞으로(오늘 이후) 시작하는 이동 구간 — 현황판 「M/D N호로 이동 예정」 */
export interface PendingMove {
  date: string;
  fromRoomId: string;
  toRoomId: string;
  /** 구간 번호 (1부터, undoMove용) */
  idx: number;
  nights: number;
}
export function pendingMoves(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments" | "earlyOut" | "status" | "checkedOutAt">, today: string): PendingMove[] {
  if (b.kind !== "stay" || b.status !== "active" || b.checkedOutAt) return [];
  const legs: Leg[] = fullLegsOf(b);
  const out: PendingMove[] = [];
  for (let i = 1; i < legs.length; i++) {
    const l = legs[i]!;
    if (l.checkIn >= today && l.roomId && legs[i - 1]!.roomId) out.push({ date: l.checkIn, fromRoomId: legs[i - 1]!.roomId!, toRoomId: l.roomId, idx: i, nights: l.nights });
  }
  return out;
}
/** 다음 이동 예정 하나 — 내일 이후만 (오늘 이동은 「이동 완료」 쪽이에요). 없으면 null */
export const nextMove = (b: Parameters<typeof pendingMoves>[0], today: string): PendingMove | null => pendingMoves(b, addDays(today, 1))[0] ?? null;

/** 「10/29 608호로 이동 예정」 */
export const moveLabel = (m: Pick<PendingMove, "date" | "toRoomId">, roomNo: (id: string) => string): string => `${md(m.date)} ${roomNo(m.toRoomId)}호로 이동 예정`;

/** 이동 완료 기록의 말 (booking_changes · 객실) — 이게 있으면 그 날 이동은 끝난 걸로 봐요 */
export const MOVE_DONE_PREFIX = "이동 완료 · ";
export const moveDoneSummary = (m: Pick<PendingMove, "date">, fromNo: string, toNo: string): string => `${MOVE_DONE_PREFIX}${fromNo}호 → ${toNo}호 (${md(m.date)})`;
export const isMoveDone = (changes: readonly Change[], bookingId: string, date: string): boolean =>
  changes.some((c) => c.bookingId === bookingId && c.kind === "room" && c.effectiveOn === date && c.summary.startsWith(MOVE_DONE_PREFIX));
/** 오늘이 이동일이고 아직 「이동 완료」를 안 눌렀으면 그 이동 (다음 행동 = 이동 완료) */
export function moveDueToday(b: Parameters<typeof pendingMoves>[0] & { id: string }, today: string, changes: readonly Change[]): PendingMove | null {
  const m = pendingMoves(b, today).find((x) => x.date === today);
  return m && !isMoveDone(changes, b.id, today) ? m : null;
}

/** 이동 예약 취소: idx번째 구간을 앞 방으로 합쳐요 */
export function cancelScheduledMove(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments">, idx: number) {
  return normalizeSegments(undoMove(b, idx));
}

/** 이동 후 구간(moveDate~끝)의 1박 요금을 한 번에 바꾸기 → 새 박별 요금과 새 총액 (앞 구간 요금·가산분은 그대로) */
export function retargetLegRate(b: Pick<Booking, "checkIn" | "nights" | "price" | "nightRates">, moveDate: string, perNight: number): { nightRates: StayNightRates; price: number } {
  const n = b.nights ?? 0;
  const fb = n ? Math.round(b.price / n) : 0;
  let rates: StayNightRates | null = b.nightRates ?? null;
  const before = tableRows(b.checkIn, n, rates, fb);
  const oldLeg = before.filter((r) => r.date >= moveDate).reduce((x, r) => x + r.amount, 0);
  let newLeg = 0;
  for (const r of before) {
    if (r.date < moveDate) continue;
    rates = withNight(b.checkIn, n, rates, fb, r.date, Math.max(0, Math.round(perNight)));
    newLeg += Math.max(0, Math.round(perNight));
  }
  return { nightRates: rates!, price: Math.max(0, b.price - oldLeg + newLeg) };
}
/** 구간별 객실료 (박별 요금표 기준) — 구간마다 방·기간·금액이 보여요 */
export function legCharges(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments" | "price" | "nightRates">): { roomId: string | null; checkIn: string; nights: number; amount: number }[] {
  const n = b.nights ?? 0;
  const rows = tableRows(b.checkIn, n, b.nightRates ?? null, n ? Math.round(b.price / n) : 0);
  return fullLegsOf(b).map((l) => ({
    roomId: l.roomId,
    checkIn: l.checkIn,
    nights: l.nights,
    amount: tableTotal(rows.filter((r) => r.date >= l.checkIn && r.date < addDays(l.checkIn, l.nights))),
  }));
}

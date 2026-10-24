// 퇴실처리 되돌리기: checkedOutAt만 null · 결제 불변 · 물리/칸 충돌 시 차단
import {
  type Booking,
  addDays,
  dayLabel,
  isActive,
  legConflicts,
  legsOf,
  legsClash,
  occupiesRoom,
  roomOnNight,
  stayEnd,
} from "./ledger";
import { isCheckedOut, nowBoardVisible, roomForNowBoard } from "./nowboard";

export const CHECKOUT_UNDO_CTA = "되돌리기";
export const CHECKOUT_UNDO_TITLE = "퇴실처리 되돌리기";
export const DAYUSE_UNDO_TITLE = "이용 종료 되돌리기";

/** 되돌릴 수 있는 퇴실/이용종료 건인가 (active + checkedOutAt) */
export function canUndoCheckout(b: Pick<Booking, "status" | "checkedOutAt" | "kind">): boolean {
  return isActive(b) && isCheckedOut(b) && (b.kind === "stay" || b.kind === "dayuse");
}

/** 저장 패치: 점유만 복구 · 결제/박수 불변 */
export function restoreCheckoutPatch(): { checkedOutAt: null } {
  return { checkedOutAt: null };
}

function roomLabelOf(
  roomId: string | null | undefined,
  roomLabel: (id: string | null) => string | null,
): string {
  if (!roomId) return "?";
  return roomLabel(roomId) ?? roomId;
}

/** 되돌렸을 때 오늘 보드에 쓸 호실 id */
export function undoRoomId(b: Booking, today: string): string | null {
  const back: Booking = { ...b, checkedOutAt: null };
  if (b.kind === "dayuse") return b.roomId;
  return roomForNowBoard(back, today) ?? b.roomId ?? null;
}

/**
 * 되돌리면 물리·칸 충돌이 나는지. 막으면 KR 문구, 아니면 null.
 * · 숙박: legConflicts (밤 겹침) 또는 오늘 같은 방 보드에 다른 예약
 * · 대실: 같은 날·방 활성 대실/숙박 점유
 */
export function checkoutUndoBlock(
  bookings: readonly Booking[],
  b: Booking,
  today: string,
  roomLabel: (id: string | null) => string | null = (x) => x,
): string | null {
  if (!canUndoCheckout(b)) return "퇴실처리된 예약만 되돌릴 수 있어요.";
  const back: Booking = { ...b, checkedOutAt: null };

  if (b.kind === "dayuse") {
    const rid = b.roomId;
    if (!rid) return null;
    const peer = bookings.find((x) => {
      if (x.id === b.id || !occupiesRoom(x) || x.roomId !== rid) return false;
      if (x.kind === "dayuse") return x.checkIn === b.checkIn;
      return x.kind === "stay" && nowBoardVisible(x, today) && roomForNowBoard(x, today) === rid;
    });
    if (peer) {
      const ho = roomLabelOf(rid, roomLabel);
      return `${ho}호에 ${peer.guestName} 님 예약이 있어 되돌릴 수 없어요. 그 예약을 먼저 옮기거나 퇴실처리해 주세요.`;
    }
    return null;
  }

  const clashes = legConflicts(bookings as Booking[], back);
  if (clashes.length) {
    const mine = legsOf(back).filter((l) => l.roomId);
    const peer = bookings.find((x) => {
      if (x.id === b.id || !occupiesRoom(x) || x.kind !== "stay") return false;
      return legsOf(x).some((o) => mine.some((m) => legsClash(m, o)));
    });
    const rid = clashes[0]?.roomId ?? b.roomId;
    const ho = roomLabelOf(rid, roomLabel);
    const name = peer?.guestName ?? "다른 손님";
    const when = clashes[0]?.checkIn ? dayLabel(clashes[0].checkIn) : "";
    return `${when ? `${when} ` : ""}${ho}호에 ${name} 님 예약이 있어 되돌릴 수 없어요. 그 예약을 먼저 옮기거나 퇴실처리해 주세요.`;
  }

  // 퇴실 아침 + 당일 입실: 밤 겹침 없어도 칸에 이미 새 손님
  const rid = undoRoomId(b, today);
  if (rid) {
    const other = bookings.find((x) => {
      if (x.id === b.id || !isActive(x) || x.kind !== "stay") return false;
      if (isCheckedOut(x)) return false;
      return nowBoardVisible(x, today) && roomForNowBoard(x, today) === rid;
    });
    if (other) {
      const ho = roomLabelOf(rid, roomLabel);
      return `${ho}호에 ${other.guestName} 님 예약이 있어 되돌릴 수 없어요. 그 예약을 먼저 옮기거나 퇴실처리해 주세요.`;
    }
  }
  return null;
}

/**
 * 선택 호실의 최근 퇴실처리 숙박 (오늘 보드에 다시 올릴 수 있는 건).
 * 복수면 checkedOutAt 최신 1건. 단체는 단실만(호출측).
 */
export function recentCheckedOutForRoom(
  bookings: readonly Booking[],
  roomId: string,
  today: string,
): Booking | null {
  const candidates = bookings.filter((b) => {
    if (!canUndoCheckout(b) || b.kind !== "stay") return false;
    const back: Booking = { ...b, checkedOutAt: null };
    if (!nowBoardVisible(back, today)) return false;
    const lastNight = addDays(stayEnd(b), -1);
    return (
      roomForNowBoard(back, today) === roomId ||
      roomOnNight(back, today) === roomId ||
      roomOnNight(back, lastNight) === roomId ||
      b.roomId === roomId
    );
  });
  if (!candidates.length) return null;
  return candidates.sort((a, c) => (c.checkedOutAt ?? "").localeCompare(a.checkedOutAt ?? ""))[0] ?? null;
}

/** askConfirm body (stay) */
export function checkoutUndoConfirmBody(b: Booking, roomLabel: string): string {
  return `${roomLabel ? `${roomLabel}호 · ` : ""}${b.guestName}\n퇴실처리를 되돌릴까요? 칸에 다시 보여요.\n결제·환불은 그대로입니다.`;
}

/** askConfirm body (dayuse) */
export function dayuseUndoConfirmBody(b: Booking, roomLabel: string): string {
  const when = b.startTime && b.endTime ? ` · ${b.startTime}~${b.endTime}` : "";
  return `${roomLabel ? `${roomLabel}호 · ` : ""}${b.guestName}${when}\n이용 종료를 되돌릴까요? 대실이 다시 보여요.`;
}

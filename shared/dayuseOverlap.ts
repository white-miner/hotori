// 대실 ↔ 숙박 병행: 겹침 주의 팝업 · 동일 손님 스킵 (dayuse-with-stay-plan §4)
import { inTimeOf } from "./extratime";
import {
  type Booking,
  type HotelSettings,
  occupiesNight,
  occupiesRoom,
  roomOnNight,
  toMinutes,
} from "./ledger";
import { nowBoardVisible, roomForNowBoard } from "./nowboard";

export type GuestPick = Pick<Booking, "guestName" | "guestPhone">;

/** 이름: trim · 연속 공백 1칸 · 영문 소문자 */
export function normalizeGuestName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 연락처: 숫자만. 비면 매칭 실패용 빈 문자열 */
export function normalizeGuestPhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * 동일 손님 = 정규화 이름 + 정규화 연락처 둘 다 일치.
 * 한쪽만 같거나 번호/이름 비면 매칭 실패 → 팝업 유지.
 */
export function sameDayuseGuest(a: GuestPick, b: GuestPick): boolean {
  const na = normalizeGuestName(a.guestName ?? "");
  const nb = normalizeGuestName(b.guestName ?? "");
  const pa = normalizeGuestPhone(a.guestPhone);
  const pb = normalizeGuestPhone(b.guestPhone);
  if (!na || !nb || !pa || !pb) return false;
  return na === nb && pa === pb;
}

/** 대실 종료가 기준 시각(입실)보다 뒤인지. 자정 넘김 대실 포함. */
export function dayuseEndsAfter(start: string, end: string, gate: string): boolean {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return e > toMinutes(gate);
}

export type DayuseOverlapDraft = Pick<
  Booking,
  "id" | "kind" | "checkIn" | "roomId" | "startTime" | "endTime" | "guestName" | "guestPhone"
>;

export type DayuseOverlapResult =
  | { ok: true }
  | { ok: false; stay: Booking; checkInTime: string; message: string };

/**
 * 같은 방·같은 날 숙박과 대실이 겹치면 warn (저장은 허용 · UI 확인).
 * · 입실일·미입실: 대실 끝 > 입실 시각이면 경고
 * · 이미 투숙(입실완료·연박 중간·퇴실 아침 가시): 항상 경고
 * · 동일 손님(이름+전화): 스킵
 */
export function dayuseStayOverlapWarn(
  s: Pick<HotelSettings, "stayTimes">,
  bookings: readonly Booking[],
  draft: DayuseOverlapDraft,
): DayuseOverlapResult {
  if (draft.kind !== "dayuse" || !draft.roomId || !draft.startTime || !draft.endTime) return { ok: true };
  const D = draft.checkIn;
  const roomId = draft.roomId;

  for (const stay of bookings) {
    if (stay.id === draft.id || stay.kind !== "stay" || !occupiesRoom(stay)) continue;

    const onNight = occupiesNight(stay, D) ? roomOnNight(stay, D) : null;
    const onBoard = nowBoardVisible(stay, D) ? roomForNowBoard(stay, D) : null;
    const rid = onNight ?? onBoard ?? null;
    if (rid !== roomId) continue;
    if (sameDayuseGuest(draft, stay)) continue;

    const checkInTime = inTimeOf(s, stay);
    const checkoutMorning = !!onBoard && !onNight;
    // 연박 중간·퇴실 아침·이미 입실 → 대실∩점유 = 항상 주의
    const always =
      checkoutMorning || stay.arrived || (occupiesNight(stay, D) && D > stay.checkIn);
    // 입실일·미입실: 대실 끝 > 입실 시각이면 겹침
    const overlapsIn =
      D === stay.checkIn &&
      !stay.arrived &&
      dayuseEndsAfter(draft.startTime, draft.endTime, checkInTime);

    if (!always && !overlapsIn) continue;

    const stayLabel = stay.arrived || D > stay.checkIn || checkoutMorning ? "숙박" : "숙박예약";
    const message = `이 객실에 오늘 ${stayLabel}이 있어요 (입실 ${checkInTime}). 대실 ${draft.startTime}~${draft.endTime}과 겹칩니다. 그래도 저장할까요?`;
    return { ok: false, stay, checkInTime, message };
  }
  return { ok: true };
}

/** 당일 활성 대실을 방별로 (시간순) */
export function dayuseByRoom(bookings: readonly Booking[], date: string): Map<string, Booking[]> {
  const m = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.kind !== "dayuse" || b.checkIn !== date || !occupiesRoom(b) || !b.roomId) continue;
    const list = m.get(b.roomId) ?? [];
    list.push(b);
    m.set(b.roomId, list);
  }
  for (const list of m.values()) list.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  return m;
}

import { canEarlyOutToday, checkedOutRoomOverlaps, freeRooms, isEarlyOut, stayEnd, type Booking, type HotelSettings } from "./ledger";
import { canCheckOut, canEndDayuse } from "./nowboard";

export function assignableBooking(b: Booking): boolean {
  return b.status === "active" && b.kind === "stay" && !b.roomId && !b.checkedOutAt && !isEarlyOut(b);
}
/** 선택 예약의 전체 기간 기준이다. 보고 있던 과거 카드/손님은 배정 가용성에 쓰지 않는다. */
export function assignmentRoom(s: HotelSettings, bookings: Booking[], b: Booking, roomId: string, free = freeRooms(s, bookings, b)) {
  const room = s.floors.flatMap(f => f.rooms).find(r => r.id === roomId);
  const eligible = !!room && assignableBooking(b) && free.has(roomId);
  const historical = eligible ? checkedOutRoomOverlaps(bookings, { ...b, roomId }).length : 0;
  return { eligible, differentType: !!room && room.typeId !== b.typeId, historical,
    reason: !room ? "객실 없음" : !assignableBooking(b) ? "미배정 숙박 예약만 배정할 수 있습니다" : !free.has(roomId) ? "예약 기간 중 다른 투숙 또는 판매 마감" : historical ? "완료된 이용 기록 보존 · 배정 확인 필요" : "예약 전체 기간 배정 가능" };
}
export function roomWorkState(b: Booking | null, today: string) {
  const active = !!b && b.status === "active";
  const closed = !!b?.checkedOutAt || !!b && isEarlyOut(b);
  return {
    arrive: active && !closed && !b!.arrived && b!.checkIn <= today,
    checkout: !!b && canCheckOut(b, today),
    endDayuse: !!b && canEndDayuse(b),
    earlyOut: active && !closed && b!.kind === "stay" && (canEarlyOutToday(b!, today) || ((b!.nights ?? 0) >= 2 && today >= stayEnd(b!))),
    closed,
  };
}

// 객실 추가·단체 방 고르기: 어떤 호실이든 고를 수 있게 — 겹치면 막지 않고 알려 주기만 해요.
import {
  type Booking,
  type HotelSettings,
  addDays,
  allRooms,
  freeRooms,
  legsOf,
  nightsOverlap,
  occupiesRoom,
  stayEnd,
} from "./ledger";
import { roomsHeldForStay } from "./roomHold";

export interface RoomClash {
  roomId: string;
  kind: "booking" | "dayuse" | "hold";
  /** 겹치는 예약 (임시마감이면 null) */
  bookingId: string | null;
  guest: string;
  /** 겹치는 구간 [from, to) */
  from: string;
  to: string;
  /** 이미 끝난 날짜인데 퇴실처리가 안 된 예약 → 「퇴실 처리」 한 번으로 풀려요 */
  stale: boolean;
}

/** 그 방에서 [checkIn, +nights) 와 겹치는 예약·임시마감 (겹침이 없으면 빈 배열) */
export function roomClashes(
  s: HotelSettings,
  bookings: readonly Booking[],
  roomId: string,
  checkIn: string,
  nights: number,
  today: string,
  excludeIds: ReadonlySet<string> = new Set(),
): RoomClash[] {
  const out: RoomClash[] = [];
  const draft = { checkIn, nights };
  for (const b of bookings) {
    if (excludeIds.has(b.id) || !occupiesRoom(b) || b.kind !== "stay") continue;
    for (const l of legsOf(b)) {
      if (l.roomId !== roomId || !nightsOverlap(l, draft)) continue;
      const to = addDays(l.checkIn, l.nights);
      out.push({
        roomId,
        kind: "booking",
        bookingId: b.id,
        guest: b.groupName ?? b.guestName ?? "",
        from: l.checkIn > checkIn ? l.checkIn : checkIn,
        to: to < addDays(checkIn, nights) ? to : addDays(checkIn, nights),
        stale: !!b.arrived && stayEnd(b) <= today,
      });
    }
  }
  if (nights > 0 && roomsHeldForStay(s.roomHolds ?? [], checkIn, nights).has(roomId)) {
    out.push({ roomId, kind: "hold", bookingId: null, guest: "임시마감", from: checkIn, to: addDays(checkIn, nights), stale: false });
  }
  return out;
}

/** 같은 타입(없으면 아무) 중 그 기간에 비어 있는 방 — 같은 층 먼저. 「빈 방으로 바꾸기」용 */
export function suggestFreeRoom(
  s: HotelSettings,
  bookings: readonly Booking[],
  roomId: string,
  checkIn: string,
  nights: number,
  taken: ReadonlySet<string> = new Set(),
): string | null {
  const rooms = allRooms(s);
  const me = rooms.find((r) => r.id === roomId);
  if (!me) return null;
  const free = freeRooms(s, bookings as Booking[], { id: "__clash__", kind: "stay", checkIn, nights, startTime: null, endTime: null });
  const ok = rooms.filter((r) => r.id !== roomId && free.has(r.id) && !taken.has(r.id));
  const pick = (list: typeof ok) => list.find((r) => r.floorId === me.floorId) ?? list[0] ?? null;
  return (pick(ok.filter((r) => r.typeId === me.typeId)) ?? null)?.id ?? null;
}

/** 안내 문장 한 줄 */
export function clashLine(c: RoomClash, md: (d: string) => string): string {
  if (c.kind === "hold") return "임시마감 기간이에요";
  const span = c.to === addDays(c.from, 1) ? md(c.from) : `${md(c.from)}~${md(c.to)}`;
  return `${span} ${c.guest || "다른 예약"}${c.stale ? " (날짜 지남 · 퇴실처리 안 됨)" : ""}`;
}

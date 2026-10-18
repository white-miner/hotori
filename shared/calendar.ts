// 객실 캘린더: 방마다 한 줄, 날짜마다 한 칸. 숙박은 입실일부터 N박만큼 막대 (퇴실일 칸은 비어 있어요).
import { type Booking, type HotelSettings, type Leg, addDays, daysBetween, isActive, isCancelledRefilled, legsOf, roomMap } from "./ledger";

export interface Span {
  start: number; // 보이는 범위 안에서 시작 칸 (0부터)
  len: number; // 보이는 칸 수
  clipL: boolean; // 범위 앞에서 이미 시작했어요
  clipR: boolean; // 범위 뒤까지 이어져요
}
/** 숙박 막대가 보이는 범위 [from, to] 안에서 차지하는 칸. 안 겹치면 null */
export function barSpan(checkIn: string, nights: number, from: string, to: string): Span | null {
  if (!nights || nights < 1) return null;
  const last = addDays(checkIn, nights - 1); // 마지막 밤
  if (last < from || checkIn > to) return null;
  const s = checkIn < from ? from : checkIn;
  const e = last > to ? to : last;
  return { start: daysBetween(from, s), len: daysBetween(s, e) + 1, clipL: checkIn < from, clipR: last > to };
}

export interface Bar {
  b: Booking;
  span: Span;
  conflict: boolean; // 같은 방에서 다른 정상 숙박과 밤이 겹쳐요
  leg: Leg; // 객실 이동이면 그 방에 묵는 구간
  prev?: string | null; // 앞 구간 방 (이동해 들어왔으면)
  next?: string | null; // 다음 구간 방 (이동해 나가면)
}
export interface CalendarLayout {
  rooms: Map<string, Bar[]>; // roomId → 막대들
  dayuse: Map<string, Map<number, Booking[]>>; // roomId → 칸 → 대실
  lanes: Bar[][]; // 방 미배정 숙박: 서로 안 겹치게 줄을 나눠요
  lanesDayuse: Map<number, Booking[]>; // 방 미배정 대실
  conflicts: number; // 겹치는 숙박 쌍 수
}

const overlapNights = (a: Bar, b: Bar) => a.leg.checkIn < addDays(b.leg.checkIn, b.leg.nights) && b.leg.checkIn < addDays(a.leg.checkIn, a.leg.nights);

/** 방 미배정 막대를 줄에 나눠 담아요: 시작이 빠른 것부터, 들어갈 수 있는 첫 줄에 */
export function stackLanes(bars: Bar[]): Bar[][] {
  const sorted = [...bars].sort((a, b) => a.span.start - b.span.start || b.span.len - a.span.len || a.b.id.localeCompare(b.b.id) || a.leg.idx - b.leg.idx);
  const lanes: Bar[][] = [];
  const ends: number[] = []; // 줄마다 마지막 막대가 끝난 다음 칸
  for (const bar of sorted) {
    let i = ends.findIndex((e) => e <= bar.span.start);
    if (i < 0) {
      i = lanes.length;
      lanes.push([]);
      ends.push(0);
    }
    lanes[i].push(bar);
    ends[i] = bar.span.start + bar.span.len;
  }
  return lanes;
}

/** 같은 방 안에서 정상 숙박끼리 밤이 겹치면 둘 다 conflict, 쌍 수를 돌려줘요 */
export function markConflicts(bars: Bar[]): number {
  let n = 0;
  const act = bars.filter((x) => isActive(x.b));
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++)
      if (act[i].b.id !== act[j].b.id && overlapNights(act[i], act[j])) {
        act[i].conflict = act[j].conflict = true;
        n++;
      }
  return n;
}

/**
 * 캘린더 전체 배치. 취소·노쇼는 그 자리를 새 예약이 채우면 안 보여요 (현황판과 같은 규칙).
 * buildingId를 주면 그 건물 방만, 방 미배정은 '전체'에서만 보여요.
 */
export function calendarLayout(s: HotelSettings, bookings: Booking[], from: string, to: string, buildingId?: string | null): CalendarLayout {
  const rooms = roomMap(s);
  const near = bookings.filter((b) =>
    b.kind === "stay" ? !!b.nights && b.checkIn <= to && addDays(b.checkIn, b.nights - 1) >= from : b.checkIn >= from && b.checkIn <= to,
  );
  const out: CalendarLayout = { rooms: new Map(), dayuse: new Map(), lanes: [], lanesDayuse: new Map(), conflicts: 0 };
  const loose: Bar[] = [];
  for (const b of near) {
    if (b.kind === "dayuse") {
      if (!isActive(b) && isCancelledRefilled(b, near, rooms)) continue;
      const room = b.roomId ? rooms.get(b.roomId) : undefined;
      if (buildingId && room?.buildingId !== buildingId) continue;
      const i = daysBetween(from, b.checkIn);
      const m = room ? (out.dayuse.get(room.id) ?? out.dayuse.set(room.id, new Map()).get(room.id)!) : out.lanesDayuse;
      m.set(i, [...(m.get(i) ?? []), b]);
      continue;
    }
    // 숙박: 방 구간마다 막대 하나 (객실 이동이면 여러 개)
    const legs = legsOf(b);
    legs.forEach((leg, k) => {
      if (!isActive(b) && isCancelledRefilled(b, near, rooms, leg)) return;
      const room = leg.roomId ? rooms.get(leg.roomId) : undefined;
      if (buildingId && room?.buildingId !== buildingId) return;
      const span = barSpan(leg.checkIn, leg.nights, from, to);
      if (!span) return;
      const bar: Bar = { b, span, conflict: false, leg, prev: k > 0 ? legs[k - 1].roomId : undefined, next: k < legs.length - 1 ? legs[k + 1].roomId : undefined };
      if (room) out.rooms.set(room.id, [...(out.rooms.get(room.id) ?? []), bar]);
      else loose.push(bar);
    });
  }
  for (const bars of out.rooms.values()) {
    out.conflicts += markConflicts(bars);
    // 취소는 밑에, 정상은 위에 그려요
    bars.sort((a, b) => Number(isActive(a.b)) - Number(isActive(b.b)) || a.span.start - b.span.start);
  }
  out.lanes = stackLanes(loose);
  return out;
}

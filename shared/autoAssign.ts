/**
 * 미배정 예약 자동 배정 (순수 함수 — 화면·DB와 무관).
 *
 * 규칙
 * - 같은 객실 타입의 빈 방에만 넣어요. 다른 타입으로는 절대 자동 배정하지 않아요(이유만 알려 줘요).
 * - 이미 배정된 예약은 건드리지 않고, 임시마감(room holds)·다른 예약과 겹치는 방은 쓰지 않아요.
 * - 한 방에서 끝까지 묵는 게 기본. 못 들어가면 「방 나눠 배정」 옵션이 켜진 때만 구간(room_segments)으로 나눠요.
 * - 쪼개짐 최소화(best-fit): 앞뒤 빈 날이 가장 적은 방부터 채워서, 통째로 빈 방은 연박용으로 남겨요.
 * - 단체(groupId 같은 예약들)는 같은 건물·같은 층에 연속 호실로 모으려고 해요. 안 되면 흩어 놓되 표시해요.
 */
import {
  type Booking,
  type PlacedRoom,
  type RoomSegment,
  type HotelSettings,
  addDays,
  allRooms,
  checkedOutRoomOverlaps,
  daysBetween,
  freeRooms,
  legConflicts,
  legsOf,
  normalizeSegments,
  occupiesRoom,
  orderedFloors,
} from "./ledger";
import { dayuseStayOverlapWarn } from "./dayuseOverlap";
import { listUnassignedBookings } from "./nowboard";
import { roomsHeldForStay } from "./roomHold";

export type UnassignableReason = "no-type" | "no-rooms-of-type" | "held" | "full" | "fragmented" | "invalid";

export const UNASSIGNABLE_LABEL: Record<UnassignableReason, string> = {
  "no-type": "객실 타입이 없어요",
  "no-rooms-of-type": "그 타입 객실이 없어요",
  held: "그 기간 임시마감이에요",
  full: "그 기간 빈 방이 없어요",
  fragmented: "한 방으로 이어 묵을 수 없어요",
  invalid: "입실일·박수를 확인해 주세요",
};

export interface AutoAssignOptions {
  /** 한 방으로 못 들어가는 연박을 방 나눠 배정(구간)할지. 기본 false */
  allowSplit?: boolean;
  /** 나눠 배정할 때 최대 구간 수 (기본 3) */
  maxSegments?: number;
}

export interface AutoAssignItem {
  bookingId: string;
  /** 첫 방 (구간이 있으면 첫 구간의 방) */
  roomId: string;
  segments: RoomSegment[] | null;
  groupId: string | null;
  /** 단체인데 같은 층에 모으지 못해 흩어 놓음 */
  scattered: boolean;
}
export interface AutoAssignSkip {
  bookingId: string;
  reason: UnassignableReason;
  detail: string;
}
export interface AutoAssignPlan {
  items: AutoAssignItem[];
  skipped: AutoAssignSkip[];
}

const GAP_CAP = 14;

interface RoomInfo {
  room: PlacedRoom;
  order: number; // 설정 순서 (건물→층→방)
  floorKey: string;
  idx: number; // 층 안 순서
}

const floorKeyOf = (r: { buildingId: string; floorId: string }) => `${r.buildingId}/${r.floorId}`;

function buildRoomIndex(s: HotelSettings): Map<string, RoomInfo> {
  const m = new Map<string, RoomInfo>();
  let order = 0;
  for (const f of orderedFloors(s)) {
    f.rooms.forEach((r, idx) => {
      m.set(r.id, {
        room: { ...r, floorId: f.id, buildingId: f.buildingId },
        order: order++,
        floorKey: `${f.buildingId}/${f.id}`,
        idx,
      });
    });
  }
  return m;
}

const eligible = (b: Booking) => !!b.nights && b.nights > 0 && /^\d{4}-\d{2}-\d{2}$/.test(b.checkIn);

/** 작업용 예약 목록 (배정 결과를 가상으로 반영) */
class Work {
  private byId: Map<string, Booking>;
  constructor(bookings: Booking[]) {
    this.byId = new Map(bookings.map((b) => [b.id, b]));
  }
  list(): Booking[] {
    return [...this.byId.values()];
  }
  set(b: Booking, roomId: string, segments: RoomSegment[] | null) {
    this.byId.set(b.id, { ...b, roomId, segments });
  }
  clone(): Work {
    return new Work(this.list());
  }
}

const draftOf = (b: Booking, checkIn = b.checkIn, nights = b.nights ?? 0) => ({
  id: b.id,
  kind: "stay" as const,
  checkIn,
  nights,
  startTime: null,
  endTime: null,
});

/** 방 앞뒤 빈 날 합 (작을수록 딱 맞음). 이웃이 없으면 상한(GAP_CAP)만큼 불리 */
function gapScore(s: HotelSettings, work: Booking[], roomId: string, checkIn: string, nights: number): number {
  const end = addDays(checkIn, nights);
  let prevEnd: string | null = null;
  let nextStart: string | null = null;
  const consider = (from: string, to: string) => {
    // [from, to) 이 점유 구간
    if (to <= checkIn) prevEnd = prevEnd === null || to > prevEnd ? to : prevEnd;
    else if (from >= end) nextStart = nextStart === null || from < nextStart ? from : nextStart;
  };
  for (const b of work) {
    if (!occupiesRoom(b) || b.kind !== "stay") continue;
    for (const l of legsOf(b)) if (l.roomId === roomId) consider(l.checkIn, addDays(l.checkIn, l.nights));
  }
  for (const h of s.roomHolds ?? []) if (h.roomId === roomId) consider(h.from, addDays(h.to, 1));
  const before = prevEnd === null ? GAP_CAP : Math.min(GAP_CAP, daysBetween(prevEnd, checkIn));
  const after = nextStart === null ? GAP_CAP : Math.min(GAP_CAP, daysBetween(end, nextStart));
  return before + after;
}

function typeRoomsOf(idx: Map<string, RoomInfo>, typeId: string): RoomInfo[] {
  return [...idx.values()].filter((i) => i.room.typeId === typeId).sort((a, b) => a.order - b.order);
}

interface Pick1 {
  roomId: string;
  segments: RoomSegment[] | null;
}

/**
 * freeRooms가 막지 않지만 자동 배정은 절대 넣지 않는 겹침 (사람이 확인해야 하는 경우)
 * - checkedout: 퇴실처리된 숙박이 같은 방·같은 밤을 아직 잡고 있음 (수동 배정은 「덮어쓰기」 확인 모달을 띄움 → 자동은 확인할 수 없으니 건너뜀)
 * - dayuse: 같은 방·같은 날 대실과 시간이 겹침 (수동 배정은 경고 후 허용 → 자동은 건너뜀)
 */
export type ExtraBlock = "checkedout" | "dayuse";
export function extraBlock(s: HotelSettings, bookings: Booking[], b: Booking, roomId: string, checkIn: string, nights: number): ExtraBlock | null {
  const draft: Booking = { ...b, kind: "stay", roomId, segments: null, checkIn, nights, earlyOut: null, checkedOutAt: null, status: "active" };
  if (checkedOutRoomOverlaps(bookings, draft).length) return "checkedout";
  for (const d of bookings) {
    if (d.id === b.id || d.kind !== "dayuse" || !occupiesRoom(d) || d.roomId !== roomId) continue;
    // 같은 손님 예외(수동 경로)도 두지 않아요: 이름·번호를 비워서 검사
    if (!dayuseStayOverlapWarn(s, [draft], { ...d, guestName: "", guestPhone: null }).ok) return "dayuse";
  }
  return null;
}

/** 한 방에 통째로 들어갈 수 있는 방들 (같은 타입만) */
function wholeStayCandidates(s: HotelSettings, work: Work, idx: Map<string, RoomInfo>, b: Booking): RoomInfo[] {
  const list = work.list();
  const free = freeRooms(s, list, draftOf(b));
  return typeRoomsOf(idx, b.typeId).filter((i) => free.has(i.room.id) && !extraBlock(s, list, b, i.room.id, b.checkIn, b.nights ?? 0));
}

/** 밤마다 가장 오래 이어 묵을 수 있는 방으로 이어 붙여 구간 계획. 실패 시 null */
function planSplit(s: HotelSettings, work: Work, idx: Map<string, RoomInfo>, b: Booking, maxSegments: number): RoomSegment[] | null {
  const n = b.nights ?? 0;
  const rooms = typeRoomsOf(idx, b.typeId);
  if (!rooms.length || n < 2) return null;
  const list = work.list();
  // 밤별 빈 방
  const freeByNight: Set<string>[] = [];
  for (let i = 0; i < n; i++) {
    const f = freeRooms(s, list, draftOf(b, addDays(b.checkIn, i), 1));
    const night = addDays(b.checkIn, i);
    freeByNight.push(new Set(rooms.filter((r) => f.has(r.room.id) && !extraBlock(s, list, b, r.room.id, night, 1)).map((r) => r.room.id)));
    if (!freeByNight[i].size) return null;
  }
  const segs: RoomSegment[] = [];
  let i = 0;
  let prev: string | null = null;
  while (i < n) {
    let best: { id: string; run: number; order: number } | null = null;
    for (const r of rooms) {
      if (!freeByNight[i].has(r.room.id)) continue;
      let run = 0;
      while (i + run < n && freeByNight[i + run].has(r.room.id)) run++;
      if (!best || run > best.run || (run === best.run && r.room.id === prev && best.id !== prev)) best = { id: r.room.id, run, order: r.order };
    }
    if (!best) return null;
    segs.push({ roomId: best.id, nights: best.run });
    prev = best.id;
    i += best.run;
  }
  const norm = normalizeSegments(segs);
  if (!norm || norm.length > maxSegments) return null;
  return norm;
}

function whyUnassignable(s: HotelSettings, work: Work, idx: Map<string, RoomInfo>, b: Booking, opts: Required<AutoAssignOptions>): AutoAssignSkip {
  const mk = (reason: UnassignableReason, extra = ""): AutoAssignSkip => ({
    bookingId: b.id,
    reason,
    detail: extra ? `${UNASSIGNABLE_LABEL[reason]} · ${extra}` : UNASSIGNABLE_LABEL[reason],
  });
  if (!b.typeId) return mk("no-type");
  const rooms = typeRoomsOf(idx, b.typeId);
  if (!rooms.length) return mk("no-rooms-of-type");
  const list = work.list();
  const noHold = freeRooms({ ...s, roomHolds: [] }, list, draftOf(b));
  const heldOnly = rooms.filter((r) => noHold.has(r.room.id) && !extraBlock(s, list, b, r.room.id, b.checkIn, b.nights ?? 0));
  if (heldOnly.length) return mk("held");
  if (rooms.some((r) => noHold.has(r.room.id))) return mk("full", "퇴실처리·대실과 겹치는 방은 자동으로 넣지 않아요");
  if ((b.nights ?? 0) > 1 && !opts.allowSplit && planSplit(s, work, idx, b, opts.maxSegments)) return mk("fragmented", "방 나눠 배정을 켜면 들어가요");
  return mk("full");
}

/** 가장 딱 맞는 방 하나 (restrict: 후보 방 id 제한 · near: 단체 연속 호실용 층 안 위치들) */
function bestRoom(
  s: HotelSettings,
  work: Work,
  idx: Map<string, RoomInfo>,
  b: Booking,
  restrictFloor: string | null,
  near: number[] | null,
): RoomInfo | null {
  let cands = wholeStayCandidates(s, work, idx, b);
  if (restrictFloor) cands = cands.filter((c) => c.floorKey === restrictFloor);
  if (!cands.length) return null;
  const list = work.list();
  const scored = cands.map((c) => ({
    c,
    dist: near && near.length ? Math.min(...near.map((x) => Math.abs(c.idx - x))) : 0,
    gap: gapScore(s, list, c.room.id, b.checkIn, b.nights ?? 0),
  }));
  scored.sort((x, y) => x.dist - y.dist || x.gap - y.gap || x.c.order - y.c.order);
  return scored[0].c;
}

/**
 * 미배정 예약 `targets`를 자동 배정하는 계획을 만들어요. 아무것도 저장하지 않아요.
 * 실제 저장 직전에는 revalidateItem으로 건마다 다시 확인하세요.
 */
export function planAutoAssign(s: HotelSettings, bookings: Booking[], targets: Booking[], options: AutoAssignOptions = {}): AutoAssignPlan {
  const opts: Required<AutoAssignOptions> = { allowSplit: options.allowSplit ?? false, maxSegments: options.maxSegments ?? 3 };
  const idx = buildRoomIndex(s);
  // 장부(bookings)의 최신 사본만 쓰고, 같은 예약이 두 번 넘어와도 한 번만 (중복 배정 → 겹침 방지)
  const unassigned = new Map(listUnassignedBookings(bookings).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const todo: Booking[] = [];
  for (const t of targets) {
    const cur = unassigned.get(t.id);
    if (cur && !seen.has(t.id)) {
      seen.add(t.id);
      todo.push(cur);
    }
  }
  const work = new Work(bookings);
  const items: AutoAssignItem[] = [];
  const skipped: AutoAssignSkip[] = [];

  // 단위: 단체(2건 이상) / 단건
  const byGroup = new Map<string, Booking[]>();
  const units: { key: string; list: Booking[]; group: boolean }[] = [];
  for (const b of todo) {
    if (b.groupId) {
      const g = byGroup.get(b.groupId) ?? [];
      g.push(b);
      byGroup.set(b.groupId, g);
    }
  }
  for (const b of todo) {
    if (b.groupId && (byGroup.get(b.groupId)?.length ?? 0) >= 2) {
      if (!units.some((u) => u.key === b.groupId)) units.push({ key: b.groupId, list: byGroup.get(b.groupId)!, group: true });
    } else units.push({ key: b.id, list: [b], group: false });
  }
  const minCheckIn = (l: Booking[]) => l.map((x) => x.checkIn).sort()[0];
  const maxNights = (l: Booking[]) => Math.max(...l.map((x) => x.nights ?? 0));
  units.sort(
    (a, b) =>
      minCheckIn(a.list).localeCompare(minCheckIn(b.list)) ||
      Number(b.group) - Number(a.group) ||
      maxNights(b.list) - maxNights(a.list) ||
      a.list[0].createdAt.localeCompare(b.list[0].createdAt) ||
      a.key.localeCompare(b.key),
  );

  const placeSingle = (b: Booking, groupId: string | null, scattered: boolean) => {
    if (!b.typeId || !eligible(b)) {
      skipped.push({ bookingId: b.id, reason: !eligible(b) ? "invalid" : "no-type", detail: UNASSIGNABLE_LABEL[!eligible(b) ? "invalid" : "no-type"] });
      return;
    }
    const best = bestRoom(s, work, idx, b, null, null);
    let pick: Pick1 | null = best ? { roomId: best.room.id, segments: null } : null;
    if (!pick && opts.allowSplit && (b.nights ?? 0) > 1) {
      const segs = planSplit(s, work, idx, b, opts.maxSegments);
      if (segs) pick = { roomId: segs[0].roomId, segments: segs };
    }
    if (!pick) {
      skipped.push(whyUnassignable(s, work, idx, b, opts));
      return;
    }
    work.set(b, pick.roomId, pick.segments);
    items.push({ bookingId: b.id, roomId: pick.roomId, segments: pick.segments, groupId, scattered });
  };

  for (const u of units) {
    if (!u.group) {
      placeSingle(u.list[0], null, false);
      continue;
    }
    const members = [...u.list].sort((a, b) => a.typeId.localeCompare(b.typeId) || a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id));
    const bad = members.filter((m) => !m.typeId || !eligible(m));
    const ok = members.filter((m) => !bad.includes(m));
    for (const m of bad) placeSingle(m, u.key, false);
    // 이미 배정된 같은 단체 방의 층을 먼저
    const peerFloors: string[] = [];
    for (const b of bookings) {
      if (b.groupId !== u.key || !occupiesRoom(b) || !b.roomId) continue;
      const fi = idx.get(b.roomId);
      if (fi && !peerFloors.includes(fi.floorKey)) peerFloors.push(fi.floorKey);
    }
    const allFloors = [...new Set([...idx.values()].map((i) => i.floorKey))];
    const floorOrder = [...peerFloors, ...allFloors.filter((f) => !peerFloors.includes(f))];
    let best: { floor: string; cost: number; picks: { b: Booking; room: RoomInfo }[] } | null = null;
    for (const fl of floorOrder) {
      const sim = work.clone();
      const picks: { b: Booking; room: RoomInfo }[] = [];
      // 이미 배정된 같은 단체 방이 이 층에 있으면 그 옆부터 (연속 호실)
      const near: number[] = bookings
        .filter((x) => x.groupId === u.key && occupiesRoom(x) && x.roomId && idx.get(x.roomId)?.floorKey === fl)
        .map((x) => idx.get(x.roomId!)!.idx);
      let cost = peerFloors.length && !peerFloors.includes(fl) ? 1000 : 0;
      let fine = true;
      for (const m of ok) {
        const r = bestRoom(s, sim, idx, m, fl, near);
        if (!r) {
          fine = false;
          break;
        }
        cost += (near.length ? Math.min(...near.map((x) => Math.abs(r.idx - x))) : 0) * 10 + gapScore(s, sim.list(), r.room.id, m.checkIn, m.nights ?? 0);
        sim.set(m, r.room.id, null);
        near.push(r.idx);
        picks.push({ b: m, room: r });
      }
      if (fine && (!best || cost < best.cost)) best = { floor: fl, cost, picks };
    }
    if (best) {
      for (const p of best.picks) {
        work.set(p.b, p.room.room.id, null);
        items.push({ bookingId: p.b.id, roomId: p.room.room.id, segments: null, groupId: u.key, scattered: false });
      }
    } else {
      // 한 층에 다 못 모으면 건별로 흩어 배정 (표시)
      for (const m of ok) placeSingle(m, u.key, true);
    }
  }

  // 입력 순서(=화면 정렬) 기준으로 되돌려 주면 미리보기가 안정적
  const order = new Map(todo.map((b, i) => [b.id, i]));
  items.sort((a, b) => (order.get(a.bookingId) ?? 0) - (order.get(b.bookingId) ?? 0));
  skipped.sort((a, b) => (order.get(a.bookingId) ?? 0) - (order.get(b.bookingId) ?? 0));
  return { items, skipped };
}


/**
 * 저장 직전 건별 재검증 — 그 사이 다른 사람이 배정했거나 방이 막혔는지.
 * 문제 없으면 null, 있으면 사용자에게 보일 이유.
 */
export function revalidateItem(s: HotelSettings, latest: Booking[], item: Pick<AutoAssignItem, "bookingId" | "roomId" | "segments">): string | null {
  const b = latest.find((x) => x.id === item.bookingId);
  if (!b) return "예약을 찾을 수 없어요";
  if (b.status !== "active" || b.kind !== "stay") return "예약 상태가 바뀌었어요";
  if (b.roomId) return "그 사이 이미 배정됐어요";
  if (!b.nights) return "박수를 확인해 주세요";
  const draft: Booking = { ...b, roomId: item.roomId, segments: item.segments };
  const roomIds = new Set(allRooms(s).map((r) => r.id));
  const legs = legsOf(draft);
  if (!legs.length || legs.some((l) => !l.roomId || !roomIds.has(l.roomId))) return "방 정보가 바뀌었어요";
  if (legConflicts(latest, draft).length) return "그 사이 다른 예약과 겹쳐요";
  for (const l of legs) if (roomsHeldForStay(s.roomHolds ?? [], l.checkIn, l.nights).has(l.roomId!)) return "그 방이 임시마감이에요";
  const rm = new Map(allRooms(s).map((r) => [r.id, r]));
  for (const l of legs) {
    if (b.typeId && rm.get(l.roomId!)?.typeId !== b.typeId) return "예약한 타입과 다른 방이에요";
    const x = extraBlock(s, latest, b, l.roomId!, l.checkIn, l.nights);
    if (x === "checkedout") return "퇴실처리된 숙박과 같은 방·같은 밤이 겹쳐요";
    if (x === "dayuse") return "같은 날 대실과 시간이 겹쳐요";
  }
  return null;
}

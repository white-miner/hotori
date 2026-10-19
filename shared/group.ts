// 단체 예약: 방 고르기(타입 수 → 같은 층 · 붙은 방), 금액 나누기, 장부 묶음
import { type Booking, type HotelSettings, type PlacedRoom, addDays, allRooms, freeRooms, isActive, revenueOf, stockTable } from "./ledger";

export const GROUP_NAME_MAX = 40;
export const GROUP_ROOMS_MAX = 60;

/** 총액을 방 수로 똑같이 나누고 남는 원은 첫 방에 */
export function splitTotal(total: number, n: number): number[] {
  if (n <= 0) return [];
  const per = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? total - per * (n - 1) : per));
}

/** 그 기간 내내 비어 있는 방 (방 번호 순서 = 설정 순서) */
export function freeForStay(s: HotelSettings, bookings: Booking[], checkIn: string, nights: number): Set<string> {
  return freeRooms(s, bookings, { id: "__group__", kind: "stay", checkIn, nights, startTime: null, endTime: null });
}

/**
 * 타입 n개 자동 채우기: 같은 층에서 비어 있는 그 타입 방을 연달아(붙은 방 우선) 골라요.
 * 한 층에 다 없으면 빈 방이 많은 층부터 채워요. 이미 고른 방(taken)은 건너뛰어요.
 */
export function autoPick(s: HotelSettings, free: Set<string>, typeId: string, n: number, taken: Set<string> = new Set()): string[] {
  if (n <= 0) return [];
  const rooms = allRooms(s);
  const byFloor = new Map<string, { r: PlacedRoom; pos: number }[]>();
  rooms.forEach((r) => {
    if (!byFloor.has(r.floorId)) byFloor.set(r.floorId, []);
  });
  const posInFloor = new Map<string, number>();
  for (const f of byFloor.keys()) rooms.filter((r) => r.floorId === f).forEach((r, i) => posInFloor.set(r.id, i));
  for (const r of rooms)
    if (r.typeId === typeId && free.has(r.id) && !taken.has(r.id)) byFloor.get(r.floorId)!.push({ r, pos: posInFloor.get(r.id)! });
  // 한 층에 n개가 있으면: 가장 촘촘한(첫 방 ~ 끝 방 사이가 가장 짧은) 구간
  let best: { ids: string[]; span: number; order: number } | null = null;
  let order = 0;
  for (const list of byFloor.values()) {
    order++;
    for (let i = 0; i + n <= list.length; i++) {
      const span = list[i + n - 1].pos - list[i].pos;
      if (!best || span < best.span) best = { ids: list.slice(i, i + n).map((x) => x.r.id), span, order };
    }
  }
  if (best) return best.ids;
  // 여러 층: 빈 방이 많은 층부터, 층 안에서는 앞 번호부터
  const floors = [...byFloor.values()].filter((l) => l.length).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (const l of floors) for (const x of l) if (out.length < n) out.push(x.r.id);
  return out;
}

/** 타입×수가 재고에 주는 영향: 타입마다 그 기간 가장 적게 남는 수 (전 → 후) */
export function groupStockImpactByTypes(
  s: HotelSettings,
  bookings: Booking[],
  checkIn: string,
  nights: number,
  counts: Map<string, number> | Record<string, number>,
) {
  const dates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
  const table = stockTable(s, bookings, dates);
  const pick = counts instanceof Map ? counts : new Map(Object.entries(counts).map(([k, v]) => [k, Number(v) || 0]));
  return [...pick.entries()]
    .filter(([, n]) => n > 0)
    .map(([typeId, n]) => {
      const before = Math.min(...dates.map((d) => table.get(typeId)?.get(d) ?? 0));
      return { typeId, n, before, after: before - n };
    });
}

/** 고른 방이 재고에 주는 영향: 타입마다 그 기간 가장 적게 남는 수 (전 → 후) */
export function groupStockImpact(s: HotelSettings, bookings: Booking[], checkIn: string, nights: number, roomIds: string[]) {
  const rmap = new Map(allRooms(s).map((r) => [r.id, r]));
  const pick = new Map<string, number>();
  for (const id of roomIds) {
    const t = rmap.get(id)?.typeId;
    if (t) pick.set(t, (pick.get(t) ?? 0) + 1);
  }
  return groupStockImpactByTypes(s, bookings, checkIn, nights, pick);
}

export interface GroupTypeSlot {
  typeId: string;
  count: number;
}

/** 타입×수 → 멤버 줄 수만큼 typeId 배열 (저장·금액 줄용) */
export function expandTypeSlots(slots: GroupTypeSlot[]): string[] {
  const out: string[] = [];
  for (const x of slots) for (let i = 0; i < x.count; i++) out.push(x.typeId);
  return out;
}

/** 단체 예약 줄 만들기 (방마다 한 줄, 또는 타입만·호실 미정) */
export function groupDrafts(p: {
  groupId: string;
  groupName: string;
  platformId: string;
  checkIn: string;
  nights: number;
  /** 물리 방 id. 타입만이면 비우고 typeIds를 넣어요 */
  roomIds?: string[];
  /** 호실 미정 멤버의 타입 (길이 = 실 수). roomIds와 둘 중 하나만 */
  typeIds?: string[];
  prices: number[];
  s: HotelSettings;
  guestsOf?: (typeId: string) => number | null;
  tentative?: boolean;
  noClean?: boolean;
}): Booking[] {
  const rmap = new Map(allRooms(p.s).map((r) => [r.id, r]));
  const now = new Date().toISOString();
  const tent = !!p.tentative;
  const ncx = !!p.noClean;
  if (p.typeIds?.length) {
    return p.typeIds.map((typeId, i) => ({
      id: `__g${i}`,
      kind: "stay" as const,
      status: "active" as const,
      platformId: p.platformId,
      price: p.prices[i] ?? 0,
      guestName: p.groupName.trim(),
      typeId,
      roomId: null,
      segments: null,
      checkIn: p.checkIn,
      nights: p.nights,
      startTime: null,
      endTime: null,
      arrived: false,
      tentative: tent,
      noClean: ncx,
      earlyOut: null,
      checkedOutAt: null,
      refund: null,
      memo: null,
      guests: p.guestsOf?.(typeId) ?? null,
      groupId: p.groupId,
      groupName: p.groupName.trim(),
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  }
  return (p.roomIds ?? []).map((id, i) => {
    const typeId = rmap.get(id)?.typeId ?? "";
    return {
      id: `__g${i}`,
      kind: "stay" as const,
      status: "active" as const,
      platformId: p.platformId,
      price: p.prices[i] ?? 0,
      guestName: p.groupName.trim(),
      typeId,
      roomId: id,
      segments: null,
      checkIn: p.checkIn,
      nights: p.nights,
      startTime: null,
      endTime: null,
      arrived: false,
      tentative: tent,
      noClean: ncx,
      earlyOut: null,
      checkedOutAt: null,
      refund: null,
      memo: null,
      guests: p.guestsOf?.(typeId) ?? null,
      groupId: p.groupId,
      groupName: p.groupName.trim(),
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function validateGroup(p: {
  name: string;
  platformId: string;
  nights: number;
  roomIds: string[];
  prices: number[];
  free: Set<string>;
  /** 타입만(호실 미정). 있으면 roomIds는 무시하고 타입×수로 검사해요 */
  typeOnly?: GroupTypeSlot[];
}): string | null {
  if (!p.name.trim()) return "단체명을 적어 주세요.";
  if (p.name.trim().length > GROUP_NAME_MAX) return `단체명은 ${GROUP_NAME_MAX}글자까지예요.`;
  if (!p.platformId) return "플랫폼을 골라 주세요.";
  if (!Number.isInteger(p.nights) || p.nights < 1 || p.nights > 90) return "박수를 확인해 주세요.";
  if (p.typeOnly) {
    const slots = p.typeOnly.filter((x) => x.count > 0);
    if (!slots.length || slots.some((x) => !x.typeId || !Number.isInteger(x.count) || x.count < 0)) return "타입과 실 수를 확인해 주세요.";
    const n = slots.reduce((a, x) => a + x.count, 0);
    if (n < 2) return "타입을 합쳐 두 실 이상 잡아 주세요.";
    if (n > GROUP_ROOMS_MAX) return `한 번에 ${GROUP_ROOMS_MAX}실까지 만들 수 있어요.`;
    if (p.prices.length !== n) return "방별 금액을 확인해 주세요.";
  } else {
    if (p.roomIds.length < 2) return "방을 두 개 이상 골라 주세요.";
    if (p.roomIds.length > GROUP_ROOMS_MAX) return `한 번에 ${GROUP_ROOMS_MAX}실까지 만들 수 있어요.`;
    const busy = p.roomIds.filter((id) => !p.free.has(id));
    if (busy.length) return "그 기간에 다른 예약이 있는 방이 있어요. 다시 골라 주세요.";
    if (p.prices.length && p.prices.length !== p.roomIds.length) return "방별 금액을 확인해 주세요.";
  }
  if (p.prices.some((x) => !Number.isInteger(x) || x < 0 || x > 100_000_000)) return "금액을 확인해 주세요.";
  return null;
}

/**
 * 기존 단체에 객실(또는 타입만) 추가할 때 검사.
 * 단체명·플랫폼은 기존 묶음을 따르므로 여기선 안 봐요. 1실부터 가능.
 */
export function validateGroupAttach(p: {
  nights: number;
  roomIds: string[];
  prices: number[];
  free: Set<string>;
  /** 타입만(호실 미정). 있으면 roomIds는 무시하고 타입×수로 검사해요 */
  typeOnly?: GroupTypeSlot[];
}): string | null {
  if (!Number.isInteger(p.nights) || p.nights < 1 || p.nights > 90) return "박수를 확인해 주세요.";
  if (p.typeOnly) {
    const slots = p.typeOnly.filter((x) => x.count > 0);
    if (!slots.length || slots.some((x) => !x.typeId || !Number.isInteger(x.count) || x.count < 0)) return "타입과 실 수를 확인해 주세요.";
    const n = slots.reduce((a, x) => a + x.count, 0);
    if (n < 1) return "실 수를 한 개 이상 잡아 주세요.";
    if (n > GROUP_ROOMS_MAX) return `한 번에 ${GROUP_ROOMS_MAX}실까지 추가할 수 있어요.`;
    if (p.prices.length !== n) return "방별 금액을 확인해 주세요.";
  } else {
    if (p.roomIds.length < 1) return "방을 한 개 이상 골라 주세요.";
    if (p.roomIds.length > GROUP_ROOMS_MAX) return `한 번에 ${GROUP_ROOMS_MAX}실까지 추가할 수 있어요.`;
    const busy = p.roomIds.filter((id) => !p.free.has(id));
    if (busy.length) return "그 기간에 다른 예약이 있는 방이 있어요. 다시 골라 주세요.";
    if (p.prices.length && p.prices.length !== p.roomIds.length) return "방별 금액을 확인해 주세요.";
  }
  if (p.prices.some((x) => !Number.isInteger(x) || x < 0 || x > 100_000_000)) return "금액을 확인해 주세요.";
  return null;
}

export interface GroupSummary {
  groupId: string;
  name: string;
  members: Booking[];
  active: Booking[];
  rooms: number; // 정상 방 수
  checkIn: string;
  nights: number;
  total: number; // 매출 합 (취소 빼고, 노쇼 포함, 환불 뺌)
  arrived: number;
}
/** 장부·현황판에서 묶음 정보 */
export function groupSummaries(list: Booking[]): Map<string, GroupSummary> {
  const m = new Map<string, GroupSummary>();
  for (const b of list) {
    if (!b.groupId) continue;
    let g = m.get(b.groupId);
    if (!g) {
      g = { groupId: b.groupId, name: b.groupName ?? "", members: [], active: [], rooms: 0, checkIn: b.checkIn, nights: b.nights ?? 0, total: 0, arrived: 0 };
      m.set(b.groupId, g);
    }
    g.members.push(b);
    if (isActive(b)) {
      g.active.push(b);
      g.rooms++;
      if (b.arrived) g.arrived++;
    }
    if (b.checkIn < g.checkIn) g.checkIn = b.checkIn;
    g.nights = Math.max(g.nights, b.nights ?? 0);
    g.total += revenueOf(b);
  }
  return m;
}

/** 단체 날짜 바꾸기: 객실 이동·중도 퇴실한 방이 있으면 한 번에 못 바꿔요. 다른 예약과 겹치는 방을 알려 줘요 */
export function groupDateBlock(s: HotelSettings, bookings: Booking[], members: Booking[], checkIn: string, nights: number): string | null {
  const act = members.filter(isActive);
  if (act.some((b) => b.segments?.length || b.earlyOut)) return "객실 이동이나 중도 퇴실한 방이 있어서 날짜는 한 번에 바꿀 수 없어요. 방마다 고쳐 주세요.";
  const ids = new Set(members.map((b) => b.id));
  const free = freeForStay(s, bookings.filter((b) => !ids.has(b.id)), checkIn, nights);
  const rmap = new Map(allRooms(s).map((r) => [r.id, r]));
  const busy = act.filter((b) => b.roomId && !free.has(b.roomId)).map((b) => rmap.get(b.roomId!)?.no ?? "?");
  return busy.length ? `${busy.join(", ")}호는 그 기간에 다른 예약이 있어요.` : null;
}

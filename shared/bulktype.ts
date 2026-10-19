// 설정 › 객실 배치: 여러 방을 골라 타입을 한 번에 (층·건물이 달라도 돼요). 되돌리기는 바꾸기 전 타입으로
import { type HotelSettings, type PlacedRoom, allRooms, isMultiBuilding, buildingName } from "./ledger";

/** 화면 순서(건물 → 층 → 방)로 a부터 b까지 (shift-클릭 범위) */
export function roomRange(s: HotelSettings, a: string, b: string): string[] {
  const ids = allRooms(s).map((r) => r.id);
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i < 0 || j < 0) return j >= 0 ? [b] : [];
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}
/** 한 방 누르기: 있으면 빼고 없으면 넣어요 */
export function toggleRoom(sel: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(sel);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}
/** 범위 더하기 (shift-클릭: 고른 상태로 맞춰요) */
export function addRooms(sel: ReadonlySet<string>, ids: string[]): Set<string> {
  const n = new Set(sel);
  for (const id of ids) n.add(id);
  return n;
}
/** '층 전체': 그 층 방이 모두 골라져 있으면 빼고, 아니면 모두 넣어요 */
export function toggleFloor(s: HotelSettings, sel: ReadonlySet<string>, floorId: string): Set<string> {
  const ids = (s.floors.find((f) => f.id === floorId)?.rooms ?? []).map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => sel.has(id));
  const n = new Set(sel);
  for (const id of ids) {
    if (all) n.delete(id);
    else n.add(id);
  }
  return n;
}
export const floorAllSelected = (s: HotelSettings, sel: ReadonlySet<string>, floorId: string) => {
  const rooms = s.floors.find((f) => f.id === floorId)?.rooms ?? [];
  return rooms.length > 0 && rooms.every((r) => sel.has(r.id));
};

export interface BulkResult {
  settings: HotelSettings;
  /** 바뀐 방의 예전 타입 (되돌리기) */
  prev: Map<string, string | null>;
  changed: number;
}
/** 고른 방 모두 typeId로 (이미 그 타입인 방은 그대로). 설정 한 번 저장 */
export function applyType(s: HotelSettings, sel: ReadonlySet<string>, typeId: string | null): BulkResult {
  const prev = new Map<string, string | null>();
  const floors = s.floors.map((f) => ({
    ...f,
    rooms: f.rooms.map((r) => {
      if (!sel.has(r.id) || (r.typeId ?? null) === typeId) return r;
      prev.set(r.id, r.typeId ?? null);
      return { ...r, typeId };
    }),
  }));
  return { settings: prev.size ? { ...s, floors } : s, prev, changed: prev.size };
}
/** 되돌리기: 바꾼 방만 예전 타입으로 (그 사이 지워진 방은 넘어가요) */
export function undoType(s: HotelSettings, prev: ReadonlyMap<string, string | null>): HotelSettings {
  return { ...s, floors: s.floors.map((f) => ({ ...f, rooms: f.rooms.map((r) => (prev.has(r.id) ? { ...r, typeId: prev.get(r.id)! } : r)) })) };
}

/** 방 이름 줄: 같은 층에서 번호가 이어지면 '605–608호', 아니면 '503 · 507 · 303호' (6개 넘으면 '외 N개') */
export function roomsLabel(s: HotelSettings, ids: Iterable<string>): string {
  const set = new Set(ids);
  const rooms: PlacedRoom[] = allRooms(s).filter((r) => set.has(r.id));
  if (!rooms.length) return "";
  const multi = isMultiBuilding(s);
  const name = (r: PlacedRoom) => (multi ? `${buildingName(s, r.buildingId)} ${r.no}` : r.no);
  // 같은 층 · 숫자 번호 · 하나씩 이어지면 범위로
  const nums = rooms.map((r) => (/^\d+$/.test(r.no) ? Number(r.no) : NaN));
  const oneFloor = rooms.every((r) => r.floorId === rooms[0].floorId);
  if (rooms.length >= 3 && oneFloor && nums.every(Number.isFinite)) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)) {
      const first = rooms.find((r) => Number(r.no) === sorted[0])!;
      return `${name(first)}–${sorted[sorted.length - 1]}호`;
    }
  }
  const shown = rooms.slice(0, 6).map(name).join(" · ");
  return rooms.length > 6 ? `${shown}호 외 ${rooms.length - 6}개` : `${shown}호`;
}
/** '스탠다드 2PC로' · '디럭스 트윈으로' · '온돌VIP로' (받침 있으면 '으로', ㄹ 받침은 '로') */
export function withRo(w: string): string {
  const t = w.trim();
  const c = t.slice(-1).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const j = (c - 0xac00) % 28;
    return `${t}${j && j !== 8 ? "으로" : "로"}`;
  }
  return `${t}${/[0136]$/.test(t) || /[mnMN]$/.test(t) ? "으로" : "로"}`;
}
/** 알림: '605–608호 4개를 스탠다드 2PC로 바꿨어요' */
export function bulkToast(s: HotelSettings, ids: Iterable<string>, n: number, typeName: string | null): string {
  return `${roomsLabel(s, ids)} ${n}개를 ${typeName ? withRo(typeName) : "타입 없음으로"} 바꿨어요`;
}

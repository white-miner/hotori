// HOTORI v3 · 예약 장부 핵심 규칙 (화면과 테스트가 같이 써요)
// 남은 객실(타입, 날짜) = 그 타입 방 수 − 그날 밤을 차지한 숙박 예약 수
// - 숙박 N박 = 입실 날짜부터 N개의 밤. 퇴실하는 날 밤은 비어요.
// - 대실은 계산에 넣지 않아요. 취소·노쇼도 빠져요.
// - 방을 정했으면 실제 방의 타입에서, 안 정했으면 판 타입에서 빼요.

export type Kind = "stay" | "dayuse";
export type Status = "active" | "cancelled" | "noshow";

export const TYPE_NAME_MAX = 12; // 객실 타입 이름 최대 글자 수
/** @deprecated TYPE_NAME_MAX와 같아요 */
export const TYPE_CODE_MAX = TYPE_NAME_MAX;
export interface RoomType {
  id: string;
  name: string; // 객실 타입 이름(최대 12글자). 칩·방 칸·현황표·장부에 그대로 보여요. 예: S, SD, 스탠다드 디럭스
  /** @deprecated 예전 '약자' 칸. 옛 데이터를 불러올 때만 읽고, 저장할 때는 name과 같은 값으로 맞춰 둬요 */
  code?: string;
}
const OLD_DEFAULT_TYPE_NAME = "새 타입";
/** 옛 데이터 → 이름 하나로: 화면에 보이던 약자가 있으면 그걸, 없으면 이름('새 타입'은 빼고) */
export function migrateTypeName(t: { code?: unknown; name?: unknown }): string {
  const code = typeof t.code === "string" ? t.code.trim() : "";
  const name = typeof t.name === "string" ? t.name.trim() : "";
  return (code || (name === OLD_DEFAULT_TYPE_NAME ? "" : name)).slice(0, TYPE_NAME_MAX);
}
/** 화면에 보이는 객실 타입 이름 */
export const typeLabel = (t?: Pick<RoomType, "name"> | null): string => t?.name?.trim() ?? "";
/** 이름이 비어 있지 않아 예약·방 배정에 쓸 수 있는 타입 */
export const usableTypes = <T extends Pick<RoomType, "name">>(types: T[]): T[] => types.filter((t) => typeLabel(t) !== "");
export interface Room {
  id: string; // 호텔 안에서 유일 (건물이 달라도 같은 번호를 쓸 수 있어서 번호가 아니라 id로 구분해요)
  no: string; // 방 번호 또는 이름 (예: 601, 펜션1)
  typeId: string | null;
  color?: string | null;
}
export interface Building {
  id: string;
  name: string; // 예: 본관, 별관, A동
}
export interface Floor {
  id: string;
  name: string; // 예: 6층
  buildingId: string;
  color?: string | null;
  rooms: Room[];
}
export interface Platform {
  id: string;
  name: string;
  abbr: string; // 한 글자 약자
}
export interface HotelSettings {
  buildings: Building[]; // 1개 이상. 1개면 화면은 예전과 똑같아요.
  floors: Floor[];
  types: RoomType[];
  platforms: Platform[];
  lowThreshold: number;
  shopItems: ShopItem[]; // 매점 물품 (위에서부터 매점 화면 순서)
}
export interface ShopItem {
  id: string;
  name: string; // 최대 20글자, 비어 있으면 매점 화면에 안 나와요
  price: number; // 원
  category: string; // 자유 입력, 비어 있으면 '기타'
  hidden: boolean; // 품절·숨김
}
export const SHOP_NAME_MAX = 20;
export const SHOP_CATEGORY_MAX = 12;
export const FREE_SHOP_ITEM_LIMIT = 10;
export function normalizeShopItems(raw: unknown): ShopItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string")
    .filter((x) => !seen.has(x.id as string) && !!seen.add(x.id as string))
    .map((x) => {
      const price = Math.round(Number(x.price));
      return {
        id: x.id as string,
        name: typeof x.name === "string" ? x.name.slice(0, SHOP_NAME_MAX) : "",
        price: Number.isFinite(price) && price >= 0 ? Math.min(price, 10_000_000) : 0,
        category: typeof x.category === "string" ? x.category.slice(0, SHOP_CATEGORY_MAX) : "",
        hidden: x.hidden === true,
      };
    });
}

export interface Booking {
  id: string;
  kind: Kind;
  status: Status;
  platformId: string;
  price: number; // 총액
  guestName: string;
  typeId: string; // 판 타입
  roomId: string | null;
  checkIn: string; // YYYY-MM-DD
  nights: number | null; // 숙박만
  startTime: string | null; // HH:MM (대실만)
  endTime: string | null;
  arrived: boolean;
  memo: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const BUSINESS_DAY_CUTOFF_HOUR = 6;
export const HOTEL_TIME_ZONE = "Asia/Seoul";

/** 건물 정보가 없던 예전 설정은 모두 이 건물 하나로 봐요 (DB 마이그레이션과 같은 id) */
export const DEFAULT_BUILDING: Building = { id: "b-main", name: "본관" };

export function emptySettings(): HotelSettings {
  return { buildings: [{ ...DEFAULT_BUILDING }], floors: [], types: [], platforms: [], lowThreshold: 2, shopItems: [] };
}
export function normalizeSettings(raw: unknown): HotelSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<HotelSettings>;
  const th = Number(s.lowThreshold);
  const seen = new Set<string>();
  const buildings = (Array.isArray(s.buildings) ? s.buildings : []).filter(
    (b): b is Building =>
      !!b && typeof b === "object" && typeof b.id === "string" && !!b.id && !seen.has(b.id) && !!seen.add(b.id),
  ).map((b) => ({ id: b.id, name: typeof b.name === "string" ? b.name : "" })); // 비어 있으면 화면에는 A동·B동…
  if (!buildings.length) buildings.push({ ...DEFAULT_BUILDING });
  const first = buildings[0].id;
  return {
    buildings,
    floors: Array.isArray(s.floors)
      ? s.floors.map((f) => ({
          ...f,
          buildingId: typeof f.buildingId === "string" && seen.has(f.buildingId) ? f.buildingId : first,
          rooms: Array.isArray(f.rooms) ? f.rooms : [],
        }))
      : [],
    types: Array.isArray(s.types)
      ? s.types
          .filter((t) => t && typeof t.id === "string")
          .map((t) => {
            const name = migrateTypeName(t);
            return { ...t, name, code: name };
          })
      : [],
    platforms: Array.isArray(s.platforms) ? s.platforms : [],
    lowThreshold: Number.isInteger(th) && th >= 0 && th <= 20 ? th : 2,
    shopItems: normalizeShopItems((s as { shopItems?: unknown }).shopItems),
  };
}

// ---------- 날짜 ----------
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86400000);
}
function zonedDate(instant: Date, timeZone = HOTEL_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
/** 영업일: 자정~새벽 6시 전 도착은 전날 밤 숙박으로 쳐요. */
export function businessDate(now: Date = new Date(), cutoffHour = BUSINESS_DAY_CUTOFF_HOUR): string {
  return zonedDate(new Date(now.getTime() - cutoffHour * 3600000));
}
const WEEK = "일월화수목금토";
export function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function md(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}
export function dayLabel(date: string): string {
  return `${md(date)}(${weekday(date)})`;
}
export function checkOut(b: Pick<Booking, "checkIn" | "nights">): string {
  return addDays(b.checkIn, b.nights ?? 0);
}

// ---------- 건물·층·방 ----------
/** 이름을 안 적은 건물은 순서대로 A동, B동, C동… (26개 넘으면 27동…) */
export function defaultBuildingName(index: number): string {
  return index < 26 ? `${String.fromCharCode(65 + index)}동` : `${index + 1}동`;
}
/** 화면에 보이는 건물 이름 */
export function buildingName(s: Pick<HotelSettings, "buildings">, buildingId: string | null | undefined): string {
  const i = s.buildings.findIndex((b) => b.id === buildingId);
  if (i < 0) return "";
  return s.buildings[i].name.trim() || defaultBuildingName(i);
}
export const isMultiBuilding = (s: Pick<HotelSettings, "buildings">) => (s.buildings?.length ?? 0) > 1;
/** 건물 순서 → 그 건물 안의 층 순서 (건물을 모르는 층은 첫 건물로) */
export function orderedFloors(s: HotelSettings): Floor[] {
  const bs = s.buildings?.length ? s.buildings : [DEFAULT_BUILDING];
  const known = new Set(bs.map((b) => b.id));
  const bOf = (f: Floor) => (known.has(f.buildingId) ? f.buildingId : bs[0].id);
  return bs.flatMap((b) => s.floors.filter((f) => bOf(f) === b.id).map((f) => ({ ...f, buildingId: b.id })));
}
export function floorsOf(s: HotelSettings, buildingId: string): Floor[] {
  return orderedFloors(s).filter((f) => f.buildingId === buildingId);
}
export type PlacedRoom = Room & { floorId: string; buildingId: string };
export function allRooms(s: HotelSettings): PlacedRoom[] {
  return orderedFloors(s).flatMap((f) => f.rooms.map((r) => ({ ...r, floorId: f.id, buildingId: f.buildingId })));
}
/** 화면에 보이는 방 이름: 건물이 하나면 "201", 둘 이상이면 "별관 201" */
export function roomLabel(s: HotelSettings, roomId: string | null | undefined): string | null {
  if (!roomId) return null;
  const r = allRooms(s).find((x) => x.id === roomId);
  if (!r) return null;
  if (!isMultiBuilding(s)) return r.no;
  const n = buildingName(s, r.buildingId);
  return n ? `${n} ${r.no}` : r.no;
}
/** "601~610, 701" → ["601", ..., "610", "701"] */
export function parseRoomInput(v: string): string[] {
  const out: string[] = [];
  for (const part of v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d{1,5})\s*[~-]\s*(\d{1,5})$/.exec(part);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b >= a && b - a < 60) for (let n = a; n <= b; n++) out.push(String(n));
    } else out.push(part.slice(0, 12));
  }
  return out;
}
/** 층에 방 추가: 같은 건물 안에 이미 있는 번호만 건너뛰어요 (다른 건물에는 같은 번호가 있어도 돼요) */
export function addRoomsToFloor(
  s: HotelSettings,
  floorId: string,
  input: string,
  typeId: string | null,
  newId: () => string,
): { settings: HotelSettings; added: string[]; skipped: string[] } {
  const floor = s.floors.find((f) => f.id === floorId);
  if (!floor) return { settings: s, added: [], skipped: [] };
  const existing = new Set(allRooms(s).filter((r) => r.buildingId === floor.buildingId).map((r) => r.no));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const no of parseRoomInput(input)) {
    if (existing.has(no)) skipped.push(no);
    else {
      existing.add(no);
      added.push(no);
    }
  }
  if (!added.length) return { settings: s, added, skipped };
  const rooms = added.map((no) => ({ id: newId(), no, typeId, color: null }));
  return {
    settings: { ...s, floors: s.floors.map((f) => (f.id === floorId ? { ...f, rooms: [...f.rooms, ...rooms] } : f)) },
    added,
    skipped,
  };
}
/** 같은 건물 안에서 겹치는 방 번호 (건물이 다르면 괜찮아요) */
export function duplicateRoomNos(s: HotelSettings): { buildingId: string; no: string }[] {
  const seen = new Set<string>();
  const dup: { buildingId: string; no: string }[] = [];
  for (const r of allRooms(s)) {
    const k = `${r.buildingId}\u0000${r.no}`;
    if (seen.has(k)) dup.push({ buildingId: r.buildingId, no: r.no });
    seen.add(k);
  }
  return dup;
}
/** 층 순서 바꾸기: 같은 건물 안에서 바로 위/아래 층과 자리를 바꿔요 */
export function moveFloor(s: HotelSettings, floorId: string, dir: -1 | 1): HotelSettings {
  const f = s.floors.find((x) => x.id === floorId);
  if (!f) return s;
  const same = orderedFloors(s).filter((x) => x.buildingId === f.buildingId);
  const i = same.findIndex((x) => x.id === floorId);
  const other = same[i + dir];
  if (!other) return s;
  const a = s.floors.findIndex((x) => x.id === floorId);
  const b = s.floors.findIndex((x) => x.id === other.id);
  const floors = s.floors.slice();
  [floors[a], floors[b]] = [floors[b], floors[a]];
  return { ...s, floors };
}
/** 새 층 이름: 그 건물 층 이름의 가장 큰 숫자 + 1 (숫자가 없으면 층 수 + 1) */
export function nextFloorName(s: HotelSettings, buildingId: string): string {
  const fl = floorsOf(s, buildingId);
  const nums = fl.map((f) => Number(/(\d+)/.exec(f.name)?.[1])).filter((n) => Number.isFinite(n));
  return `${nums.length ? Math.max(...nums) + 1 : fl.length + 1}층`;
}
/** 층 추가: 새 층은 그 건물의 맨 위(목록·현황판 첫 줄)에 들어가요 */
export function addFloorOnTop(s: HotelSettings, buildingId: string, id: string): HotelSettings {
  const floor: Floor = { id, name: nextFloorName(s, buildingId), buildingId, color: null, rooms: [] };
  const top = floorsOf(s, buildingId)[0];
  const at = top ? s.floors.findIndex((x) => x.id === top.id) : -1;
  const floors = s.floors.slice();
  if (at < 0) floors.push(floor);
  else floors.splice(at, 0, floor);
  return { ...s, floors };
}
/** 건물 지우기: 그 건물의 층·방도 같이 지워요 (마지막 건물은 못 지워요) */
export function removeBuilding(s: HotelSettings, buildingId: string): HotelSettings {
  if (s.buildings.length <= 1) return s;
  return {
    ...s,
    buildings: s.buildings.filter((b) => b.id !== buildingId),
    floors: s.floors.filter((f) => f.buildingId !== buildingId),
  };
}

// ---------- 방·타입 ----------
export function roomMap(s: HotelSettings) {
  return new Map(allRooms(s).map((r) => [r.id, r]));
}
/** 타입별 방 수. buildingId를 주면 그 건물 방만 세요 */
export function typeTotals(s: HotelSettings, buildingId?: string | null): Map<string, number> {
  const m = new Map<string, number>(s.types.map((t) => [t.id, 0]));
  for (const r of allRooms(s))
    if (r.typeId && m.has(r.typeId) && (!buildingId || r.buildingId === buildingId)) m.set(r.typeId, m.get(r.typeId)! + 1);
  return m;
}
/** 재고를 빼는 타입: 방을 정했으면 그 방의 타입, 아니면 판 타입 */
export function effectiveTypeId(b: Pick<Booking, "typeId" | "roomId">, rooms: Map<string, Room>): string {
  const r = b.roomId ? rooms.get(b.roomId) : undefined;
  return r?.typeId ?? b.typeId;
}

// ---------- 밤 차지 ----------
export const isActive = (b: Pick<Booking, "status">) => b.status === "active";
export function occupiesNight(b: Pick<Booking, "kind" | "checkIn" | "nights">, date: string): boolean {
  if (b.kind !== "stay" || !b.nights) return false;
  return b.checkIn <= date && date < addDays(b.checkIn, b.nights);
}
export function nightsOverlap(
  a: Pick<Booking, "checkIn" | "nights">,
  b: Pick<Booking, "checkIn" | "nights">,
): boolean {
  return a.checkIn < checkOut(b) && b.checkIn < checkOut(a);
}

// ---------- 남은 객실 ----------
export type StockTable = Map<string, Map<string, number>>; // typeId -> date -> remaining
/**
 * 남은 객실 표. buildingId를 주면 그 건물만: 그 건물 방 수에서 그 건물 방에 배정된 숙박만 빼요.
 * 방을 안 정한 숙박은 어느 건물인지 모르니 '전체'에서만 빠져요.
 */
export function stockTable(s: HotelSettings, bookings: Booking[], dates: string[], buildingId?: string | null): StockTable {
  const totals = typeTotals(s, buildingId);
  const rooms = roomMap(s);
  const table: StockTable = new Map();
  for (const t of s.types) table.set(t.id, new Map(dates.map((d) => [d, totals.get(t.id) ?? 0])));
  const dateSet = new Set(dates);
  for (const b of bookings) {
    if (!isActive(b) || b.kind !== "stay" || !b.nights) continue;
    if (buildingId && rooms.get(b.roomId ?? "")?.buildingId !== buildingId) continue;
    const tid = effectiveTypeId(b, rooms);
    const row = table.get(tid);
    if (!row) continue;
    for (let i = 0; i < b.nights; i++) {
      const d = addDays(b.checkIn, i);
      if (dateSet.has(d)) row.set(d, row.get(d)! - 1);
    }
  }
  return table;
}
export function remaining(s: HotelSettings, bookings: Booking[], typeId: string, date: string): number {
  return stockTable(s, bookings, [date]).get(typeId)?.get(date) ?? 0;
}

export type Level = "ok" | "low" | "full" | "over";
export function stockLevel(rem: number, total: number, lowThreshold: number): Level {
  if (rem < 0) return "over";
  if (rem === 0) return total > 0 ? "full" : "ok";
  if (rem <= lowThreshold && total >= lowThreshold + 2) return "low";
  return "ok";
}

/** 가장 가까운 오버부킹 (날짜 순, 같은 날이면 타입 순서) */
export function firstOverbooking(s: HotelSettings, table: StockTable, dates: string[]) {
  for (const d of dates)
    for (const t of s.types) {
      const r = table.get(t.id)?.get(d) ?? 0;
      if (r < 0) return { date: d, type: t, over: -r };
    }
  return null;
}

/** 14일 안의 오버부킹 전부 (날짜·타입마다 한 칸) — 탭의 빨간 숫자 */
export function allOverbookings(s: HotelSettings, table: StockTable, dates: string[]) {
  const out: { date: string; type: RoomType; over: number }[] = [];
  for (const d of dates)
    for (const t of s.types) {
      const r = table.get(t.id)?.get(d) ?? 0;
      if (r < 0) out.push({ date: d, type: t, over: -r });
    }
  return out;
}

/** 이 날짜들 중 하룻밤이라도 걸친, 방을 안 정한 숙박 수 (건물별 표에는 빠져요) */
export function unassignedStays(s: HotelSettings, bookings: Booking[], dates: string[]): number {
  const rooms = roomMap(s);
  const set = new Set(dates);
  return bookings.filter(
    (b) =>
      isActive(b) && b.kind === "stay" && !!b.nights && !(b.roomId && rooms.has(b.roomId)) &&
      Array.from({ length: b.nights }, (_, i) => addDays(b.checkIn, i)).some((d) => set.has(d)),
  ).length;
}

// ---------- 재고 현황 기간 (14일 · 주 · 월 · 기간) ----------
export type StockPeriod = "d14" | "week" | "month" | "range";
export const STOCK_RANGE_MAX = 92; // 기간으로 볼 수 있는 최대 일수 (약 3개월)
export const isStockPeriod = (v: unknown): v is StockPeriod => v === "d14" || v === "week" || v === "month" || v === "range";
/** 그 주 월요일 (월~일) */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function dateList(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n) + 1 }, (_, i) => addDays(from, i));
}
/** 기간 고르기: 끝이 시작보다 앞이면 바꾸고, 너무 길면 시작부터 최대 일수까지만 */
export function clampRange(from: string, to: string, max = STOCK_RANGE_MAX): { from: string; to: string; swapped: boolean; capped: boolean } {
  let a = from;
  let b = to;
  const swapped = b < a;
  if (swapped) [a, b] = [b, a];
  const capped = daysBetween(a, b) + 1 > max;
  if (capped) b = addDays(a, max - 1);
  return { from: a, to: b, swapped, capped };
}
/**
 * 보이는 날짜 범위. anchor: 14일은 시작 날짜, 주·월은 그 안의 아무 날짜.
 * 기간은 custom [from, to]를 그대로(정리해서) 써요.
 */
export function stockRange(period: StockPeriod, anchor: string, custom?: { from: string; to: string }): { from: string; to: string } {
  if (period === "week") {
    const a = weekStart(anchor);
    return { from: a, to: addDays(a, 6) };
  }
  if (period === "month") return { from: monthStart(anchor), to: monthEnd(anchor) };
  if (period === "range" && custom) {
    const c = clampRange(custom.from, custom.to);
    return { from: c.from, to: c.to };
  }
  return { from: anchor, to: addDays(anchor, 13) };
}
/** ‹ › 한 번: 14일은 14일, 주는 7일, 월은 한 달, 기간은 같은 길이만큼 */
export function shiftStockAnchor(period: StockPeriod, anchor: string, dir: 1 | -1, custom?: { from: string; to: string }): string {
  if (period === "week") return addDays(weekStart(anchor), 7 * dir);
  if (period === "month") {
    const [y, m] = anchor.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
  }
  if (period === "range" && custom) return addDays(custom.from, (daysBetween(custom.from, custom.to) + 1) * dir);
  return addDays(anchor, 14 * dir);
}
/** '2026년 10월' 또는 '10/19(월) ~ 10/25(일)' (해가 다르면 연도도) */
export function stockRangeLabel(period: StockPeriod, from: string, to: string, today: string): string {
  if (period === "month") return `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`;
  const fy = from.slice(0, 4);
  const ty = to.slice(0, 4);
  const a = (fy !== today.slice(0, 4) || fy !== ty ? `${fy}. ` : "") + dayLabel(from);
  const b = (ty !== fy ? `${ty}. ` : "") + dayLabel(to);
  return `${a} ~ ${b}`;
}

// ---------- 현황판 탭 (재고 현황 | 객실 배치) ----------
export type BoardTab = "stock" | "rooms";
/** '#/board/rooms' → rooms, '#/board/stock' → stock, 그 밖에는 null (기기에 남긴 탭을 써요) */
export function boardTabFromHash(hash: string): BoardTab | null {
  const m = /^#\/board\/(stock|rooms)\/?$/.exec(hash);
  return m ? (m[1] as BoardTab) : null;
}

/** 저장 전 미리보기: 바뀌는 밤마다 '남은 객실 4 → 3' */
export function previewChange(
  s: HotelSettings,
  bookings: Booking[],
  draft: Booking,
): { date: string; typeId: string; before: number; after: number }[] {
  const prev = bookings.find((b) => b.id === draft.id);
  const after = bookings.filter((b) => b.id !== draft.id).concat(draft);
  const rooms = roomMap(s);
  const keys = new Map<string, { date: string; typeId: string }>();
  for (const b of [prev, draft]) {
    if (!b || !isActive(b) || b.kind !== "stay" || !b.nights) continue;
    const tid = effectiveTypeId(b, rooms);
    for (let i = 0; i < b.nights; i++) {
      const d = addDays(b.checkIn, i);
      keys.set(`${tid}@${d}`, { date: d, typeId: tid });
    }
  }
  const out = [...keys.values()]
    .map((k) => ({
      ...k,
      before: remaining(s, bookings, k.typeId, k.date),
      after: remaining(s, after, k.typeId, k.date),
    }))
    .filter((r) => r.before !== r.after);
  return out.sort((a, b) => (a.date === b.date ? a.typeId.localeCompare(b.typeId) : a.date < b.date ? -1 : 1));
}

// ---------- 보드 (방 번호 칸) ----------
/** 그 방·그 밤에 보여 줄 숙박: 살아 있는 예약이 우선, 없으면 취소된 예약을 줄 그어 보여 줘요. */
export function boardEntryForRoom(bookings: Booking[], roomId: string, date: string): Booking | null {
  let cancelled: Booking | null = null;
  for (const b of bookings) {
    if (b.roomId !== roomId || !occupiesNight(b, date)) continue;
    if (isActive(b)) return b;
    if (!cancelled || (b.cancelledAt ?? "") > (cancelled.cancelledAt ?? "")) cancelled = b;
  }
  return cancelled;
}

/**
 * 취소 예약이 보드에서 사라지는지: 그 자리(같은 방, 겹치는 밤)를 새 예약이 채웠으면 사라져요.
 * 방이 없던 취소는 같은 타입 숙박이 취소 뒤에 새로 들어와 겹치는 밤을 채우면 사라져요.
 */
export function isCancelledRefilled(c: Booking, bookings: Booking[], rooms: Map<string, Room>): boolean {
  if (isActive(c)) return false;
  return bookings.some((b) => {
    if (b.id === c.id || !isActive(b) || b.kind !== c.kind) return false;
    if (c.kind === "stay") {
      if (!nightsOverlap(b, c)) return false;
      if (c.roomId) return b.roomId === c.roomId;
      return (
        effectiveTypeId(b, rooms) === effectiveTypeId(c, rooms) &&
        b.createdAt > (c.cancelledAt ?? c.updatedAt)
      );
    }
    // 대실: 같은 날, 같은 방(또는 방 없음이면 같은 타입), 시간이 겹치면
    if (b.checkIn !== c.checkIn || !timesOverlap(b, c)) return false;
    if (c.roomId) return b.roomId === c.roomId;
    return b.typeId === c.typeId && b.createdAt > (c.cancelledAt ?? c.updatedAt);
  });
}

export function toMinutes(t: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function timeRange(b: Pick<Booking, "startTime" | "endTime">): [number, number] {
  const s = toMinutes(b.startTime);
  let e = toMinutes(b.endTime);
  if (e <= s) e += 1440; // 자정을 넘기는 대실
  return [s, e];
}
export function timesOverlap(a: Booking, b: Booking): boolean {
  const [as, ae] = timeRange(a);
  const [bs, be] = timeRange(b);
  return as < be && bs < ae;
}

export interface NightBoard {
  byRoom: Map<string, Booking>; // roomId -> 보여 줄 숙박
  unassigned: Booking[]; // 방을 아직 안 정한 숙박 (취소된 건 줄 그어 표시, 채워지면 숨김)
  dayuse: Booking[]; // 그날 대실 (시간순)
  nightCount: number; // 그날 밤 살아 있는 숙박 수
}
export function nightBoard(s: HotelSettings, bookings: Booking[], date: string): NightBoard {
  const rooms = roomMap(s);
  const byRoom = new Map<string, Booking>();
  for (const r of rooms.values()) {
    const b = boardEntryForRoom(bookings, r.id, date);
    if (b && (isActive(b) || !isCancelledRefilled(b, bookings, rooms))) byRoom.set(r.id, b);
  }
  const visible = (b: Booking) => isActive(b) || !isCancelledRefilled(b, bookings, rooms);
  const unassigned = bookings
    .filter((b) => b.kind === "stay" && occupiesNight(b, date) && (!b.roomId || !rooms.has(b.roomId)) && visible(b))
    .sort((a, b) => Number(!isActive(a)) - Number(!isActive(b)) || a.createdAt.localeCompare(b.createdAt));
  const dayuse = bookings
    .filter((b) => b.kind === "dayuse" && b.checkIn === date && visible(b))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const nightCount = bookings.filter((b) => isActive(b) && occupiesNight(b, date)).length;
  return { byRoom, unassigned, dayuse, nightCount };
}

/** 그 기간에 비어 있는 방 (수정 중인 예약 자신은 빼고 봐요) */
export function freeRooms(
  s: HotelSettings,
  bookings: Booking[],
  draft: Pick<Booking, "id" | "kind" | "checkIn" | "nights" | "startTime" | "endTime">,
): Set<string> {
  const free = new Set(allRooms(s).map((r) => r.id));
  for (const b of bookings) {
    if (b.id === draft.id || !isActive(b) || !b.roomId) continue;
    if (draft.kind === "stay") {
      if (b.kind === "stay" && nightsOverlap(b, draft)) free.delete(b.roomId);
    } else if (b.kind === "dayuse" && b.checkIn === draft.checkIn && timesOverlap(b, draft as Booking)) {
      free.delete(b.roomId);
    }
  }
  return free;
}

export function perNight(b: Pick<Booking, "price" | "nights">): number | null {
  return b.nights && b.nights > 1 ? Math.round(b.price / b.nights) : null;
}
export const won = (v: number) => v.toLocaleString("ko-KR");
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * 사람이 적은 시간을 HH:MM으로: "13:30", "1330", "930", "9:5", "13", "13시 30분", "오후 1:30", "1:30 PM".
 * 알아볼 수 없으면 "" 를 돌려줘요.
 */
export function parseTime(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "";
  const pm = /오후|pm|p\.m\./.test(v);
  const am = /오전|am|a\.m\./.test(v);
  let h: number;
  let m: number;
  const sep = /^\D*(\d{1,2})\s*(?::|시|\.|h)\s*(\d{1,2})?\s*분?\D*$/.exec(v);
  if (sep) {
    h = Number(sep[1]);
    m = sep[2] ? Number(sep[2]) : 0;
  } else {
    const d = v.replace(/\D/g, "");
    if (!d || d.length > 4) return "";
    if (d.length <= 2) [h, m] = [Number(d), 0];
    else [h, m] = [Number(d.slice(0, d.length - 2)), Number(d.slice(-2))];
  }
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h === 24 && m === 0) h = 0;
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/** HH:MM + 분 (자정을 넘기면 다음날 시각) */
export function addMinutesToTime(t: string, min: number): string {
  if (!TIME_RE.test(t)) return "";
  const [a, b] = t.split(":").map(Number);
  const x = (((a * 60 + b + min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}
/** 시작~끝 이용 시간(분). 끝이 시작보다 이르면 자정을 넘긴 것으로 봐요 */
export function dayuseMinutes(start: string, end: string): number | null {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const s = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  let e = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  if (e <= s) e += 1440;
  return e - s;
}
/** 기기 시각을 가장 가까운 5분으로 (13:32 → 13:30, 13:33 → 13:35) */
export function nowRounded(d: Date = new Date(), step = 5): string {
  const x = Math.round((d.getHours() * 60 + d.getMinutes()) / step) * step;
  return addMinutesToTime("00:00", x);
}

export function validateBooking(b: Booking, s: HotelSettings): string | null {
  if (!s.platforms.some((p) => p.id === b.platformId)) return "플랫폼을 골라 주세요.";
  if (!s.types.some((t) => t.id === b.typeId && typeLabel(t))) return "객실 타입을 골라 주세요.";
  if (!b.guestName.trim()) return "손님 이름을 적어 주세요.";
  if (!Number.isFinite(b.price) || b.price < 0) return "판매 가격을 적어 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.checkIn)) return "입실 날짜를 골라 주세요.";
  if (b.kind === "stay") {
    if (!b.nights || b.nights < 1 || b.nights > 90) return "박수는 1~90박 사이로 적어 주세요.";
  } else {
    if (!b.startTime || !b.endTime || !TIME_RE.test(b.startTime) || !TIME_RE.test(b.endTime))
      return "대실은 이용 시간을 꼭 적어 주세요. 예: 12:00~14:00";
    if (b.startTime === b.endTime) return "대실 시작과 끝 시간이 같아요.";
  }
  return null;
}

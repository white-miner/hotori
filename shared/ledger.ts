// HOTORI v3 · 예약 장부 핵심 규칙 (화면과 테스트가 같이 써요)
// 남은 객실(타입, 날짜) = 그 타입 방 수 − 그날 밤을 차지한 숙박 예약 수
// - 숙박 N박 = 입실 날짜부터 N개의 밤. 퇴실하는 날 밤은 비어요.
// - 대실은 계산에 넣지 않아요. 취소·노쇼도 빠져요.
// - 방을 정했으면 실제 방의 타입에서, 안 정했으면 판 타입에서 빼요.

export type Kind = "stay" | "dayuse";
export type Status = "active" | "cancelled" | "noshow";

export interface RoomType {
  id: string;
  code: string; // 최대 3글자, 예: S, SD
  name: string;
}
export interface Room {
  id: string;
  no: string; // 방 번호 또는 이름 (예: 601, 방갈로)
  typeId: string | null;
  color?: string | null;
}
export interface Floor {
  id: string;
  name: string; // 예: 6층
  color?: string | null;
  rooms: Room[];
}
export interface Platform {
  id: string;
  name: string;
  abbr: string; // 한 글자 약자
}
export interface HotelSettings {
  floors: Floor[];
  types: RoomType[];
  platforms: Platform[];
  lowThreshold: number;
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

export function emptySettings(): HotelSettings {
  return { floors: [], types: [], platforms: [], lowThreshold: 2 };
}
export function normalizeSettings(raw: unknown): HotelSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<HotelSettings>;
  const th = Number(s.lowThreshold);
  return {
    floors: Array.isArray(s.floors)
      ? s.floors.map((f) => ({ ...f, rooms: Array.isArray(f.rooms) ? f.rooms : [] }))
      : [],
    types: Array.isArray(s.types) ? s.types : [],
    platforms: Array.isArray(s.platforms) ? s.platforms : [],
    lowThreshold: Number.isInteger(th) && th >= 0 && th <= 20 ? th : 2,
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

// ---------- 방·타입 ----------
export function allRooms(s: HotelSettings): (Room & { floorId: string })[] {
  return s.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floorId: f.id })));
}
export function roomMap(s: HotelSettings) {
  return new Map(allRooms(s).map((r) => [r.id, r]));
}
export function typeTotals(s: HotelSettings): Map<string, number> {
  const m = new Map<string, number>(s.types.map((t) => [t.id, 0]));
  for (const r of allRooms(s)) if (r.typeId && m.has(r.typeId)) m.set(r.typeId, m.get(r.typeId)! + 1);
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
export function stockTable(s: HotelSettings, bookings: Booking[], dates: string[]): StockTable {
  const totals = typeTotals(s);
  const rooms = roomMap(s);
  const table: StockTable = new Map();
  for (const t of s.types) table.set(t.id, new Map(dates.map((d) => [d, totals.get(t.id) ?? 0])));
  const dateSet = new Set(dates);
  for (const b of bookings) {
    if (!isActive(b) || b.kind !== "stay" || !b.nights) continue;
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

export function validateBooking(b: Booking, s: HotelSettings): string | null {
  if (!s.platforms.some((p) => p.id === b.platformId)) return "플랫폼을 골라 주세요.";
  if (!s.types.some((t) => t.id === b.typeId)) return "객실 타입을 골라 주세요.";
  if (!b.guestName.trim()) return "이름을 적어 주세요.";
  if (!Number.isFinite(b.price) || b.price < 0) return "판매가격을 적어 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.checkIn)) return "입실 날짜를 골라 주세요.";
  if (b.kind === "stay") {
    if (!b.nights || b.nights < 1 || b.nights > 90) return "박수는 1~90박이에요.";
  } else {
    if (!b.startTime || !b.endTime || !TIME_RE.test(b.startTime) || !TIME_RE.test(b.endTime))
      return "대실은 이용시간을 꼭 적어 주세요. 예: 12:00~14:00";
    if (b.startTime === b.endTime) return "대실 시작과 끝 시간이 같아요.";
  }
  return null;
}

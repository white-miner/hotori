// 단체 기간 연장: 객실마다 직전 박 금액을 제안하고, 총액을 나누거나 다른 객실에 복사하지 않습니다.
// 저장 값은 기존 열(nights, night_rates, price, open_ended, room)만 바꿉니다. 결제 줄은 건드리지 않습니다.
import {
  type Booking,
  type HotelSettings,
  type RoomSegment,
  STAY_NIGHTS_MAX,
  addDays,
  daysBetween,
  fitSegments,
  isEarlyOut,
  occupiesRoom,
  roomOnNight,
} from "./ledger";
import { lastNightRate } from "./extend";
import { stayAddons } from "./extend";
import { extrasTotal, occupiedNightDates, stayNightRatesToJson, type StayNightRates } from "./nightrates";
import { planStayEnd } from "./stayEndPlan";

export type ExtendMode = { kind: "plus"; add: number } | { kind: "date"; out: string } | { kind: "open" };

export interface ExtendClash {
  date: string;
  roomId: string;
  otherId: string;
  otherName: string;
}

export interface ExtendNightLine {
  date: string;
  /** null = 아직 없음. 새 박은 직전 박 금액이 들어가고, 예전 빈 칸은 비워 둡니다. */
  amount: number | null;
  proposed: boolean;
}

export interface RoomExtendPlan {
  bookingId: string;
  guestName: string;
  roomId: string | null;
  typeId: string;
  lock: string | null;
  inHouse: boolean;
  fromNights: number;
  toNights: number;
  checkOut: string;
  openEnded: boolean;
  lines: ExtendNightLine[];
  extensionCharge: number;
  price: number;
  nightRates: StayNightRates | null;
  segments: RoomSegment[] | null;
  error: string | null;
  clashes: ExtendClash[];
  /** 박수·퇴실 미정·호실 중 하나라도 바뀜 */
  changed: boolean;
}

export interface GroupExtendPlan {
  rooms: RoomExtendPlan[];
  /** 선택된 객실의 늘어난 청구 (0 미만은 0으로 자름, 객실끼리 상계하지 않음) */
  extensionCharge: number;
  /** 저장 가능한 객실 */
  ready: RoomExtendPlan[];
}

export function inHouseMember(b: Booking, today: string): boolean {
  if (b.status !== "active" || b.kind !== "stay" || b.checkedOutAt || isEarlyOut(b) || b.stayMode === "long_stay") return false;
  if (!b.arrived || !b.nights) return false;
  return b.checkIn <= today && addDays(b.checkIn, b.nights) > today;
}

function lockReason(b: Booking): string | null {
  if (b.status !== "active") return "취소·노쇼 예약";
  if (b.kind !== "stay") return "대실 예약";
  if (b.checkedOutAt || isEarlyOut(b)) return "이미 퇴실한 예약";
  if (b.stayMode === "long_stay") return "장기 투숙은 여기서 연장하지 않아요";
  if (!b.nights) return "이용 기간 확인 필요";
  return null;
}

function targetNights(b: Booking, mode: ExtendMode, today: string): { nights: number; openEnded: boolean; error: string | null } {
  const n0 = b.nights ?? 1;
  if (mode.kind === "open") {
    const plan = planStayEnd(b, null, today);
    if (!plan.patch) return { nights: n0, openEnded: true, error: plan.reason };
    return { nights: plan.patch.nights ?? n0, openEnded: true, error: null };
  }
  if (mode.kind === "plus") {
    const add = Math.round(mode.add);
    if (!Number.isInteger(add) || add < 1) return { nights: n0, openEnded: false, error: "늘릴 박수를 확인해 주세요." };
    const nights = n0 + add;
    if (nights > STAY_NIGHTS_MAX) return { nights: n0, openEnded: false, error: `최대 ${STAY_NIGHTS_MAX}박까지예요.` };
    return { nights, openEnded: false, error: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mode.out)) return { nights: n0, openEnded: false, error: "퇴실일을 골라 주세요." };
  const nights = daysBetween(b.checkIn, mode.out);
  if (nights < n0) return { nights: n0, openEnded: false, error: "지금 퇴실일보다 이릅니다. 이 객실은 빼거나 더 늦은 날짜를 고르세요." };
  if (nights > STAY_NIGHTS_MAX) return { nights: n0, openEnded: false, error: `최대 ${STAY_NIGHTS_MAX}박까지예요.` };
  return { nights, openEnded: false, error: null };
}

function amountFor(
  b: Booking,
  date: string,
  isNew: boolean,
  edits: Record<string, number | null> | undefined,
): { amount: number | null; proposed: boolean } {
  if (edits && Object.prototype.hasOwnProperty.call(edits, date)) {
    const v = edits[date];
    return { amount: v == null ? null : Math.round(v), proposed: false };
  }
  const own = b.nightRates?.nights?.[date];
  if (typeof own === "number") return { amount: Math.round(own), proposed: false };
  if (isNew) return { amount: lastNightRate(b), proposed: true };
  return { amount: null, proposed: false };
}

function clashesOf(all: Booking[], b: Booking, nights: number, roomId: string | null, fromNights: number): ExtendClash[] {
  if (!roomId) return [];
  const moved = roomId !== (b.roomId ?? null);
  const hits: ExtendClash[] = [];
  for (let i = 0; i < nights; i++) {
    if (!moved && i < fromNights) continue;
    const date = addDays(b.checkIn, i);
    for (const other of all) {
      if (other.id === b.id || !occupiesRoom(other) || other.kind !== "stay") continue;
      if (roomOnNight(other, date) === roomId) hits.push({ date, roomId, otherId: other.id, otherName: other.guestName });
    }
  }
  return hits;
}

function priceOf(b: Booking, nights: number, lines: ExtendNightLine[]): { price: number; nightRates: StayNightRates | null; error: string | null } {
  const missing = lines.find((l) => l.amount == null || !Number.isSafeInteger(l.amount) || l.amount < 0 || l.amount > 100_000_000);
  if (missing) return { price: b.price, nightRates: b.nightRates ?? null, error: `${missing.date} 숙박 요금을 입력해 주세요.` };
  const map: Record<string, number> = {};
  for (const l of lines) map[l.date] = l.amount!;
  const oldDates = occupiedNightDates(b.checkIn, b.nights ?? 0);
  const oldSum = oldDates.reduce((n, d) => n + (typeof b.nightRates?.nights?.[d] === "number" ? b.nightRates!.nights![d]! : 0), 0);
  const complete = oldDates.every((d) => typeof b.nightRates?.nights?.[d] === "number");
  const adjustment = complete ? b.price - oldSum - extrasTotal(b.nightRates) : stayAddons(b);
  const extras = b.nightRates?.extras?.map((x) => (x.perNight ? { ...x, amount: x.perNight * nights } : { ...x }));
  const nightRates: StayNightRates = { ...b.nightRates, nights: map, ...(extras ? { extras } : {}) };
  const price = Object.values(map).reduce((n, v) => n + v, 0) + extrasTotal(nightRates) + adjustment;
  if (!Number.isSafeInteger(price) || price < 0 || price > 100_000_000) {
    return { price: b.price, nightRates, error: "객실 총액은 0원~1억원이어야 합니다." };
  }
  return { price, nightRates, error: null };
}

export function planGroupPeriodExtend(input: {
  all: readonly Booking[];
  members: readonly Booking[];
  selected: ReadonlySet<string>;
  mode: ExtendMode;
  today: string;
  /** bookingId → 날짜 → 금액. 없는 날짜는 제안·기존 값을 씁니다. */
  edits?: Record<string, Record<string, number | null>>;
  /** bookingId → 바꿀 호실. 없으면 지금 호실. */
  rooms?: Record<string, string | null>;
}): GroupExtendPlan {
  const rooms: RoomExtendPlan[] = input.members.map((b) => {
    const lock = lockReason(b);
    const inHouse = inHouseMember(b, input.today);
    const fromNights = b.nights ?? 0;
    const base: RoomExtendPlan = {
      bookingId: b.id,
      guestName: b.guestName,
      roomId: b.roomId,
      typeId: b.typeId,
      lock,
      inHouse,
      fromNights,
      toNights: fromNights,
      checkOut: addDays(b.checkIn, fromNights || 1),
      openEnded: !!b.openEnded,
      lines: [],
      extensionCharge: 0,
      price: b.price,
      nightRates: b.nightRates ?? null,
      segments: b.segments ?? null,
      error: lock,
      clashes: [],
      changed: false,
    };
    if (lock || !input.selected.has(b.id)) return base;
    if ((input.rooms?.[b.id] ?? b.roomId) !== b.roomId && b.segments?.length) {
      return { ...base, error: "객실을 옮겨 둔 예약은 여기서 호실을 바꾸지 못해요. 이 객실은 빼 주세요." };
    }
    const target = targetNights(b, input.mode, input.today);
    if (target.error) return { ...base, error: target.error };
    const dates = occupiedNightDates(b.checkIn, target.nights);
    const oldSet = new Set(occupiedNightDates(b.checkIn, fromNights));
    const edits = input.edits?.[b.id];
    const lines = dates.map((date) => {
      const cell = amountFor(b, date, !oldSet.has(date), edits);
      return { date, ...cell };
    });
    const priced = priceOf(b, target.nights, lines);
    const roomId = input.rooms?.[b.id] ?? b.roomId ?? null;
    const segments = target.nights === fromNights && roomId === b.roomId ? b.segments ?? null : fitSegments(b.segments, roomId, target.nights);
    const clashes = priced.error ? [] : clashesOf(input.all as Booking[], b, target.nights, roomId, roomId === (b.roomId ?? null) ? fromNights : 0);
    const delta = priced.price - b.price;
    const changed = target.nights !== fromNights || target.openEnded !== !!b.openEnded || roomId !== (b.roomId ?? null);
    return {
      ...base,
      roomId,
      toNights: target.nights,
      checkOut: addDays(b.checkIn, target.nights),
      openEnded: target.openEnded,
      lines,
      extensionCharge: Math.max(0, delta),
      price: priced.error ? b.price : priced.price,
      nightRates: priced.nightRates,
      segments,
      error: priced.error,
      clashes,
      changed,
    };
  });
  const chosen = rooms.filter((r) => input.selected.has(r.bookingId) && !r.lock);
  const ready = chosen.filter((r) => r.changed && !r.error && r.clashes.length === 0);
  return {
    rooms,
    extensionCharge: chosen.reduce((n, r) => n + r.extensionCharge, 0),
    ready,
  };
}

export interface ExtendWriteLine {
  id: string;
  nights: number;
  price: number;
  night_rates: StayNightRates | null;
  open_ended: boolean;
  room_id: string | null;
  room_segments: { room: string; nights: number }[] | null;
  updated_at: string;
}

/** DB 함수에 넘길 줄. 결제 열은 없습니다. */
export function extendWriteLines(before: readonly Booking[], ready: readonly RoomExtendPlan[]): ExtendWriteLine[] {
  return ready.map((r) => {
    const b = before.find((x) => x.id === r.bookingId);
    return {
      id: r.bookingId,
      nights: r.toNights,
      price: r.price,
      night_rates: stayNightRatesToJson(r.nightRates),
      open_ended: r.openEnded,
      room_id: r.roomId,
      room_segments: r.segments?.map((x) => ({ room: x.roomId, nights: x.nights })) ?? null,
      updated_at: b?.updatedAt ?? "",
    };
  });
}

/** 겹침을 풀 수 있는 같은 타입 빈 호실. */
export function extendRoomChoices(s: HotelSettings, all: readonly Booking[], room: RoomExtendPlan, self: Booking): { id: string; no: string }[] {
  const out: { id: string; no: string }[] = [];
  for (const f of s.floors) {
    for (const rm of f.rooms) {
      if (rm.typeId !== room.typeId || rm.id === room.roomId) continue;
      const hits = clashesOf(all as Booking[], self, room.toNights, rm.id, 0);
      if (!hits.length) out.push({ id: rm.id, no: rm.no });
    }
  }
  return out;
}

export function extendMemo(ready: readonly RoomExtendPlan[]): string {
  const dates: string[] = [];
  for (const r of ready) {
    const start = r.lines[0]?.date;
    const oldLast = start && r.fromNights > 0 ? addDays(start, r.fromNights - 1) : "";
    for (const l of r.lines) if (!oldLast || l.date > oldLast) dates.push(l.date);
  }
  if (!dates.length) return ready.some((r) => r.openEnded) ? "기간 연장 (퇴실 미정)" : "기간 연장";
  dates.sort();
  const from = dates[0]!.slice(5).replace("-", "/");
  const to = dates[dates.length - 1]!.slice(5).replace("-", "/");
  return (from === to ? `기간 연장 (${from})` : `기간 연장 (${from}~${to})`).slice(0, 40);
}

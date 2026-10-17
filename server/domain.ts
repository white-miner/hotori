import type {
  AppState,
  Attendance,
  Audit,
  Channel,
  Command,
  CommandResult,
  Limits,
  Member,
  OperationSettings,
  PaymentMethod,
  Plan,
  Report,
  Reservation,
  Room,
  RoomIssue,
  RoomType,
} from "../shared/types.js";
import { randomUUID } from "node:crypto";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function fail(code: string, message: string, status = 400): never {
  throw new DomainError(code, message, status);
}
export function dateValue(value: unknown, name = "날짜"): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    return fail("INVALID_DATE", `${name}를 올바르게 입력해 주세요.`);
  return value;
}
export const todayKST = (instant = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
// Hotel business day rolls over at 06:00 Asia/Seoul. Between midnight and the cutoff, a guest of the previous business date may still check in late.
export const BUSINESS_DAY_CUTOFF_HOUR = 6;
export function lateArrivalDate(today: string, now: string): string | null {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime()) || todayKST(instant) !== today)
    return null;
  const business = todayKST(
    new Date(instant.getTime() - BUSINESS_DAY_CUTOFF_HOUR * 3600000),
  );
  return business < today ? business : null;
}
export function addDays(day: string, count: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function addMonths(day: string, count: number) {
  const d = new Date(day + "T00:00:00Z");
  const original = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + count);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(original, last));
  return d.toISOString().slice(0, 10);
}
export function nights(start: string, end: string) {
  const n = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (!Number.isInteger(n) || n < 1 || n > 366)
    return fail(
      "INVALID_STAY",
      "체크아웃은 체크인 다음 날부터, 최대 366박까지 가능합니다.",
    );
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}
const overlap = (a: string, b: string, c: string, d: string) => a < d && c < b;
const text = (v: unknown, name: string, max = 100, optional = false) => {
  if (optional && (v === undefined || v === "")) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max)
    return fail("INVALID_INPUT", `${name}: 1~${max}자로 입력해 주세요.`);
  return v.trim();
};
const integer = (v: unknown, name: string, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    return fail(
      "INVALID_INPUT",
      `${name}: ${min}~${max} 사이 정수를 입력해 주세요.`,
    );
  return v;
};
const choice = <T extends string>(
  v: unknown,
  items: readonly T[],
  name: string,
): T => {
  if (typeof v !== "string" || !items.includes(v as T))
    return fail("INVALID_INPUT", `${name} 값이 올바르지 않습니다.`);
  return v as T;
};
const id = () => randomUUID();
/** mutate가 받은 서버 시각. 시간 계산을 한 요청 안에서 같게 맞춥니다. */
let NOW_MS = Date.now();
export interface DatabaseState {
  property: AppState["property"];
  plan: Plan;
  rooms: Room[];
  roomTypes: RoomType[];
  channels: Channel[];
  reservations: Reservation[];
  issues: RoomIssue[];
  members: Member[];
  attendance: Attendance[];
  audit: Audit[];
  revision: number;
  /** 대실·입퇴실 시간 설정. 예전 데이터에는 없을 수 있습니다. */
  settings?: Partial<OperationSettings>;
  /** 층 색 ("건물동|층" → #RRGGBB). 예전 데이터에는 없을 수 있습니다. */
  floorColors?: Record<string, string>;
  /** 마지막 한 번 누르는 작업 되돌리기 정보 (화면에는 보내지 않습니다) */
  undo?: UndoRecord;
}
export interface UndoRecord {
  token: string;
  revision: number;
  at: string;
  action: string;
  targetId: string;
  before: string;
}
/** 화면은 5초 동안 되돌리기를 보여 주고, 서버는 네트워크 지연을 감안해 조금 더 기다립니다. */
export const UNDO_WINDOW_MS = 15000;
export const UNDO_UI_MS = 5000;
const UNDOABLE = new Set([
  "reservation.checkin",
  "reservation.checkout",
  "reservation.walkin",
  "reservation.assign",
  "reservation.cancel",
  "room.update",
]);
export const DEFAULT_SETTINGS: OperationSettings = {
  baseHours: 4,
  extraHourFee: 10000,
  cleaningMinutes: 30,
  checkInTime: "15:00",
  checkOutTime: "11:00",
};
export const DEFAULT_HOURLY_RATE: Record<string, number> = {
  standard: 35000,
  deluxe: 45000,
  suite: 60000,
};
export function settingsOf(s: DatabaseState): OperationSettings {
  return { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
}
export function hourlyRateOf(type: RoomType): number {
  return (
    type.hourlyRate ??
    DEFAULT_HOURLY_RATE[type.id] ??
    Math.round((type.baseRate * 0.4) / 1000) * 1000
  );
}
export const isHourly = (r: Reservation) => r.stayType === "hourly";
const isNightly = (r: Reservation) => r.stayType !== "hourly";
/** 한국 시간 날짜+시각 → epoch ms */
export const kstMs = (day: string, hm: string) =>
  Date.parse(`${day}T${hm}:00+09:00`);
/** 06시 기준 영업일 (Asia/Seoul) */
export const businessDateOf = (instant: string | Date) =>
  todayKST(
    new Date(new Date(instant).getTime() - BUSINESS_DAY_CUTOFF_HOUR * 3600000),
  );
const HEX = /^#[0-9a-fA-F]{6}$/;
const colorValue = (v: unknown, name: string) => {
  if (typeof v !== "string" || !HEX.test(v))
    return fail("INVALID_COLOR", `${name}은 #RRGGBB 형식으로 골라 주세요.`);
  return v.toUpperCase();
};
const timeValue = (v: unknown, name: string) => {
  if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
    return fail("INVALID_INPUT", `${name}: HH:MM 형식으로 입력해 주세요.`);
  return v;
};
/** 숙박 예약이 그 방을 쓰는 시간 범위 (입실일 입실 시각 ~ 퇴실일 퇴실 시각) */
function nightWindow(s: DatabaseState, r: Reservation, nowMs: number) {
  const o = settingsOf(s);
  const start = kstMs(r.checkIn, o.checkInTime);
  let end = kstMs(r.checkOut, o.checkOutTime);
  // 퇴실 처리 전인 투숙객은 실제로 나갈 때까지 방을 쓰고 있습니다.
  if (r.status === "checked_in") end = Math.max(end, nowMs + 60000);
  return { start, end };
}
function hourlyWindow(s: DatabaseState, r: Reservation, nowMs: number) {
  const start = Date.parse(r.startAt!);
  let end = Date.parse(r.endAt!);
  if (r.status === "checked_in") end = Math.max(end, nowMs + 60000);
  return { start, end };
}
const live = (r: Reservation) =>
  r.status === "confirmed" || r.status === "checked_in";
/** 그 날 밤(입실 시각 이후)까지 대실로 쓰이는 같은 타입 객실 */
function hourlyRoomsAtNight(
  s: DatabaseState,
  typeId: string,
  day: string,
  nowMs: number,
  exclude?: string,
) {
  const o = settingsOf(s);
  const nightStart = kstMs(day, o.checkInTime);
  const nightEnd = kstMs(addDays(day, 1), o.checkOutTime);
  const rooms = new Set<string>();
  for (const r of s.reservations) {
    if (r.id === exclude || !isHourly(r) || !live(r) || r.typeId !== typeId)
      continue;
    const w = hourlyWindow(s, r, nowMs);
    if (w.start < nightEnd && w.end > nightStart)
      r.roomIds.forEach((id) => rooms.add(id));
  }
  return rooms;
}
export function limits(s: DatabaseState, today: string): Limits {
  const months = s.plan === "pro" ? 6 : 1;
  return {
    months,
    historyStart: addMonths(today, -months),
    futureEnd: addMonths(today, months),
    maxRooms: s.plan === "pro" ? null : 20,
    maxOpenIssues: s.plan === "pro" ? 30 : 1,
    periodReports: s.plan === "pro",
    attendance: s.plan === "pro",
    newSalesBlocked: s.plan === "free" && s.rooms.length > 20,
  };
}
export function seed(today: string, now?: string): DatabaseState {
  const roomTypes = [
    { id: "standard", name: "스탠다드", baseRate: 80000, hourlyRate: 35000 },
    { id: "deluxe", name: "디럭스", baseRate: 110000, hourlyRate: 45000 },
    { id: "suite", name: "스위트", baseRate: 160000, hourlyRate: 60000 },
  ];
  const channels = [
    { id: "direct", name: "직접 예약", feeBps: 0, color: "#527d64" },
    { id: "booking", name: "부킹닷컴", feeBps: 1500, color: "#5479bc" },
    { id: "agoda", name: "아고다", feeBps: 1500, color: "#a98054" },
    { id: "walkin", name: "현장 방문", feeBps: 0, color: "#9a78ab" },
  ];
  const rooms: Room[] = Array.from({ length: 16 }, (_, i) => ({
    id: `room-${Math.floor(i / 4) + 2}${(i % 4) + 1 < 10 ? "0" : ""}${(i % 4) + 1}`,
    number: `${Math.floor(i / 4) + 2}0${(i % 4) + 1}`,
    building: "본관",
    floor: Math.floor(i / 4) + 2,
    typeId: i < 8 ? "standard" : i < 14 ? "deluxe" : "suite",
    cleaning: ([3, 6, 10].includes(i)
      ? "dirty"
      : i === 9
        ? "cleaning"
        : "clean") as Room["cleaning"],
    facility: i === 15 ? "blocked" : "normal",
    version: 1,
  }));
  if (now) {
    // 예시 데이터: 청소 대기·진행 중인 방이 언제부터 그랬는지 보여 줘요.
    const t0 = Date.parse(now);
    rooms.forEach((room, i) => {
      if (room.cleaning === "dirty")
        room.cleaningSince = new Date(t0 - (12 + i * 4) * 60000).toISOString();
      if (room.cleaning === "cleaning")
        room.cleaningSince = new Date(t0 - 9 * 60000).toISOString();
    });
  }
  const reservations: Reservation[] = [];
  const make = (
    n: number,
    guest: string,
    typeId: string,
    ci: number,
    co: number,
    roomNumbers: string[],
    status: Reservation["status"],
    channelId: string,
    rate: number,
  ) => {
    const quantity = Math.max(1, roomNumbers.length);
    const start = addDays(today, ci),
      end = addDays(today, co);
    const total = quantity * nights(start, end).length * rate;
    const feeBps = channels.find((c) => c.id === channelId)!.feeBps;
    const fee = Math.floor((total * feeBps + 5000) / 10000);
    reservations.push({
      id: `demo-${n}`,
      guestName: guest,
      phone: "010-0000-" + String(n).padStart(4, "0"),
      typeId,
      quantity,
      checkIn: start,
      checkOut: end,
      channelId,
      nightlyRate: rate,
      totalAmount: total,
      feeAmount: fee,
      feeBps,
      netAmount: total - fee,
      status,
      roomIds: roomNumbers.map(
        (number) => rooms.find((r) => r.number === number)!.id,
      ),
      memo: "가상 손님 · 실제 예약이 아닙니다",
      version: 1,
      createdAt: today + "T00:00:00Z",
      createdPlan: "free",
    });
  };
  make(
    1,
    "김하늘 (예시)",
    "standard",
    -1,
    1,
    ["201"],
    "checked_in",
    "booking",
    80000,
  );
  make(
    2,
    "이서준 (예시)",
    "standard",
    -2,
    0,
    ["202"],
    "checked_in",
    "direct",
    80000,
  );
  make(
    3,
    "박지우 (예시)",
    "standard",
    0,
    2,
    ["203"],
    "confirmed",
    "agoda",
    85000,
  );
  make(4, "최도윤 (예시)", "standard", 0, 1, [], "confirmed", "walkin", 80000);
  make(5, "정유진 (예시)", "standard", 0, 1, [], "confirmed", "direct", 80000);
  make(
    6,
    "윤서아 (예시)",
    "deluxe",
    -1,
    2,
    ["401"],
    "checked_in",
    "booking",
    110000,
  );
  make(7, "한시온 (예시)", "deluxe", 0, 1, [], "confirmed", "agoda", 115000);
  make(
    8,
    "오지안 (예시)",
    "deluxe",
    0,
    2,
    ["404"],
    "confirmed",
    "direct",
    110000,
  );
  make(
    9,
    "임수빈 (예시)",
    "suite",
    -1,
    1,
    ["503"],
    "checked_in",
    "direct",
    160000,
  );
  make(
    10,
    "문태오 (예시)",
    "standard",
    1,
    3,
    [],
    "confirmed",
    "booking",
    90000,
  );
  make(
    11,
    "강예린 (예시)",
    "deluxe",
    -5,
    -3,
    ["401"],
    "checked_out",
    "agoda",
    105000,
  );
  make(
    12,
    "조민준 (예시)",
    "standard",
    -3,
    -2,
    ["201"],
    "checked_out",
    "direct",
    80000,
  );
  // 화면 확인용 대실 예시: 서버를 처음 켤 때의 시각 기준으로 만듭니다.
  if (now && Number.isFinite(Date.parse(now))) {
    const base = Date.parse(now);
    const hourly = (
      n: number,
      guest: string,
      number: string,
      startOffsetMin: number,
      hours: number,
      status: Reservation["status"],
      channelId: string,
    ) => {
      const room = rooms.find((r) => r.number === number)!;
      const startAt = new Date(base + startOffsetMin * 60000).toISOString();
      const endAt = new Date(
        Date.parse(startAt) + hours * 3600000,
      ).toISOString();
      const day = businessDateOf(startAt);
      const rate =
        roomTypes.find((t) => t.id === room.typeId)!.hourlyRate ?? 35000;
      const feeBps = channels.find((c) => c.id === channelId)!.feeBps;
      const fee = Math.floor((rate * feeBps + 5000) / 10000);
      reservations.push({
        id: `demo-h${n}`,
        guestName: guest,
        phone: "",
        typeId: room.typeId,
        quantity: 1,
        checkIn: day,
        checkOut: addDays(day, 1),
        channelId,
        nightlyRate: rate,
        totalAmount: rate,
        feeAmount: fee,
        feeBps,
        netAmount: rate - fee,
        status,
        roomIds: [room.id],
        memo: "가상 대실 손님 · 실제 예약이 아닙니다",
        version: 1,
        createdAt: now,
        createdPlan: "free",
        stayType: "hourly",
        startAt,
        endAt,
        hours,
        payment: "card",
        checkedInAt: status === "checked_in" ? startAt : undefined,
      });
    };
    hourly(21, "강민서 (예시)", "301", -230, 4, "checked_in", "walkin");
    hourly(22, "이준호 (예시)", "502", -140, 4, "checked_in", "walkin");
    hourly(23, "송태윤 (예시)", "304", 75, 3, "confirmed", "direct");
  }
  return {
    property: {
      id: "demo-hotel",
      name: "호토리 데모 호텔",
      tagline: "호텔 운영의 모든 순간을, 곁에서",
      timezone: "Asia/Seoul",
      demo: true,
    },
    plan: "free",
    rooms,
    roomTypes,
    channels,
    reservations,
    issues: [
      {
        id: "issue-1",
        roomId: rooms[15].id,
        title: "에어컨 점검 필요",
        detail:
          "냉방 소음 점검 중입니다. 수리 후 판매 재개를 별도로 확인해 주세요. (가상 예시)",
        category: "repair",
        priority: "urgent",
        status: "in_progress",
        createdAt: today + "T00:00:00Z",
        version: 1,
      },
      {
        id: "issue-2",
        roomId: rooms[6].id,
        title: "침구 교체 요청",
        detail: "객실 정비 시 여분 침구를 확인해 주세요. (가상 예시)",
        category: "condition",
        priority: "normal",
        status: "open",
        createdAt: today + "T01:00:00Z",
        version: 1,
      },
    ],
    members: [
      {
        id: "member-owner",
        name: "김운영 (예시)",
        role: "owner",
        active: true,
      },
      {
        id: "member-front",
        name: "이프런트 (예시)",
        role: "front",
        active: true,
      },
      {
        id: "member-house",
        name: "박정비 (예시)",
        role: "housekeeping",
        active: true,
      },
    ],
    attendance: [],
    settings: { ...DEFAULT_SETTINGS },
    floorColors: {},
    audit: [
      {
        id: id(),
        action: "데모 데이터 생성",
        targetId: "demo-hotel",
        actor: "로컬 데모 운영자",
        at: new Date().toISOString(),
      },
    ],
    revision: 1,
  };
}
const active = (r: Reservation) => r.status !== "cancelled";
// A checked-in stay past its scheduled checkout date still occupies its rooms through tonight until checkout is recorded.
const overdue = (r: Reservation, today: string) =>
  r.stayType !== "hourly" && r.status === "checked_in" && r.checkOut < today;
const stayEnd = (r: Reservation, today: string) =>
  overdue(r, today) ? addDays(today, 1) : r.checkOut;
const getReservation = (s: DatabaseState, d: Record<string, unknown>) => {
  const r = s.reservations.find((r) => r.id === d.id);
  if (!r) return fail("NOT_FOUND", "예약을 찾을 수 없습니다.", 404);
  if (r.version !== d.version)
    return fail(
      "VERSION_CONFLICT",
      "다른 화면에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      409,
    );
  return r;
};
function checkAccess(s: DatabaseState, r: Reservation, today: string) {
  if (r.checkOut <= limits(s, today).historyStart && r.status !== "checked_in")
    fail(
      "HISTORY_LIMIT",
      "현재 플랜의 과거 예약 조회 기간을 벗어났습니다.",
      403,
    );
}
function checkRange(
  s: DatabaseState,
  start: string,
  end: string,
  today: string,
) {
  const l = limits(s, today);
  if (start < l.historyStart || end > l.futureEnd)
    fail(
      "PLAN_DATE_LIMIT",
      `현재 플랜 예약 범위는 ${l.historyStart}~${l.futureEnd} 체크아웃까지입니다.`,
      403,
    );
}
function ensureInventory(
  s: DatabaseState,
  candidate: Reservation,
  today: string,
  exclude?: string,
) {
  const nowMs = NOW_MS;
  for (const day of nights(candidate.checkIn, candidate.checkOut)) {
    const capacity =
      s.rooms.filter(
        (r) => r.typeId === candidate.typeId && r.facility !== "blocked",
      ).length -
      hourlyRoomsAtNight(s, candidate.typeId, day, nowMs, exclude).size;
    const sold = s.reservations
      .filter(
        (r) =>
          r.id !== exclude &&
          active(r) &&
          isNightly(r) &&
          r.typeId === candidate.typeId &&
          r.checkIn <= day &&
          stayEnd(r, today) > day,
      )
      .reduce((n, r) => n + r.quantity, 0);
    if (sold + candidate.quantity > capacity)
      fail(
        "SOLD_OUT",
        `${day} 객실이 부족합니다. 잔여 ${Math.max(0, capacity - sold)}실입니다.`,
        409,
      );
  }
}
function ensureAssignment(
  s: DatabaseState,
  r: Reservation,
  roomIds: unknown,
  today: string,
) {
  if (
    !Array.isArray(roomIds) ||
    roomIds.some((v) => typeof v !== "string") ||
    roomIds.length !== r.quantity ||
    new Set(roomIds).size !== roomIds.length
  )
    fail(
      "INVALID_ASSIGNMENT",
      `서로 다른 ${r.quantity}개 객실을 선택해 주세요.`,
    );
  for (const rid of roomIds as string[]) {
    const room = s.rooms.find((x) => x.id === rid);
    if (!room || room.typeId !== r.typeId)
      fail("INVALID_ASSIGNMENT", "예약 타입과 같은 객실을 선택해 주세요.");
    if (room.facility === "blocked")
      fail("ROOM_BLOCKED", `${room.number}호는 판매 중지 상태입니다.`, 409);
    if (
      s.reservations.some(
        (x) =>
          x.id !== r.id &&
          isNightly(x) &&
          overdue(x, today) &&
          x.roomIds.includes(rid) &&
          overlap(x.checkIn, stayEnd(x, today), r.checkIn, r.checkOut),
      )
    )
      fail(
        "ROOM_OCCUPIED",
        `${room.number}호 이전 투숙객의 예정 퇴실일이 지났지만 퇴실 처리 전입니다. 퇴실을 먼저 처리해 주세요.`,
        409,
      );
    if (
      s.reservations.some(
        (x) =>
          x.id !== r.id &&
          active(x) &&
          isNightly(x) &&
          x.roomIds.includes(rid) &&
          overlap(x.checkIn, x.checkOut, r.checkIn, r.checkOut),
      )
    )
      fail("ROOM_CONFLICT", `${room.number}호에 겹치는 예약이 있습니다.`, 409);
    const nowMs = NOW_MS;
    const mine = nightWindow(s, r, nowMs);
    if (
      s.reservations.some(
        (x) =>
          x.id !== r.id &&
          isHourly(x) &&
          live(x) &&
          x.roomIds.includes(rid) &&
          (() => {
            const w = hourlyWindow(s, x, nowMs);
            return w.start < mine.end && mine.start < w.end;
          })(),
      )
    )
      fail(
        "ROOM_CONFLICT",
        `${room.number}호에 숙박 시간과 겹치는 대실이 있습니다.`,
        409,
      );
  }
  r.roomIds = roomIds as string[];
}
// Conservative whole-stay packing. Never accept a stay that requires an
// unimplemented room-move workflow; a valid arrangement may be rejected.
function ensureContinuousRooms(s: DatabaseState, today: string) {
  for (const type of s.roomTypes) {
    const rooms = s.rooms.filter(
      (room) => room.typeId === type.id && room.facility !== "blocked",
    );
    const allocations = new Map<string, { start: string; end: string }[]>(
      rooms.map((room) => [room.id, []]),
    );
    const stays = s.reservations.filter(
      (r) =>
        active(r) && isNightly(r) && r.typeId === type.id && r.checkOut > today,
    );
    for (const r of stays.filter((r) => r.roomIds.length === r.quantity)) {
      for (const rid of r.roomIds) {
        const slots = allocations.get(rid);
        if (!slots)
          fail(
            "ROOM_BLOCKED",
            "현재·미래 배정 객실은 판매 중지할 수 없습니다.",
            409,
          );
        if (
          slots.some((slot) =>
            overlap(slot.start, slot.end, r.checkIn, r.checkOut),
          )
        )
          fail("ROOM_CONFLICT", "겹치는 객실 배정이 있습니다.", 409);
        slots.push({ start: r.checkIn, end: r.checkOut });
      }
    }
    for (const r of stays
      .filter((r) => r.roomIds.length !== r.quantity)
      .sort(
        (a, b) =>
          a.checkIn.localeCompare(b.checkIn) ||
          b.checkOut.localeCompare(a.checkOut),
      )) {
      let remaining = r.quantity;
      for (const slots of allocations.values()) {
        if (
          !slots.some((slot) =>
            overlap(slot.start, slot.end, r.checkIn, r.checkOut),
          )
        ) {
          slots.push({ start: r.checkIn, end: r.checkOut });
          if (--remaining === 0) break;
        }
      }
      if (remaining)
        fail(
          "CONTINUOUS_ROOM_REQUIRED",
          "연박 전체를 같은 객실에 배정할 수 있는지 확인이 필요합니다. 기존 예약을 먼저 배정하거나 기간을 조정해 주세요. 객실 이동은 초안에서 지원하지 않습니다.",
          409,
        );
    }
  }
}
function price(s: DatabaseState, r: Reservation) {
  r.totalAmount =
    r.nightlyRate * r.quantity * nights(r.checkIn, r.checkOut).length;
  if (!Number.isSafeInteger(r.totalAmount) || r.totalAmount > 1e12)
    fail("INVALID_AMOUNT", "예약 총금액이 허용 범위를 초과했습니다.");
  r.feeAmount = Math.floor((r.totalAmount * r.feeBps + 5000) / 10000);
  r.netAmount = r.totalAmount - r.feeAmount;
}
const PAYMENTS: readonly PaymentMethod[] = [
  "card",
  "cash",
  "transfer",
  "later",
];
/** 대실 요금: 기본 시간까지 정액, 넘는 시간마다 추가 요금 */
export function hourlyPrice(s: DatabaseState, typeId: string, hours: number) {
  const type = s.roomTypes.find((t) => t.id === typeId);
  if (!type) return fail("INVALID_TYPE", "객실 타입을 확인해 주세요.");
  const o = settingsOf(s);
  return hourlyRateOf(type) + Math.max(0, hours - o.baseHours) * o.extraHourFee;
}
function feeOf(total: number, feeBps: number) {
  return Math.floor((total * feeBps + 5000) / 10000);
}
function ensureHourlyRoom(
  s: DatabaseState,
  r: Reservation,
  room: Room,
  checkingIn: boolean,
) {
  if (room.facility !== "normal")
    fail(
      "ROOM_BLOCKED",
      `${room.number}호는 ${room.facility === "blocked" ? "판매 중지" : "점검 중"}입니다.`,
      409,
    );
  if (checkingIn && room.cleaning !== "clean")
    fail("ROOM_NOT_READY", `${room.number}호 청소를 먼저 끝내 주세요.`, 409);
  const o = settingsOf(s);
  const clean = o.cleaningMinutes * 60000;
  const mine = hourlyWindow(s, r, NOW_MS);
  for (const x of s.reservations) {
    if (x.id === r.id || !live(x) || !x.roomIds.includes(room.id)) continue;
    if (checkingIn && x.status === "checked_in")
      fail(
        "ROOM_OCCUPIED",
        `${room.number}호에 아직 손님이 계십니다. 퇴실을 먼저 처리해 주세요.`,
        409,
      );
    const w = isHourly(x)
      ? hourlyWindow(s, x, NOW_MS)
      : nightWindow(s, x, NOW_MS);
    if (w.start < mine.end + clean && mine.start < w.end + clean)
      fail(
        "ROOM_CONFLICT",
        `${room.number}호에 겹치는 ${isHourly(x) ? "대실" : "숙박"}이 있습니다. (청소 ${o.cleaningMinutes}분 포함)`,
        409,
      );
  }
  // 대실이 오늘 밤 입실 시각을 넘기면 숙박 재고를 함께 확인합니다.
  const nightStart = kstMs(r.checkIn, o.checkInTime);
  if (mine.end > nightStart) {
    const capacity = s.rooms.filter(
      (x) => x.typeId === r.typeId && x.facility !== "blocked",
    ).length;
    const sold = s.reservations
      .filter(
        (x) =>
          active(x) &&
          isNightly(x) &&
          x.typeId === r.typeId &&
          x.checkIn <= r.checkIn &&
          x.checkOut > r.checkIn,
      )
      .reduce((n, x) => n + x.quantity, 0);
    const busy = hourlyRoomsAtNight(s, r.typeId, r.checkIn, NOW_MS, r.id);
    busy.add(room.id);
    if (busy.size + sold > capacity)
      fail(
        "SOLD_OUT",
        `대실이 ${o.checkInTime} 이후까지 이어지면 오늘 밤 숙박 예약 객실이 부족해집니다.`,
        409,
      );
  }
}
/** 대실 예약(또는 바로 입실) 만들기 */
function buildHourly(
  s: DatabaseState,
  d: Record<string, unknown>,
  today: string,
  now: string,
  checkInNow: boolean,
): Reservation {
  const room = s.rooms.find((x) => x.id === d.roomId);
  if (!room) return fail("NOT_FOUND", "객실을 찾을 수 없습니다.", 404);
  const hours = integer(d.hours, "대실 시간", 1, 12);
  const startAt = checkInNow
    ? now
    : (() => {
        if (
          typeof d.startAt !== "string" ||
          !Number.isFinite(Date.parse(d.startAt))
        )
          return fail("INVALID_INPUT", "대실 시작 시각을 확인해 주세요.");
        return new Date(Date.parse(d.startAt)).toISOString();
      })();
  if (!checkInNow && Date.parse(startAt) < NOW_MS - 10 * 60000)
    fail("INVALID_INPUT", "지난 시각에는 대실을 넣을 수 없습니다.");
  const endAt = new Date(Date.parse(startAt) + hours * 3600000).toISOString();
  const day = businessDateOf(startAt);
  if (limits(s, today).newSalesBlocked)
    fail(
      "ROOM_LICENSE_REQUIRED",
      "무료 플랜에서 20실 초과 호텔은 신규 판매가 보류됩니다.",
      403,
    );
  checkRange(s, day, addDays(day, 1), today);
  const channelId =
    d.channelId === undefined ? "walkin" : text(d.channelId, "판매 채널");
  const channel = s.channels.find((c) => c.id === channelId);
  if (!channel) return fail("INVALID_CHANNEL", "판매 채널을 확인해 주세요.");
  const total =
    d.amount === undefined || d.amount === null
      ? hourlyPrice(s, room.typeId, hours)
      : integer(d.amount, "대실 금액", 0, 100000000);
  const fee = feeOf(total, channel.feeBps);
  const r: Reservation = {
    id: id(),
    guestName:
      d.guestName === undefined || d.guestName === ""
        ? "대실 손님"
        : text(d.guestName, "손님 이름", 60),
    phone: text(d.phone, "연락처", 40, true),
    typeId: room.typeId,
    quantity: 1,
    checkIn: day,
    checkOut: addDays(day, 1),
    channelId,
    nightlyRate: total,
    totalAmount: total,
    feeAmount: fee,
    feeBps: channel.feeBps,
    netAmount: total - fee,
    status: checkInNow ? "checked_in" : "confirmed",
    roomIds: [room.id],
    memo: text(d.memo, "메모", 1000, true),
    version: 1,
    createdAt: now,
    createdPlan: s.plan,
    protectedFuture: s.plan === "pro",
    stayType: "hourly",
    startAt,
    endAt,
    hours,
    payment:
      d.payment === undefined ? undefined : choice(d.payment, PAYMENTS, "결제"),
    checkedInAt: checkInNow ? now : undefined,
  };
  ensureHourlyRoom(s, r, room, checkInNow);
  return r;
}
function checkInRooms(s: DatabaseState, r: Reservation) {
  for (const rid of r.roomIds) {
    const room = s.rooms.find((x) => x.id === rid)!;
    if (room.cleaning !== "clean" || room.facility !== "normal")
      fail(
        "ROOM_NOT_READY",
        `${room.number}호 청소 완료·시설 정상을 확인해 주세요.`,
        409,
      );
    if (
      s.reservations.some(
        (x) =>
          x.id !== r.id && x.status === "checked_in" && x.roomIds.includes(rid),
      )
    )
      fail(
        "ROOM_OCCUPIED",
        `${room.number}호 이전 투숙객의 퇴실을 먼저 처리해 주세요.`,
        409,
      );
  }
}
function markDirty(s: DatabaseState, r: Reservation, now: string) {
  for (const rid of r.roomIds) {
    const room = s.rooms.find((x) => x.id === rid)!;
    room.cleaning = "dirty";
    room.cleaningSince = now;
    room.version++;
  }
}
export function mutate(
  s: DatabaseState,
  cmd: Command,
  today: string,
  now = new Date().toISOString(),
): CommandResult {
  const d = cmd.data;
  if (!d || typeof d !== "object" || Array.isArray(d))
    return fail("INVALID_INPUT", "명령 데이터가 올바르지 않습니다.");
  NOW_MS = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  let targetId = "demo-hotel",
    message = "저장했습니다.";
  const undoable = UNDOABLE.has(cmd.type);
  const before = undoable
    ? JSON.stringify({ ...s, undo: undefined, audit: undefined })
    : "";
  switch (cmd.type) {
    case "undo": {
      const u = s.undo;
      if (!u || u.token !== d.token)
        fail("UNDO_EXPIRED", "되돌릴 수 있는 작업이 없습니다.", 409);
      if (u.revision !== s.revision)
        fail(
          "UNDO_CONFLICT",
          "그 사이에 다른 변경이 있어 되돌리지 않았습니다. 화면에서 직접 고쳐 주세요.",
          409,
        );
      if (NOW_MS - Date.parse(u.at) > UNDO_WINDOW_MS)
        fail("UNDO_EXPIRED", "되돌리기 시간이 지났습니다.", 409);
      const previous = JSON.parse(u.before) as DatabaseState;
      const audit = s.audit;
      for (const key of Object.keys(s) as (keyof DatabaseState)[])
        delete s[key];
      Object.assign(s, previous, { audit, revision: u.revision });
      delete s.undo;
      targetId = u.targetId;
      message = "방금 한 작업을 되돌렸습니다.";
      break;
    }
    case "reservation.walkin": {
      if (d.stayType === "hourly") {
        const r = buildHourly(s, d, today, now, true);
        s.reservations.push(r);
        targetId = r.id;
        message = `${s.rooms.find((x) => x.id === r.roomIds[0])!.number}호 대실 ${r.hours}시간 입실 처리했습니다.`;
        break;
      }
      // 현장 숙박: 예약을 만들고 같은 방으로 바로 입실합니다.
      const room = s.rooms.find((x) => x.id === d.roomId);
      if (!room) fail("NOT_FOUND", "객실을 찾을 수 없습니다.", 404);
      const count = integer(d.nights ?? 1, "숙박일수", 1, 60);
      const checkIn = lateArrivalDate(today, now) ?? today;
      const checkOut = addDays(checkIn, count);
      if (limits(s, today).newSalesBlocked)
        fail(
          "ROOM_LICENSE_REQUIRED",
          "무료 플랜에서 20실 초과 호텔은 신규 판매가 보류됩니다.",
          403,
        );
      checkRange(s, checkIn, checkOut, today);
      const channelId =
        d.channelId === undefined ? "walkin" : text(d.channelId, "판매 채널");
      const channel = s.channels.find((c) => c.id === channelId);
      if (!channel) fail("INVALID_CHANNEL", "판매 채널을 확인해 주세요.");
      const type = s.roomTypes.find((x) => x.id === room.typeId)!;
      const r: Reservation = {
        id: id(),
        guestName:
          d.guestName === undefined || d.guestName === ""
            ? "현장 손님"
            : text(d.guestName, "손님 이름", 60),
        phone: text(d.phone, "연락처", 40, true),
        typeId: room.typeId,
        quantity: 1,
        checkIn,
        checkOut,
        channelId,
        nightlyRate:
          d.nightlyRate === undefined
            ? type.baseRate
            : integer(d.nightlyRate, "1박 금액", 0, 100000000),
        totalAmount: 0,
        feeAmount: 0,
        feeBps: channel.feeBps,
        netAmount: 0,
        status: "confirmed",
        roomIds: [],
        memo: text(d.memo, "메모", 1000, true),
        version: 1,
        createdAt: now,
        createdPlan: s.plan,
        protectedFuture: s.plan === "pro",
        stayType: "nightly",
        payment:
          d.payment === undefined
            ? undefined
            : choice(d.payment, PAYMENTS, "결제"),
      };
      price(s, r);
      ensureInventory(s, r, today);
      ensureAssignment(s, r, [room.id], today);
      checkInRooms(s, r);
      r.status = "checked_in";
      r.checkedInAt = now;
      r.version++;
      s.reservations.push(r);
      targetId = r.id;
      message = `${room.number}호 ${count}박 입실 처리했습니다.`;
      break;
    }
    case "reservation.create":
    case "reservation.update": {
      if (cmd.type === "reservation.create" && d.stayType === "hourly") {
        const r = buildHourly(s, d, today, now, false);
        s.reservations.push(r);
        targetId = r.id;
        message = "대실 예약을 넣었습니다.";
        break;
      }
      const previous =
        cmd.type === "reservation.update" ? getReservation(s, d) : undefined;
      if (previous && isHourly(previous))
        fail(
          "HOURLY_READONLY",
          "대실은 내용을 바꾸지 않고, 취소한 뒤 다시 넣어 주세요.",
        );
      if (previous) {
        checkAccess(s, previous, today);
        if (previous.checkIn < limits(s, today).historyStart)
          fail(
            "CLIPPED_RESERVATION_READONLY",
            "일부 숙박일이 조회 기간 밖에 있어 예약 내용 변경을 제한합니다. 원본 기록은 보존됩니다.",
            403,
          );
        if (previous.status !== "confirmed")
          fail("INVALID_STATUS", "확정 상태 예약만 내용을 변경할 수 있습니다.");
      }
      const typeId = text(d.typeId, "객실 타입");
      if (!s.roomTypes.some((t) => t.id === typeId))
        fail("INVALID_TYPE", "객실 타입을 확인해 주세요.");
      const channelId = text(d.channelId, "판매 채널");
      if (!s.channels.some((c) => c.id === channelId))
        fail("INVALID_CHANNEL", "판매 채널을 확인해 주세요.");
      const checkIn = dateValue(d.checkIn, "체크인"),
        checkOut = dateValue(d.checkOut, "체크아웃");
      nights(checkIn, checkOut);
      const quantity = integer(d.quantity, "객실 수", 1, 1000);
      const unchangedInventory =
        previous &&
        previous.typeId === typeId &&
        quantity <= previous.quantity &&
        checkIn >= previous.checkIn &&
        checkOut <= previous.checkOut;
      if (!unchangedInventory) {
        if (limits(s, today).newSalesBlocked)
          fail(
            "ROOM_LICENSE_REQUIRED",
            "무료 플랜에서 20실 초과 호텔은 신규 판매가 보류됩니다. 기존 예약 처리는 가능합니다.",
            403,
          );
        checkRange(s, checkIn, checkOut, today);
      } else if (checkOut <= limits(s, today).historyStart)
        checkAccess(s, previous, today);
      const r: Reservation = {
        id: previous?.id ?? id(),
        guestName: text(d.guestName, "예약자명", 60),
        phone: text(d.phone, "연락처", 40, true),
        typeId,
        quantity,
        checkIn,
        checkOut,
        channelId,
        nightlyRate: integer(
          d.nightlyRate,
          "1박 객실당 판매금액",
          0,
          100000000,
        ),
        totalAmount: 0,
        feeAmount: 0,
        feeBps:
          previous?.channelId === channelId
            ? previous.feeBps
            : s.channels.find((c) => c.id === channelId)!.feeBps,
        netAmount: 0,
        status: "confirmed",
        stayType: "nightly",
        payment: previous?.payment,
        roomIds: previous?.roomIds.slice(0, quantity) ?? [],
        memo: text(d.memo, "메모", 1000, true),
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        createdPlan: previous?.createdPlan ?? s.plan,
        protectedFuture: previous?.protectedFuture || s.plan === "pro",
      };
      price(s, r);
      if (!unchangedInventory) ensureInventory(s, r, today, previous?.id);
      if (previous?.typeId !== r.typeId) r.roomIds = [];
      if (r.roomIds.length === r.quantity)
        ensureAssignment(s, r, r.roomIds, today);
      else r.roomIds = [];
      if (previous)
        s.reservations[s.reservations.findIndex((x) => x.id === r.id)] = r;
      else s.reservations.push(r);
      targetId = r.id;
      message = previous ? "예약을 변경했습니다." : "새 예약을 등록했습니다.";
      break;
    }
    case "reservation.cancel": {
      const r = getReservation(s, d);
      checkAccess(s, r, today);
      if (r.status !== "confirmed")
        fail(
          "INVALID_STATUS",
          "확정 예약만 취소할 수 있습니다. 투숙·퇴실 기록은 유지됩니다.",
        );
      r.status = "cancelled";
      r.version++;
      targetId = r.id;
      message = "예약을 취소하고 재고를 반환했습니다.";
      break;
    }
    case "reservation.assign": {
      const r = getReservation(s, d);
      checkAccess(s, r, today);
      if (r.status !== "confirmed")
        fail("INVALID_STATUS", "입실 전 확정 예약만 배정할 수 있습니다.");
      if (isHourly(r))
        fail(
          "HOURLY_READONLY",
          "대실은 방을 바꾸지 않고, 취소한 뒤 다시 넣어 주세요.",
        );
      ensureAssignment(s, r, d.roomIds, today);
      r.version++;
      targetId = r.id;
      message = "객실을 배정했습니다.";
      break;
    }
    case "reservation.checkin": {
      const r = getReservation(s, d);
      checkAccess(s, r, today);
      if (isHourly(r)) {
        if (r.status !== "confirmed")
          fail(
            "INVALID_STATUS",
            "입실 전 대실 예약만 입실 처리할 수 있습니다.",
          );
        if (NOW_MS >= Date.parse(r.endAt!))
          fail("INVALID_STATUS", "대실 시간이 이미 지났습니다.");
        if (Date.parse(r.startAt!) - NOW_MS > 2 * 3600000)
          fail(
            "INVALID_STATUS",
            "대실 예약은 시작 2시간 전부터 입실 처리할 수 있습니다.",
          );
        const room = s.rooms.find((x) => x.id === r.roomIds[0])!;
        // 일찍 오면 지금부터 같은 시간만큼 이용합니다.
        if (NOW_MS < Date.parse(r.startAt!)) {
          r.startAt = now;
          r.endAt = new Date(NOW_MS + r.hours! * 3600000).toISOString();
        }
        ensureHourlyRoom(s, r, room, true);
        r.status = "checked_in";
        r.checkedInAt = now;
        r.version++;
        targetId = r.id;
        message = `${room.number}호 대실 입실 처리했습니다.`;
        break;
      }
      const late = lateArrivalDate(today, now);
      const staysToday = today >= r.checkIn && today < r.checkOut;
      const lateArrival = !!late && late >= r.checkIn && late < r.checkOut;
      if (r.status !== "confirmed" || (!staysToday && !lateArrival))
        fail(
          "INVALID_STATUS",
          `오늘 숙박하는 확정 예약만 입실 처리할 수 있습니다. 자정부터 ${BUSINESS_DAY_CUTOFF_HOUR}시 전까지는 전날 숙박 예약도 입실할 수 있습니다.`,
        );
      ensureAssignment(s, r, r.roomIds, today);
      checkInRooms(s, r);
      r.status = "checked_in";
      r.checkedInAt = now;
      r.version++;
      targetId = r.id;
      message = "입실 처리했습니다.";
      break;
    }
    case "reservation.checkout": {
      const r = getReservation(s, d);
      checkAccess(s, r, today);
      if (r.status !== "checked_in")
        fail(
          "INVALID_STATUS",
          "현재 투숙 중인 예약만 퇴실 처리할 수 있습니다.",
        );
      // 대실은 정액이라 일찍 나가도 바로 퇴실할 수 있습니다.
      if (isNightly(r) && today < r.checkOut)
        fail(
          "EARLY_CHECKOUT",
          "조기 퇴실과 금액 조정은 아직 지원하지 않습니다. 예정 퇴실일에 처리해 주세요.",
        );
      r.status = "checked_out";
      r.checkedOutAt = now;
      r.version++;
      markDirty(s, r, now);
      targetId = r.id;
      message = "퇴실 처리하고 객실을 청소 필요 상태로 바꿨습니다.";
      break;
    }
    case "room.create": {
      if (s.plan === "free" && s.rooms.length >= 20)
        fail(
          "ROOM_LIMIT",
          "무료 플랜은 객실을 20개까지 등록할 수 있습니다.",
          403,
        );
      const number = text(d.number, "객실번호", 20),
        building =
          d.building === undefined ? "본관" : text(d.building, "건물동", 30);
      if (
        s.plan === "free" &&
        s.rooms.length > 0 &&
        !s.rooms.some((r) => r.building === building)
      )
        fail(
          "BUILDING_LIMIT",
          "무료 플랜은 기존 건물동 1개만 사용할 수 있습니다.",
          403,
        );
      if (s.rooms.some((r) => r.number === number && r.building === building))
        fail("DUPLICATE_ROOM", "같은 동에 이미 등록된 객실번호입니다.", 409);
      const typeId = text(d.typeId, "객실 타입");
      if (!s.roomTypes.some((x) => x.id === typeId))
        fail("INVALID_TYPE", "객실 타입을 확인해 주세요.");
      const room: Room = {
        id: id(),
        number,
        building,
        floor: integer(d.floor, "층", -10, 200),
        typeId,
        cleaning: "clean",
        facility: "normal",
        version: 1,
      };
      s.rooms.push(room);
      targetId = room.id;
      message = "객실을 등록했습니다.";
      break;
    }
    case "room.update": {
      const room = s.rooms.find((x) => x.id === d.id);
      if (!room) fail("NOT_FOUND", "객실을 찾을 수 없습니다.", 404);
      if (room.version !== d.version)
        fail(
          "VERSION_CONFLICT",
          "객실이 변경되었습니다. 새로고침해 주세요.",
          409,
        );
      const facility =
        d.facility === undefined
          ? room.facility
          : choice(
              d.facility,
              ["normal", "inspection", "blocked"],
              "시설 상태",
            );
      if (facility === "blocked" && room.facility !== "blocked") {
        if (
          s.reservations.some(
            (r) =>
              active(r) &&
              (r.checkOut > today || r.status === "checked_in") &&
              r.roomIds.includes(room.id),
          )
        )
          fail(
            "ASSIGNED_BOOKING_CONFLICT",
            "배정된 현재·미래 예약이 있습니다. 먼저 객실 재배정 또는 취소가 필요합니다.",
            409,
          );
        const capacity =
          s.rooms.filter(
            (r) => r.typeId === room.typeId && r.facility !== "blocked",
          ).length - 1;
        const relevant = s.reservations.filter(
          (r) =>
            active(r) &&
            isNightly(r) &&
            r.typeId === room.typeId &&
            stayEnd(r, today) > today,
        );
        for (const date of new Set(
          relevant.flatMap((r) =>
            overdue(r, today)
              ? [today]
              : nights(r.checkIn, r.checkOut).filter((n) => n >= today),
          ),
        )) {
          const sold = relevant
            .filter((r) => r.checkIn <= date && stayEnd(r, today) > date)
            .reduce((n, r) => n + r.quantity, 0);
          if (sold > capacity)
            fail(
              "INVENTORY_CONFLICT",
              `${date} 기존 예약 수용량이 부족해집니다. 먼저 예약을 조정해 주세요.`,
              409,
            );
        }
      }
      room.facility = facility;
      if (d.cleaning !== undefined) {
        const cleaning = choice(
          d.cleaning,
          ["clean", "dirty", "cleaning"],
          "청소 상태",
        );
        if (cleaning !== room.cleaning)
          room.cleaningSince = cleaning === "clean" ? undefined : now;
        room.cleaning = cleaning;
      }
      if (d.color !== undefined) {
        if (d.color === null || d.color === "") delete room.color;
        else room.color = colorValue(d.color, "객실 색");
      }
      if (d.label !== undefined) {
        const label = text(d.label, "특수객실 이름", 12, true);
        if (label) room.label = label;
        else delete room.label;
      }
      room.version++;
      targetId = room.id;
      message = "객실 상태를 변경했습니다.";
      break;
    }
    case "issue.create": {
      const room = s.rooms.find((r) => r.id === d.roomId);
      if (!room) fail("NOT_FOUND", "객실을 찾을 수 없습니다.", 404);
      if (
        s.issues.filter((i) => i.roomId === room.id && i.status !== "resolved")
          .length >= limits(s, today).maxOpenIssues
      )
        fail(
          "ISSUE_LIMIT",
          `객실별 미해결 항목은 현재 ${limits(s, today).maxOpenIssues}개까지입니다. 기존 항목을 해결하거나 프로 체험을 선택해 주세요.`,
          403,
        );
      const issue: RoomIssue = {
        id: id(),
        roomId: room.id,
        title: text(d.title, "항목 제목", 100),
        detail: text(d.detail, "상세 내용", 2000, true),
        category: choice(d.category, ["repair", "condition", "other"], "유형"),
        priority: choice(d.priority, ["normal", "urgent"], "중요도"),
        status: "open",
        createdAt: now,
        version: 1,
      };
      s.issues.push(issue);
      targetId = issue.id;
      message = "인수인계 항목을 기록했습니다.";
      break;
    }
    case "issue.update": {
      const issue = s.issues.find((i) => i.id === d.id);
      if (!issue) fail("NOT_FOUND", "인수인계 항목을 찾을 수 없습니다.", 404);
      if (issue.version !== d.version)
        fail(
          "VERSION_CONFLICT",
          "항목이 변경되었습니다. 새로고침해 주세요.",
          409,
        );
      const status = choice(
        d.status,
        ["open", "in_progress", "resolved"],
        "진행 상태",
      );
      if (
        issue.status === "resolved" &&
        status !== "resolved" &&
        s.issues.filter(
          (i) => i.roomId === issue.roomId && i.status !== "resolved",
        ).length >= limits(s, today).maxOpenIssues
      )
        fail(
          "ISSUE_LIMIT",
          "미해결 항목 한도 때문에 다시 열 수 없습니다.",
          403,
        );
      issue.status = status;
      if (d.title !== undefined) issue.title = text(d.title, "제목", 100);
      if (d.detail !== undefined)
        issue.detail = text(d.detail, "상세 내용", 2000, true);
      issue.resolvedAt = status === "resolved" ? now : undefined;
      issue.version++;
      targetId = issue.id;
      message =
        status === "resolved"
          ? "항목을 해결했습니다. 판매 재개는 객실 상태에서 별도로 확인해 주세요."
          : "항목을 변경했습니다.";
      break;
    }
    case "floor.update": {
      const building = text(d.building, "건물동", 30);
      const floor = integer(d.floor, "층", -10, 200);
      if (!s.rooms.some((r) => r.building === building && r.floor === floor))
        fail("NOT_FOUND", "그 층에 등록된 객실이 없습니다.", 404);
      const key = `${building}|${floor}`;
      s.floorColors = { ...(s.floorColors ?? {}) };
      if (d.color === null || d.color === "") delete s.floorColors[key];
      else s.floorColors[key] = colorValue(d.color, "층 색");
      targetId = key;
      message = `${floor}층 색을 바꿨습니다.`;
      break;
    }
    case "settings.update": {
      const o = settingsOf(s);
      const next: OperationSettings = {
        baseHours:
          d.baseHours === undefined
            ? o.baseHours
            : integer(d.baseHours, "대실 기본 시간", 1, 12),
        extraHourFee:
          d.extraHourFee === undefined
            ? o.extraHourFee
            : integer(d.extraHourFee, "추가 1시간 요금", 0, 10000000),
        cleaningMinutes:
          d.cleaningMinutes === undefined
            ? o.cleaningMinutes
            : integer(d.cleaningMinutes, "청소 시간", 0, 240),
        checkInTime:
          d.checkInTime === undefined
            ? o.checkInTime
            : timeValue(d.checkInTime, "숙박 입실 시각"),
        checkOutTime:
          d.checkOutTime === undefined
            ? o.checkOutTime
            : timeValue(d.checkOutTime, "숙박 퇴실 시각"),
      };
      if (d.hourlyRates !== undefined) {
        if (!d.hourlyRates || typeof d.hourlyRates !== "object")
          fail("INVALID_INPUT", "대실 요금 값이 올바르지 않습니다.");
        for (const [typeId, value] of Object.entries(
          d.hourlyRates as Record<string, unknown>,
        )) {
          const type = s.roomTypes.find((x) => x.id === typeId);
          if (!type) fail("INVALID_TYPE", "객실 타입을 확인해 주세요.");
          type.hourlyRate = integer(
            value,
            `${type.name} 대실 요금`,
            0,
            10000000,
          );
        }
      }
      s.settings = next;
      message = "대실·입퇴실 설정을 저장했습니다.";
      break;
    }
    case "property.update":
      s.property.name = text(d.name, "호텔 이름", 60);
      message = "호텔 이름을 저장했습니다.";
      break;
    case "member.create": {
      const member: Member = {
        id: id(),
        name: text(d.name, "직원 이름", 40),
        role: choice(d.role, ["manager", "front", "housekeeping"], "직원 역할"),
        active: true,
      };
      s.members.push(member);
      targetId = member.id;
      message =
        "데모 조직에 구성원을 등록했습니다. 실제 계정 초대는 아직 지원하지 않습니다.";
      break;
    }
    case "attendance.clockin": {
      if (s.plan !== "pro")
        fail("PRO_REQUIRED", "출근 기록은 프로 플랜 기능입니다.", 403);
      const member = s.members.find((m) => m.id === d.memberId && m.active);
      if (!member) fail("NOT_FOUND", "구성원을 찾을 수 없습니다.", 404);
      if (s.attendance.some((a) => a.memberId === member.id && !a.clockOut))
        fail("ALREADY_CLOCKED_IN", "이미 출근 중입니다.", 409);
      const session: Attendance = {
        id: id(),
        memberId: member.id,
        clockIn: now,
      };
      s.attendance.push(session);
      targetId = session.id;
      message = "서버 시간으로 출근을 기록했습니다.";
      break;
    }
    case "attendance.clockout": {
      const attendance = s.attendance.find((a) => a.id === d.id);
      if (!attendance) fail("NOT_FOUND", "근무 기록을 찾을 수 없습니다.", 404);
      if (attendance.clockOut)
        fail("ALREADY_CLOCKED_OUT", "이미 퇴근한 기록입니다.", 409);
      attendance.clockOut = now;
      targetId = attendance.id;
      message = "서버 시간으로 퇴근을 기록했습니다.";
      break;
    }
    case "demo.plan":
      s.plan = choice(d.plan, ["free", "pro"], "플랜");
      message = `${s.plan === "pro" ? "프로" : "무료"} 체험 모드로 전환했습니다. 실제 결제는 발생하지 않습니다.`;
      break;
    default:
      fail("UNKNOWN_COMMAND", "지원하지 않는 작업입니다.");
  }
  if (
    [
      "reservation.create",
      "reservation.update",
      "reservation.assign",
      "room.update",
    ].includes(cmd.type)
  )
    ensureContinuousRooms(s, today);
  s.revision++;
  s.audit.push({
    id: id(),
    action: cmd.type,
    targetId,
    at: now,
    actor: "로컬 데모 운영자",
  });
  if (undoable) {
    s.undo = {
      token: id(),
      revision: s.revision,
      at: now,
      action: cmd.type,
      targetId,
      before,
    };
    return {
      message,
      id: targetId,
      revision: s.revision,
      undoToken: s.undo.token,
      undoUntil: new Date(NOW_MS + UNDO_UI_MS).toISOString(),
    };
  }
  delete s.undo;
  return { message, id: targetId, revision: s.revision };
}
function feeOnNight(r: Reservation, date: string) {
  const i = Math.round((Date.parse(date) - Date.parse(r.checkIn)) / 86400000);
  const feeUntil = (count: number) =>
    Math.floor((r.nightlyRate * r.quantity * r.feeBps * count + 5000) / 10000);
  return feeUntil(i + 1) - feeUntil(i);
}
export function report(
  s: DatabaseState,
  start: string,
  end: string,
  today: string,
): Report {
  dateValue(start);
  dateValue(end);
  if (end < start) fail("INVALID_RANGE", "종료일이 시작일보다 빠릅니다.");
  const l = limits(s, today);
  if (start < l.historyStart || end >= l.futureEnd)
    fail(
      "REPORT_DATE_LIMIT",
      `리포트 조회 범위는 ${l.historyStart}~${addDays(l.futureEnd, -1)}입니다.`,
      403,
    );
  if (s.plan === "free" && start !== end)
    fail(
      "PRO_REQUIRED",
      "기간별 리포트는 프로 플랜에서 이용할 수 있습니다.",
      403,
    );
  const days = nights(start, addDays(end, 1)).map((date) => {
    const bookings = s.reservations.filter(
      (r) =>
        active(r) && isNightly(r) && r.checkIn <= date && r.checkOut > date,
    );
    // 대실은 영업일(06시 기준) 하루에 정액으로 잡습니다.
    const hourly = s.reservations.filter(
      (r) => active(r) && isHourly(r) && r.checkIn === date,
    );
    const nightlyRevenue = bookings.reduce(
      (n, r) => n + r.nightlyRate * r.quantity,
      0,
    );
    const hourlyRevenue = hourly.reduce((n, r) => n + r.totalAmount, 0);
    const revenue = nightlyRevenue + hourlyRevenue;
    const fee =
      bookings.reduce((n, r) => n + feeOnNight(r, date), 0) +
      hourly.reduce((n, r) => n + r.feeAmount, 0);
    return {
      date,
      revenue,
      fee,
      netRevenue: revenue - fee,
      sold: bookings.reduce((n, r) => n + r.quantity, 0),
      nightlyRevenue,
      hourlyRevenue,
      hourlyCount: hourly.length,
    };
  });
  const channels = s.channels.map((c) => {
    let revenue = 0,
      sold = 0;
    for (const r of s.reservations.filter(
      (r) => active(r) && r.channelId === c.id,
    )) {
      if (isHourly(r)) {
        if (r.checkIn >= start && r.checkIn <= end) revenue += r.totalAmount;
        continue;
      }
      const count = nights(r.checkIn, r.checkOut).filter(
        (d) => d >= start && d <= end,
      ).length;
      revenue += count * r.quantity * r.nightlyRate;
      sold += count * r.quantity;
    }
    return { channelId: c.id, revenue, sold };
  });
  return {
    start,
    end,
    revenue: days.reduce((n, d) => n + d.revenue, 0),
    fee: days.reduce((n, d) => n + d.fee, 0),
    netRevenue: days.reduce((n, d) => n + d.netRevenue, 0),
    sold: days.reduce((n, d) => n + d.sold, 0),
    nightlyRevenue: days.reduce((n, d) => n + d.nightlyRevenue, 0),
    hourlyRevenue: days.reduce((n, d) => n + d.hourlyRevenue, 0),
    hourlyCount: days.reduce((n, d) => n + d.hourlyCount, 0),
    days,
    channels,
  };
}
export function snapshot(
  s: DatabaseState,
  date: string,
  today: string,
  now = new Date().toISOString(),
): AppState {
  dateValue(date);
  const l = limits(s, today);
  if (date < l.historyStart || date >= l.futureEnd)
    fail(
      "PLAN_DATE_LIMIT",
      `현황 조회 범위는 ${l.historyStart}~${addDays(l.futureEnd, -1)}입니다.`,
      403,
    );
  const visible = s.reservations
    .filter((r) => r.checkOut > l.historyStart || r.status === "checked_in")
    .map((original) => {
      const r = structuredClone(original);
      if (isHourly(r) && r.checkIn >= l.historyStart) return r;
      if (r.checkOut <= l.historyStart) {
        r.totalAmount = 0;
        r.nightlyRate = 0;
        r.feeAmount = 0;
        r.netAmount = 0;
        r.phone = "";
        r.memo = "조회 기간 밖의 미퇴실 업무입니다.";
        r.clipped = true;
      } else if (r.checkIn < l.historyStart) {
        const visibleNights = nights(l.historyStart, r.checkOut);
        r.checkIn = l.historyStart;
        r.clipped = true;
        r.totalAmount = visibleNights.length * r.nightlyRate * r.quantity;
        r.feeAmount = visibleNights.reduce(
          (n, date) => n + feeOnNight(original, date),
          0,
        );
        r.netAmount = r.totalAmount - r.feeAmount;
      }
      return r;
    })
    .filter(
      (r) =>
        r.checkIn < l.futureEnd ||
        ((r.createdPlan === "pro" || r.protectedFuture) && r.checkOut >= today),
    );
  const allowedIds = new Set(visible.map((r) => r.id));
  const booked = s.reservations.filter(
    (r) =>
      active(r) &&
      isNightly(r) &&
      r.checkIn <= date &&
      stayEnd(r, today) > date,
  );
  const hourlyToday = s.reservations.filter(
    (r) => active(r) && isHourly(r) && r.checkIn === date,
  );
  const inventory = s.roomTypes.map((t) => {
    const rooms = s.rooms.filter((r) => r.typeId === t.id),
      blocked = rooms.filter((r) => r.facility === "blocked").length,
      sold = booked
        .filter((r) => r.typeId === t.id)
        .reduce((n, r) => n + r.quantity, 0);
    return {
      typeId: t.id,
      total: rooms.length,
      blocked,
      sold,
      available: Math.max(0, rooms.length - blocked - sold),
    };
  });
  const r = report(s, date, date, today),
    soldRooms = inventory.reduce((n, t) => n + t.sold, 0),
    blockedRooms = inventory.reduce((n, t) => n + t.blocked, 0);
  const { undo: _undo, ...publicState } = s;
  return {
    ...structuredClone(publicState),
    settings: settingsOf(s),
    floorColors: { ...(s.floorColors ?? {}) },
    serverNow: now,
    businessDate: businessDateOf(now),
    businessDayCutoffHour: BUSINESS_DAY_CUTOFF_HOUR,
    roomTypes: s.roomTypes.map((t) => ({ ...t, hourlyRate: hourlyRateOf(t) })),
    today,
    selectedDate: date,
    lateArrivalDate: lateArrivalDate(today, now),
    limits: l,
    reservations: visible,
    audit: s.audit
      .filter(
        (a) =>
          !a.action.startsWith("reservation.") || allowedIds.has(a.targetId),
      )
      .slice(-40)
      .reverse(),
    dashboard: {
      totalRooms: s.rooms.length,
      soldRooms,
      blockedRooms,
      availableRooms: s.rooms.length - blockedRooms - soldRooms,
      occupancy: s.rooms.length
        ? Math.round((soldRooms / s.rooms.length) * 100)
        : 0,
      revenue: r.revenue,
      fee: r.fee,
      netRevenue: r.netRevenue,
      hourlyRevenue: r.hourlyRevenue,
      hourlyCount: hourlyToday.length,
      arrivals: s.reservations
        .filter((r) => active(r) && isNightly(r) && r.checkIn === date)
        .reduce((n, r) => n + r.quantity, 0),
      departures: s.reservations
        .filter(
          (r) =>
            active(r) &&
            isNightly(r) &&
            (r.checkOut === date || (date === today && overdue(r, today))),
        )
        .reduce((n, r) => n + r.quantity, 0),
      unassigned: booked
        .filter((r) => r.roomIds.length !== r.quantity)
        .reduce((n, r) => n + r.quantity - r.roomIds.length, 0),
      openIssues: s.issues.filter((i) => i.status !== "resolved").length,
      inventory,
    },
  };
}

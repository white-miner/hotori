import { normalizePlatformFee, normalizeRate } from "./feerate";
import { platformAbbr } from "./platform";
import { type ExpenseCategory, normalizeExpenseCategories } from "./expense";
import type { Payment } from "./payment";
import type { LongStayRate, NightCharge, SettleCycle, StayMode } from "./longstay";
import type { StayNightRates } from "./nightrates";
import {
  type TypeRateOverridesMap,
  type TypeRatesMap,
  type TypeStopSellMap,
  normalizeTypeRateOverrides,
  normalizeTypeRates,
  normalizeTypeStopSell,
} from "./salesCalendar";
import {
  DEFAULT_HOUR_FEE,
  type DayuseDefaults,
  type ParkingSettings,
  type StayTimes,
  normalizeDayuseDefaults,
  normalizeParking,
  type SurchargeTier,
  normalizeHourFee,
  normalizeSpecialDates,
  normalizeStayTimes,
  normalizeTiers,
} from "./tiers";
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
  /** 인원 추가금: 기본 인원(안 적으면 2) · 최대 인원(넘으면 경고만) · 추가 요금 등급 id */
  baseGuests?: number;
  maxGuests?: number;
  tierId?: string;
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
  color?: string | null; // 캘린더 막대 색 (#RRGGBB). 없으면 플랫폼 기본 색
  /** 현장 결제 (잔금을 따져요). 없으면 이름에 '현장'·'전화'가 있을 때 켜진 걸로 봐요 */
  onsite?: boolean;
  /** 수수료율 % (없으면 수수료 없음) */
  feeRate?: number | null;
  /** 수수료 기준: 판매가(sale, 기본) · 쿠폰 뺀 금액(net) */
  feeBasis?: "sale" | "net";
  /** 쿠폰 기본 부담: 숙소 부담이면 true (기본은 플랫폼 부담) */
  couponHotel?: boolean;
  /** 정산 주기: 퇴실 후 N일에 입금 (없으면 날짜 없음) */
  payoutDays?: number | null;
}
export interface HotelSettings {
  buildings: Building[]; // 1개 이상. 1개면 화면은 예전과 똑같아요.
  floors: Floor[];
  types: RoomType[];
  platforms: Platform[];
  lowThreshold: number;
  shopItems: ShopItem[]; // 매점 물품 (위에서부터 매점 화면 순서)
  expenseCategories: ExpenseCategory[]; // 지출 분류 (없으면 기본: 수리·비품구매·식자재·세탁·공과금·기타)
  /** 인원 추가 요금 등급 (없으면 기본: 일반 1만/2만 · 특수 2만/3만) */
  surchargeTiers: SurchargeTier[];
  /** 특별일: 주말 요금을 받는 날 (밤 기준 YYYY-MM-DD) */
  specialDates: string[];
  /** 기본 입실 · 퇴실 시간 (없으면 16:00 · 12:00) */
  stayTimes: StayTimes;
  /** 대실 기본 시작·종료·가격 (호텔 공통 · 없으면 14:00–17:00 · 0원) */
  dayuseDefaults: DayuseDefaults;
  /** 빠른 입실 · 늦은 퇴실 1시간 추가 요금 (없으면 10,000원) */
  extraHourFee: number;
  /** 주차 관리 (없으면 꺼짐) */
  parking: ParkingSettings;
  /** 카드 수수료율 % (현장 카드 결제에만, 없으면 없음) */
  cardFeeRate: number | null;
  /** 판매 캘린더: 타입별 평일/주말/기본 1박 (기본값만 · 예약 진실은 night_rates) */
  typeRates: TypeRatesMap;
  /** 판매 캘린더: 타입×숙박일 요금 오버라이드 */
  typeRateOverrides: TypeRateOverridesMap;
  /** 판매 캘린더: 타입×숙박일 판매 중지 */
  typeStopSell: TypeStopSellMap;
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

export interface Coupon {
  amount: number;
  /** 숙소 부담 (입금에서 빠져요). 아니면 플랫폼 부담 */
  hotel: boolean;
}
export interface RoomSegment {
  roomId: string;
  nights: number;
}
export interface Booking {
  id: string;
  kind: Kind;
  status: Status;
  platformId: string;
  price: number; // 총액 (금액미정이면 0 + priceUnset)
  /** 판매가 미확정(금액미정). true면 price는 0 · 잔금/완납은 확정 전까지 보류 */
  priceUnset?: boolean;
  guestName: string;
  /** 손님 연락처 (없으면 null) */
  guestPhone?: string | null;
  typeId: string; // 판 타입
  roomId: string | null; // 방 (객실 이동이 있으면 첫 방)
  /** 객실 이동: 방별 박수 [{roomId: 301, nights: 1}, {roomId: 305, nights: 3}]. 없으면 roomId 한 방에 전부 */
  segments?: RoomSegment[] | null;
  checkIn: string; // YYYY-MM-DD
  nights: number | null; // 숙박만
  startTime: string | null; // HH:MM (대실만)
  endTime: string | null;
  arrived: boolean;
  /** 임시 배치: 방(roomId)을 잡은 뒤 확정 전 표시 (재고는 확정과 동일 점유). roomId 없으면 불가 */
  tentative?: boolean;
  /** 청소X: 이 투숙은 청소하지 않음 (예약 단위 · 현장 운영 플래그) */
  noClean?: boolean;
  /** 중도 퇴실: 손님이 떠난 영업일 (입실 다음 날 ~ 퇴실 전날). 그날 밤부터는 방이 비어요. 없으면 끝까지 묵어요 */
  earlyOut?: string | null;
  /** 중도 퇴실 때 돌려준 금액 (없으면 환불 없음). 매출에서는 중도 퇴실한 날짜에 빠져요 */
  refund?: number | null;
  memo: string | null;
  /** 인원 (안 적었으면 없음) */
  guests?: number | null;
  /** 판매 가격(price)에 들어 있는 추가 인원 금액 */
  extraFee?: number | null;
  /** 빠른 입실: 기본 입실 시간보다 몇 시간 일찍 (숙박만) */
  earlyIn?: number | null;
  /** 늦은 퇴실: 기본 퇴실 시간보다 몇 시간 늦게 (숙박만) */
  lateOut?: number | null;
  /**
   * 정상 퇴실처리 시각 (ISO). null/없으면 아직 퇴실 전.
   * 중도 퇴실(earlyOut)과 별개 — 재사용 금지.
   */
  checkedOutAt?: string | null;
  /** 숙박 유형: 일반 · 장기(퇴실 미정). 없으면 일반 */
  stayMode?: StayMode;
  /** 장기 요금표 (flat/dow). 일반은 없음 */
  longStayRate?: LongStayRate | null;
  /** 장기 정산 주기. 일반은 없음 */
  settleCycle?: SettleCycle | null;
  /** 장기 박별 누적 원장. 미수 = 합 − payments */
  charges?: NightCharge[];
  /** 판매 가격(price)에 들어 있는 시간 추가 금액 (0 + 시간 있음 = 서비스) */
  timeFee?: number | null;
  /** 주차: 도보 · 차량 (안 적었으면 없음) */
  arrival?: "walk" | "car" | null;
  cars?: number | null;
  plates?: string[] | null;
  /** 판매 가격(price)에 들어 있는 추가 차량 금액 */
  carFee?: number | null;
  /** 판매 가격에서 빠진 도보 할인 */
  walkOff?: number | null;
  /** 쿠폰: 금액 · 숙소 부담 여부 (판매 가격은 쿠폰 빼기 전 금액 그대로) */
  coupons?: Coupon[] | null;
  /** 플랫폼 입금 확인 · 실제 입금액 (없으면 입금 예정가 그대로 들어온 걸로) */
  payoutOk?: boolean;
  payoutAmount?: number | null;
  /** 단체 예약 묶음 (같은 단체의 방들은 같은 값) */
  groupId?: string | null;
  groupName?: string | null;
  /**
   * 표준 숙박 방별·밤별 요금 ({ flat, weekday?, weekend?, nights:{date:amount} }).
   * nights 행렬이 LOS를 덮으면 객실료 진실 = Σ nights. 장기 charges와 별개.
   */
  nightRates?: StayNightRates | null;
  /** 받은 돈 (선금·잔금). 장부·현황판이 잔금을 계산해요 */
  payments?: Payment[];
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const BUSINESS_DAY_CUTOFF_HOUR = 6;
export const HOTEL_TIME_ZONE = "Asia/Seoul";

/** 건물 정보가 없던 예전 설정은 모두 이 건물 하나로 봐요 (DB 마이그레이션과 같은 id) */
export const DEFAULT_BUILDING: Building = { id: "b-main", name: "본관" };

export function emptySettings(): HotelSettings {
  return {
    buildings: [{ ...DEFAULT_BUILDING }],
    floors: [],
    types: [],
    platforms: [],
    lowThreshold: 2,
    shopItems: [],
    expenseCategories: normalizeExpenseCategories(undefined),
    surchargeTiers: normalizeTiers(undefined),
    specialDates: [],
    stayTimes: normalizeStayTimes(undefined),
    dayuseDefaults: normalizeDayuseDefaults(undefined),
    extraHourFee: DEFAULT_HOUR_FEE,
    parking: normalizeParking(undefined),
    cardFeeRate: null,
    typeRates: {},
    typeRateOverrides: {},
    typeStopSell: {},
  };
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
    platforms: Array.isArray(s.platforms)
      ? s.platforms
          .filter((p) => p && typeof p.id === "string")
          .map((p) => {
            const { color, ...rest } = normalizePlatformFee(p);
            const name = typeof rest.name === "string" && rest.name.trim() ? rest.name.trim() : "플랫폼";
            const abbr = platformAbbr({ name, abbr: typeof rest.abbr === "string" ? rest.abbr : "" });
            const base = { ...rest, name, abbr };
            return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? { ...base, color: color.toUpperCase() } : base;
          })
      : [],
    lowThreshold: Number.isInteger(th) && th >= 0 && th <= 20 ? th : 2,
    shopItems: normalizeShopItems((s as { shopItems?: unknown }).shopItems),
    expenseCategories: normalizeExpenseCategories((s as { expenseCategories?: unknown }).expenseCategories),
    surchargeTiers: normalizeTiers((s as { surchargeTiers?: unknown }).surchargeTiers),
    specialDates: normalizeSpecialDates((s as { specialDates?: unknown }).specialDates),
    stayTimes: normalizeStayTimes((s as { stayTimes?: unknown }).stayTimes),
    dayuseDefaults: normalizeDayuseDefaults((s as { dayuseDefaults?: unknown }).dayuseDefaults),
    extraHourFee: normalizeHourFee((s as { extraHourFee?: unknown }).extraHourFee),
    parking: normalizeParking((s as { parking?: unknown }).parking),
    cardFeeRate: normalizeRate((s as { cardFeeRate?: unknown }).cardFeeRate),
    typeRates: normalizeTypeRates((s as { typeRates?: unknown }).typeRates),
    typeRateOverrides: normalizeTypeRateOverrides((s as { typeRateOverrides?: unknown }).typeRateOverrides),
    typeStopSell: normalizeTypeStopSell((s as { typeStopSell?: unknown }).typeStopSell),
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

/** 숙박 박수 범위 (예약 창·단체와 동일) */
export const STAY_NIGHTS_MIN = 1;
export const STAY_NIGHTS_MAX = 90;

/** 숙박 박수 클램프 (1~90). NaN·비유한 값은 1박 */
export function clampStayNights(n: number): number {
  if (!Number.isFinite(n)) return STAY_NIGHTS_MIN;
  return Math.min(STAY_NIGHTS_MAX, Math.max(STAY_NIGHTS_MIN, Math.round(n)));
}

/**
 * 입실·퇴실 → 박수.
 * 호텔: 퇴실일 아침 = 마지막 밤 다음 날 → nights = daysBetween(입실, 퇴실).
 * 예: 10/20 입실 · 10/28 퇴실 = 8박. 퇴실 ≤ 입실이면 1박.
 */
export function nightsFromStayDates(checkIn: string, checkOutDate: string): number {
  return clampStayNights(daysBetween(checkIn, checkOutDate));
}

/** 입실·박수 → 퇴실일 (장부 checkOut과 같은 산술, 박수만 클램프) */
export function checkOutFromStayNights(checkIn: string, nights: number): string {
  return addDays(checkIn, clampStayNights(nights));
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

/**
 * 물리 방을 아직 쓰는 활성 숙박.
 * 퇴실처리(`checkedOutAt`)되면 장부는 남지만 충돌·빈방에서 제외 (보드 공실과 맞춤).
 */
export function occupiesRoom(b: Pick<Booking, "status" | "checkedOutAt">): boolean {
  return isActive(b) && !b.checkedOutAt;
}
export function occupiesNight(b: Pick<Booking, "kind" | "checkIn" | "nights" | "earlyOut">, date: string): boolean {
  if (b.kind !== "stay" || !b.nights) return false;
  return b.checkIn <= date && date < addDays(b.checkIn, usedNights(b) ?? b.nights);
}
// ---------- 중도 퇴실 ----------
type EarlyPick = Pick<Booking, "kind" | "checkIn" | "nights" | "earlyOut">;
/** 중도 퇴실이 맞게 적혀 있나요: 숙박 2박 이상, 입실 다음 날 ~ 퇴실 전날 */
export const isEarlyOut = (b: EarlyPick): boolean =>
  b.kind === "stay" && !!b.nights && !!b.earlyOut && b.earlyOut > b.checkIn && b.earlyOut < addDays(b.checkIn, b.nights);
/** 실제로 묵은 박수 (중도 퇴실이 없으면 예약 박수 그대로) */
export function usedNights(b: EarlyPick): number | null {
  if (b.kind !== "stay" || !b.nights) return b.nights ?? null;
  return isEarlyOut(b) ? daysBetween(b.checkIn, b.earlyOut!) : b.nights;
}
/** 실제 퇴실일 (중도 퇴실이면 그날) */
export const stayEnd = (b: EarlyPick): string => addDays(b.checkIn, usedNights(b) ?? 0);

/** 장부 이용내역: 입실전 · 이용중 · 완료 (취소·노쇼는 null) */
export type StayPhase = "pre" | "in" | "done";
type PhasePick = Pick<Booking, "status" | "arrived" | "checkedOutAt" | "kind" | "checkIn" | "nights" | "earlyOut">;
export function stayPhase(b: PhasePick): StayPhase | null {
  if (b.status !== "active") return null;
  if (b.checkedOutAt || isEarlyOut(b)) return "done";
  if (b.arrived) return "in";
  return "pre";
}
export const STAY_PHASE_LABEL: Record<StayPhase, string> = { pre: "입실전", in: "이용중", done: "완료" };
/** 장부 상태 열: 취소·노쇼 · 입실전/이용중/완료 */
export function stayStatusLabel(b: PhasePick): string {
  if (b.status === "cancelled") return "취소";
  if (b.status === "noshow") return "노쇼";
  const p = stayPhase(b);
  return p ? STAY_PHASE_LABEL[p] : "";
}
/** 장부 입–퇴 열 (숙박=입실–퇴실 · 대실=시작~종료) */
export function stayInOutLabel(b: Pick<Booking, "kind" | "checkIn" | "nights" | "earlyOut" | "startTime" | "endTime">): string {
  if (b.kind !== "stay") return `${b.startTime ?? "?"}~${b.endTime ?? "?"}`;
  return `${md(b.checkIn)}–${md(stayEnd(b))}`;
}

/** 장부 일주일 입실현황: 대실 · 숙박(1박) · 연박(≥2박). 취소·노쇼 제외 */
export type CheckinStripKind = "dayuse" | "stay" | "multi";
export interface CheckinStripCounts {
  dayuse: number;
  stay: number;
  multi: number;
}
export const CHECKIN_STRIP_LABEL: Record<CheckinStripKind, string> = {
  dayuse: "대실",
  stay: "숙박",
  multi: "연박",
};
/** 입실일 기준 분류 (취소·노쇼 → null) */
export function checkinStripKind(b: Pick<Booking, "kind" | "nights" | "status">): CheckinStripKind | null {
  if (b.status !== "active") return null;
  if (b.kind === "dayuse") return "dayuse";
  if (b.kind === "stay") {
    const n = b.nights ?? 0;
    if (n === 1) return "stay";
    if (n >= 2) return "multi";
  }
  return null;
}
/** 날짜별 대실/숙박/연박 건수 (입실일 = checkIn · dates에 없는 날은 생략) */
export function weekCheckinCounts(
  bookings: readonly Pick<Booking, "kind" | "nights" | "status" | "checkIn">[],
  dates: readonly string[],
): Map<string, CheckinStripCounts> {
  const out = new Map<string, CheckinStripCounts>(dates.map((d) => [d, { dayuse: 0, stay: 0, multi: 0 }]));
  for (const b of bookings) {
    const k = checkinStripKind(b);
    if (!k) continue;
    const cell = out.get(b.checkIn);
    if (cell) cell[k] += 1;
  }
  return out;
}
/** 달력 주(월~일) 7일 · weekStart와 동일 */
export function weekDates(anchor: string): string[] {
  const a = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(a, i));
}
/** 중도 퇴실 단추를 보여 줄까요: 정상 숙박 2박 이상, 오늘(영업일)이 첫 밤 다음 날 ~ 퇴실 전날 */
export const canEarlyOutToday = (b: Pick<Booking, "kind" | "checkIn" | "nights" | "status" | "earlyOut">, today: string): boolean =>
  b.status === "active" && b.kind === "stay" && !!b.nights && b.nights >= 2 && !isEarlyOut(b) && today > b.checkIn && today < addDays(b.checkIn, b.nights);
/** 고를 수 있는 퇴실 날짜들 (입실 다음 날 ~ 퇴실 전날) */
export const earlyOutDates = (b: Pick<Booking, "checkIn" | "nights">): string[] =>
  Array.from({ length: Math.max(0, (b.nights ?? 0) - 1) }, (_, i) => addDays(b.checkIn, i + 1));
export const EARLY_OUT_COPY = "중도 퇴실";
/** "3박 중 2박 이용" */
export const usedLabel = (b: EarlyPick) => `${b.nights}박 중 ${usedNights(b)}박 이용`;
/** 중도 퇴실 확인: 날짜·환불 금액 */
export function validateEarlyOut(b: Booking, date: string, refund: number | null): string | null {
  if (b.status !== "active") return "취소·노쇼 예약은 중도 퇴실할 수 없어요.";
  if (b.kind !== "stay" || !b.nights || b.nights < 2) return "2박 이상 숙박만 중도 퇴실할 수 있어요.";
  if (!(date > b.checkIn && date < addDays(b.checkIn, b.nights))) return "퇴실 날짜는 입실 다음 날부터 원래 퇴실 전날까지예요.";
  if (refund != null && (!Number.isInteger(refund) || refund < 0)) return "환불 금액을 숫자로 적어 주세요.";
  if (refund != null && refund > b.price) return `환불 금액은 결제 금액(${won(b.price)}원)보다 클 수 없어요.`;
  return null;
}
/**
 * 중도 퇴실 되돌리기를 막아야 하나요: 비운 밤에 다른 예약이 그 방에 들어왔거나,
 * 되돌리면 그 밤 남은 객실이 모자라요(새로 오버부킹). 막을 이유(문구) 또는 null
 */
export function earlyOutUndoBlock(s: HotelSettings, bookings: Booking[], b: Booking, roomLabel: (id: string | null) => string | null = (x) => x): string | null {
  if (!isEarlyOut(b)) return null;
  const back: Booking = { ...b, earlyOut: null, refund: null };
  const freed = Array.from({ length: b.nights! - usedNights(b)! }, (_, i) => addDays(b.earlyOut!, i));
  const others = bookings.filter((x) => x.id !== b.id);
  for (const d of freed) {
    const room = roomOnNight(back, d);
    if (!room) continue;
    const hit = others.find((x) => isActive(x) && roomOnNight(x, d) === room);
    if (hit) return `${dayLabel(d)} 밤 ${roomLabel(room) ?? "?"}호에 ${hit.guestName} 님 예약이 들어와서 되돌릴 수 없어요. 그 예약을 먼저 옮겨 주세요.`;
  }
  const before = stockTable(s, others, freed);
  const after = stockTable(s, [...others, back], freed);
  for (const [tid, row] of after)
    for (const [d, n] of row)
      if (n < 0 && n < (before.get(tid)?.get(d) ?? 0)) {
        const t = s.types.find((x) => x.id === tid);
        return `${dayLabel(d)} 밤 ${typeLabel(t) || "그 타입"} 남은 객실이 없어서 되돌릴 수 없어요 (비운 방이 다시 팔렸어요).`;
      }
  return null;
}
// ---------- 매출 (취소 · 노쇼 · 중도 퇴실) ----------
/**
 * 예약 하나가 매출에 남기는 금액:
 *  · 취소 = 0 (전액 환불)
 *  · 노쇼 = 결제 금액 그대로 (받은 돈)
 *  · 중도 퇴실 = 결제 금액 − 환불
 */
export function revenueOf(b: Pick<Booking, "status" | "price" | "kind" | "checkIn" | "nights" | "earlyOut" | "refund">): number {
  if (b.status === "cancelled") return 0;
  return b.price - (b.status === "active" && isEarlyOut(b) ? (b.refund ?? 0) : 0);
}
export const countsRevenue = (b: Pick<Booking, "status">) => b.status !== "cancelled";
/**
 * 기간 매출 (날짜를 정직하게): 결제 금액은 입실일에, 중도 퇴실 환불은 퇴실한 날에 잡아요.
 * 그래서 9/30 입실 · 10/2 중도 퇴실 환불은 10월 매출에서 빠져요.
 */
export function roomRevenue(bookings: Booking[], from: string, to: string): { sales: number; refunds: number; net: number } {
  let sales = 0;
  let refunds = 0;
  for (const b of bookings) {
    if (!countsRevenue(b)) continue;
    if (b.checkIn >= from && b.checkIn <= to) sales += b.price;
    if (b.status === "active" && isEarlyOut(b) && b.refund && b.earlyOut! >= from && b.earlyOut! <= to) refunds += b.refund;
  }
  return { sales, refunds, net: sales - refunds };
}
// ---------- 객실 이동 (한 예약, 방 여러 개) ----------
/** 한 방에 머무는 구간: 입실일·박수·방. 이동이 없으면 구간 하나 */
export interface Leg {
  roomId: string | null;
  checkIn: string;
  nights: number;
  idx: number;
}
const segsValid = (segs: RoomSegment[] | null | undefined, nights: number | null): segs is RoomSegment[] =>
  !!segs && segs.length >= 2 && !!nights && segs.every((x) => x.roomId && x.nights >= 1) && segs.reduce((n, x) => n + x.nights, 0) === nights;
type LegPick = Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments" | "earlyOut">;
/**
 * 실제로 묵는 구간들: 중도 퇴실이면 떠난 날 밤부터는 잘라내요 (그 밤은 방·재고가 비어요).
 * 재고·방 비었는지·현황판은 모두 이걸로 봐요.
 */
export function legsOf(b: LegPick): Leg[] {
  const all = fullLegsOf(b);
  if (!isEarlyOut(b)) return all;
  const end = b.earlyOut!;
  return all
    .filter((l) => l.checkIn < end)
    .map((l) => ({ ...l, nights: Math.min(l.nights, daysBetween(l.checkIn, end)) }));
}
/** 중도 퇴실로 비운 구간 (캘린더의 흐린 꼬리). 없으면 빈 배열 */
export function freedLegsOf(b: LegPick): Leg[] {
  if (!isEarlyOut(b)) return [];
  const end = b.earlyOut!;
  return fullLegsOf(b)
    .filter((l) => addDays(l.checkIn, l.nights) > end)
    .map((l) => (l.checkIn >= end ? l : { ...l, checkIn: end, nights: daysBetween(end, addDays(l.checkIn, l.nights)) }));
}
/** 예약한 대로의 구간들 (중도 퇴실과 상관없이 처음 박수 전부) — 객실 이동 구간 고치기용 */
export function fullLegsOf(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments">): Leg[] {
  if (b.kind !== "stay" || !b.nights) return [];
  if (!segsValid(b.segments, b.nights)) return [{ roomId: b.roomId, checkIn: b.checkIn, nights: b.nights, idx: 0 }];
  let d = b.checkIn;
  return b.segments.map((x, idx) => {
    const leg = { roomId: x.roomId, checkIn: d, nights: x.nights, idx };
    d = addDays(d, x.nights);
    return leg;
  });
}
export const isMoved = (b: Pick<Booking, "kind" | "nights" | "segments">) => b.kind === "stay" && segsValid(b.segments, b.nights);
/** 그 밤에 쓰는 방 (그 밤에 안 묵으면 undefined) */
export function roomOnNight(b: LegPick, date: string): string | null | undefined {
  for (const l of legsOf(b)) if (l.checkIn <= date && date < addDays(l.checkIn, l.nights)) return l.roomId;
  return undefined;
}
/** 묵는 방 전부 (순서대로, 겹치지 않게) */
export function stayRoomIds(b: LegPick): string[] {
  const legs = fullLegsOf(b);
  const ids = (legs.length ? legs.map((l) => l.roomId) : [b.roomId]).filter((x): x is string => !!x);
  return [...new Set(ids)];
}
/** 이웃한 같은 방은 합치고, 하나만 남으면 null (이동 없음) */
export function normalizeSegments(segs: RoomSegment[] | null | undefined): RoomSegment[] | null {
  if (!segs) return null;
  const out: RoomSegment[] = [];
  for (const x of segs) {
    if (!x.roomId || x.nights < 1) continue;
    const last = out[out.length - 1];
    if (last && last.roomId === x.roomId) last.nights += x.nights;
    else out.push({ roomId: x.roomId, nights: x.nights });
  }
  return out.length >= 2 ? out : null;
}
/**
 * 박수·첫 방이 바뀌었을 때 구간을 맞춰요: 첫 구간 방 = roomId, 박수가 늘면 마지막 방에 더하고 줄면 뒤에서부터 덜어요.
 * 방이 없거나 대실이면 이동 없음.
 */
export function fitSegments(segs: RoomSegment[] | null | undefined, roomId: string | null, nights: number | null): RoomSegment[] | null {
  if (!segs || segs.length < 2 || !roomId || !nights) return null;
  const out = segs.map((x) => ({ ...x }));
  out[0].roomId = roomId;
  let sum = out.reduce((n, x) => n + x.nights, 0);
  if (sum < nights) out[out.length - 1].nights += nights - sum;
  while (sum > nights && out.length) {
    const last = out[out.length - 1];
    const cut = Math.min(last.nights, sum - nights);
    last.nights -= cut;
    sum -= cut;
    if (!last.nights) out.pop();
  }
  return normalizeSegments(out);
}
/** k박째(2..N) 밤부터 끝까지 roomId로 옮겨요. 결과 구간(이동이 없어지면 null) */
export function moveStay(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments">, fromNight: number, roomId: string): RoomSegment[] | null {
  const n = b.nights ?? 0;
  if (b.kind !== "stay" || fromNight < 2 || fromNight > n || !b.roomId) return isMoved(b) ? b.segments! : null;
  const keep: RoomSegment[] = [];
  let left = fromNight - 1;
  for (const l of fullLegsOf(b)) {
    if (left <= 0) break;
    const take = Math.min(left, l.nights);
    keep.push({ roomId: l.roomId!, nights: take });
    left -= take;
  }
  return normalizeSegments([...keep, { roomId, nights: n - fromNight + 1 }]);
}
/** 이동 취소: idx번째 구간(1부터)을 앞 방으로 되돌려 합쳐요 */
export function undoMove(b: Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments">, idx: number): RoomSegment[] | null {
  if (!isMoved(b) || idx < 1 || idx >= b.segments!.length) return isMoved(b) ? b.segments! : null;
  const segs = b.segments!.map((x) => ({ ...x }));
  segs[idx - 1].nights += segs[idx].nights;
  segs.splice(idx, 1);
  return normalizeSegments(segs);
}
// ---------- 객실 배치에서 바로 옮기기 ----------
/** 방 배정 상태 그대로 (되돌리기용) */
export interface Placement {
  roomId: string | null;
  segments: RoomSegment[] | null;
}
export const placementOf = (b: Pick<Booking, "kind" | "nights" | "roomId" | "segments">): Placement => ({
  roomId: b.roomId,
  segments: isMoved(b) ? b.segments!.map((x) => ({ ...x })) : null,
});
/**
 * 보는 밤(night)에서 옮길 때 어디부터 옮기나요:
 * 보는 밤이 첫 밤(또는 그 앞)이면 숙박 전체, 아니면 그 밤부터 퇴실까지. 대실은 늘 전체.
 * 돌려주는 값: k박째(1부터)와 옮기는 밤들(checkIn·nights)
 */
export function boardMoveWindow(b: Pick<Booking, "kind" | "checkIn" | "nights" | "earlyOut">, night: string): { from: number; whole: boolean; checkIn: string; nights: number } {
  const n = b.kind === "stay" ? (b.nights ?? 0) : 0;
  if (!n) return { from: 1, whole: true, checkIn: b.checkIn, nights: 0 };
  // 중도 퇴실했으면 실제로 묵은 밤까지만 비어 있으면 돼요
  const u = usedNights(b) ?? n;
  const k = Math.min(u, Math.max(1, Math.round((Date.parse(night) - Date.parse(b.checkIn)) / 864e5) + 1));
  return { from: k, whole: k === 1, checkIn: addDays(b.checkIn, k - 1), nights: u - k + 1 };
}
/** 객실 배치에서 roomId로 옮긴 결과 (첫 밤이면 방만 바꾸고, 중간 밤이면 그 밤에서 나눠요) */
export function boardMove(b: LegPick, night: string, roomId: string): Placement {
  const w = boardMoveWindow(b, night);
  if (b.kind !== "stay" || w.whole || !b.roomId) return { roomId, segments: null };
  const segs = moveStay(b, w.from, roomId);
  return segs ? { roomId: segs[0].roomId, segments: segs } : { roomId, segments: null };
}
/**
 * 옮길 수 있는 방: 숙박은 보는 밤부터 퇴실까지 내내 빈 방.
 * 대실은 그날 그 시간에 다른 대실과 안 겹치는 방 (숙박 방은 허용 · UI 경고).
 * 지금 그 밤에 쓰는 방은 빼요.
 */
export function boardMoveTargets(s: HotelSettings, bookings: Booking[], b: Booking, night: string): Set<string> {
  if (b.kind === "stay") {
    const w = boardMoveWindow(b, night);
    const free = freeRooms(s, bookings, { id: b.id, kind: "stay", checkIn: w.checkIn, nights: w.nights, startTime: null, endTime: null });
    const cur = roomOnNight(b, w.checkIn);
    if (cur) free.delete(cur);
    return free;
  }
  const free = freeRooms(s, bookings, b);
  if (b.roomId) free.delete(b.roomId);
  return free;
}

/** 이 숙박(초안)의 구간 중 다른 정상 숙박과 같은 방·같은 밤이 겹치는 구간 */
export function legConflicts(bookings: Booking[], draft: Booking): Leg[] {
  if (draft.kind !== "stay") return [];
  const mine = legsOf(draft).filter((l) => l.roomId);
  // 퇴실처리된 건은 물리 충돌에서 제외 (장부·재고는 유지)
  const others = bookings.filter((b) => b.id !== draft.id && occupiesRoom(b) && b.kind === "stay").flatMap((b) => legsOf(b));
  return mine.filter((m) => others.some((o) => legsClash(m, o)));
}

/**
 * 퇴실처리된 숙박 중 draft와 같은 방·밤이 겹치는 건.
 * freeRooms에는 안 막히지만 배정 시 「덮어쓰기 / 퇴실 숙박 이동」 선택 모달용.
 */
export function checkedOutRoomOverlaps(bookings: Booking[], draft: Booking): Booking[] {
  if (draft.kind !== "stay") return [];
  const mine = legsOf(draft).filter((l) => l.roomId);
  if (!mine.length) return [];
  return bookings.filter((b) => {
    if (b.id === draft.id || !isActive(b) || b.kind !== "stay" || !b.checkedOutAt) return false;
    const other = legsOf(b).filter((l) => l.roomId);
    return mine.some((m) => other.some((o) => legsClash(m, o)));
  });
}

/** 활성 투숙끼리 방 맞교환 계획 (A→Y · B→X). 중간 밤 부분 이동은 MVP 제외. */
export interface RoomSwapPlan {
  a: Booking;
  b: Booking;
  fromRoomId: string;
  toRoomId: string;
  aPlace: Placement;
  bPlace: Placement;
}

/**
 * A를 toRoomId로 옮길 때 그 방을 쓰는 활성 숙박 B가 정확히 1건이고,
 * A↔B 맞교환 후 제3자와 안 겹치면 계획을 돌려요. 아니면 null.
 * · 퍼즐 맞교환 = 숙박 전체 A↔B (원자). night 인자는 무시 — 보드가 중간 밤이어도
 *   점유↔점유를 막지 않음 (605↔608 · 퇴실예정/숙박/숙박예약 무관).
 * · 퇴실완료만 겹침 → null (덮어쓰기 모달 경로)
 * · 빈 방 → null (일반 이동 경로)
 */
export function proposeRoomSwap(
  bookings: Booking[],
  a: Booking,
  toRoomId: string,
  _night?: string,
): RoomSwapPlan | null {
  if (a.kind !== "stay" || !occupiesRoom(a) || !toRoomId) return null;
  // 항상 첫 밤·전체 숙박 기준 (부분 이동 ≠ 맞교환)
  const night0 = a.checkIn;
  const w = boardMoveWindow(a, night0);
  if (!w.whole || w.nights <= 0) return null;
  const fromRoomId = roomOnNight(a, night0) ?? a.roomId;
  if (!fromRoomId || fromRoomId === toRoomId) return null;

  const peers = bookings.filter((b) => {
    if (b.id === a.id || !occupiesRoom(b) || b.kind !== "stay") return false;
    return legsOf(b).some((l) => l.roomId === toRoomId && nightsOverlap(l, w));
  });
  if (peers.length !== 1) return null;
  const b = peers[0];

  const aPlace = boardMove(a, night0, toRoomId);
  const bPlace = boardMove(b, b.checkIn, fromRoomId);
  const next = bookings.map((x) => {
    if (x.id === a.id) return { ...x, roomId: aPlace.roomId, segments: aPlace.segments };
    if (x.id === b.id) return { ...x, roomId: bPlace.roomId, segments: bPlace.segments };
    return x;
  });
  const a2 = next.find((x) => x.id === a.id)!;
  const b2 = next.find((x) => x.id === b.id)!;
  if (legConflicts(next, a2).length || legConflicts(next, b2).length) return null;

  return { a, b, fromRoomId, toRoomId, aPlace, bPlace };
}

/**
 * 객실 이동 중 맞교환 가능 방 → plan.
 * boardMoveTargets(빈 방)와 겹치지 않음 · 점유 칸만.
 */
export function boardSwapTargets(
  s: HotelSettings,
  bookings: Booking[],
  a: Booking,
  night: string,
): Map<string, RoomSwapPlan> {
  const out = new Map<string, RoomSwapPlan>();
  if (a.kind !== "stay") return out;
  const free = boardMoveTargets(s, bookings, a, night);
  for (const r of allRooms(s)) {
    if (free.has(r.id)) continue;
    const plan = proposeRoomSwap(bookings, a, r.id, night);
    if (plan) out.set(r.id, plan);
  }
  return out;
}
/** 구간 둘이 같은 방에서 밤이 겹치는지 */
export function legsClash(a: Leg, b: Leg): boolean {
  return !!a.roomId && a.roomId === b.roomId && a.checkIn < addDays(b.checkIn, b.nights) && b.checkIn < addDays(a.checkIn, a.nights);
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
    // 밤마다 그 밤에 실제로 쓰는 방의 타입에서 빼요 (객실 이동이면 구간마다 달라요)
    for (const l of legsOf(b)) {
      if (buildingId && rooms.get(l.roomId ?? "")?.buildingId !== buildingId) continue;
      const row = table.get(effectiveTypeId({ typeId: b.typeId, roomId: l.roomId }, rooms));
      if (!row) continue;
      for (let i = 0; i < l.nights; i++) {
        const d = addDays(l.checkIn, i);
        if (dateSet.has(d)) row.set(d, row.get(d)! - 1);
      }
    }
  }
  return table;
}
export function remaining(s: HotelSettings, bookings: Booking[], typeId: string, date: string): number {
  return stockTable(s, bookings, [date]).get(typeId)?.get(date) ?? 0;
}

/**
 * 판매 캘린더·과거 창: 구간 조회 목록에 방금 저장한 로컬 예약을 합쳐요 (live가 같은 id면 우선).
 * 저장 직후 hard refresh 없이 재고가 반영되게.
 */
export function mergeViewBookings(fetched: Booking[], live: Booking[]): Booking[] {
  const m = new Map<string, Booking>();
  for (const b of fetched) m.set(b.id, b);
  for (const b of live) m.set(b.id, b);
  return [...m.values()];
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
      isActive(b) &&
      legsOf(b).some(
        (l) => !(l.roomId && rooms.has(l.roomId)) && Array.from({ length: l.nights }, (_, i) => addDays(l.checkIn, i)).some((d) => set.has(d)),
      ),
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
export type BoardTab = "now" | "stock" | "rooms" | "calendar" | "parking";
/** '#/board/now' → now, '#/board/rooms' → rooms, … 그 밖에는 null (기기에 남긴 탭을 써요) */
export function boardTabFromHash(hash: string): BoardTab | null {
  const m = /^#\/board\/(now|stock|rooms|calendar|parking)\/?$/.exec(hash);
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
    for (const l of legsOf(b)) {
      const tid = effectiveTypeId({ typeId: b.typeId, roomId: l.roomId }, rooms);
      for (let i = 0; i < l.nights; i++) {
        const d = addDays(l.checkIn, i);
        keys.set(`${tid}@${d}`, { date: d, typeId: tid });
      }
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
/**
 * 그 방·그 밤에 보여 줄 숙박: 물리 점유(`occupiesRoom`)가 우선, 없으면 취소된 예약을 줄 그어 보여 줘요.
 * 퇴실처리(`checkedOutAt`)된 활성 예약은 공실 — 「현황」`nowByRoom`과 맞춤.
 * (조기 퇴실 후 같은 날 재배정 시 예전 손님이 「배치」에 남는 버그 방지)
 */
export function boardEntryForRoom(bookings: Booking[], roomId: string, date: string): Booking | null {
  let cancelled: Booking | null = null;
  for (const b of bookings) {
    if (b.kind !== "stay" || roomOnNight(b, date) !== roomId) continue;
    if (occupiesRoom(b)) return b;
    if (isActive(b)) continue; // 퇴실처리됨 · 칸 비움 (새 예약은 occupiesRoom으로 선택)
    if (!cancelled || (b.cancelledAt ?? "") > (cancelled.cancelledAt ?? "")) cancelled = b;
  }
  return cancelled;
}

/**
 * 취소 예약이 보드에서 사라지는지: 그 자리(같은 방, 겹치는 밤)를 새 예약이 채웠으면 사라져요.
 * 방이 없던 취소는 같은 타입 숙박이 취소 뒤에 새로 들어와 겹치는 밤을 채우면 사라져요.
 */
export function isCancelledRefilled(c: Booking, bookings: Booking[], rooms: Map<string, Room>, leg?: Leg): boolean {
  if (isActive(c)) return false;
  // 객실 이동한 예약은 구간마다 따로 봐요 (구간을 안 주면 첫 구간)
  const cl = c.kind === "stay" ? (leg ?? legsOf(c)[0]) : undefined;
  return bookings.some((b) => {
    if (b.id === c.id || !isActive(b) || b.kind !== c.kind) return false;
    if (c.kind === "stay") {
      if (cl?.roomId) return legsOf(b).some((l) => legsClash(l, cl));
      if (!nightsOverlap({ checkIn: b.checkIn, nights: usedNights(b) }, c)) return false;
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
const legOn = (b: Booking, date: string) => legsOf(b).find((l) => l.checkIn <= date && date < addDays(l.checkIn, l.nights));
export function nightBoard(s: HotelSettings, bookings: Booking[], date: string): NightBoard {
  const rooms = roomMap(s);
  const byRoom = new Map<string, Booking>();
  for (const r of rooms.values()) {
    const b = boardEntryForRoom(bookings, r.id, date);
    if (b && (isActive(b) || !isCancelledRefilled(b, bookings, rooms, legOn(b, date)))) byRoom.set(r.id, b);
  }
  const visible = (b: Booking) => isActive(b) || !isCancelledRefilled(b, bookings, rooms, legOn(b, date));
  const unassigned = bookings
    .filter((b) => {
      if (b.kind !== "stay" || !occupiesNight(b, date)) return false;
      const rid = roomOnNight(b, date);
      return (!rid || !rooms.has(rid)) && visible(b);
    })
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
    // 퇴실처리 = 물리 점유 아님 → 칸/칩에 노출 (활성 투숙만 막음)
    if (b.id === draft.id || !occupiesRoom(b) || !b.roomId) continue;
    if (draft.kind === "stay") {
      if (b.kind === "stay") for (const l of legsOf(b)) if (l.roomId && nightsOverlap(l, draft)) free.delete(l.roomId);
    } else if (b.kind === "dayuse" && b.checkIn === draft.checkIn && timesOverlap(b, draft as Booking)) {
      free.delete(b.roomId);
    }
  }
  return free;
}

/**
 * 호실 배정 칩용: 본관·별관 빈 방을 **하나의 목록**으로.
 * 정렬: 예약 타입 일치 → 방 번호 → 건물 순서. (건물 탭/필터로 한쪽을 숨기지 않음)
 * 예전 flat+slice(0,N)은 본관이 앞에 와서 별관이 잘렸음.
 */
export function assignableRooms(
  s: HotelSettings,
  free: Set<string>,
  typeId: string | null | undefined,
): PlacedRoom[] {
  const bs = s.buildings?.length ? s.buildings : [DEFAULT_BUILDING];
  const bIdx = new Map(bs.map((b, i) => [b.id, i]));
  return allRooms(s)
    .filter((r) => free.has(r.id))
    .sort((a, c) => {
      const t = Number(a.typeId !== typeId) - Number(c.typeId !== typeId);
      if (t) return t;
      const n = a.no.localeCompare(c.no, "ko", { numeric: true });
      if (n) return n;
      return (bIdx.get(a.buildingId) ?? 0) - (bIdx.get(c.buildingId) ?? 0);
    });
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
  if (b.priceUnset) {
    if (b.price !== 0) return "금액미정이면 판매 가격은 비워 두세요.";
  } else if (!Number.isFinite(b.price) || b.price < 0) {
    return "판매 가격을 적어 주세요.";
  }
  if ((b.coupons ?? []).reduce((n, c) => n + (c.amount > 0 ? c.amount : 0), 0) > b.price) return "쿠폰 합계가 판매 가격보다 커요. 판매 가격은 쿠폰 빼기 전 금액이에요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.checkIn)) return "입실 날짜를 골라 주세요.";
  if (b.kind === "stay") {
    if (!b.nights || b.nights < 1 || b.nights > 90) return "박수는 1~90박 사이로 적어 주세요.";
    if (b.tentative && !b.roomId) return "임시 배치는 방을 고른 뒤에만 켤 수 있어요. 호실 미정은 「간단 예약」(타입 홀드)예요.";
  } else {
    if (!b.startTime || !b.endTime || !TIME_RE.test(b.startTime) || !TIME_RE.test(b.endTime))
      return "대실은 이용 시간을 꼭 적어 주세요. 예: 12:00~14:00";
    if (b.startTime === b.endTime) return "대실 시작과 끝 시간이 같아요.";
  }
  return null;
}

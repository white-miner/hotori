// 인원 추가 요금 등급 · 특별일 (설정 저장 모양). ledger.ts가 불러서 따로 둬요
export interface SurchargeTier {
  id: string;
  name: string; // 일반 · 특수 …
  weekday: number; // 1명 1박 (일~목 밤)
  weekend: number; // 1명 1박 (금·토 밤, 특별일)
}
export const DEFAULT_TIERS: SurchargeTier[] = [
  { id: "normal", name: "일반", weekday: 10000, weekend: 20000 },
  { id: "house", name: "특수", weekday: 20000, weekend: 30000 },
];
export const DEFAULT_BASE_GUESTS = 2;
export const GUESTS_MAX = 99;
export const TIER_NAME_MAX = 10;
export const SURCHARGE_MAX = 10_000_000;

export const intIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
/** 예전 이름(펜션룸 · 펜션 · 독채)은 화면에서 '특수'로 보여요. 저장된 값은 그대로 */
const LEGACY_SPECIAL = /^(펜션룸|펜션|독채)$/;
export function tierLabel(t: Pick<SurchargeTier, "name">): string {
  const n = t.name.trim();
  return LEGACY_SPECIAL.test(n) ? "특수" : n;
}
/** '일반 객실 추가금 1만/2만 · 특수 객실 추가금 2만/3만' */
export function tierSummary(tiers: readonly SurchargeTier[], short: (n: number) => string): string {
  return tiers.map((t) => `${tierLabel(t) || "이름 없는"} 객실 추가금 ${short(t.weekday)}/${short(t.weekend)}`).join(" · ");
}
/** 설정의 추가 요금 등급: 없거나 망가졌으면 기본(일반·특수) */
export function normalizeTiers(raw: unknown): SurchargeTier[] {
  if (!Array.isArray(raw)) return DEFAULT_TIERS.map((t) => ({ ...t }));
  const seen = new Set<string>();
  const out: SurchargeTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      name: typeof o.name === "string" ? o.name.slice(0, TIER_NAME_MAX) : "",
      weekday: intIn(o.weekday, 0, SURCHARGE_MAX) ?? 0,
      weekend: intIn(o.weekend, 0, SURCHARGE_MAX) ?? 0,
    });
  }
  return out.length ? out : DEFAULT_TIERS.map((t) => ({ ...t }));
}
export function normalizeSpecialDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}


// ---------- 입실 · 퇴실 시간 (호텔 기본값) ----------
/**
 * 호텔의 기본 입실·퇴실 시간 (HH:MM, 24시간). settings.stayTimes에 저장해요.
 * 빠른 입실 · 늦은 퇴실은 예약마다 이 시간에서 몇 시간 앞당기고 미루는지(시간 수)만 적을 거예요 → shiftTime으로 계산.
 */
/** 숙박예약→숙박: auto=입실시각 후(기본) · manual=칸 하단 「숙박예약」탭만 */
export type CheckInMode = "auto" | "manual";
export const CHECK_IN_MODES: CheckInMode[] = ["auto", "manual"];
export const CHECK_IN_MODE_LABEL: Record<CheckInMode, string> = { auto: "자동", manual: "수동" };
export const isCheckInMode = (v: unknown): v is CheckInMode => v === "auto" || v === "manual";

export interface StayTimes {
  checkIn: string; // 기본 16:00
  checkOut: string; // 기본 12:00
  /** 입실 전환 모드 (없으면 자동) */
  checkInMode: CheckInMode;
}
export const DEFAULT_STAY_TIMES: StayTimes = { checkIn: "16:00", checkOut: "12:00", checkInMode: "auto" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function normalizeStayTimes(raw: unknown): StayTimes {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    checkIn: typeof o.checkIn === "string" && HHMM.test(o.checkIn) ? o.checkIn : DEFAULT_STAY_TIMES.checkIn,
    checkOut: typeof o.checkOut === "string" && HHMM.test(o.checkOut) ? o.checkOut : DEFAULT_STAY_TIMES.checkOut,
    checkInMode: isCheckInMode(o.checkInMode) ? o.checkInMode : DEFAULT_STAY_TIMES.checkInMode,
  };
}
/** 기준 시간에서 몇 시간(음수면 앞당김) 옮긴 시간과 날짜 차이: shiftTime("16:00", -3) → {time: "13:00", days: 0} */
export function shiftTime(time: string, hours: number): { time: string; days: number } {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const days = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, days };
}

/** 빠른 입실 · 늦은 퇴실 1시간 요금 (0원 ~ 100만 원, 없으면 1만 원) */
export const DEFAULT_HOUR_FEE = 10_000;
export const HOUR_FEE_MAX = 1_000_000;
export function normalizeHourFee(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(HOUR_FEE_MAX, Math.round(v)) : DEFAULT_HOUR_FEE;
}

// ---------- 대실 기본 (호텔 공통 · 타입별은 Next) ----------
/** settings.dayuseDefaults — 신규 대실 Entry 프리필 */
export interface DayuseDefaults {
  startTime: string; // HH:MM
  endTime: string;
  price: number; // 원
}
export const DEFAULT_DAYUSE_DEFAULTS: DayuseDefaults = { startTime: "14:00", endTime: "17:00", price: 0 };
export const DAYUSE_PRICE_MAX = 10_000_000;
export function normalizeDayuseDefaults(raw: unknown): DayuseDefaults {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const price = Math.round(Number(o.price));
  return {
    startTime: typeof o.startTime === "string" && HHMM.test(o.startTime) ? o.startTime : DEFAULT_DAYUSE_DEFAULTS.startTime,
    endTime: typeof o.endTime === "string" && HHMM.test(o.endTime) ? o.endTime : DEFAULT_DAYUSE_DEFAULTS.endTime,
    price: Number.isFinite(price) && price >= 0 ? Math.min(DAYUSE_PRICE_MAX, price) : DEFAULT_DAYUSE_DEFAULTS.price,
  };
}

// ---------- 주차 관리 (설정에서 켜는 호텔만) ----------
/**
 * extraCarFee: 추가 차량 1대 1박 요금 (2번째 차부터) · walkDiscount: 도보 할인 (예약 1건에 한 번)
 * 꺼져 있으면 예약 창 · 객실 배치에 주차가 안 보여요.
 */
export interface ParkingSettings {
  enabled: boolean;
  extraCarFee: number;
  walkDiscount: number;
}
export const DEFAULT_PARKING: ParkingSettings = { enabled: false, extraCarFee: 10_000, walkDiscount: 0 };
const won0 = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(1_000_000, Math.round(v)) : d);
export function normalizeParking(raw: unknown): ParkingSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { enabled: o.enabled === true, extraCarFee: won0(o.extraCarFee, DEFAULT_PARKING.extraCarFee), walkDiscount: won0(o.walkDiscount, DEFAULT_PARKING.walkDiscount) };
}

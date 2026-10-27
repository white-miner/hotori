// 인원 추가금: 타입마다 기본·최대 인원과 추가 요금 등급. 밤마다 그날 묵는 방의 타입으로 계산해요.
import { type Booking, type HotelSettings, type RoomType, addDays, allRooms, fullLegsOf } from "./ledger";
import { DEFAULT_BASE_GUESTS, DEFAULT_TIERS, GUESTS_MAX, SURCHARGE_MAX, type SurchargeTier, intIn } from "./tiers";
export * from "./tiers";

/** 타입의 기본·최대 인원 (안 적었으면 기본 2명, 최대는 기본 + 2명) */
export function typeGuests(t: Pick<RoomType, "baseGuests" | "maxGuests"> | null | undefined): { base: number; max: number } {
  const base = intIn(t?.baseGuests, 1, GUESTS_MAX) ?? DEFAULT_BASE_GUESTS;
  const max = Math.max(base, intIn(t?.maxGuests, 1, GUESTS_MAX) ?? base + 2);
  return { base, max };
}
export function tierOf(s: Pick<HotelSettings, "surchargeTiers">, t: Pick<RoomType, "tierId"> | null | undefined): SurchargeTier {
  const tiers = s.surchargeTiers?.length ? s.surchargeTiers : DEFAULT_TIERS;
  return tiers.find((x) => x.id === t?.tierId) ?? tiers[0];
}
/** 주말로 정한 요일(기본 금·토)의 밤이거나 특별일이면 주말 요금 */
export function isPeakNight(date: string, special: readonly string[] = [], weekendDays: readonly number[] = [5, 6]): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekendDays.includes(w) || special.includes(date);
}
const DOW = "일월화수목금토";
const dow = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
/** 20000 → 2만 · 15000 → 1.5만 · 5000 → 5천 · 그 밖은 쉼표 */
export function shortWon(n: number): string {
  if (n >= 10000 && n % 1000 === 0) return `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
  if (n > 0 && n < 10000 && n % 1000 === 0) return `${n / 1000}천`;
  return n.toLocaleString("ko-KR");
}

export interface SurchargeNight {
  date: string;
  typeId: string | null;
  base: number;
  extra: number; // 기본보다 많은 인원
  rate: number; // 1명 요금
  amount: number;
  peak: boolean;
}
export interface Surcharge {
  nights: SurchargeNight[];
  total: number;
  extra: number; // 가장 많이 넘은 인원
  max: number; // 그 예약의 최대 인원 (방마다 다르면 가장 작은 값)
  over: boolean; // 최대 인원 넘음 (경고만)
  /** 예: "추가 2명 · 60,000원 (금 1박 2만×2 · 일 1박 1만×2)" · 추가가 없으면 "" */
  line: string;
}
type SPick = Pick<HotelSettings, "types" | "floors" | "surchargeTiers" | "specialDates"> & { weekendDays?: number[] };
type BPick = Pick<Booking, "kind" | "checkIn" | "nights" | "roomId" | "segments" | "typeId">;

/**
 * 인원 추가금: 밤마다 그 밤에 묵는 방의 타입(방이 없으면 예약 타입)으로 기본 인원·등급을 정해요.
 * 대실은 간단히: 예약 타입 등급의 평일 요금 × 추가 인원 한 번.
 */
export function surchargeOf(s: SPick, b: BPick, guests: number | null | undefined): Surcharge {
  const types = new Map(s.types.map((t) => [t.id, t]));
  const roomType = new Map(allRooms(s as HotelSettings).map((r) => [r.id, r.typeId]));
  const g = intIn(guests, 1, GUESTS_MAX);
  const nights: SurchargeNight[] = [];
  const special = s.specialDates ?? [];
  const add = (date: string, typeId: string | null, peak: boolean) => {
    const t = typeId ? types.get(typeId) : undefined;
    const { base } = typeGuests(t);
    const tier = tierOf(s, t);
    const extra = g ? Math.max(0, g - base) : 0;
    const rate = peak ? tier.weekend : tier.weekday;
    nights.push({ date, typeId, base, extra, rate, amount: extra * rate, peak });
  };
  if (b.kind === "dayuse") add(b.checkIn, b.typeId, false);
  else
    for (const l of fullLegsOf(b))
      for (let i = 0; i < l.nights; i++) {
        const date = addDays(l.checkIn, i);
        add(date, (l.roomId && roomType.get(l.roomId)) || b.typeId, isPeakNight(date, special, s.weekendDays));
      }
  const total = nights.reduce((n, x) => n + x.amount, 0);
  const extra = nights.reduce((n, x) => Math.max(n, x.extra), 0);
  const maxes = (nights.length ? nights : [{ typeId: b.typeId }]).map((x) => typeGuests(x.typeId ? types.get(x.typeId) : undefined).max);
  const max = Math.min(...maxes);
  const over = !!g && g > max;
  let line = "";
  if (total > 0) {
    // (요금, 인원)이 같은 밤끼리 묶어요: "금·토 2박 2만×2"
    const groups: { rate: number; extra: number; days: string[] }[] = [];
    for (const x of nights) {
      if (!x.amount) continue;
      const gr = groups.find((y) => y.rate === x.rate && y.extra === x.extra);
      if (gr) gr.days.push(x.date);
      else groups.push({ rate: x.rate, extra: x.extra, days: [x.date] });
    }
    const parts = groups.map((gr) => {
      const names = [...new Set(gr.days.map(dow))].join("·");
      const unit = b.kind === "dayuse" ? "대실" : `${gr.days.length}박`;
      return `${names} ${unit} ${shortWon(gr.rate)}×${gr.extra}`;
    });
    line = `추가 ${extra}명 · ${total.toLocaleString("ko-KR")}원 (${parts.join(" · ")})`;
  }
  return { nights, total, extra, max, over, line };
}

export function validateTier(t: SurchargeTier): string | null {
  if (!t.name.trim()) return "객실 종류 이름을 적어 주세요.";
  if (t.weekday > SURCHARGE_MAX || t.weekend > SURCHARGE_MAX) return "요금이 너무 커요.";
  return null;
}

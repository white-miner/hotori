// 객실 카드(현황·배치)에 보여 줄 값: 이 객실의 하루 요금 · 결제수단+금액 · 회사명 · 이용기간.
// 총액·잔금을 하루 요금 자리에 쓰지 않아요 (합계는 단체 머리글/결제 내역에서).
import { type Booking, type Platform, md, won } from "./ledger";
import { hasFullNightMatrix, occupiedNightDates } from "./nightrates";
import { nowNightRange } from "./nowboard";
import { extrasTotal } from "./nightrates";
import { stayAddons } from "./extend";
import { type LongStayRate, nightAmount } from "./longstay";
import { PAYMENT_METHOD_LABEL, type Payment, isOnsite } from "./payment";

/** 이용기간 `10/25~10/27` (점유 밤 첫날~마지막날 · 하루면 `10/25` · 퇴실 미정이면 `10/25 ~`) */
export function nowRangeFull(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut"> & { openEnded?: boolean }): string {
  const r = nowNightRange(b);
  if (b.openEnded && b.kind === "stay" && !b.earlyOut) return `${r.fromLabel} ~`;
  return r.from === r.to ? md(r.from) : `${md(r.from)}~${md(r.to)}`;
}

export interface NowNightRate {
  /** 보는 날짜의 하루 객실 요금 (모르면 null) */
  amount: number | null;
  /** 이용 기간 안에서 박마다 요금이 달라요 → 「변동」 */
  varies: boolean;
  /** night: 박별 요금표(이 예약이 적어 둔 값) · flat: 1박 요금 · none: 적어 둔 하루 요금이 없음 (평균·추정은 만들지 않아요) */
  basis: "night" | "flat" | "none";
  min: number;
  max: number;
}

type RateBooking = Pick<Booking, "kind" | "price" | "nights" | "checkIn" | "nightRates" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff" | "priceUnset">;

/**
 * 보는 날짜의 하루 객실 요금. 박별 요금(night_rates)이 있으면 그 날 칸 그대로,
 * 이용 기간 밖이면 가장 가까운 밤 (퇴실 아침 → 마지막 밤). 추가 항목·가산분은 하루 요금이 아니라서 빼요.
 */
export function nowNightRate(b: RateBooking, date: string): NowNightRate {
  const none: NowNightRate = { amount: null, varies: false, basis: "none", min: 0, max: 0 };
  if (b.priceUnset) return none;
  const n = Math.max(1, b.nights ?? 1);
  const dates = occupiedNightDates(b.checkIn, n);
  if (!dates.length) return none;
  const view = date < dates[0]! ? dates[0]! : date > dates[dates.length - 1]! ? dates[dates.length - 1]! : date;
  const nr = b.nightRates ?? null;
  if (nr && hasFullNightMatrix(b.checkIn, n, nr)) {
    const vals = dates.map((d) => Math.max(0, Math.round(Number(nr.nights![d]) || 0)));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { amount: Math.max(0, Math.round(Number(nr.nights![view]) || 0)), varies: min !== max, basis: "night", min, max };
  }
  // 일부 박만 적어 둔 표: 보는 날짜가 적혀 있으면 그 값이 먼저 (1박 요금이 있어도 손으로 적은 박이 이겨요). 빈 박은 평균으로 메우지 않아요
  const flat = nr?.flat != null && nr.flat > 0 ? Math.round(nr.flat) : 0;
  const own = Math.round(Number(nr?.nights?.[view]) || 0);
  if (own > 0) {
    const vals = dates.map((d) => Math.round(Number(nr?.nights?.[d]) || 0) || flat).filter((v) => v > 0);
    return { amount: own, varies: vals.length > 1 && Math.min(...vals) !== Math.max(...vals), basis: "night", min: Math.min(...vals), max: Math.max(...vals) };
  }
  if (flat > 0) return { amount: flat, varies: false, basis: "flat", min: flat, max: flat };
  // 1박은 객실료 그대로가 그 밤의 요금 (나눌 게 없음). 연박에 박별 요금이 없으면 비워 둬요 — 총액÷박수 같은 추정 금지
  if (n === 1) {
    const room = b.price - extrasTotal(nr) - stayAddons(b);
    if (room > 0) return { amount: Math.round(room), varies: false, basis: "flat", min: Math.round(room), max: Math.round(room) };
  }
  return none;
}

export const nowRateText = (r: NowNightRate): string | null => (r.amount != null && r.amount > 0 ? `₩${won(r.amount)}` : null);

export interface NowPayPart {
  method: string;
  amount: number;
}

/** 결제수단별 합 (같은 수단은 한 줄로) — 방 자기 결제 + (대표객실이면) 단체 결제 */
export function nowPayParts(own: readonly Pick<Payment, "method" | "amount">[] | null | undefined, group?: readonly Pick<Payment, "method" | "amount">[] | null): NowPayPart[] {
  const sums = new Map<string, number>();
  for (const p of [...(own ?? []), ...(group ?? [])]) {
    const k = PAYMENT_METHOD_LABEL[p.method] ?? String(p.method);
    sums.set(k, (sums.get(k) ?? 0) + p.amount);
  }
  return [...sums.entries()].filter(([, a]) => a !== 0).map(([method, amount]) => ({ method, amount }));
}

/**
 * 플랫폼(OTA)이 받은 결제: 현장 결제가 아닌 플랫폼의 취소 안 된 예약은 손님이 플랫폼에 낸 판매가(적어 둔 price)를 보여요.
 * 이름은 플랫폼 이름 그대로 (`야놀자270,000`). 평균·추정이 아니라 예약에 적힌 값 그대로.
 * 단체 객실도 각 방이 자기 금액을 보여요 (단체의 이체·카드 결제만 대표객실에). 장기·금액미정은 제외.
 */
export function nowPlatformPayPart(
  b: Pick<Booking, "status" | "price" | "priceUnset" | "stayMode" | "kind">,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
): NowPayPart | null {
  if (!plat || isOnsite(plat)) return null;
  if (b.status !== "active" || b.priceUnset || b.stayMode === "long_stay") return null;
  const name = plat.name?.trim();
  return name && b.price > 0 ? { method: name, amount: Math.round(b.price) } : null;
}

/** `이체690,000` · 둘 이상이면 `이체690,000 · 카드100,000` · 셋 넘으면 `외 N건` */
export function nowPayText(parts: readonly NowPayPart[], max = 2): string | null {
  if (!parts.length) return null;
  const shown = parts.slice(0, max).map((p) => `${p.method}${won(p.amount)}`);
  const more = parts.length - shown.length;
  return more > 0 ? `${shown.join(" · ")} 외 ${more}건` : shown.join(" · ");
}

/** 회사명: 예약에 적은 회사가 먼저 · 없으면 단체 정산 정보의 회사 */
export function nowCompanyOf(
  b: { company?: string | null } | null | undefined,
  info?: { payerCompany?: string | null } | null,
): string | null {
  const own = b?.company?.trim();
  if (own) return own;
  const c = info?.payerCompany?.trim();
  return c ? c : null;
}

/** 장기숙박: 요금표(고정/요일별)에서 보는 날짜의 하루 요금 */
export function nowLongStayRate(rate: LongStayRate | null | undefined, date: string): NowNightRate {
  const none: NowNightRate = { amount: null, varies: false, basis: "none", min: 0, max: 0 };
  if (!rate) return none;
  const a = nightAmount(rate, date);
  if (a == null) return none;
  const vals = rate.kind === "dow" ? Object.values(rate.dowAmounts ?? {}).filter((x): x is number => typeof x === "number") : [a];
  const min = vals.length ? Math.min(...vals) : a;
  const max = vals.length ? Math.max(...vals) : a;
  return { amount: a, varies: min !== max, basis: "night", min, max };
}

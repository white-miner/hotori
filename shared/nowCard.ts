// 객실 카드(현황·배치)에 보여 줄 값: 이 객실의 하루 요금 · 결제수단+금액 · 회사명 · 이용기간.
// 총액·잔금을 하루 요금 자리에 쓰지 않아요 (합계는 단체 머리글/결제 내역에서).
import { type Booking, md, won } from "./ledger";
import { hasFullNightMatrix, occupiedNightDates } from "./nightrates";
import { nowNightRange } from "./nowboard";
import { extrasTotal } from "./nightrates";
import { stayAddons } from "./extend";
import { type LongStayRate, nightAmount } from "./longstay";
import { PAYMENT_METHOD_LABEL, type Payment } from "./payment";

/** 이용기간 `10/25~10/27` (점유 밤 첫날~마지막날 · 하루면 `10/25` · 미정이면 `10/25~`) */
export function nowRangeFull(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut"> & { openEnded?: boolean }): string {
  const r = nowNightRange(b);
  if (b.openEnded && b.kind === "stay" && !b.earlyOut) return r.label;
  return r.from === r.to ? md(r.from) : `${md(r.from)}~${md(r.to)}`;
}

export interface NowNightRate {
  /** 보는 날짜의 하루 객실 요금 (모르면 null) */
  amount: number | null;
  /** 이용 기간 안에서 박마다 요금이 달라요 → 「변동」 */
  varies: boolean;
  /** night: 박별 요금표 · flat: 1박 요금 · avg: 요금표가 없어 (객실료 ÷ 박수) 추정 */
  basis: "night" | "flat" | "avg" | "none";
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
  if (nr?.flat != null && nr.flat > 0) {
    const a = Math.round(nr.flat);
    return { amount: a, varies: false, basis: "flat", min: a, max: a };
  }
  const room = b.price - extrasTotal(nr) - stayAddons(b);
  if (room > 0) {
    const a = Math.round(room / n);
    return { amount: a, varies: false, basis: "avg", min: a, max: a };
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

/** `이체690,000` · 둘 이상이면 `이체690,000 · 카드100,000` · 셋 넘으면 `외 N건` */
export function nowPayText(parts: readonly NowPayPart[], max = 2): string | null {
  if (!parts.length) return null;
  const shown = parts.slice(0, max).map((p) => `${p.method}${won(p.amount)}`);
  const more = parts.length - shown.length;
  return more > 0 ? `${shown.join(" · ")} 외 ${more}건` : shown.join(" · ");
}

/** 회사명: 단체 정산 정보에 적은 회사 (개별 예약에는 회사 칸이 없어요) */
export function nowCompanyOf(info: { payerCompany?: string | null } | null | undefined): string | null {
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

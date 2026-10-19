// 수수료 · 입금 예정가
//  · 플랫폼 수수료: 기준 = 판매가(기본) 또는 판매가 − 쿠폰 전부
//  · 입금 예정가 = 판매가 − round(기준 × 수수료율) − 숙소 부담 쿠폰 − 중도 퇴실 환불 (원 단위)
//  · 노쇼는 수수료 그대로 · 취소는 0
//  · 쿠폰은 판매가(price)를 바꾸지 않아요. 플랫폼 부담 쿠폰은 숙소 돈과 상관없어요
//  · 카드 수수료: HOTORI에 적은 현장 카드 결제(선금·잔금·단체·매점 카드)에만
import { type Booking, type Coupon, type HotelSettings, type Platform, addDays, checkOut, isEarlyOut, won } from "./ledger";
import { rateLabel } from "./feerate";

export const COUPON_MAX = 10;
export const COUPON_AMOUNT_MAX = 10_000_000;

/** 쿠폰 줄 정리: 0원 · 이상한 값은 빼고 10개까지 */
export function cleanCoupons(list: unknown): Coupon[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({ amount: Math.round(Number((x as Coupon)?.amount)), hotel: (x as Coupon)?.hotel === true }))
    .filter((x) => Number.isFinite(x.amount) && x.amount > 0)
    .map((x) => ({ ...x, amount: Math.min(COUPON_AMOUNT_MAX, x.amount) }))
    .slice(0, COUPON_MAX);
}

/** 수수료 = round(기준 × 율%) : 율은 소수 둘째 자리까지라 정수로 바꿔서 계산해요 */
export const feeOf = (base: number, rate: number | null | undefined) => (rate && base > 0 ? Math.round((base * Math.round(rate * 100)) / 10000) : 0);

type PayoutPick = Pick<Booking, "status" | "price" | "kind" | "checkIn" | "nights" | "earlyOut" | "refund" | "coupons" | "payoutOk" | "payoutAmount">;
type PlatPick = Pick<Platform, "feeRate" | "feeBasis" | "payoutDays"> | null | undefined;

export interface Payout {
  sale: number; // 판매가 (취소면 0)
  rate: number | null;
  basis: "sale" | "net";
  base: number; // 수수료 기준 금액
  fee: number;
  coupons: number; // 쿠폰 전부
  hotelCoupons: number; // 숙소 부담
  platCoupons: number; // 플랫폼 부담
  refund: number; // 중도 퇴실 환불
  expected: number; // 입금 예정가
  /** 판매가와 다르게 보여 줄 게 있나요 (수수료율이 있거나 숙소 부담 쿠폰이 있으면) */
  shown: boolean;
  /** 입금을 따지나요: 취소가 아니고, 수수료율 · 정산 주기 · 숙소 부담 쿠폰 중 하나라도 있으면 */
  tracked: boolean;
  /** 입금 예정일 (정산 주기가 있으면 퇴실일 + N일) */
  dueOn: string | null;
  ok: boolean; // 입금 확인
  received: number | null; // 확인한 실제 입금액 (확인 안 했으면 null)
  diff: number; // 실제 − 예정 (확인 안 했으면 0)
}

export function payoutOf(b: PayoutPick, p: PlatPick): Payout {
  const cancelled = b.status === "cancelled";
  const coupons = cleanCoupons(b.coupons);
  const rate = p?.feeRate && p.feeRate > 0 ? p.feeRate : null;
  const basis = p?.feeBasis === "net" ? "net" : "sale";
  const sale = cancelled ? 0 : Math.max(0, Math.round(b.price));
  const all = cancelled ? 0 : coupons.reduce((n, c) => n + c.amount, 0);
  const hotelCoupons = cancelled ? 0 : coupons.filter((c) => c.hotel).reduce((n, c) => n + c.amount, 0);
  const base = basis === "net" ? Math.max(0, sale - all) : sale;
  const fee = cancelled ? 0 : feeOf(base, rate);
  const refund = !cancelled && b.status === "active" && isEarlyOut(b) ? Math.max(0, b.refund ?? 0) : 0;
  const expected = cancelled ? 0 : sale - fee - hotelCoupons - refund;
  const days = p?.payoutDays ?? null;
  const tracked = !cancelled && (rate != null || days != null || hotelCoupons > 0);
  const end = b.kind === "stay" ? (b.status === "active" && isEarlyOut(b) ? b.earlyOut! : checkOut(b)) : b.checkIn;
  const ok = tracked && b.payoutOk === true;
  const received = ok ? (b.payoutAmount != null ? Math.round(b.payoutAmount) : expected) : null;
  return {
    sale,
    rate,
    basis,
    base,
    fee,
    coupons: all,
    hotelCoupons,
    platCoupons: all - hotelCoupons,
    refund,
    expected,
    shown: !cancelled && (rate != null || hotelCoupons > 0),
    tracked,
    dueOn: tracked && days != null ? addDays(end, days) : null,
    ok,
    received,
    diff: received != null ? received - expected : 0,
  };
}

/** '70,000 − 수수료 10% 7,000 = 63,000 (쿠폰 6,000 플랫폼 부담)' — 보여 줄 게 없으면 null */
export function payoutLine(x: Payout): string | null {
  if (!x.shown) return null;
  const parts = [won(x.sale)];
  if (x.rate != null) parts.push(`수수료 ${rateLabel(x.rate)}%${x.basis === "net" && x.coupons ? `(쿠폰 뺀 ${won(x.base)} 기준)` : ""} ${won(x.fee)}`);
  if (x.hotelCoupons) parts.push(`쿠폰 숙소 부담 ${won(x.hotelCoupons)}`);
  if (x.refund) parts.push(`환불 ${won(x.refund)}`);
  const tail = x.platCoupons ? ` (쿠폰 ${won(x.platCoupons)} 플랫폼 부담)` : "";
  return `${parts.join(" − ")} = ${won(x.expected)}${tail}`;
}

/** 실제로 들어온 돈 (확인했으면 실제 입금액, 아니면 예정가) */
export const payoutValue = (x: Payout) => x.received ?? x.expected;

export interface PayoutSummary {
  count: number; // 입금을 따지는 예약 수
  sale: number;
  fee: number;
  hotelCoupons: number;
  refund: number;
  expected: number;
  okCount: number;
  okAmount: number; // 확인한 실제 입금 합계
  waitCount: number;
  waitAmount: number; // 아직 확인 안 한 입금 예정 합계
}
/** 장부 요약: 입금을 따지는 예약만 (입실일 기준 목록) */
export function payoutSummary<T extends PayoutPick>(list: T[], platOf: (b: T) => PlatPick): PayoutSummary {
  const r: PayoutSummary = { count: 0, sale: 0, fee: 0, hotelCoupons: 0, refund: 0, expected: 0, okCount: 0, okAmount: 0, waitCount: 0, waitAmount: 0 };
  for (const b of list) {
    const x = payoutOf(b, platOf(b));
    if (!x.tracked) continue;
    r.count++;
    r.sale += x.sale;
    r.fee += x.fee;
    r.hotelCoupons += x.hotelCoupons;
    r.refund += x.refund;
    r.expected += x.expected;
    if (x.ok) {
      r.okCount++;
      r.okAmount += x.received!;
    } else {
      r.waitCount++;
      r.waitAmount += x.expected;
    }
  }
  return r;
}
export const payoutWaiting = (b: PayoutPick, p: PlatPick) => {
  const x = payoutOf(b, p);
  return x.tracked && !x.ok;
};

/**
 * 숙박·대실 매출을 '입금 예정' 기준으로 (날짜는 roomRevenue와 같게):
 * 입실일이 기간 안이면 (입금 예정가 또는 실제 입금액) + 환불, 환불은 퇴실한 날에 빼요.
 */
export function payoutRevenue(bookings: Booking[], platOf: (b: Booking) => PlatPick, from: string, to: string): { amount: number; fee: number; hotelCoupons: number; diff: number } {
  let amount = 0;
  let fee = 0;
  let hotelCoupons = 0;
  let diff = 0;
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const x = payoutOf(b, platOf(b));
    if (b.checkIn >= from && b.checkIn <= to) {
      amount += payoutValue(x) + x.refund;
      fee += x.fee;
      hotelCoupons += x.hotelCoupons;
      diff += x.diff;
    }
    if (x.refund && b.earlyOut! >= from && b.earlyOut! <= to) amount -= x.refund;
  }
  return { amount, fee, hotelCoupons, diff };
}

/** 카드 수수료: 현장 카드 결제 합계 × 율 (플랫폼이 받은 예약 금액에는 안 붙어요) */
export const cardFeeOf = (s: Pick<HotelSettings, "cardFeeRate">, cardTotal: number) => feeOf(cardTotal, s.cardFeeRate);

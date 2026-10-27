// 「현황」대실 판매: Entry 우회 · dayuseDefaults 프리필 · overlap warn · ±수납
import { type Booking, type HotelSettings, validateBooking, won } from "./ledger";
import {
  type BookPayMethod,
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  isBookPayMethod,
  isOnsite,
  validatePayment,
  walkInDisplayName,
} from "./payment";

export const DAYUSE_SALE_TITLE = "대실 판매";
export const DAYUSE_SALE_CTA = "대실 판매";

export { BOOK_PAY_METHODS as DAYUSE_SALE_METHODS, BOOK_PAY_LABEL as DAYUSE_SALE_METHOD_LABEL };

export interface DayuseSaleInput {
  roomId: string;
  typeId: string;
  checkIn: string;
  startTime: string;
  endTime: string;
  price: number;
  guestName: string;
  guestPhone?: string | null;
  platformId: string;
  /** 금액>0이면 즉시 수납 */
  collect: boolean;
  method: BookPayMethod;
  bizDate: string;
}

export interface DayuseSaleDraft {
  booking: Booking;
  collectAmount: number;
  method: BookPayMethod | null;
}

/** 현장·전화 플랫폼 우선 (대실 현장 판매). 없으면 첫 플랫폼. */
export function dayuseSalePlatformId(s: Pick<HotelSettings, "platforms">): string {
  return s.platforms.find((p) => isOnsite(p))?.id ?? s.platforms[0]?.id ?? "";
}

export function validateDayuseSale(s: HotelSettings, input: DayuseSaleInput): string | null {
  if (!input.roomId) return "호실을 골라 주세요.";
  if (!input.typeId || !s.types.some((t) => t.id === input.typeId)) return "객실 타입이 없어요.";
  if (!s.platforms.some((p) => p.id === input.platformId)) return "플랫폼을 골라 주세요.";
  if (!Number.isFinite(input.price) || input.price < 0) return "판매가를 입력해 주세요.";
  const name = input.guestName.trim() || walkInDisplayName(input.checkIn);
  const draft = buildDayuseSaleBooking(s, { ...input, guestName: name });
  const v = validateBooking(draft, s);
  if (v) return v;
  if (input.collect && input.price > 0) {
    const pv = validatePayment(Math.round(input.price), input.method, input.bizDate);
    if (pv) return pv;
  }
  if (input.collect && input.price > 0 && !isBookPayMethod(input.method)) {
    return "카드 · 현금 · 이체 중에 골라 주세요.";
  }
  return null;
}

export function buildDayuseSaleBooking(_s: HotelSettings, input: DayuseSaleInput): Booking {
  const guestName = input.guestName.trim() || walkInDisplayName(input.checkIn);
  const now = new Date().toISOString();
  return {
    id: "__draft__",
    kind: "dayuse",
    status: "active",
    platformId: input.platformId,
    price: Math.round(input.price),
    priceUnset: false,
    guestName,
    guestPhone: input.guestPhone?.trim() || null,
    typeId: input.typeId,
    roomId: input.roomId,
    segments: null,
    checkIn: input.checkIn,
    nights: null,
    startTime: input.startTime,
    endTime: input.endTime,
    arrived: true,
    tentative: false,
    noClean: false,
    earlyOut: null,
    checkedOutAt: null,
    stayMode: "standard",
    longStayRate: null,
    settleCycle: null,
    charges: [],
    refund: null,
    memo: null,
    groupId: null,
    groupName: null,
    nightRates: null,
    guests: null,
    extraFee: null,
    earlyIn: null,
    lateOut: null,
    timeFee: null,
    arrival: null,
    cars: null,
    plates: null,
    carFee: null,
    walkOff: null,
    coupons: null,
    payoutOk: false,
    payoutAmount: null,
    payments: [],
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function planDayuseSale(s: HotelSettings, input: DayuseSaleInput): DayuseSaleDraft | { err: string } {
  const err = validateDayuseSale(s, input);
  if (err) return { err };
  const booking = buildDayuseSaleBooking(s, input);
  const collectAmount = input.collect && booking.price > 0 ? booking.price : 0;
  return {
    booking,
    collectAmount,
    method: collectAmount > 0 ? input.method : null,
  };
}

export function dayuseSaleNotifyLine(guestName: string, roomLabel: string, price: number, collected: boolean, method: BookPayMethod | null): string {
  const pay =
    collected && method && price > 0
      ? ` · ${BOOK_PAY_LABEL[method]} ${won(price)}원`
      : price > 0
        ? ` · ${won(price)}원`
        : "";
  return `${roomLabel}호 대실 판매 · ${guestName}${pay}`;
}

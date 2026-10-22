// 「현황」숙박 판매 전용 · selection-first · SimpleBooking/MiniFloorPlan 금지
import {
  type Booking,
  type HotelSettings,
  allRooms,
  freeRooms,
  validateBooking,
  won,
} from "./ledger";
import { GROUP_ROOMS_MAX, groupDrafts, splitTotal } from "./group";
import { nightRatesFromTotal } from "./nightrates";
import {
  type BookPayMethod,
  type OnsitePayMode,
  isOnsite,
  planOnsiteCreatePay,
  validateGuestPhone,
  validateOnsiteCreateDeposit,
  walkInDisplayName,
} from "./payment";
import { applyExtend, canExtend, nightRate } from "./extend";
import { clampHours } from "./extratime";

export const STAY_SALE_TITLE = "숙박 판매";
export const STAY_SALE_CTA = "숙박 판매";

/** 현장·전화 우선 (ops 판매). 없으면 첫 플랫폼. */
export function staySalePlatformId(s: Pick<HotelSettings, "platforms">): string {
  return s.platforms.find((p) => isOnsite(p))?.id ?? s.platforms[0]?.id ?? "";
}

export interface StaySaleCreateInput {
  roomIds: string[];
  checkIn: string;
  nights: number;
  guestName: string;
  guestPhone?: string | null;
  guests: number;
  price: number;
  priceUnset?: boolean;
  platformId: string;
  payMode: OnsitePayMode;
  depAmt: string;
  depMethod: BookPayMethod;
  bizDate: string;
  /** 빠른 입실 시간 (0=없음) */
  earlyInHours?: number;
  earlyInAmount?: number;
  earlyInMethod?: BookPayMethod | "service";
  /** 늦은 퇴실 시간 (0=없음) */
  lateOutHours?: number;
  lateOutAmount?: number;
  lateOutMethod?: BookPayMethod | "service" | "deferred";
  /** 오늘 입실 + 바로 입실 */
  walkInImmediate?: boolean;
}

export interface StaySaleOccupiedInput {
  bookingId: string;
  /** +1박 연장 */
  extend: boolean;
  earlyInHours?: number;
  earlyInAmount?: number;
  earlyInMethod?: BookPayMethod | "service";
  lateOutHours?: number;
  lateOutAmount?: number;
  lateOutMethod?: BookPayMethod | "service" | "deferred";
  bizDate: string;
}

export function validateStaySaleCreate(s: HotelSettings, input: StaySaleCreateInput): string | null {
  if (!input.roomIds.length) return "호실이 없어요.";
  if (input.roomIds.length > GROUP_ROOMS_MAX) return `한 번에 ${GROUP_ROOMS_MAX}실까지예요.`;
  if (!s.platforms.some((p) => p.id === input.platformId)) return "플랫폼을 골라 주세요.";
  const nights = Math.max(1, Math.round(input.nights));
  if (nights < 1) return "박수를 골라 주세요.";
  const plat = s.platforms.find((p) => p.id === input.platformId);
  const name = input.guestName.trim() || (input.walkInImmediate ? walkInDisplayName(input.checkIn) : "");
  if (!name) return "이름을 적어 주세요.";
  const phoneErr = validateGuestPhone(plat, input.guestPhone, { walkInImmediate: !!input.walkInImmediate });
  if (phoneErr) return phoneErr;
  if (!input.priceUnset && !(input.price > 0)) return "판매가를 적거나 금액미정을 켜 주세요.";
  if (isOnsite(plat) && !input.priceUnset) {
    const depErr = validateOnsiteCreateDeposit(input.payMode, {
      priceUnset: false,
      saleTotal: Math.round(input.price),
      depAmt: input.depAmt,
      depMethod: input.depMethod,
      bizDate: input.bizDate,
    });
    if (depErr) return depErr;
  }
  const free = freeRooms(s, [], {
    id: "__stay_sale__",
    kind: "stay",
    checkIn: input.checkIn,
    nights,
    startTime: null,
    endTime: null,
  });
  // freeRooms with empty bookings = all rooms free; real clash checked at commit with live list
  void free;
  return null;
}

export function buildStaySaleDrafts(
  s: HotelSettings,
  input: StaySaleCreateInput,
): Booking[] | { err: string } {
  const err = validateStaySaleCreate(s, input);
  if (err) return { err };
  const rmap = new Map(allRooms(s).map((r) => [r.id, r]));
  const nights = Math.max(1, Math.round(input.nights));
  const name = input.guestName.trim() || walkInDisplayName(input.checkIn);
  const prices = input.priceUnset
    ? input.roomIds.map(() => 0)
    : splitTotal(Math.round(input.price), input.roomIds.length);
  const earlyH = clampHours(input.earlyInHours ?? 0);
  const lateH = clampHours(input.lateOutHours ?? 0);
  const earlyAmt =
    earlyH > 0 && input.earlyInMethod !== "service" ? Math.max(0, Math.round(input.earlyInAmount ?? 0)) : 0;
  const lateAmt =
    lateH > 0 && input.lateOutMethod !== "service" ? Math.max(0, Math.round(input.lateOutAmount ?? 0)) : 0;
  /** 판매가·timeFee에 합산 (서비스=0 · 후불도 가격에는 포함) */
  const timeExtra = earlyAmt + lateAmt;

  if (input.roomIds.length === 1) {
    const rid = input.roomIds[0];
    const room = rmap.get(rid);
    if (!room?.typeId) return { err: "이 호실에 타입이 없어요." };
    const base = prices[0] ?? 0;
    const price = base + timeExtra;
    const now = new Date().toISOString();
    const b: Booking = {
      id: "__draft__",
      kind: "stay",
      status: "active",
      platformId: input.platformId,
      price: input.priceUnset ? 0 : price,
      priceUnset: !!input.priceUnset,
      guestName: name,
      guestPhone: input.guestPhone?.trim() || null,
      typeId: room.typeId,
      roomId: rid,
      segments: null,
      checkIn: input.checkIn,
      nights,
      startTime: null,
      endTime: null,
      arrived: !!input.walkInImmediate,
      tentative: false,
      noClean: false,
      earlyOut: null,
      checkedOutAt: null,
      refund: null,
      memo: null,
      guests: input.guests > 0 ? input.guests : null,
      groupId: null,
      groupName: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      payments: [],
      nightRates: input.priceUnset || !(base > 0) ? null : nightRatesFromTotal(input.checkIn, nights, base),
      earlyIn: earlyH || null,
      lateOut: lateH || null,
      timeFee: timeExtra > 0 ? timeExtra : null,
    };
    const v = validateBooking(b, s);
    if (v) return { err: v };
    return [b];
  }

  const groupId = crypto.randomUUID();
  const drafts = groupDrafts({
    groupId,
    groupName: name,
    platformId: input.platformId,
    checkIn: input.checkIn,
    nights,
    roomIds: input.roomIds,
    prices: prices.map((p) => p + Math.floor(timeExtra / input.roomIds.length)),
    s,
    guestsOf: () => (input.guests > 0 ? input.guests : null),
    arrived: !!input.walkInImmediate,
  }).map((b, i) => ({
    ...b,
    guestPhone: input.guestPhone?.trim() || null,
    priceUnset: !!input.priceUnset,
    price: input.priceUnset ? 0 : (prices[i] ?? 0) + (i === 0 ? timeExtra : 0),
    earlyIn: earlyH || null,
    lateOut: lateH || null,
    timeFee: i === 0 && timeExtra > 0 ? timeExtra : null,
    nightRates:
      input.priceUnset || !((prices[i] ?? 0) > 0)
        ? null
        : nightRatesFromTotal(input.checkIn, nights, prices[i] ?? 0),
  }));
  return drafts;
}

export function staySaleCreatePayPlan(input: StaySaleCreateInput, saleTotal: number) {
  return planOnsiteCreatePay(input.payMode, {
    priceUnset: !!input.priceUnset,
    saleTotal,
    depAmt: input.depAmt,
    depMethod: input.depMethod,
  });
}

export function staySaleNotifyLine(guestName: string, roomLabels: string[], price: number, payTail: string): string {
  const rooms = roomLabels.map((n) => `${n}호`).join(", ");
  const p = price > 0 ? ` · ${won(price)}원` : "";
  return `${guestName} 님 숙박 판매 · ${rooms}${p}${payTail}`;
}

/** 점유 객실: 연장·입·퇴 조정 가능 여부 */
export function canStaySaleOccupied(b: Pick<Booking, "status" | "kind">): boolean {
  return b.status === "active" && b.kind === "stay";
}

export function staySaleExtendPreview(b: Booking, typeRate?: number | null) {
  if (!canExtend(b)) return null;
  const rate = nightRate(b, typeRate);
  return applyExtend(b, rate);
}

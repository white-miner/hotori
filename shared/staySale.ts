// 「현황」숙박 판매 전용 · selection-first · SimpleBooking/MiniFloorPlan 금지
// 모드: 현장 | 플랫폼 (운영에 간단예약 병렬 금지 · OTA 잔금 금지)
import {
  type Booking,
  type HotelSettings,
  type Platform,
  addDays,
  allRooms,
  freeRooms,
  md,
  validateBooking,
  won,
} from "./ledger";
import { GROUP_ROOMS_MAX, groupDrafts } from "./group";
import { type StayNightRates, priceFromNightMatrix } from "./nightrates";
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

/**
 * StaySaleModal draft reset key — occupied id + room ids only.
 * Must NOT include HotelSettings identity: useHotelData poll/realtime
 * replaces `settings` every ~10s and would wipe in-progress name/phone.
 */
export function staySaleDraftSessionKey(
  occupiedId: string | null | undefined,
  roomIds: readonly string[],
): string {
  return `${occupiedId ?? "new"}|${roomIds.join(",")}`;
}

/** 숙박 판매 채널 모드 · 현장 | 플랫폼 (바로입실은 푸터 CTA · 채널 배타 없음) */
export type StaySaleChannelMode = "onsite" | "platform";

/** 푸터: 저장하기 = 숙박예약 · 바로입실 = 저장+arrived */
export const STAY_SALE_SAVE = "저장하기";
export const STAY_SALE_CHECKIN = "바로입실";
/** 플랫폼 판매금: 총액 기본 · 박당 옵션 (OTA SoT) */
export type StaySaleSalesMode = "total" | "perNight";

/** 현장·전화 우선 (ops 판매). 없으면 첫 플랫폼. */
export function staySalePlatformId(s: Pick<HotelSettings, "platforms">): string {
  return s.platforms.find((p) => isOnsite(p))?.id ?? s.platforms[0]?.id ?? "";
}

/** 플랫폼(OTA) 기본 채널 · 비현장 우선 */
export function staySaleOtaPlatformId(s: Pick<HotelSettings, "platforms">): string {
  return s.platforms.find((p) => !isOnsite(p))?.id ?? s.platforms[0]?.id ?? "";
}

/** 모드에 맞는 기본 platformId */
export function staySalePlatformIdForMode(
  s: Pick<HotelSettings, "platforms">,
  mode: StaySaleChannelMode,
): string {
  return mode === "onsite" ? staySalePlatformId(s) : staySaleOtaPlatformId(s);
}

/** 플랫폼 모드 칩 목록 (야/아/여/호… · 현장·전화 제외) */
export function staySaleOtaPlatforms(s: Pick<HotelSettings, "platforms">): Platform[] {
  return s.platforms.filter((p) => !isOnsite(p));
}

/**
 * 숙박 요약(헤더 부제용 · 콤팩트):
 * 1박 `10/23 1박` · 같은달 연박 `10/23~24 2박` · 월넘김 `10/30~11/2 3박`.
 * (구 `M/D ~ M/D · n박 n+1일` 블록 금지)
 */
export function staySaleNightsSummary(checkIn: string, nights: number): string {
  const n = Math.max(1, Math.round(nights));
  const lastNight = addDays(checkIn, n - 1);
  const start = md(checkIn);
  if (n === 1) return `${start} ${n}박`;
  const [, sm, sd] = checkIn.split("-").map(Number);
  const [, em, ed] = lastNight.split("-").map(Number);
  const end = sm === em ? String(ed) : md(lastNight);
  return `${start}~${end} ${n}박`;
}

/**
 * 판매금 해석: 플랫폼 박당 = rate×박 · 총액/현장 = 입력 총액.
 * 금액미정이면 0.
 */
export function staySaleResolvePrice(input: {
  channel: StaySaleChannelMode;
  salesMode: StaySaleSalesMode;
  priceUnset?: boolean;
  total: number;
  perNight: number;
  nights: number;
}): number {
  if (input.priceUnset) return 0;
  const nights = Math.max(1, Math.round(input.nights));
  if (input.channel === "platform" && input.salesMode === "perNight") {
    return Math.max(0, Math.round(input.perNight)) * nights;
  }
  return Math.max(0, Math.round(input.total));
}

export interface StaySaleCreateInput {
  roomIds: string[];
  checkIn: string;
  nights: number;
  guestName: string;
  guestPhone?: string | null;
  /** 회사명 (선택 · 객실 카드에 표시) */
  company?: string | null;
  guests: number;
  /** 1실이면 판매가 · 2실 이상이면 객실별 요금(roomRates)의 합 (나눠 담지 않아요) */
  price: number;
  /** 2실 이상: 객실별(roomIds 순서) 박별 요금표 — 같은 타입이어도 방마다 따로 */
  roomRates?: StayNightRates[];
  priceUnset?: boolean;
  platformId: string;
  payMode: OnsitePayMode;
  depAmt: string;
  depMethod: BookPayMethod;
  tenders?: import("./payment").TenderAmounts | null;
  bizDate: string;
  /** 빠른 입실 시간 (0=없음) */
  earlyInHours?: number;
  earlyInAmount?: number;
  earlyInMethod?: BookPayMethod | "service";
  /** 늦은 퇴실 시간 (0=없음) */
  lateOutHours?: number;
  lateOutAmount?: number;
  lateOutMethod?: BookPayMethod | "service" | "deferred";
  /** 푸터 「바로입실」: 저장 + arrived · 이름·전화 완화 · 현장·플랫폼 공통 */
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
  if (!name) return "이름을 입력해 주세요.";
  const phoneErr = validateGuestPhone(plat, input.guestPhone, { walkInImmediate: !!input.walkInImmediate });
  if (phoneErr) return phoneErr;
  if (input.roomIds.length > 1 && !input.priceUnset) {
    const rr = input.roomRates;
    if (!rr || rr.length !== input.roomIds.length) return "객실마다 요금을 입력해 주세요.";
    if (rr.some((r) => !(priceFromNightMatrix(r) > 0))) return "객실마다 요금을 입력해 주세요.";
  }
  if (!input.priceUnset && !(input.price > 0)) {
    return isOnsite(plat) ? "판매가를 적거나 금액미정을 켜 주세요." : "판매금을 적거나 금액미정을 켜 주세요.";
  }
  // OTA: 현장 결제/선금 검증 스킵 · 잔금 없음 (#84)
  if (isOnsite(plat) && !input.priceUnset) {
    const depErr = validateOnsiteCreateDeposit(input.payMode, {
      priceUnset: false,
      saleTotal: Math.round(input.price),
      depAmt: input.depAmt,
      depMethod: input.depMethod,
      tenders: input.tenders,
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

/** 채널 모드와 platformId 정합 (현장↔OTA 배타) */
export function staySaleChannelOfPlat(
  plat: Pick<Platform, "name"> & { onsite?: boolean | null } | null | undefined,
): StaySaleChannelMode {
  return isOnsite(plat) ? "onsite" : "platform";
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
  // 다실: 객실마다 자기 요금표의 합 (총액을 나누거나 첫 방에 몰지 않아요) · 1실: 판매가
  const prices = input.priceUnset
    ? input.roomIds.map(() => 0)
    : input.roomIds.length === 1
      ? [Math.round(input.price)]
      : (input.roomRates ?? []).map((r) => priceFromNightMatrix(r));
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
      company: input.company?.trim() || null,
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
      // 총액을 박수로 나눠 채우지 않아요 — 직접 적은 박별 요금(roomRates)만 저장
      nightRates: input.priceUnset ? null : (input.roomRates?.[0] ?? null),
      earlyIn: earlyH || null,
      lateOut: lateH || null,
      timeFee: timeExtra > 0 ? timeExtra : null,
    };
    const v = validateBooking(b, s);
    if (v) return { err: v };
    return [b];
  }

  const groupId = crypto.randomUUID();
  // 빠른 입실·늦은 퇴실 요금은 한 번만 — 대표(첫 호실) 한 줄에만 더해요 (객실 요금은 그대로)
  const withTime = prices.map((p, i) => (i === 0 ? p + timeExtra : p));
  const drafts = groupDrafts({
    groupId,
    groupName: name,
    platformId: input.platformId,
    checkIn: input.checkIn,
    nights,
    roomIds: input.roomIds,
    prices: withTime,
    memberNightRates: input.priceUnset ? undefined : input.roomRates,
    s,
    guestsOf: () => (input.guests > 0 ? input.guests : null),
    arrived: !!input.walkInImmediate,
  }).map((b, i) => ({
    ...b,
    guestPhone: input.guestPhone?.trim() || null,
    company: input.company?.trim() || null,
    priceUnset: !!input.priceUnset,
    price: input.priceUnset ? 0 : (withTime[i] ?? 0),
    earlyIn: earlyH || null,
    lateOut: lateH || null,
    timeFee: i === 0 && timeExtra > 0 ? timeExtra : null,
    nightRates: input.priceUnset ? null : (b.nightRates ?? null),
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

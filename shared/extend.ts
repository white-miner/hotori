// 1박 연장: 박수 +1 · 판매 가격에 당일 단가 가산 · 잔금/수납 제안 (스키마 추가 없음)
import {
  type Booking,
  type HotelSettings,
  type RoomSegment,
  STAY_NIGHTS_MAX,
  addDays,
  dayLabel,
  daysBetween,
  fitSegments,
  isActive,
  isEarlyOut,
  legsClash,
  legsOf,
  occupiesRoom,
  roomLabel,
  won,
} from "./ledger";
import {
  type BookPayMethod,
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  isBookPayMethod,
  PAY_MAX,
  validatePayment,
} from "./payment";
import {
  type StayNightRates,
  appendNightAmount,
  hasFullNightMatrix,
  memberFlatRate,
  priceFromNightMatrix,
  syncStayNightRates,
} from "./nightrates";

export const EXTEND_COPY = "1박 연장";
export const NIGHTS_PRICE_WARN =
  "박수가 늘었는데 판매 가격은 그대로예요. 「1박 연장」으로 요금을 더하거나, 가격을 직접 고쳐 주세요. 그래도 저장할까요?";
export const REPRICE_TOAST = "판매가를 1박 요금 × 박수에 맞췄어요";

/** 박과 무관한 가산분 (추가인원·시간료·주차 − 도보할인). MVP 재계산 시 유지 */
export function stayAddons(
  b: Pick<Booking, "kind" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff">,
): number {
  const xf = Math.max(0, b.extraFee ?? 0);
  const tf = b.kind === "stay" && (b.earlyIn || b.lateOut) ? Math.max(0, b.timeFee ?? 0) : 0;
  const cf = b.arrival === "car" ? Math.max(0, b.carFee ?? 0) : 0;
  const wo = b.arrival === "walk" ? Math.max(0, b.walkOff ?? 0) : 0;
  return xf + tf + cf - wo;
}

/** 1박 단가 기본값: 방별 flat → 타입/단체 요금 → 판매가 ÷ 박수 */
export function nightRate(
  b: Pick<Booking, "price" | "nights" | "nightRates">,
  typeRate?: number | null,
): number {
  const flat = memberFlatRate(b.nightRates, typeRate);
  if (flat > 0) return flat;
  const n = b.nights ?? 0;
  if (n < 1) return 0;
  return Math.max(0, Math.round(b.price / n));
}

/**
 * 객실료 1박 단가 (가산분 제외). 방별 flat → 타입 rates → (price − addons) ÷ oldNights.
 * 연장용 nightRate와 달리 박수↓ 재계산의 진실.
 */
export function roomNightRate(
  b: Pick<Booking, "kind" | "price" | "nights" | "nightRates" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff">,
  typeRate?: number | null,
): number {
  const flat = memberFlatRate(b.nightRates, null);
  if (flat > 0) return flat;
  if (typeRate != null && typeRate > 0) return Math.round(typeRate);
  const n = b.nights ?? 0;
  if (n < 1) return 0;
  const room = Math.max(0, b.price - stayAddons(b));
  return Math.max(0, Math.round(room / n));
}

export interface RepriceResult {
  rate: number;
  addons: number;
  price: number;
  nightRates?: StayNightRates | null;
}

/**
 * 박수 변경 시 판매가.
 * · 밤 행렬 있으면 Σ 셀(+가산) · 축소는 뒤 밤 drop · 확장은 기본 단가 셀 추가
 * · 없으면 rate × newNights + 가산분
 */
export function repriceForNights(
  b: Pick<
    Booking,
    "kind" | "price" | "nights" | "checkIn" | "nightRates" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff"
  >,
  newNights: number,
  typeRate?: number | null,
): RepriceResult {
  const n = Math.max(1, Math.round(newNights));
  const addons = stayAddons(b);
  const rate = roomNightRate(b, typeRate);
  const checkIn = b.checkIn;
  if (checkIn && (b.nightRates?.nights || b.nightRates?.flat || b.nightRates?.weekday || b.nightRates?.weekend)) {
    const prev = {
      ...b.nightRates,
      flat: b.nightRates?.flat ?? rate,
    };
    const nightRates = syncStayNightRates(checkIn, n, prev, { typeRate: typeRate ?? rate });
    if (hasFullNightMatrix(checkIn, n, nightRates)) {
      return { rate: nightRates.flat ?? rate, addons, price: priceFromNightMatrix(nightRates, addons), nightRates };
    }
  }
  return { rate, addons, price: Math.max(0, rate * n + addons), nightRates: b.nightRates ?? null };
}

/** 중도 퇴실 환불 제안 = 미사용 박 × 단가 (수정 가능) */
export function unusedNightRefund(
  b: Pick<
    Booking,
    "kind" | "price" | "nights" | "checkIn" | "nightRates" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff"
  >,
  earlyOutOn: string,
  typeRate?: number | null,
): number {
  const nights = b.nights ?? 0;
  if (nights < 2) return 0;
  const used = Math.max(0, Math.min(nights - 1, daysBetween(b.checkIn, earlyOutOn)));
  const unused = nights - used;
  if (unused <= 0) return 0;
  return roomNightRate(b, typeRate) * unused;
}

/** 활성 숙박 · 중도 퇴실 아님 · 90박 미만 */
export function canExtend(b: Pick<Booking, "status" | "kind" | "checkIn" | "nights" | "earlyOut">): boolean {
  return b.status === "active" && b.kind === "stay" && !!b.nights && b.nights >= 1 && b.nights < STAY_NIGHTS_MAX && !isEarlyOut(b);
}

export interface ExtendDraft {
  nights: number;
  price: number;
  segments: RoomSegment[] | null;
  rate: number;
  /** 연장 후 퇴실일 */
  checkOut: string;
  /** 새로 점유하는 밤 (입실 + 옛 박수) */
  extraNight: string;
  nightRates?: StayNightRates | null;
}

/** 박수 +1 · 가격 + rate · fitSegments · 밤 셀 추가(있으면) */
export function applyExtend(
  b: Pick<Booking, "checkIn" | "nights" | "price" | "roomId" | "segments" | "nightRates">,
  rate: number,
): ExtendDraft {
  const nights = (b.nights ?? 0) + 1;
  const r = Math.max(0, Math.round(rate));
  const price = b.price + r;
  const segments = fitSegments(b.segments, b.roomId, nights);
  const extraNight = addDays(b.checkIn, nights - 1);
  const nightRates =
    b.nightRates?.nights || b.nightRates?.flat
      ? appendNightAmount(b.nightRates, extraNight, r)
      : b.nightRates ?? null;
  return {
    nights,
    price,
    segments,
    rate: r,
    checkOut: addDays(b.checkIn, nights),
    extraNight,
    nightRates,
  };
}

/** 연장 충돌 경고 모달 제목 (Entry · 운영패널 → Entry) */
export const EXTEND_OVERLAP_TITLE = "이 객실에 예약이 있습니다";

/** 연장 후 초안 (겹침 검사·저장 공통) */
export function extendDraftBooking(b: Booking, rate: number): { draft: Booking; extraNight: string } {
  const d = applyExtend(b, rate);
  return {
    draft: { ...b, nights: d.nights, price: d.price, segments: d.segments },
    extraNight: d.extraNight,
  };
}

/**
 * 1박 연장 시 같은 방·새 밤에 겹치는 다른 활성(미퇴실) 예약.
 * 하드블록 아님 — UI에서 취소/승인 모달. 침묵 연장 금지.
 */
export function extendOverlaps(bookings: Booking[], b: Booking, rate: number): Booking[] {
  if (!canExtend(b)) return [];
  const { draft } = extendDraftBooking(b, rate);
  const mine = legsOf(draft).filter((l) => l.roomId);
  if (!mine.length) return [];
  return bookings.filter((x) => {
    if (x.id === b.id || !occupiesRoom(x) || x.kind !== "stay") return false;
    return legsOf(x).some((o) => !!o.roomId && mine.some((m) => legsClash(m, o)));
  });
}

/** 연장 가능·금액만 검사. 방 겹침은 extendOverlaps + 모달 (단체는 아래 planGroupExtend가 막음). */
export function extendBlock(
  s: HotelSettings,
  bookings: Booking[],
  b: Booking,
  rate: number,
  _label: (id: string | null) => string | null = (id) => roomLabel(s, id),
): string | null {
  if (!canExtend(b)) {
    if (isEarlyOut(b)) return "중도 퇴실한 예약은 1박 연장할 수 없어요. 먼저 되돌리거나 예약을 고쳐 주세요.";
    if (b.status !== "active") return "취소·노쇼 예약은 1박 연장할 수 없어요.";
    if (b.kind !== "stay") return "숙박만 1박 연장할 수 있어요.";
    if ((b.nights ?? 0) >= 90) return "박수가 너무 많아요 (90박까지).";
    return "1박 연장할 수 없어요.";
  }
  if (!Number.isInteger(rate) || rate < 0) return "오늘 요금을 숫자로 적어 주세요.";
  if (rate > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  void bookings;
  return null;
}

export function validateExtendRate(rate: number): string | null {
  if (!Number.isInteger(rate) || rate < 0) return "오늘 요금을 숫자로 적어 주세요.";
  if (rate > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  return null;
}

/**
 * 박수↑인데 판매가가 그대로면 경고 (연장 유도). 박수↓는 자동 재계산이라 여기 안 탐.
 * 장기는 원장이 진실이라 제외.
 */
export function nightsChangedWithoutPrice(
  prev: Pick<Booking, "kind" | "nights" | "price" | "stayMode">,
  next: Pick<Booking, "kind" | "nights" | "price" | "stayMode">,
): boolean {
  if (next.stayMode === "long_stay" || prev.stayMode === "long_stay") return false;
  const pn = prev.nights ?? 0;
  const nn = next.nights ?? 0;
  return next.kind === "stay" && prev.kind === "stay" && nn > pn && prev.price === next.price;
}

export type ExtendCollect = { method: BookPayMethod; amount: number } | null;

export interface ExtendPlan {
  draft: ExtendDraft;
  /** 수납하면 넣을 결제 줄 금액 (0이면 잔금만) */
  collectAmount: number;
}

export function planExtend(b: Booking, rate: number, collect: boolean): ExtendPlan {
  const draft = applyExtend(b, rate);
  return { draft, collectAmount: collect && draft.rate > 0 ? draft.rate : 0 };
}

/** 운영패널 「1박 연장」라이트 모달 · 카드/이체/현금/서비스/후불 */
export type ExtendPayMethod = BookPayMethod | "service" | "deferred";
export const EXTEND_PAY_METHODS: ExtendPayMethod[] = [...BOOK_PAY_METHODS, "service", "deferred"];
export const EXTEND_PAY_LABEL: Record<ExtendPayMethod, string> = {
  ...BOOK_PAY_LABEL,
  service: "서비스",
  deferred: "후불",
};
export const isExtendPayMethod = (v: unknown): v is ExtendPayMethod =>
  v === "service" || v === "deferred" || isBookPayMethod(v);

export interface OpsExtendInput {
  /** 오늘 요금 (서비스면 무시·0) */
  rate: number;
  method: ExtendPayMethod;
  bizDate: string;
}

export interface OpsExtendPlan {
  draft: ExtendDraft;
  method: ExtendPayMethod;
  /** 판매가에 더하는 금액 (서비스=0) */
  effectiveRate: number;
  collectAmount: number;
  payMethod: BookPayMethod | null;
}

/** 운영패널 1박 연장: planExtend + 결제수단. StaySale 비경유. */
export function planOpsExtend(b: Booking, input: OpsExtendInput): OpsExtendPlan | { err: string } {
  if (!canExtend(b)) {
    if (isEarlyOut(b)) return { err: "중도 퇴실한 예약은 1박 연장할 수 없어요. 먼저 되돌리거나 예약을 고쳐 주세요." };
    if (b.status !== "active") return { err: "취소·노쇼 예약은 1박 연장할 수 없어요." };
    if (b.kind !== "stay") return { err: "숙박만 1박 연장할 수 있어요." };
    if ((b.nights ?? 0) >= 90) return { err: "박수가 너무 많아요 (90박까지)." };
    return { err: "1박 연장할 수 없어요." };
  }
  if (!isExtendPayMethod(input.method)) return { err: "카드 · 이체 · 현금 · 서비스 · 후불 중에 골라 주세요." };
  const effectiveRate = input.method === "service" ? 0 : Math.max(0, Math.round(input.rate));
  const rv = validateExtendRate(effectiveRate);
  if (rv) return { err: rv };
  const collect =
    effectiveRate > 0 && input.method !== "service" && input.method !== "deferred";
  if (collect) {
    const pv = validatePayment(effectiveRate, input.method, input.bizDate);
    if (pv) return { err: pv };
  }
  const plan = planExtend(b, effectiveRate, collect);
  return {
    draft: plan.draft,
    method: input.method,
    effectiveRate,
    collectAmount: plan.collectAmount,
    payMethod: collect && isBookPayMethod(input.method) ? input.method : null,
  };
}

/** 단체: 방마다 단가 (방별 flat → 단체 타입 요금) */
export function groupMemberRate(
  b: Pick<Booking, "price" | "nights" | "typeId" | "nightRates">,
  rates: Record<string, number> | null | undefined,
): number {
  return nightRate(b, rates?.[b.typeId]);
}

export interface GroupExtendPlan {
  members: { id: string; guestName: string; roomId: string | null; typeId: string; draft: ExtendDraft }[];
  totalRate: number;
}

/** 활성 방만 +1박 · 가격 가산. 막히면 null + block에 문구 */
export function planGroupExtend(
  s: HotelSettings,
  bookings: Booking[],
  members: Booking[],
  rates: Record<string, number> | null | undefined,
): { ok: GroupExtendPlan } | { err: string } {
  const act = members.filter((b) => isActive(b) && canExtend(b));
  if (!act.length) return { err: "연장할 수 있는 방이 없어요." };
  if (members.some((b) => isActive(b) && isEarlyOut(b))) return { err: "중도 퇴실한 방이 있어서 한 번에 연장할 수 없어요. 방마다 예약 창에서 해 주세요." };
  if (members.some((b) => isActive(b) && b.segments?.length)) return { err: "객실 이동한 방이 있어서 한 번에 연장할 수 없어요. 방마다 예약 창에서 해 주세요." };
  const membersOut: GroupExtendPlan["members"] = [];
  let totalRate = 0;
  // 같은 단체의 다른 방은 서로 겹치지 않으니, 연장 초안을 순차로 반영해 겹침을 봐요
  let working = bookings.map((x) => ({ ...x }));
  for (const b of act) {
    const rate = groupMemberRate(b, rates);
    const block = extendBlock(s, working, b, rate);
    if (block) return { err: block };
    const hits = extendOverlaps(working, b, rate);
    if (hits.length) {
      const d = applyExtend(b, rate);
      const rooms = [...new Set(hits.map((x) => `${roomLabel(s, x.roomId) ?? "?"}호`))].join(", ");
      return { err: `${rooms}는 ${dayLabel(d.extraNight)} 밤에 다른 예약이 있어요. 방을 옮기거나 비운 뒤 연장해 주세요.` };
    }
    const draft = applyExtend(b, rate);
    membersOut.push({ id: b.id, guestName: b.guestName, roomId: b.roomId, typeId: b.typeId, draft });
    totalRate += draft.rate;
    working = working.map((x) => (x.id === b.id ? { ...x, nights: draft.nights, price: draft.price, segments: draft.segments } : x));
  }
  return { ok: { members: membersOut, totalRate } };
}

/** 알림용 짧은 줄 */
export function extendNotifyLine(guestName: string, d: ExtendDraft, collected: boolean): string {
  const pay = collected && d.rate > 0 ? ` · 오늘 요금 ${won(d.rate)}원 받음` : d.rate > 0 ? ` · 잔금 +${won(d.rate)}원` : "";
  return `${guestName} 님 ${EXTEND_COPY} · ${d.nights}박 · ${dayLabel(d.checkOut)} 퇴실${pay}`;
}

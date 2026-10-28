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
  "박수가 늘었는데 판매 가격은 그대로예요. 「1박 연장」으로 요금을 더하거나, 가격을 직접 수정해 주세요. 그래도 저장할까요?";
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

/** 조기 퇴실 환불 제안 = 미사용 박 × 단가 (수정 가능) */
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

/** 활성 숙박 · 조기 퇴실 아님 · 366박 미만 */
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

export interface ThroughPlan {
  /** 늘어나는 박수 */
  add: number;
  /** 연장 후 퇴실일 */
  checkOut: string;
  /** 1박 요금(마지막 박 기준) */
  rate: number;
  draft: ExtendDraft;
}

/**
 * 오늘까지 연장 — 퇴실 예정일이 오늘 이전·오늘이면 "오늘 밤까지 묵는 것"으로 박수를 늘려요.
 * 요금은 마지막 박(없으면 1박 평균) 그대로. 결제는 따로(연장과 분리). 366박 상한은 넘지 않아요.
 */
export function planThroughToday(b: Booking, today: string, rateOverride?: number | null, ahead = 0): ThroughPlan | null {
  if (!canExtend(b)) return null;
  const nights0 = b.nights ?? 0;
  // 절대값으로 맞춰요 (두 번 실행해도, 두 사람이 동시에 열어도 같은 결과)
  const want = Math.min(STAY_NIGHTS_MAX, daysBetween(b.checkIn, today) + 1 + Math.max(0, Math.min(30, ahead)));
  const add = want - nights0;
  if (add < 1) return null;
  const rate = Math.max(0, Math.round(rateOverride ?? lastNightRate(b)));
  let cur: Pick<Booking, "checkIn" | "nights" | "price" | "roomId" | "segments" | "nightRates"> = b;
  let last: ExtendDraft | null = null;
  for (let i = 0; i < add; i++) {
    last = applyExtend(cur, rate);
    cur = { ...cur, nights: last.nights, price: last.price, segments: last.segments, nightRates: last.nightRates ?? cur.nightRates };
  }
  const d = last!;
  return { add, checkOut: d.checkOut, rate, draft: { ...d, rate: rate * add } };
}

/** 마지막 박 요금: 박별 요금이 있으면 그 마지막 박, 없으면 방별 flat → 판매가 ÷ 박수 */
export function lastNightRate(b: Pick<Booking, "checkIn" | "price" | "nights" | "nightRates">): number {
  const n = b.nights ?? 0;
  const last = n > 0 ? b.nightRates?.nights?.[addDays(b.checkIn, n - 1)] : undefined;
  if (typeof last === "number" && last > 0) return Math.round(last);
  return nightRate(b, null);
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

/** 오늘까지 연장 후 같은 방·새 밤에 겹치는 다른 활성 예약 (막지 않고 안내만) */
export function throughOverlaps(bookings: Booking[], b: Booking, plan: ThroughPlan): Booking[] {
  // 청구 박수만 비교 — 방 보호(holdAhead)는 청구를 막지 않아요
  const draft: Booking = { ...b, nights: plan.draft.nights, price: plan.draft.price, segments: plan.draft.segments, openEnded: false };
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
    if (isEarlyOut(b)) return "조기 퇴실한 예약은 1박 연장할 수 없어요. 먼저 되돌리거나 예약을 수정해 주세요.";
    if (b.status !== "active") return "취소·노쇼 예약은 1박 연장할 수 없어요.";
    if (b.kind !== "stay") return "숙박만 1박 연장할 수 있어요.";
    if ((b.nights ?? 0) >= STAY_NIGHTS_MAX) return `박수가 너무 많아요 (${STAY_NIGHTS_MAX}박까지).`;
    return "1박 연장할 수 없어요.";
  }
  if (!Number.isInteger(rate) || rate < 0) return "오늘 요금을 숫자로 입력해 주세요.";
  if (rate > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  void bookings;
  return null;
}

export function validateExtendRate(rate: number): string | null {
  if (!Number.isInteger(rate) || rate < 0) return "오늘 요금을 숫자로 입력해 주세요.";
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
  /** 수납하면 넣을 결제 내역 금액 (0이면 잔금만) */
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
    if (isEarlyOut(b)) return { err: "조기 퇴실한 예약은 1박 연장할 수 없어요. 먼저 되돌리거나 예약을 수정해 주세요." };
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
  /** 건너뛴 방 (조기 퇴실·객실 이동·다른 예약과 겹침) — 나머지만 연장해요 */
  skipped: { id: string; roomId: string | null; reason: string }[];
}

/** 활성 방만 +1박 · 가격 가산. 연장할 수 없는 방은 건너뛰고 나머지를 연장해요 (아무 방도 못 하면 err) */
export function planGroupExtend(
  s: HotelSettings,
  bookings: Booking[],
  members: Booking[],
  rates: Record<string, number> | null | undefined,
): { ok: GroupExtendPlan } | { err: string } {
  const live = members.filter((b) => isActive(b));
  const skipped: GroupExtendPlan["skipped"] = [];
  const membersOut: GroupExtendPlan["members"] = [];
  let totalRate = 0;
  // 같은 단체의 다른 방은 서로 겹치지 않으니, 연장 초안을 순차로 반영해 겹침을 봐요
  let working = bookings.map((x) => ({ ...x }));
  for (const b of live) {
    const skip = (reason: string) => skipped.push({ id: b.id, roomId: b.roomId, reason });
    if (isEarlyOut(b)) {
      skip("조기 퇴실");
      continue;
    }
    if (!canExtend(b)) {
      skip((b.nights ?? 0) >= STAY_NIGHTS_MAX ? `${STAY_NIGHTS_MAX}박까지` : "연장 불가");
      continue;
    }
    if (b.segments?.length) {
      skip("객실 이동함");
      continue;
    }
    const rate = groupMemberRate(b, rates);
    const block = extendBlock(s, working, b, rate);
    if (block) {
      skip(block);
      continue;
    }
    const hits = extendOverlaps(working, b, rate);
    if (hits.length) {
      const d = applyExtend(b, rate);
      skip(`${dayLabel(d.extraNight)} 밤에 다른 예약`);
      continue;
    }
    const draft = applyExtend(b, rate);
    membersOut.push({ id: b.id, guestName: b.guestName, roomId: b.roomId, typeId: b.typeId, draft });
    totalRate += draft.rate;
    working = working.map((x) => (x.id === b.id ? { ...x, nights: draft.nights, price: draft.price, segments: draft.segments } : x));
  }
  if (!membersOut.length) {
    const why = skipped[0] ? `${roomLabel(s, skipped[0].roomId) ?? "?"}호: ${skipped[0].reason}` : "";
    return { err: `연장할 수 있는 방이 없어요.${why ? ` (${why})` : ""}` };
  }
  return { ok: { members: membersOut, totalRate, skipped } };
}

/** 건너뛴 방 안내 한 줄 (없으면 빈 문자열) */
export function skippedNote(s: HotelSettings, skipped: GroupExtendPlan["skipped"]): string {
  if (!skipped.length) return "";
  return `건너뜀 ${skipped.map((k) => `${roomLabel(s, k.roomId) ?? "?"}호(${k.reason})`).join(", ")}`;
}

/** 알림용 짧은 줄 */
export function extendNotifyLine(guestName: string, d: ExtendDraft, collected: boolean): string {
  const pay = collected && d.rate > 0 ? ` · 오늘 요금 ${won(d.rate)}원 수납` : d.rate > 0 ? ` · 잔금 +${won(d.rate)}원` : "";
  return `${guestName} 님 ${EXTEND_COPY} · ${d.nights}박 · ${dayLabel(d.checkOut)} 퇴실${pay}`;
}


/** 열린 숙박: 앱이 따라가야 하는 입실 중 숙박인가 (입실함 · 퇴실/조기 퇴실/취소 아님 · 장기 모드 아님) */
export function isOpenFollowable(b: Booking): boolean {
  return b.kind === "stay" && b.status === "active" && b.openEnded === true && b.arrived && !b.checkedOutAt && b.stayMode !== "long_stay" && canExtend(b);
}

export interface OpenFollow {
  plan: ThroughPlan;
  /** 실제로 확보한 여분 박 (원하는 버퍼에서 겹치면 줄어들 수 있음) */
  ahead: number;
}

/**
 * 열린 숙박을 "오늘 밤 + 버퍼"까지 이을 계획. 새로 늘어나는 밤에 다른 예약이 있으면 버퍼를 줄여 보고,
 * 오늘 밤까지도 겹치면 건드리지 않아요 (null — 확인 필요 T12′가 알려 줘요). 이미 충분하면 null.
 */
export function planOpenFollow(b: Booking, bookings: Booking[], today: string): OpenFollow | null {
  if (!isOpenFollowable(b)) return null;
  // 청구는 오늘 밤까지만 — 방 보호(holdAhead)는 방만 막고 박수·요금에 넣지 않아요
  const before = new Set(throughOverlaps(bookings, b, { draft: { nights: b.nights ?? 0, price: b.price, segments: b.segments ?? null } } as ThroughPlan).map((x) => x.id));
  const plan = planThroughToday(b, today, null, 0);
  if (!plan) return null;
  const hits = throughOverlaps(bookings, b, plan).filter((x) => !before.has(x.id));
  return hits.length ? null : { plan, ahead: 0 };
}

/** 열린 숙박인데 이을 밤(버퍼 포함 필요 최소 = 오늘 밤)에 다른 예약이 있어 따라가지 못하는 경우 → 겹치는 예약들 */
export function openFollowBlocked(b: Booking, bookings: Booking[], today: string): Booking[] {
  if (!isOpenFollowable(b)) return [];
  const plan = planThroughToday(b, today, null, 0);
  if (!plan) return [];
  const before = new Set(throughOverlaps(bookings, b, { draft: { nights: b.nights ?? 0, price: b.price, segments: b.segments ?? null } } as ThroughPlan).map((x) => x.id));
  return throughOverlaps(bookings, b, plan).filter((x) => !before.has(x.id));
}

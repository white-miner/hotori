// 1박 연장: 박수 +1 · 판매 가격에 당일 단가 가산 · 잔금/수납 제안 (스키마 추가 없음)
import {
  type Booking,
  type HotelSettings,
  type RoomSegment,
  addDays,
  dayLabel,
  fitSegments,
  isActive,
  isEarlyOut,
  legConflicts,
  roomLabel,
  won,
} from "./ledger";
import { type BookPayMethod, PAY_MAX } from "./payment";

export const EXTEND_COPY = "1박 연장";
export const NIGHTS_PRICE_WARN =
  "박수가 바뀌었는데 판매 가격은 그대로예요. 가격·잔금을 맞추지 않으면 완납으로 보일 수 있어요. 그래도 저장할까요?";

/** 1박 단가 기본값: 타입/단체 요금이 있으면 그걸, 없으면 현재 판매가 ÷ 박수 */
export function nightRate(b: Pick<Booking, "price" | "nights">, typeRate?: number | null): number {
  if (typeRate != null && typeRate > 0) return Math.round(typeRate);
  const n = b.nights ?? 0;
  if (n < 1) return 0;
  return Math.max(0, Math.round(b.price / n));
}

/** 활성 숙박 · 중도 퇴실 아님 · 90박 미만 */
export function canExtend(b: Pick<Booking, "status" | "kind" | "checkIn" | "nights" | "earlyOut">): boolean {
  return b.status === "active" && b.kind === "stay" && !!b.nights && b.nights >= 1 && b.nights < 90 && !isEarlyOut(b);
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
}

/** 박수 +1 · 가격 + rate · fitSegments */
export function applyExtend(b: Pick<Booking, "checkIn" | "nights" | "price" | "roomId" | "segments">, rate: number): ExtendDraft {
  const nights = (b.nights ?? 0) + 1;
  const r = Math.max(0, Math.round(rate));
  const price = b.price + r;
  const segments = fitSegments(b.segments, b.roomId, nights);
  return {
    nights,
    price,
    segments,
    rate: r,
    checkOut: addDays(b.checkIn, nights),
    extraNight: addDays(b.checkIn, nights - 1),
  };
}

/** 방 겹침으로 연장 막힘 문구, 아니면 null */
export function extendBlock(
  s: HotelSettings,
  bookings: Booking[],
  b: Booking,
  rate: number,
  label: (id: string | null) => string | null = (id) => roomLabel(s, id),
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
  const d = applyExtend(b, rate);
  const draft: Booking = { ...b, nights: d.nights, price: d.price, segments: d.segments };
  const busy = legConflicts(bookings, draft);
  if (busy.length) {
    const rooms = [...new Set(busy.map((l) => `${label(l.roomId) ?? "?"}호`))].join(", ");
    return `${rooms}는 ${dayLabel(d.extraNight)} 밤에 다른 예약이 있어요. 방을 옮기거나 비운 뒤 연장해 주세요.`;
  }
  return null;
}

export function validateExtendRate(rate: number): string | null {
  if (!Number.isInteger(rate) || rate < 0) return "오늘 요금을 숫자로 적어 주세요.";
  if (rate > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  return null;
}

/** 박수만 바뀌고 판매 가격이 그대로면 경고 (조용한 완납 과소청구 방지). 장기는 원장이 진실이라 제외 */
export function nightsChangedWithoutPrice(
  prev: Pick<Booking, "kind" | "nights" | "price" | "stayMode">,
  next: Pick<Booking, "kind" | "nights" | "price" | "stayMode">,
): boolean {
  if (next.stayMode === "long_stay" || prev.stayMode === "long_stay") return false;
  return next.kind === "stay" && prev.kind === "stay" && (prev.nights ?? 0) !== (next.nights ?? 0) && prev.price === next.price;
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

/** 단체: 방마다 단가 (단체 타입 요금 우선) */
export function groupMemberRate(b: Pick<Booking, "price" | "nights" | "typeId">, rates: Record<string, number> | null | undefined): number {
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

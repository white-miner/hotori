// 단체 정산: 단체 하나를 결제자 하나로. 금액은 방들의 지금 상태로 계산해요.
import { type Booking, type Platform } from "./ledger";
import { type Payment, isOnsite, paidOf } from "./payment";

export type GroupPayMode = "prepaid" | "postpaid";
export const PAY_MODE_LABEL: Record<GroupPayMode, string> = { prepaid: "선결제", postpaid: "후불(퇴실 후 정산)" };
/** 단체 뱃지 6색 팔레트 (현황·배치 동일) */
export const GROUP_BADGE_COLORS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;
export type GroupBadgeColor = (typeof GROUP_BADGE_COLORS)[number];
export function isGroupBadgeColor(v: unknown): v is GroupBadgeColor {
  return typeof v === "string" && (GROUP_BADGE_COLORS as readonly string[]).includes(v);
}
export interface GroupExtra {
  name: string;
  amount: number;
}
export interface GroupInfo {
  id: string;
  payMode: GroupPayMode;
  dueOn: string | null;
  payerCompany: string | null;
  payerName: string | null;
  payerPhone: string | null;
  /** 타입별 1박 요금 (만들 때 적은 값, 보여 주기용) */
  rates: Record<string, number> | null;
  extras: GroupExtra[];
  payments: Payment[];
  /** 칸 「단체」뱃지 색 (g1..g6). null이면 기본 무채 */
  badgeColor: GroupBadgeColor | null;
}
export const emptyGroupInfo = (id: string): GroupInfo => ({
  id,
  payMode: "prepaid",
  dueOn: null,
  payerCompany: null,
  payerName: null,
  payerPhone: null,
  rates: null,
  extras: [],
  payments: [],
  badgeColor: null,
});
export const EXTRA_NAME_MAX = 30;
export const EXTRA_MAX = 50;

/** 타입별 1박 요금으로 방마다 가격 (요금 × 박수) */
export function ratePrices(roomTypes: string[], rates: Record<string, number>, nights: number): number[] {
  return roomTypes.map((t) => Math.max(0, Math.round(rates[t] ?? 0)) * nights);
}
/** "S 10실 × 50,000 × 12박 + T 4실 × 70,000 × 12박" 식 (타입 순서대로) */
export function rateFormula(counts: { label: string; n: number; rate: number }[], nights: number): string {
  return counts
    .filter((c) => c.n > 0)
    .map((c) => `${c.label} ${c.n}실 × ${c.rate.toLocaleString("ko-KR")} × ${nights}박`)
    .join(" + ");
}

export interface SettleLine {
  typeId: string;
  rooms: number;
  nights: number; // 방마다 박수 합
  rate: number; // 1박 요금 (적은 값, 없으면 평균)
  subtotal: number; // 판매 가격 합 (추가 인원 뺀)
  noshow: number;
}
export interface Settlement {
  lines: SettleLine[];
  roomSum: number;
  extraGuests: number; // 추가 인원 (B)
  extraTime: number; // 빠른 입실 · 늦은 퇴실 (D)
  parking: number; // 추가 차량 − 도보 할인 (E)
  extras: number; // 추가 항목
  refunds: number; // 중도 퇴실 환불
  cancelled: { rooms: number; amount: number }; // 빠진 것 (청구 안 함)
  noshowRooms: number;
  total: number; // 최종 결제액
  paid: number; // 받은 돈 (단체 + 방마다 받은 선금)
  left: number;
  settled: boolean;
  /** 잔금을 따지나요: 후불이거나 현장 결제 플랫폼일 때 (OTA 선결제는 잔금 없음) */
  tracked: boolean;
}
/**
 * 정산 계산: 취소한 방은 빼고, 노쇼는 넣고, 중도 퇴실 환불은 빼요.
 * 방 가격을 고쳤으면 고친 가격이 들어가요 (가격 = 판매 가격 − 추가 인원 − 빠른 입실·늦은 퇴실).
 */
export function settle(members: Booking[], info: GroupInfo | null | undefined, plat?: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null): Settlement {
  const counted = members.filter((b) => b.status !== "cancelled");
  const byType = new Map<string, SettleLine>();
  let extraGuests = 0;
  let extraTime = 0;
  let parking = 0;
  let refunds = 0;
  for (const b of counted) {
    const xf = Math.min(b.extraFee ?? 0, b.price);
    extraGuests += xf;
    const tf = b.kind === "stay" && (b.earlyIn || b.lateOut) ? Math.min(Math.max(0, b.timeFee ?? 0), b.price - xf) : 0;
    extraTime += tf;
    const cf = b.arrival === "car" ? Math.max(0, b.carFee ?? 0) : 0;
    const wo = b.arrival === "walk" ? Math.max(0, b.walkOff ?? 0) : 0;
    parking += cf - wo;
    if (b.status === "active" && b.earlyOut && b.refund) refunds += b.refund;
    let l = byType.get(b.typeId);
    if (!l) byType.set(b.typeId, (l = { typeId: b.typeId, rooms: 0, nights: 0, rate: 0, subtotal: 0, noshow: 0 }));
    l.rooms++;
    l.nights += b.nights ?? 1;
    l.subtotal += b.price - xf - tf - cf + wo;
    if (b.status === "noshow") l.noshow++;
  }
  const lines = [...byType.values()].map((l) => {
    const r = info?.rates?.[l.typeId];
    return { ...l, rate: r && r > 0 ? r : l.nights ? Math.round(l.subtotal / l.nights) : 0 };
  });
  const cx = members.filter((b) => b.status === "cancelled");
  const roomSum = lines.reduce((a, l) => a + l.subtotal, 0);
  const extras = (info?.extras ?? []).reduce((a, x) => a + Math.max(0, x.amount), 0);
  const total = Math.max(0, roomSum + extraGuests + extraTime + parking + extras - refunds);
  const paid = (info?.payments ?? []).reduce((a, x) => a + x.amount, 0) + counted.reduce((a, b) => a + paidOf(b), 0);
  // 후불·현장 결제만 잔금. OTA 선결제(prepaid)는 결제 줄·추가항목이 있어도 플랫폼 선결제 → 잔금 없음.
  const tracked = info?.payMode === "postpaid" || isOnsite(plat);
  const left = tracked ? Math.max(0, total - paid) : 0;
  return {
    lines,
    roomSum,
    extraGuests,
    extraTime,
    parking,
    extras,
    refunds,
    cancelled: { rooms: cx.length, amount: cx.reduce((a, b) => a + b.price, 0) },
    noshowRooms: counted.filter((b) => b.status === "noshow").length,
    total,
    paid,
    left,
    settled: tracked && total > 0 && left === 0,
    tracked,
  };
}
/** 장부 단체 줄의 작은 글자: '정산 대기 9,360,000' · '잔금 …' · '정산 완료' */
export function settleBadge(st: Settlement, info: GroupInfo | null | undefined): { text: string; due: boolean } | null {
  if (!st.tracked || st.total <= 0) return null;
  if (st.settled) return { text: "정산 완료", due: false };
  const v = st.left.toLocaleString("ko-KR");
  return { text: info?.payMode === "postpaid" ? `정산 대기 ${v}` : `잔금 ${v}`, due: true };
}
export function validateExtra(x: GroupExtra): string | null {
  if (!x.name.trim()) return "항목 이름을 적어 주세요.";
  if (x.name.trim().length > EXTRA_NAME_MAX) return `항목 이름은 ${EXTRA_NAME_MAX}글자까지예요.`;
  if (!Number.isInteger(x.amount) || x.amount <= 0 || x.amount > 100_000_000) return "금액을 적어 주세요.";
  return null;
}

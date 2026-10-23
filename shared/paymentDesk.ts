// 「현황」결제/납입 데스크: Option A 축소 · 단실 addPayment · 동일 groupId → addGroupPayment
import { type Booking, type Platform, won } from "./ledger";
import {
  type BookPayMethod,
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type PayKind,
  type Payment,
  PAY_MAX,
  isBookPayMethod,
  payState,
  validatePayment,
} from "./payment";
import {
  type SurchargeReason,
  SURCHARGE_REASON_LABEL,
  SURCHARGE_REASONS,
  canAddSurcharge,
  planAddSurcharge,
  type AddSurchargePlan,
} from "./addSurcharge";
import { type GroupInfo, settle } from "./settle";

export const PAYMENT_DESK_TITLE = "결제 / 납입";
export const PAYMENT_DESK_CTA = "결제 / 납입";

export { BOOK_PAY_METHODS as PAYMENT_DESK_METHODS, BOOK_PAY_LABEL as PAYMENT_DESK_METHOD_LABEL };
export { SURCHARGE_REASONS as PAYMENT_DESK_SURCHARGE_REASONS, SURCHARGE_REASON_LABEL };

export type PaymentDeskKind = PayKind; // balance=받기 · deposit=선금

export interface PaymentDeskGlance {
  tracked: boolean;
  due: number;
  paid: number;
  left: number;
  full: boolean;
  /** 그룹 합산이면 true */
  group: boolean;
  memberCount: number;
  priceUnset: boolean;
}

export function paymentDeskGlance(
  members: Booking[],
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  groupInfo?: GroupInfo | null,
): PaymentDeskGlance {
  const active = members.filter((b) => b.status === "active");
  const priceUnset = active.some((b) => b.priceUnset);
  const groupId = active[0]?.groupId ?? null;
  // 같은 groupId면 settle(방+단체 수납). 호출측이 형제 전부 넘겨야 due가 맞음.
  const isGroup = !!groupId && active.every((b) => b.groupId === groupId);

  if (isGroup) {
    const st = settle(active, groupInfo ?? null, plat);
    return {
      tracked: st.tracked,
      due: st.total,
      paid: st.paid,
      left: st.left,
      full: st.settled,
      group: active.length > 1,
      memberCount: active.length,
      priceUnset,
    };
  }

  const b = active[0];
  if (!b) {
    return { tracked: false, due: 0, paid: 0, left: 0, full: false, group: false, memberCount: 0, priceUnset: false };
  }
  const ps = payState(b, plat);
  return {
    tracked: ps.tracked,
    due: ps.due,
    paid: ps.paid,
    left: ps.left,
    full: ps.full,
    group: false,
    memberCount: 1,
    priceUnset,
  };
}

/** 동일 groupId 점유 복수선택 허용 여부 */
export function sameGroupId(members: readonly (Pick<Booking, "groupId"> | null | undefined)[]): string | null {
  const ids = members.map((b) => b?.groupId ?? null);
  if (!ids.length || ids.some((id) => !id)) return null;
  const first = ids[0]!;
  return ids.every((id) => id === first) ? first : null;
}

export interface PaymentDeskPayInput {
  amount: number;
  method: BookPayMethod;
  kind: PaymentDeskKind;
  bizDate: string;
}

export interface PaymentDeskPayPlan {
  amount: number;
  method: BookPayMethod;
  kind: PaymentDeskKind;
  /** 그룹 1줄이면 true */
  asGroup: boolean;
}

export function validatePaymentDeskPay(glance: PaymentDeskGlance, input: PaymentDeskPayInput): string | null {
  if (glance.priceUnset) return "금액미정 예약이 있어요. 판매가를 먼저 확정해 주세요.";
  if (!isBookPayMethod(input.method)) return "카드 · 현금 · 이체 중에 골라 주세요.";
  if (input.kind !== "balance" && input.kind !== "deposit") return "받기 · 선금 중에 골라 주세요.";
  const pv = validatePayment(input.amount, input.method, input.bizDate);
  if (pv) return pv;
  // OTA 등 잔금 미추적: 선금/받기는 허용(기록)하되 left 검증 생략
  if (glance.tracked && input.kind === "balance" && input.amount > glance.left && glance.left >= 0) {
    // 부분/초과: 초과는 막지 않음(현장 관례) — left=0이면 안내만 UI
  }
  return null;
}

export function planPaymentDeskPay(
  glance: PaymentDeskGlance,
  input: PaymentDeskPayInput,
): PaymentDeskPayPlan | { err: string } {
  const err = validatePaymentDeskPay(glance, input);
  if (err) return { err };
  return {
    amount: Math.round(input.amount),
    method: input.method,
    kind: input.kind,
    asGroup: glance.group,
  };
}

export interface PaymentDeskSurchargeInput {
  reason: SurchargeReason;
  hours: number;
  amount: number;
  memo: string;
  collect: boolean;
  method: BookPayMethod;
  bizDate: string;
}

/** 단실만. 그룹 복수면 null. */
export function planPaymentDeskSurcharge(
  b: Booking,
  input: PaymentDeskSurchargeInput,
): AddSurchargePlan | { err: string } {
  if (!canAddSurcharge(b)) return { err: "이 예약에는 할증을 넣을 수 없어요." };
  return planAddSurcharge(b, input);
}

export function paymentDeskNotifyLine(
  guestName: string,
  amount: number,
  method: BookPayMethod,
  kind: PaymentDeskKind,
  leftAfter: number | null,
  group?: boolean,
): string {
  const verb = kind === "deposit" ? "선금" : "받기";
  const scope = group ? "단체 " : "";
  const left =
    leftAfter == null ? "" : leftAfter > 0 ? ` · 남은 금액 ${won(leftAfter)}원` : " · 정산 완료";
  return `${scope}${guestName} 님 ${verb} · ${BOOK_PAY_LABEL[method]} ${won(amount)}원${left}`;
}

export function canOpenPaymentDesk(b: Pick<Booking, "status" | "kind"> | null | undefined): boolean {
  return !!b && b.status === "active" && b.kind === "stay";
}

/** 오잔금 제거: 판매가를 받은 돈(+환불)에 맞춰 left=0. 결제 줄은 유지(void/adjust). 장기 제외.
 * 늦은 퇴실 auto 시간료(기본 1만)가 판매가에 들어간 오잔금도 이 경로로 맞춤 → timeFee=0(서비스) 유지·lateOut 유지. */
export function planClearResidualBalance(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
): { bookingId: string; newPrice: number; cleared: number; timeFee: number | null } | { err: string } {
  if (b.status !== "active" || b.kind !== "stay") return { err: "활성 숙박만 맞출 수 있어요." };
  if (b.stayMode === "long_stay") return { err: "장기 숙박은 예약 기록의 원장에서 맞춰 주세요." };
  if (b.priceUnset) return { err: "금액미정이에요. 판매가를 먼저 확정해 주세요." };
  const ps = payState(b, plat);
  if (!ps.tracked) return { err: "현장 결제 예약만 잔금을 맞출 수 있어요." };
  if (ps.left <= 0) return { err: "없앨 잔금이 없어요." };
  const refund = b.earlyOut ? Math.max(0, b.refund ?? 0) : 0;
  const newPrice = Math.round(ps.paid + refund);
  if (newPrice < 0 || newPrice > PAY_MAX) return { err: "판매가를 맞출 수 없어요." };
  if (newPrice === Math.round(b.price)) return { err: "판매가가 이미 맞아요." };
  const hasTime = !!(b.earlyIn || b.lateOut);
  return {
    bookingId: b.id,
    newPrice,
    cleared: ps.left,
    // 시간 마크는 두고 요금만 서비스(0)로 — 오잔금이 시간료일 때 원장 정합
    timeFee: hasTime ? 0 : (b.timeFee ?? null),
  };
}

export function clearResidualConfirmLine(cleared: number, newPrice: number): string {
  return `오잔금 ${won(cleared)}원을 없애고 판매가를 ${won(newPrice)}원으로 맞출까요?\n결제 내역은 그대로 두고, 청구액만 조정해요. (늦은 퇴실 시간은 유지 · 시간료 0원)`;
}

export type DeskPayLine =
  | { scope: "booking"; bookingId: string; pay: Payment; roomHint?: string }
  | { scope: "group"; groupId: string; pay: Payment };

/** 데스크 내역: 방 결제 + (있으면) 단체 결제 */
export function deskPaymentLines(
  members: Booking[],
  groupInfo?: GroupInfo | null,
): DeskPayLine[] {
  const lines: DeskPayLine[] = [];
  for (const b of members) {
    for (const p of b.payments ?? []) {
      lines.push({ scope: "booking", bookingId: b.id, pay: p });
    }
  }
  if (groupInfo?.payments?.length) {
    for (const p of groupInfo.payments) {
      lines.push({ scope: "group", groupId: groupInfo.id, pay: p });
    }
  }
  return lines.sort((a, b) => (a.pay.createdAt || a.pay.bizDate).localeCompare(b.pay.createdAt || b.pay.bizDate));
}

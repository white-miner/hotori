// 「현황」결제/납입 데스크: Option A 축소 · 단실 addPayment · 동일 groupId → addGroupPayment
import { type Booking, type Platform, won } from "./ledger";
import {
  type BookPayMethod,
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type PayKind,
  isBookPayMethod,
  isOnsite,
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
  const isGroup = !!groupId && active.length > 1 && active.every((b) => b.groupId === groupId);

  if (isGroup) {
    const st = settle(active, groupInfo ?? null, plat);
    return {
      tracked: st.tracked,
      due: st.total,
      paid: st.paid,
      left: st.left,
      full: st.settled,
      group: true,
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

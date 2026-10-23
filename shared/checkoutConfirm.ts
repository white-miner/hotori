// 퇴실처리 확인: 잔금 있으면 settle/PaymentDesk 글랜스 + 결제 후 퇴실 · 잔금 남기고 퇴실
import { type Booking, type Platform, won } from "./ledger";
import { type BookPayMethod, BOOK_PAY_LABEL } from "./payment";
import {
  type PaymentDeskGlance,
  type PaymentDeskPayPlan,
  paymentDeskGlance,
  planPaymentDeskPay,
} from "./paymentDesk";
import type { GroupInfo } from "./settle";

export const CHECKOUT_CONFIRM_TITLE = "퇴실처리";
export const CHECKOUT_PAY_THEN = "결제 후 퇴실";
export const CHECKOUT_LEAVE_BALANCE = "잔금 남기고 퇴실";
export const CHECKOUT_SIMPLE_CONFIRM = "퇴실처리";

/** 잔금 결제 UI를 띄울지 (추적·남은>0·금액확정) */
export function checkoutNeedsBalanceUi(glance: PaymentDeskGlance): boolean {
  return glance.tracked && glance.left > 0 && !glance.priceUnset;
}

export function checkoutBalanceGlance(
  members: Booking[],
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  groupInfo?: GroupInfo | null,
): PaymentDeskGlance {
  return paymentDeskGlance(members, plat, groupInfo);
}

/** 퇴실 직전 잔금 전액(또는 입력액) 받기 계획 */
export function planCheckoutBalancePay(
  glance: PaymentDeskGlance,
  input: { amount: number; method: BookPayMethod; bizDate: string },
): PaymentDeskPayPlan | { err: string } {
  return planPaymentDeskPay(glance, {
    amount: input.amount,
    method: input.method,
    kind: "balance",
    bizDate: input.bizDate,
  });
}

export function checkoutPayNotifyLine(guestName: string, amount: number, method: BookPayMethod, group?: boolean): string {
  const scope = group ? "단체 " : "";
  return `${scope}${guestName} 님 받기 · ${BOOK_PAY_LABEL[method]} ${won(amount)}원 · 퇴실처리`;
}

export function checkoutLeaveBalanceNotifyLine(guestName: string, left: number): string {
  return `${guestName} 님 퇴실처리 · 잔금 ${won(left)}원 남김`;
}

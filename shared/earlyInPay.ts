// 「현황」빠른 입실: 즉시 arrived 금지 → 추가금 결제 팝업 후 확정
// 서비스 = 무료(₩0)·결제 줄 없음. 카드/현금/이체는 amount>0일 때만 booking_payments.
import { type BookPayMethod, BOOK_PAY_LABEL, BOOK_PAY_METHODS, isBookPayMethod, PAY_MAX, validatePayment } from "./payment";
import { won } from "./ledger";

export const EARLY_IN_PAY_TITLE = "빠른 입실";
export const EARLY_IN_PAY_NOTE = "추가금 · 빠른 입실";
export const EARLY_IN_CTA = "빠른 입실";
export const EARLY_IN_HOUR_CHIPS = [1, 2, 3, 4, 5, 6] as const;

/** UI 방법: Option A 3종 + 서비스(complimentary) */
export type EarlyInPayMethod = BookPayMethod | "service";
export const EARLY_IN_PAY_METHODS: EarlyInPayMethod[] = [...BOOK_PAY_METHODS, "service"];
export const EARLY_IN_PAY_LABEL: Record<EarlyInPayMethod, string> = {
  ...BOOK_PAY_LABEL,
  service: "서비스",
};
export const isEarlyInPayMethod = (v: unknown): v is EarlyInPayMethod =>
  v === "service" || isBookPayMethod(v);

export interface EarlyInPayInput {
  amount: number;
  method: EarlyInPayMethod;
  bizDate: string;
  /** 빠른 입실 시간 수 (0=시간만 안 바꾸고 입실) */
  hours?: number;
}

export interface EarlyInPayPlan {
  /** 판매가에 더할 추가금 (서비스·0원이면 0) */
  priceDelta: number;
  /** 지금 받을 금액 (priceDelta와 동일 · >0이면 결제 줄) */
  collectAmount: number;
  method: BookPayMethod | null;
  payNote: string | null;
  /** 예약 earlyIn에 쓸 시간 (0이면 필드 유지) */
  hours: number;
}

/** 서비스면 금액 강제 0 · 그 외는 입력 금액(≥0) */
export function effectiveEarlyInAmount(amount: number, method: EarlyInPayMethod): number {
  if (method === "service") return 0;
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

export function validateEarlyInPay(input: EarlyInPayInput): string | null {
  if (!isEarlyInPayMethod(input.method)) return "카드 · 현금 · 이체 · 서비스 중에 골라 주세요.";
  // 서비스: 금액 무시(강제 0) · 날짜/방법 검증 생략
  if (input.method === "service") return null;
  if (!Number.isFinite(input.amount) || input.amount < 0) return "추가금 금액을 숫자로 적어 주세요.";
  const amount = Math.round(input.amount);
  if (amount > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (amount > 0) {
    const pv = validatePayment(amount, input.method, input.bizDate);
    if (pv) return pv;
  }
  return null;
}

/**
 * 확정 초안: 금액>0 · 비서비스 → 판매가+수납 · 아니면 입실만.
 * arrived 패치는 UI가 항상 적용. hours>0이면 earlyIn 갱신.
 */
export function planEarlyInPay(input: EarlyInPayInput): EarlyInPayPlan | { err: string } {
  const err = validateEarlyInPay(input);
  if (err) return { err };
  const hours =
    typeof input.hours === "number" && Number.isFinite(input.hours)
      ? Math.max(0, Math.min(12, Math.round(input.hours)))
      : 0;
  const amount = effectiveEarlyInAmount(input.amount, input.method);
  if (amount <= 0 || input.method === "service") {
    return { priceDelta: 0, collectAmount: 0, method: null, payNote: null, hours };
  }
  return {
    priceDelta: amount,
    collectAmount: amount,
    method: input.method,
    payNote: EARLY_IN_PAY_NOTE,
    hours,
  };
}

export function earlyInPayNotifyLine(guestName: string, plan: EarlyInPayPlan, method: EarlyInPayMethod): string {
  const time = plan.hours > 0 ? ` · ${plan.hours}시간 앞당김` : "";
  if (method === "service" || plan.collectAmount <= 0) {
    return `${guestName} 님 빠른 입실했어요${method === "service" ? " · 서비스(0원)" : ""}${time}`;
  }
  return `${guestName} 님 빠른 입실 · ${EARLY_IN_PAY_LABEL[plan.method!]} ${won(plan.collectAmount)}원${time}`;
}

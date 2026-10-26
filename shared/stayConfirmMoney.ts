/** 숙박확인서 금액 줄 — settle/장부와 일치 · 기관 환급용. See stay-confirmation-letter-plan.md */
import { type Booking, type Platform, revenueOf } from "./ledger";
import { isOnsite, paidOf, payState } from "./payment";

export type StayConfirmMoney = {
  unset: boolean;
  /** 판매가 (revenueOf) */
  sale: number;
  /** 받은 (paidOf) */
  paid: number;
  /** 잔금 — null이면 인쇄에서 생략 */
  left: number | null;
  /** 받은 줄 표시 (현장·또는 수납 있을 때) */
  showPaid: boolean;
};

/**
 * 확인서 금액: 판매가 항상 · 받은은 수납/현장 · 잔금은 현장 잔금>0일 때만.
 * OTA(비현장) + FO 수납 0 → 판매가만 (플랫폼 선결제 전제 · 허위 잔금 금지).
 */
export function stayConfirmMoney(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
): StayConfirmMoney {
  const paid = paidOf(b);
  if (b.priceUnset) return { unset: true, sale: 0, paid, left: null, showPaid: paid > 0 };
  const sale = revenueOf(b);
  const ps = payState(b, plat);
  const tracked = ps.tracked || isOnsite(plat);
  // 퇴실 후에도 현장 채널이면 잔금 표시 (payState는 active만 tracked)
  const due = sale;
  const leftRaw = Math.max(0, due - paid);
  const showPaid = paid > 0 || tracked;
  const left = tracked && leftRaw > 0 ? leftRaw : null;
  return { unset: false, sale, paid, left, showPaid };
}

/** 한 줄 요약 (FO tip / tests) */
export function stayConfirmMoneyLine(m: StayConfirmMoney, won: (n: number) => string, labels: {
  sale: string;
  paid: string;
  balance: string;
  amountUnset: string;
}): string {
  if (m.unset) return labels.amountUnset;
  const parts = [`${labels.sale} ${won(m.sale)}`];
  if (m.showPaid) parts.push(`${labels.paid} ${won(m.paid)}`);
  if (m.left != null) parts.push(`${labels.balance} ${won(m.left)}`);
  return parts.join(" · ");
}

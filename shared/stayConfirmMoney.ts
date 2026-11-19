/** 숙박확인서 금액 줄 — 결제 등록·장부와 같은 잔액 기준 (shared/folio) · 기관 환급용. See stay-confirmation-letter-plan.md */
import { type Booking, type Platform, revenueOf } from "./ledger";
import { isOnsite, paidOf, payState } from "./payment";
import { bookingBalance, groupFolio, groupExtrasTotal } from "./folio";
import type { GroupInfo } from "./settle";

export type StayConfirmMoney = {
  unset: boolean;
  /** 판매가 (이 객실 revenueOf) */
  sale: number;
  /** 받은 돈 (단체 객실이면 단체 전체 수납) */
  paid: number;
  /** 잔금 — null이면 인쇄에서 생략 */
  left: number | null;
  /** 받은 줄 표시 (현장·또는 수납 있을 때) */
  showPaid: boolean;
  /** 단체 객실: 수납·잔금이 단체 전체 기준 */
  group: boolean;
};

export interface StayConfirmGroup {
  members: readonly Booking[];
  info: GroupInfo | null | undefined;
}

/**
 * 확인서 금액: 판매가 항상 · 받은은 수납/현장 · 잔금은 현장 잔금>0일 때만.
 * 잔금 = 예약 전체 청구 − 받은 결제 (모든 화면과 같은 기준). 단체 객실은 단체 한 장부(단체 결제 포함)로 봐요.
 * OTA(비현장) + FO 수납 0 → 판매가만 (플랫폼 선결제 전제 · 허위 잔금 금지).
 */
export function stayConfirmMoney(
  b: Booking,
  plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined,
  group?: StayConfirmGroup | null,
): StayConfirmMoney {
  const ownPaid = paidOf(b);
  if (b.priceUnset) return { unset: true, sale: 0, paid: ownPaid, left: null, showPaid: ownPaid > 0, group: false };
  const sale = revenueOf(b);
  if (b.groupId && group) {
    const members = group.members.filter((x) => x.groupId === b.groupId && x.status !== "cancelled");
    const lump = (group.info?.payments ?? []).reduce((n, p) => n + p.amount, 0);
    const extras = groupExtrasTotal(group.info);
    const f = groupFolio(members.length ? members : [b], lump, extras, { onsite: plat ? isOnsite(plat) : null, payMode: group.info?.payMode ?? null });
    const tracked = f.tracked || isOnsite(plat);
    const left = tracked && !f.priceUnset && f.owed > 0 ? f.owed : null;
    return { unset: false, sale, paid: f.paid, left, showPaid: f.paid > 0 || tracked, group: true };
  }
  const ps = payState(b, plat);
  const tracked = ps.tracked || isOnsite(plat);
  // 퇴실 후에도 현장 채널이면 잔금 표시 (payState는 active만 tracked)
  const m = bookingBalance(sale, ownPaid);
  const showPaid = ownPaid > 0 || tracked;
  const left = tracked && m.owed > 0 ? m.owed : null;
  return { unset: false, sale, paid: ownPaid, left, showPaid, group: false };
}

/** 한 줄 요약 (FO tip / tests) */
export function stayConfirmMoneyLine(m: StayConfirmMoney, won: (n: number) => string, labels: {
  sale: string;
  paid: string;
  balance: string;
  amountUnset: string;
  groupBasis?: string;
}): string {
  if (m.unset) return labels.amountUnset;
  const parts = [`${labels.sale} ${won(m.sale)}`];
  if (m.showPaid) parts.push(`${labels.paid} ${won(m.paid)}`);
  if (m.left != null) parts.push(`${labels.balance} ${won(m.left)}`);
  if (m.group && labels.groupBasis && (m.showPaid || m.left != null)) parts.push(labels.groupBasis);
  return parts.join(" · ");
}

// 선금 · 잔금: 받은 돈은 예약마다 줄로 적고, 잔금은 화면에서 계산해요.
import { type Booking, type Platform, revenueOf } from "./ledger";
import { won } from "./ledger";

/** 예약 결제 방법: 카드 · 현금 · 이체 (이체는 현금 시재에 안 들어가요). 매점·지출은 카드·현금만 */
export type BookPayMethod = "card" | "cash" | "transfer";
export const BOOK_PAY_METHODS: BookPayMethod[] = ["card", "cash", "transfer"];
export const BOOK_PAY_LABEL: Record<BookPayMethod, string> = { card: "카드", cash: "현금", transfer: "이체" };
export const isBookPayMethod = (v: unknown): v is BookPayMethod => v === "card" || v === "cash" || v === "transfer";

export type PayKind = "deposit" | "balance";
export const PAY_KIND_LABEL: Record<PayKind, string> = { deposit: "선금", balance: "잔금" };
export interface Payment {
  id: string;
  bookingId: string;
  kind: PayKind;
  method: BookPayMethod;
  amount: number;
  bizDate: string;
  createdAt: string;
}
export const PAY_MAX = 100_000_000;

/** 현장 결제 플랫폼: 설정에서 고른 값, 안 골랐으면 이름에 '현장'·'전화'가 있으면 켜져요 */
export function isOnsite(p: Pick<Platform, "name"> & { onsite?: boolean | null } | null | undefined): boolean {
  if (!p) return false;
  if (typeof p.onsite === "boolean") return p.onsite;
  return /현장|전화/.test(p.name);
}

export const paidOf = (b: Pick<Booking, "payments">) => (b.payments ?? []).reduce((n, x) => n + x.amount, 0);

export interface PayState {
  /** 잔금을 따지나요: 현장 결제 플랫폼이거나 받은 돈을 적었으면 */
  tracked: boolean;
  due: number; // 받을 돈 (가격 − 환불)
  paid: number;
  left: number; // 잔금 (0 이상)
  full: boolean; // 완납
}
/**
 * 잔금 계산: 정상 예약만. 플랫폼(OTA) 예약은 플랫폼이 받은 걸로 봐서 잔금이 없어요.
 * 받을 돈 = 판매 가격 − 중도 퇴실 환불.
 */
export function payState(b: Booking, plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined): PayState {
  const paid = paidOf(b);
  const tracked = b.status === "active" && (isOnsite(plat) || paid > 0);
  const due = revenueOf(b);
  const left = tracked ? Math.max(0, due - paid) : 0;
  return { tracked, due, paid, left, full: tracked && left === 0 && due > 0 };
}
/** 장부 현금 시재에 들어가는 예약 현금 (기간 안에 받은 선금·잔금) */
export function bookingCash(list: Pick<Payment, "method" | "amount" | "bizDate">[], from: string, to: string): number {
  return list.filter((x) => x.method === "cash" && x.bizDate >= from && x.bizDate <= to).reduce((n, x) => n + x.amount, 0);
}
export function validatePayment(amount: number, method: string, bizDate: string): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "받은 금액을 적어 주세요.";
  if (amount > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (!isBookPayMethod(method)) return "카드 · 현금 · 이체 중에 골라 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return "받은 날짜를 골라 주세요.";
  return null;
}

/** 받은 돈을 방법별로: 기간을 주면 그 영업일 안에 받은 것만 */
export function paySplit(list: Pick<Payment, "method" | "amount" | "bizDate">[], from?: string, to?: string): Record<BookPayMethod, number> & { total: number } {
  const r = { card: 0, cash: 0, transfer: 0, total: 0 };
  for (const x of list) {
    if (from && x.bizDate < from) continue;
    if (to && x.bizDate > to) continue;
    r[x.method] += x.amount;
    r.total += x.amount;
  }
  return r;
}
/** '카드 120,000 · 현금 50,000 · 이체 30,000' (0원인 방법은 빼요, 다 0이면 빈 글자) */
export function splitLine(p: Record<BookPayMethod, number>): string {
  return BOOK_PAY_METHODS.filter((m) => p[m] > 0).map((m) => `${BOOK_PAY_LABEL[m]} ${won(p[m])}`).join(" · ");
}

// 결제 등록(단체): 결제일 · 수단 · 금액 · 메모(선택) — 이게 전부예요.
//  · 결제는 객실·박에 나누지 않아요. 단체로 받은 한 줄로 기록하고, 청구 합계와 견줘 미수금을 보여 줘요.
//  · 금액 기본값 = 지금 미수금 (고칠 수 있어요). 많거나 적어도 막지 않아요 (초과 수납으로 보여요).
import { md, won } from "./ledger";
import type { GroupLedger } from "./groupLedger";
import type { BookPayMethod } from "./payment";

export const RECEIPT_AMOUNT_MAX = 100_000_000;
export const RECEIPT_MEMO_MAX = 40;

/** 금액 기본값: 미수금 (없으면 0) */
export function receiptSuggest(ledger: Pick<GroupLedger, "owed">): number {
  return Math.max(0, Math.round(ledger.owed));
}

/** 메모 예시: 청구 기간 `10/25~10/27 3박` (객실 요금이 없으면 빈 글자) */
export function receiptMemoHint(ledger: Pick<GroupLedger, "rooms">): string {
  const live = ledger.rooms.filter((r) => r.firstNight && r.lastNight);
  if (!live.length) return "";
  const from = live.map((r) => r.firstNight!).sort()[0]!;
  const to = live.map((r) => r.lastNight!).sort().pop()!;
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return from === to ? `${md(from)} 1박` : `${md(from)}~${md(to)} ${nights}박`;
}

export interface ReceiptInput {
  amount: number;
  method: BookPayMethod;
  bizDate: string;
  memo?: string | null;
}
export interface ReceiptPlan {
  ok: boolean;
  error: string | null;
  amount: number;
  /** 저장할 한 줄 */
  line: { amount: number; method: BookPayMethod; bizDate: string; note: string | null } | null;
  /** 등록 뒤 남는 차액 (양수 = 아직 미수금, 음수 = 초과 수납) */
  after: number;
}

/** 입력 점검 + 저장할 줄. 금액만 막아요 (0 이하 · 1억 초과) */
export function receiptPlan(ledger: Pick<GroupLedger, "owed" | "prepaid">, inp: ReceiptInput): ReceiptPlan {
  const amount = Math.round(Number(inp.amount) || 0);
  const after = ledger.owed - ledger.prepaid - amount;
  if (amount <= 0) return { ok: false, error: "금액을 입력해 주세요.", amount: 0, line: null, after };
  if (amount > RECEIPT_AMOUNT_MAX) return { ok: false, error: "금액을 확인해 주세요 (1억 원까지).", amount, line: null, after };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.bizDate)) return { ok: false, error: "결제일을 골라 주세요.", amount, line: null, after };
  const memo = inp.memo?.trim().slice(0, RECEIPT_MEMO_MAX) || null;
  return { ok: true, error: null, amount, line: { amount, method: inp.method, bizDate: inp.bizDate, note: memo }, after };
}

/** 큰 버튼 글자: `결제 등록 · 690,000원` */
export function receiptButtonLabel(amount: number): string {
  return amount > 0 ? `결제 등록 · ${won(amount)}원` : "결제 등록";
}

/** 등록 뒤 결과 문구: `결제 등록 후 미수금 80,000원` · `정산 완료` · `초과 수납 10,000원` */
export function receiptAfterLabel(after: number): string {
  return after > 0 ? `등록하면 미수금 ${won(after)}원이 남아요` : after < 0 ? `등록하면 초과 수납 ${won(-after)}원이에요` : "등록하면 정산 완료예요";
}

/** 단체 머리글의 큰 버튼: `결제 등록 · 80,000원` — 열면 같은 금액이 채워져 있어요 */
export function receiptNextAction(ledger: Pick<GroupLedger, "owed">): { label: string; amount: number } {
  const amount = receiptSuggest(ledger);
  return { label: receiptButtonLabel(amount), amount };
}

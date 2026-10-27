// Option A · 잔액 보관: 조기 퇴실 시 현금 환불과 분리한 손님 부채 · 새 예약에서 「잔액 사용」
import { unusedNightRefund } from "./extend";
import { type Booking, addDays, won } from "./ledger";
import { phoneDigits, normalizeGuestName } from "./guestSearch";
import { type PayKind, PAY_MAX, paidOf, isBookPayMethod } from "./payment";

export const STAY_CREDIT_COPY = {
  keep: "잔액 보관",
  balance: "보관 잔액",
  use: "잔액 사용",
  preferredDate: "희망 재입실일",
  list: "보관 잔액",
} as const;

export type StayCreditStatus = "open" | "depleted" | "void";

export interface StayCredit {
  id: string;
  hotelId: string;
  guestName: string;
  guestPhone: string | null;
  amountOriginal: number;
  amountRemaining: number;
  preferredRecheckinDate: string | null;
  sourceBookingId: string | null;
  status: StayCreditStatus;
  expiresOn: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StayCreditApplication {
  id: string;
  hotelId: string;
  creditId: string;
  bookingId: string;
  paymentId: string | null;
  amount: number;
  bizDate: string;
  createdAt: string;
}

/** 결제 내역 method — 카드/현금/이체와 구분 · 시재 제외 */
export const STAY_CREDIT_PAY_METHOD = "credit" as const;
export type StayCreditPayMethod = typeof STAY_CREDIT_PAY_METHOD;

export function isStayCreditPayMethod(v: unknown): v is StayCreditPayMethod {
  return v === STAY_CREDIT_PAY_METHOD;
}

export function payMethodLabel(method: string): string {
  if (isStayCreditPayMethod(method)) return STAY_CREDIT_COPY.use;
  if (isBookPayMethod(method)) {
    return method === "card" ? "카드" : method === "cash" ? "현금" : "이체";
  }
  return method;
}

export type EarlyOutDisposition = "none" | "refund" | "keep";

/** 이용분(earned) = 판매가 − 미사용박×단가 제안. 보관 기본 = max(0, 수납액 − earned) */
export function earnedForEarlyOut(
  b: Pick<
    Booking,
    | "kind"
    | "price"
    | "nights"
    | "checkIn"
    | "nightRates"
    | "extraFee"
    | "earlyIn"
    | "lateOut"
    | "timeFee"
    | "arrival"
    | "carFee"
    | "walkOff"
  >,
  earlyOutOn: string,
  typeRate?: number | null,
): number {
  const unused = unusedNightRefund(b, earlyOutOn, typeRate);
  return Math.max(0, Math.round(b.price) - unused);
}

/** 보관액 기본값 = paid − earned (편집 가능). 음수면 0 */
export function defaultKeepAmount(
  b: Pick<
    Booking,
    | "kind"
    | "price"
    | "nights"
    | "checkIn"
    | "nightRates"
    | "extraFee"
    | "earlyIn"
    | "lateOut"
    | "timeFee"
    | "arrival"
    | "carFee"
    | "walkOff"
    | "payments"
  >,
  earlyOutOn: string,
  typeRate?: number | null,
): number {
  const earned = earnedForEarlyOut(b, earlyOutOn, typeRate);
  return Math.max(0, paidOf(b) - earned);
}

export function validateKeepCreditAmount(
  amount: number,
  paid: number,
  maxCap: number = PAY_MAX,
): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "보관 금액을 입력해 주세요.";
  if (amount > maxCap) return "금액이 너무 커요 (1억 원까지).";
  if (amount > paid) return `보관 금액은 수납액(${won(paid)}원)보다 클 수 없어요.`;
  return null;
}

export function validatePreferredRecheckinDate(date: string | null | undefined, today: string): string | null {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "희망 재입실일을 확인해 주세요.";
  if (date < today) return "희망 재입실일은 오늘 이후로 입력해 주세요.";
  return null;
}

export interface CreateStayCreditInput {
  guestName: string;
  guestPhone?: string | null;
  amount: number;
  preferredRecheckinDate?: string | null;
  sourceBookingId: string;
  note?: string | null;
  today: string;
  /** 현장·전화만 MVP 허용 — false면 거절 */
  onsite: boolean;
}

export function planCreateStayCredit(input: CreateStayCreditInput): {
  guestName: string;
  guestPhone: string | null;
  amount: number;
  preferredRecheckinDate: string | null;
  sourceBookingId: string;
  note: string | null;
} | { err: string } {
  if (!input.onsite) {
    return { err: "잔액 보관은 현장·전화(호텔 수납) 예약만 쓸 수 있어요. OTA 선결제는 채널 환불 정책을 따라 주세요." };
  }
  const guestName = input.guestName?.trim() ?? "";
  if (!guestName) return { err: "손님 이름이 필요해요." };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { err: "보관 금액을 입력해 주세요." };
  if (input.amount > PAY_MAX) return { err: "금액이 너무 커요 (1억 원까지)." };
  const prefErr = validatePreferredRecheckinDate(input.preferredRecheckinDate, input.today);
  if (prefErr) return { err: prefErr };
  return {
    guestName: guestName.slice(0, 40),
    guestPhone: input.guestPhone?.trim() ? input.guestPhone.trim().slice(0, 30) : null,
    amount: Math.round(input.amount),
    preferredRecheckinDate: input.preferredRecheckinDate || null,
    sourceBookingId: input.sourceBookingId,
    note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
  };
}

/** 조기 퇴실 + 보관: refund는 항상 null · 보관액은 별도 검증 */
export function validateEarlyOutKeep(
  b: Booking,
  date: string,
  keepAmount: number,
  preferredDate: string | null,
  today: string,
  onsite: boolean,
): string | null {
  if (b.status !== "active") return "취소·노쇼 예약은 조기 퇴실할 수 없어요.";
  if (b.kind !== "stay" || !b.nights || b.nights < 2) return "2박 이상 숙박만 조기 퇴실할 수 있어요.";
  if (!(date > b.checkIn && date < addDays(b.checkIn, b.nights))) {
    return "퇴실 날짜는 입실 다음 날부터 원래 퇴실 전날까지예요.";
  }
  if (!onsite) {
    return "잔액 보관은 현장·전화(호텔 수납) 예약만 쓸 수 있어요. OTA 선결제는 채널 환불 정책을 따라 주세요.";
  }
  const paid = paidOf(b);
  const amtErr = validateKeepCreditAmount(keepAmount, paid);
  if (amtErr) return amtErr;
  return validatePreferredRecheckinDate(preferredDate, today);
}

export function matchOpenCredits(
  credits: readonly StayCredit[],
  guestName: string | null | undefined,
  guestPhone: string | null | undefined,
): StayCredit[] {
  const open = credits.filter((c) => c.status === "open" && c.amountRemaining > 0);
  if (!open.length) return [];
  const digits = phoneDigits(guestPhone);
  const nameKey = normalizeGuestName(guestName);
  const byPhone =
    digits.length >= 4
      ? open.filter((c) => {
          const cd = phoneDigits(c.guestPhone);
          return cd.length > 0 && (cd.includes(digits) || digits.includes(cd));
        })
      : [];
  if (byPhone.length) return byPhone.sort(sortCredits);
  if (!nameKey) return [];
  return open
    .filter((c) => normalizeGuestName(c.guestName).includes(nameKey) || nameKey.includes(normalizeGuestName(c.guestName)))
    .sort(sortCredits);
}

function sortCredits(a: StayCredit, b: StayCredit): number {
  const da = a.preferredRecheckinDate ?? "9999";
  const db = b.preferredRecheckinDate ?? "9999";
  if (da !== db) return da.localeCompare(db);
  return b.amountRemaining - a.amountRemaining;
}

export function listOpenCredits(credits: readonly StayCredit[]): StayCredit[] {
  return credits.filter((c) => c.status === "open" && c.amountRemaining > 0).sort(sortCredits);
}

export interface ApplyStayCreditInput {
  credit: StayCredit;
  bookingId: string;
  amount: number;
  bizDate: string;
  kind?: PayKind;
}

export interface ApplyStayCreditPlan {
  creditId: string;
  bookingId: string;
  amount: number;
  bizDate: string;
  kind: PayKind;
  remainingAfter: number;
  statusAfter: StayCreditStatus;
  paymentNote: string;
}

export function planApplyStayCredit(input: ApplyStayCreditInput): ApplyStayCreditPlan | { err: string } {
  const { credit } = input;
  if (credit.status !== "open") return { err: "이미 쓰였거나 무효인 보관 잔액이에요." };
  if (credit.amountRemaining <= 0) return { err: "보관 잔액이 없어요." };
  if (credit.expiresOn && input.bizDate > credit.expiresOn) return { err: "만료된 보관 잔액이에요." };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { err: "사용할 금액을 입력해 주세요." };
  if (input.amount > PAY_MAX) return { err: "금액이 너무 커요 (1억 원까지)." };
  if (input.amount > credit.amountRemaining) {
    return { err: `보관 잔액(${won(credit.amountRemaining)}원)보다 클 수 없어요.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.bizDate)) return { err: "수납일을 선택해 주세요." };
  if (!input.bookingId) return { err: "적용할 예약이 없어요." };
  const remainingAfter = credit.amountRemaining - input.amount;
  return {
    creditId: credit.id,
    bookingId: input.bookingId,
    amount: Math.round(input.amount),
    bizDate: input.bizDate,
    kind: input.kind === "deposit" ? "deposit" : "balance",
    remainingAfter,
    statusAfter: remainingAfter === 0 ? "depleted" : "open",
    paymentNote: `${STAY_CREDIT_COPY.use} · ${credit.guestName}`.slice(0, 80),
  };
}

export function planVoidStayCredit(credit: StayCredit): { creditId: string } | { err: string } {
  if (credit.status === "void") return { err: "이미 무효예요." };
  if (credit.status === "depleted") return { err: "모두 사용한 잔액은 무효로 바꿀 수 없어요." };
  return { creditId: credit.id };
}

export function keepCreditNotifyLine(guestName: string, amount: number, preferred: string | null): string {
  const pref = preferred ? ` · ${STAY_CREDIT_COPY.preferredDate} ${preferred.slice(5).replace("-", "/")}` : "";
  return `${guestName} 님 ${STAY_CREDIT_COPY.keep} ${won(amount)}원${pref}`;
}

export function applyCreditNotifyLine(guestName: string, amount: number, remaining: number): string {
  const left = remaining > 0 ? ` · ${STAY_CREDIT_COPY.balance} 잔액 ${won(remaining)}원` : ` · ${STAY_CREDIT_COPY.balance} 소진`;
  return `${guestName} 님 ${STAY_CREDIT_COPY.use} ${won(amount)}원${left}`;
}

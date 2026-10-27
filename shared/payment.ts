// 선금 · 잔금: 수납액은 예약마다 줄로 적고, 잔금은 화면에서 계산해요.
import { type Booking, type Platform, revenueOf } from "./ledger";
import { won } from "./ledger";

/** 예약 결제 방법: 카드 · 현금 · 이체 (이체는 현금 시재에 안 들어가요). 매점은 카드·현금, 지출은 카드·현금·이체 */
export type BookPayMethod = "card" | "cash" | "transfer";
/** 보관 잔액 사용 — 시재 제외 · FO 칩(BOOK_PAY_METHODS)에는 안 넣음 */
export type CreditPayMethod = "credit";
export type PaymentMethod = BookPayMethod | CreditPayMethod;
export const BOOK_PAY_METHODS: BookPayMethod[] = ["card", "cash", "transfer"];
export const BOOK_PAY_LABEL: Record<BookPayMethod, string> = { card: "카드", cash: "현금", transfer: "이체" };
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "카드",
  cash: "현금",
  transfer: "이체",
  credit: "잔액 사용",
};
export const isBookPayMethod = (v: unknown): v is BookPayMethod => v === "card" || v === "cash" || v === "transfer";
export const isPaymentMethod = (v: unknown): v is PaymentMethod => isBookPayMethod(v) || v === "credit";

export type PayKind = "deposit" | "balance";
export const PAY_KIND_LABEL: Record<PayKind, string> = { deposit: "선금", balance: "잔금" };
/** 장기: 선수 / 수납 · 표준: 선금 / 잔금 */
export function payKindLabel(kind: PayKind, long = false): string {
  if (long) return kind === "deposit" ? "선수" : "수납";
  return PAY_KIND_LABEL[kind];
}
/** Entry 내역 주 카피: `현금 80,000` · `잔액 사용 80,000` */
export function payLineMain(method: PaymentMethod, amount: number): string {
  return `${PAYMENT_METHOD_LABEL[method]} ${won(amount)}`;
}
export interface Payment {
  id: string;
  bookingId: string;
  /** 단체 정산 결제면 bookingId 비고 groupId만 (booking_payments.group_id) */
  groupId?: string | null;
  kind: PayKind;
  method: PaymentMethod;
  amount: number;
  bizDate: string;
  createdAt: string;
  /** 추가금 등 보조 라벨 (`추가금 · 늦은 퇴실`). 없으면 Entry는 kind 라벨 */
  note?: string | null;
  /** 기간 결제: 이 결제가 덮는 첫 박 + 박수 (둘 다 있을 때만 기간 결제 · 없으면 맨 앞 미결제 박부터 채움) */
  nightDate?: string | null;
  periodNights?: number | null;
  /** 처리한 직원 (auth user id · 이름은 없어요) */
  createdBy?: string | null;
  /** 기록 정정으로 마지막에 고친 시각 (없으면 고친 적 없음) */
  editedAt?: string | null;
}
/** 결제 줄 정정 입력 (한 줄 전체) */
export interface PaymentEdit {
  bookingId: string | null;
  groupId: string | null;
  kind: PayKind;
  method: PaymentMethod;
  amount: number;
  bizDate: string;
  note?: string | null;
  nightDate?: string | null;
  periodNights?: number | null;
}
export const PAY_MAX = 100_000_000;

/** 현장 결제 플랫폼: 설정에서 고른 값, 안 골랐으면 이름에 '현장'·'전화'가 있으면 켜져요 */
export function isOnsite(p: Pick<Platform, "name"> & { onsite?: boolean | null } | null | undefined): boolean {
  if (!p) return false;
  if (typeof p.onsite === "boolean") return p.onsite;
  return /현장|전화/.test(p.name);
}

type OnsitePlat = Pick<Platform, "name"> & { onsite?: boolean | null };
type IdPlat = OnsitePlat & Pick<Platform, "id">;

/** 「바로 입실」자동 표시명 prefix · guest_name CHECK(≥1) 충족 · 보드 힌트 감지 */
export const WALKIN_IMMEDIATE_PREFIX = "바로입실";

/** 빈 이름일 때 저장용 표시명 (`바로입실 10/21`) */
export function walkInDisplayName(checkIn: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkIn);
  if (!m) return WALKIN_IMMEDIATE_PREFIX;
  return `${WALKIN_IMMEDIATE_PREFIX} ${Number(m[2])}/${Number(m[3])}`;
}

export function isWalkInPlaceholderName(name: string | null | undefined): boolean {
  const t = name?.trim() ?? "";
  return t === WALKIN_IMMEDIATE_PREFIX || t.startsWith(`${WALKIN_IMMEDIATE_PREFIX} `);
}

/** 연락처 필수/선택 — `isGuestPhoneRequired` · `validateGuestPhone` · UI `phoneRequired` 공용 */
export type GuestPhoneOpts = {
  /** 푸터 「바로입실」생성 CTA */
  walkInImmediate?: boolean;
  /**
   * 수정: 기존 예약 연락처가 비어 있으면 계속 선택.
   * (바로입실로 null 저장한 뒤 메모·박수 등만 고칠 때). 신규 「저장하기」에는 쓰지 않음.
   */
  priorPhoneEmpty?: boolean;
  /** 수정: 바로입실 표시명이면 연락처 선택 */
  walkInPlaceholder?: boolean;
};

/**
 * 연락처 필수 여부 (라벨 * · HTML required · validateGuestPhone SoT).
 * 현장·전화만 필수. 바로입실 생성·이미 빈 연락처(또는 바로입실 표시명)인 예약 수정은 선택.
 */
export function isGuestPhoneRequired(
  plat: OnsitePlat | null | undefined,
  opts?: GuestPhoneOpts,
): boolean {
  if (opts?.walkInImmediate) return false;
  if (opts?.priorPhoneEmpty) return false;
  if (opts?.walkInPlaceholder) return false;
  return isOnsite(plat);
}

/**
 * Entry 수정용 opts. `existing`이 있을 때만 prior/placeholder 완화.
 * 신규는 walkInImmediate만 넘기면 됨.
 */
export function guestPhoneOptsForBooking(input: {
  walkInImmediate?: boolean;
  existing?: { guestPhone?: string | null; guestName?: string | null } | null;
  /** 폼 현재 이름 (placeholder 감지; 없으면 existing.guestName) */
  guestName?: string | null;
}): GuestPhoneOpts {
  const existing = input.existing ?? null;
  return {
    walkInImmediate: !!input.walkInImmediate,
    priorPhoneEmpty: existing ? !existing.guestPhone?.trim() : false,
    walkInPlaceholder: existing
      ? isWalkInPlaceholderName(input.guestName ?? existing.guestName)
      : false,
  };
}

/**
 * 연락처 검증. OTA는 빈 번호 OK. 현장·전화는 `isGuestPhoneRequired`가 true일 때만 필수.
 * 간단 예약·Entry·StaySale·결제 저장이 이 함수만 써요.
 */
export function validateGuestPhone(
  plat: OnsitePlat | null | undefined,
  phone: string | null | undefined,
  opts?: GuestPhoneOpts,
): string | null {
  if (!isGuestPhoneRequired(plat, opts)) return null;
  if (phone?.trim()) return null;
  return "현장·전화 채널은 연락처가 필요해요.";
}

/** 간단 예약 기본 채널: 프리셋 → 첫 현장·전화 채널 → 첫 플랫폼. (OTA는 칩에서 바로 바꿔요) */
export function defaultBookingPlatformId(platforms: IdPlat[], presetId?: string | null): string {
  if (presetId && platforms.some((p) => p.id === presetId)) return presetId;
  return platforms.find((p) => isOnsite(p))?.id ?? platforms[0]?.id ?? "";
}

export const paidOf = (b: Pick<Booking, "payments">) => (b.payments ?? []).reduce((n, x) => n + x.amount, 0);

export interface PayState {
  /** 잔금을 따지나요: 현장 결제(`isOnsite`)만. OTA는 손님·플랫폼 선결제 → 잔금 없음 */
  tracked: boolean;
  due: number; // 청구액 (가격 − 환불)
  paid: number;
  left: number; // 잔금 (0 이상)
  full: boolean; // 완납
}
/**
 * 잔금 계산: 정상 예약만. 플랫폼(OTA) 예약은 손님·플랫폼이 받은 걸로 봐서 잔금이 없어요
 * (결제 내역이 있어도 현장 결제 채널이 아니면 잔금·미수 톤 금지 — 보드 완납/검정).
 * 청구액 = 판매 가격 − 조기 퇴실 환불.
 * 장기(long_stay): 청구액 = 원장 누적 − 수납액 (판매가 price 총액 모델 아님).
 */
export function payState(b: Booking, plat: (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined): PayState {
  const paid = paidOf(b);
  // 금액미정: 잔금·완납 계산 보류 (글랜스는 nowAmountGlance)
  if (b.priceUnset) return { tracked: false, due: 0, paid, left: 0, full: false };
  if (b.stayMode === "long_stay" && b.status === "active") {
    const due = (b.charges ?? []).reduce((n, x) => n + x.amount, 0);
    const left = Math.max(0, due - paid);
    return { tracked: true, due, paid, left, full: due > 0 && left === 0 };
  }
  // 현장·전화(또는 설정에서 '현장 결제' ON)만 잔금. OTA는 paid>0이어도 잔금 표시 안 함.
  const tracked = b.status === "active" && isOnsite(plat);
  const due = revenueOf(b);
  const left = tracked ? Math.max(0, due - paid) : 0;
  return { tracked, due, paid, left, full: tracked && left === 0 && due > 0 };
}
/** 장부 현금 시재에 들어가는 예약 현금 (기간 안에 받은 선금·잔금) */
export function bookingCash(list: Pick<Payment, "method" | "amount" | "bizDate">[], from: string, to: string): number {
  return list.filter((x) => x.method === "cash" && x.bizDate >= from && x.bizDate <= to).reduce((n, x) => n + x.amount, 0);
}
export function validatePayment(amount: number, method: string, bizDate: string): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "수납 금액을 입력해 주세요.";
  if (amount > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (!isBookPayMethod(method)) return "카드 · 현금 · 이체 중에 골라 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return "수납일을 선택해 주세요.";
  return null;
}

/** 수납액을 방법별로: 기간을 주면 그 영업일 안에 받은 것만. credit(잔액 사용)은 total만 합산 · 시재 칩 제외 */
export function paySplit(list: Pick<Payment, "method" | "amount" | "bizDate">[], from?: string, to?: string): Record<BookPayMethod, number> & { total: number; credit: number } {
  const r = { card: 0, cash: 0, transfer: 0, credit: 0, total: 0 };
  for (const x of list) {
    if (from && x.bizDate < from) continue;
    if (to && x.bizDate > to) continue;
    if (isBookPayMethod(x.method)) r[x.method] += x.amount;
    else if (x.method === "credit") r.credit += x.amount;
    else continue;
    r.total += x.amount;
  }
  return r;
}
/** '카드 120,000 · 현금 50,000 · 이체 30,000' (0원인 방법은 빼요, 다 0이면 빈 글자) */
export function splitLine(p: Record<BookPayMethod, number>): string {
  return BOOK_PAY_METHODS.filter((m) => p[m] > 0).map((m) => `${BOOK_PAY_LABEL[m]} ${won(p[m])}`).join(" · ");
}

/**
 * 현장·전화 생성 progressive: 완납 / 후불 / 선금 (간단·Entry create stay 공유).
 * 후불 = 수납 줄 없음 · 완납(prepaid) = 판매금 전액(balance) · 선금 = deposit 일부.
 * 판매금(총액)은 세 모드 모두 별도 필드 — 이 타입으로 숨기지 않음.
 * UI 라벨 Option A — enum `prepaid|postpaid|deposit` 유지.
 */
export type OnsitePayMode = "prepaid" | "postpaid" | "deposit";
export const ONSITE_PAY_MODES = ["prepaid", "postpaid", "deposit"] as const;
export const ONSITE_PAY_MODE_LABEL: Record<OnsitePayMode, string> = {
  prepaid: "완납",
  postpaid: "후불",
  deposit: "선금",
};

export type OnsiteCreatePayPlan =
  | { kind: "none" }
  | { kind: "balance"; amount: number; method: BookPayMethod }
  | { kind: "deposit"; amount: number; method: BookPayMethod };

/** 선금 모드일 때만 수납 액수 검증 · 완납/후불은 판매금 필드로 */
export function validateOnsiteCreateDeposit(
  payMode: OnsitePayMode,
  opts: { priceUnset?: boolean; saleTotal: number; depAmt: string; depMethod: BookPayMethod; bizDate: string },
): string | null {
  if (opts.priceUnset || payMode !== "deposit") return null;
  const amt = Number(opts.depAmt || 0);
  const pv = validatePayment(amt, opts.depMethod, opts.bizDate);
  if (pv) return pv;
  if (amt > opts.saleTotal) return "선금이 판매금보다 커요.";
  return null;
}

/** 저장 직후 addPayment에 넣을 계획 (금액미정·후불·0원 완납 → none) */
export function planOnsiteCreatePay(
  payMode: OnsitePayMode,
  opts: { priceUnset?: boolean; saleTotal: number; depAmt: string; depMethod: BookPayMethod },
): OnsiteCreatePayPlan {
  if (opts.priceUnset) return { kind: "none" };
  if (payMode === "prepaid" && opts.saleTotal > 0) {
    return { kind: "balance", amount: opts.saleTotal, method: opts.depMethod };
  }
  if (payMode === "deposit") {
    const amt = Number(opts.depAmt || 0);
    if (amt > 0) return { kind: "deposit", amount: amt, method: opts.depMethod };
  }
  return { kind: "none" };
}

export function onsiteCreatePayTail(plan: OnsiteCreatePayPlan): string {
  if (plan.kind === "balance") return ` · 완납 ${won(plan.amount)}원`;
  if (plan.kind === "deposit") return ` · 선금 ${won(plan.amount)}원(${BOOK_PAY_LABEL[plan.method]})`;
  return "";
}

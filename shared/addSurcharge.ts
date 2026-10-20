// 「+추가금」: 같은 날·같은 예약에 붙는 할증·시간료·기타 청구 (박수·재고 불변)
// 1박 연장(extend.ts)과 분리. 사유가 늦은 퇴실이면 lateOut을 같은 확정에서 갱신.
import { type Booking, dayLabel, won } from "./ledger";
import { clampHours, EXTRA_HOURS_MAX } from "./extratime";
import { type BookPayMethod, payKindLabel, PAY_MAX, validatePayment } from "./payment";

export const SURCHARGE_COPY = "+추가금";

export type SurchargeReason = "late_out" | "late_fee" | "other";
export const SURCHARGE_REASONS: SurchargeReason[] = ["late_out", "late_fee", "other"];
export const SURCHARGE_REASON_LABEL: Record<SurchargeReason, string> = {
  late_out: "늦은 퇴실",
  late_fee: "레이트·무단",
  other: "기타",
};

export function isSurchargeReason(v: unknown): v is SurchargeReason {
  return v === "late_out" || v === "late_fee" || v === "other";
}

/** 활성 숙박만 (늦은 퇴실·레이트 시나리오). 중도 퇴실·취소 제외 */
export function canAddSurcharge(b: Pick<Booking, "status" | "kind" | "earlyOut">): boolean {
  return b.status === "active" && b.kind === "stay" && !b.earlyOut;
}

/** N시간 × 1시간 요금 (기본 제안액) */
export function defaultSurchargeAmount(extraHourFee: number, hours: number): number {
  return clampHours(hours) * Math.max(0, Math.round(extraHourFee));
}

/** 기본 퇴실 시각 이후 경과 시간(올림) → 레이트 제안 N. 아직 전이면 0 */
export function suggestElapsedLateHours(checkOutHHMM: string, nowHHMM: string): number {
  const out = minutesOf(checkOutHHMM);
  const now = minutesOf(nowHHMM);
  if (now <= out) return 0;
  return clampHours(Math.ceil((now - out) / 60));
}

function minutesOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 결제 내역 보조: `추가금 · 늦은 퇴실` */
export function surchargePayNote(reason: SurchargeReason): string {
  return `추가금 · ${SURCHARGE_REASON_LABEL[reason]}`;
}

/** Entry 내역 보조 줄: note 있으면 추가금 라벨 · 없으면 kind 라벨 */
export function payLineSub(
  kind: "deposit" | "balance",
  bizDate: string,
  note: string | null | undefined,
  long = false,
): string {
  const date = dayLabel(bizDate);
  if (note?.trim()) return `${note.trim()} · ${date}`;
  return `${payKindLabel(kind, long)} · ${date}`;
}

/** 예약 메모에 사유 접두를 남김 (기존 메모 유지) */
export function mergeSurchargeMemo(prev: string | null | undefined, reason: SurchargeReason, note: string): string | null {
  const tag = `[추가금·${SURCHARGE_REASON_LABEL[reason]}]`;
  const line = note.trim() ? `${tag} ${note.trim().slice(0, 80)}` : tag;
  const base = (prev ?? "").replace(/\[추가금·[^\]]*\][^\n]*/g, "").trim();
  const merged = [base, line].filter(Boolean).join("\n").trim();
  return merged ? merged.slice(0, 200) : null;
}

export interface AddSurchargeInput {
  reason: SurchargeReason;
  /** late_out 필수(≥1) · late_fee 선택 · other 무시 */
  hours: number;
  amount: number;
  /** 기타는 필수 · 그 외는 선택 */
  memo: string;
  /** 금액>0이면 true=지금 받기 · false=잔금으로 남김. 0원이면 무시 */
  collect: boolean;
  method: BookPayMethod;
  bizDate: string;
}

export interface AddSurchargeDraft {
  price: number;
  lateOut: number | null;
  timeFee: number | null;
  memo: string | null;
  /** 불변 — 테스트·가드용 */
  nights: number | null;
}

export interface AddSurchargePlan {
  draft: AddSurchargeDraft;
  collectAmount: number;
  payNote: string | null;
  appliesLateOut: boolean;
}

export function validateAddSurcharge(b: Booking, input: AddSurchargeInput): string | null {
  if (!canAddSurcharge(b)) {
    if (b.earlyOut) return "중도 퇴실한 예약에는 추가금을 넣을 수 없어요.";
    if (b.status !== "active") return "취소·노쇼 예약에는 추가금을 넣을 수 없어요.";
    if (b.kind !== "stay") return "숙박 예약에만 추가금을 넣을 수 있어요.";
    return "추가금을 넣을 수 없어요.";
  }
  if (!isSurchargeReason(input.reason)) return "사유를 골라 주세요.";
  const hours = clampHours(input.hours);
  if (input.reason === "late_out" && hours < 1) return "늦은 퇴실 시간을 1시간 이상 골라 주세요.";
  if (input.reason === "other" && !input.memo.trim()) return "기타 사유는 메모를 적어 주세요.";
  if (!Number.isInteger(input.amount) || input.amount < 0) return "추가금 금액을 숫자로 적어 주세요.";
  if (input.amount > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (hours > EXTRA_HOURS_MAX) return `시간은 ${EXTRA_HOURS_MAX}시간까지예요.`;
  if (input.amount > 0 && input.collect) {
    const pv = validatePayment(input.amount, input.method, input.bizDate);
    if (pv) return pv;
  }
  return null;
}

/**
 * 확정 초안: price += amount · (해당 시) lateOut/timeFee · 메모.
 * nights·stayEnd·segments 불변.
 */
export function planAddSurcharge(b: Booking, input: AddSurchargeInput): AddSurchargePlan | { err: string } {
  const err = validateAddSurcharge(b, input);
  if (err) return { err };
  const hours = clampHours(input.hours);
  const amount = Math.round(input.amount);
  const appliesLateOut = input.reason === "late_out" || (input.reason === "late_fee" && hours >= 1);
  const early = clampHours(b.earlyIn);
  let lateOut = clampHours(b.lateOut);
  let timeFee = Math.max(0, Math.round(b.timeFee ?? 0));

  if (appliesLateOut) {
    lateOut = hours;
    if (amount > 0) timeFee = timeFee + amount;
  }

  const price = Math.max(0, Math.round(b.price) + amount);
  const memo = mergeSurchargeMemo(b.memo, input.reason, input.memo);
  const collectAmount = amount > 0 && input.collect ? amount : 0;
  const payNote = collectAmount > 0 ? surchargePayNote(input.reason) : null;
  const hasTime = early > 0 || (appliesLateOut && lateOut > 0);

  return {
    draft: {
      price,
      lateOut: appliesLateOut ? lateOut || null : b.lateOut ?? null,
      timeFee: hasTime ? timeFee : b.timeFee ?? null,
      memo,
      nights: b.nights,
    },
    collectAmount,
    payNote,
    appliesLateOut,
  };
}

export function surchargeNotifyLine(
  guestName: string,
  reason: SurchargeReason,
  amount: number,
  collected: boolean,
  lateOut: number | null,
): string {
  const reasonL = SURCHARGE_REASON_LABEL[reason];
  const late = lateOut ? ` · 늦은 퇴실 ${lateOut}시간` : "";
  const pay =
    amount > 0 ? (collected ? ` · ${won(amount)}원 받음` : ` · 잔금 +${won(amount)}원`) : " · 0원(기록만)";
  return `${guestName} 님 ${SURCHARGE_COPY} · ${reasonL}${late}${pay}`;
}

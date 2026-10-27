// 「시간 추가」: 운영 패널 전용 · Entry 우회
// 숙박 = 늦은 퇴실(+N) · 대실 = endTime 연장 · 요금 = hours × 시간당
import { type Booking, addMinutesToTime, parseTime, won } from "./ledger";
import { clampHours, EXTRA_HOURS_MAX } from "./extratime";
import { canAddSurcharge, planAddSurcharge, type AddSurchargePlan } from "./addSurcharge";
import {
  type BookPayMethod,
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  isBookPayMethod,
  PAY_MAX,
  validatePayment,
} from "./payment";

/** @deprecated ops CTA removed — use LATE_OUT_CTA (selection-first) */
export const ADD_TIME_CTA = "시간 추가";
export const ADD_TIME_TITLE = "시간 추가";
/** 운영패널 「늦은 퇴실」CTA · AddTime planner 재사용 */
export const LATE_OUT_CTA = "늦은 퇴실";
export const LATE_OUT_TITLE = "늦은 퇴실";
export const ADD_TIME_HOUR_CHIPS = [1, 2, 3, 4, 5, 6] as const;

/** 카드 · 이체 · 현금 · 서비스(0원) · 후불(잔금) */
export type AddTimeMethod = BookPayMethod | "service" | "deferred";
export const ADD_TIME_METHODS: AddTimeMethod[] = [...BOOK_PAY_METHODS, "service", "deferred"];
export const ADD_TIME_METHOD_LABEL: Record<AddTimeMethod, string> = {
  ...BOOK_PAY_LABEL,
  service: "서비스",
  deferred: "후불",
};
export const isAddTimeMethod = (v: unknown): v is AddTimeMethod =>
  v === "service" || v === "deferred" || isBookPayMethod(v);

export function canAddTime(b: Pick<Booking, "status" | "kind" | "earlyOut" | "checkedOutAt" | "endTime">): boolean {
  if (b.status !== "active") return false;
  if (b.kind === "stay") return canAddSurcharge(b);
  if (b.kind === "dayuse") return !b.checkedOutAt && !!b.endTime;
  return false;
}

export function addTimeAmount(hours: number, hourlyRate: number, method: AddTimeMethod): number {
  if (method === "service") return 0;
  return clampHours(hours) * Math.max(0, Math.round(hourlyRate));
}

export interface AddTimeInput {
  hours: number;
  hourlyRate: number;
  method: AddTimeMethod;
  bizDate: string;
}

export interface AddTimeStayPlan {
  kind: "stay";
  surcharge: AddSurchargePlan;
  hoursAdded: number;
  amount: number;
  method: AddTimeMethod;
  collect: boolean;
  payMethod: BookPayMethod | null;
}

export interface AddTimeDayusePlan {
  kind: "dayuse";
  endTime: string;
  price: number;
  hoursAdded: number;
  amount: number;
  method: AddTimeMethod;
  collectAmount: number;
  payMethod: BookPayMethod | null;
  payNote: string | null;
}

export type AddTimePlan = AddTimeStayPlan | AddTimeDayusePlan;

export function validateAddTime(b: Booking, input: AddTimeInput): string | null {
  if (!canAddTime(b)) {
    if (b.kind === "dayuse" && b.checkedOutAt) return "이용 종료한 대실에는 시간을 더할 수 없어요.";
    if (b.kind === "dayuse") return "대실 종료 시각이 없어요.";
    return "시간을 더할 수 없어요.";
  }
  if (!isAddTimeMethod(input.method)) return "카드 · 이체 · 현금 · 서비스 · 후불 중에 골라 주세요.";
  const hours = clampHours(input.hours);
  if (hours < 1) return "1시간 이상 골라 주세요.";
  if (hours > EXTRA_HOURS_MAX) return `시간은 ${EXTRA_HOURS_MAX}시간까지예요.`;
  if (b.kind === "stay") {
    const next = clampHours((b.lateOut ?? 0) + hours);
    if (next > EXTRA_HOURS_MAX) return `늦은 퇴실은 합쳐 ${EXTRA_HOURS_MAX}시간까지예요.`;
  }
  if (b.kind === "dayuse") {
    const end = parseTime(b.endTime ?? "");
    if (!end) return "대실 종료 시각이 올바르지 않아요.";
  }
  const amount = addTimeAmount(hours, input.hourlyRate, input.method);
  if (amount > PAY_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (amount > 0 && input.method !== "service" && input.method !== "deferred") {
    const pv = validatePayment(amount, input.method, input.bizDate);
    if (pv) return pv;
  }
  return null;
}

/**
 * 숙박: lateOut += N · price/timeFee += amount(서비스=0) · 후불=잔금 · 그 외 수단=즉시 수납.
 */
export function planAddTimeStay(b: Booking, input: AddTimeInput): AddTimeStayPlan | { err: string } {
  const err = validateAddTime(b, input);
  if (err) return { err };
  const hoursAdded = clampHours(input.hours);
  const amount = addTimeAmount(hoursAdded, input.hourlyRate, input.method);
  const lateOut = clampHours((b.lateOut ?? 0) + hoursAdded);
  const collect = amount > 0 && input.method !== "service" && input.method !== "deferred";
  const payMethod = collect && isBookPayMethod(input.method) ? input.method : ("card" as BookPayMethod);
  const planned = planAddSurcharge(b, {
    reason: "late_out",
    hours: lateOut,
    amount,
    memo: "",
    collect,
    method: payMethod,
    bizDate: input.bizDate,
  });
  if ("err" in planned) return { err: planned.err };
  return {
    kind: "stay",
    surcharge: planned,
    hoursAdded,
    amount,
    method: input.method,
    collect,
    payMethod: collect ? payMethod : null,
  };
}

/**
 * 대실: endTime += N시간 · price += amount · 수납 규칙은 숙박과 동일.
 */
export function planAddTimeDayuse(b: Booking, input: AddTimeInput): AddTimeDayusePlan | { err: string } {
  const err = validateAddTime(b, input);
  if (err) return { err };
  const hoursAdded = clampHours(input.hours);
  const amount = addTimeAmount(hoursAdded, input.hourlyRate, input.method);
  const end = parseTime(b.endTime ?? "");
  const endTime = addMinutesToTime(end, hoursAdded * 60);
  const collect = amount > 0 && input.method !== "service" && input.method !== "deferred";
  return {
    kind: "dayuse",
    endTime,
    price: Math.max(0, Math.round(b.price) + amount),
    hoursAdded,
    amount,
    method: input.method,
    collectAmount: collect ? amount : 0,
    payMethod: collect && isBookPayMethod(input.method) ? input.method : null,
    payNote: collect ? `시간 추가 · 대실 +${hoursAdded}시간` : null,
  };
}

export function planAddTime(b: Booking, input: AddTimeInput): AddTimePlan | { err: string } {
  if (b.kind === "dayuse") return planAddTimeDayuse(b, input);
  return planAddTimeStay(b, input);
}

export function addTimeNotifyLine(
  guestName: string,
  plan: AddTimePlan,
  collected: boolean,
): string {
  const hours = `+${plan.hoursAdded}시간`;
  if (plan.method === "service" || plan.amount <= 0) {
    return `${guestName} 님 ${ADD_TIME_CTA} ${hours} · 서비스(0원)`;
  }
  const pay =
    plan.method === "deferred"
      ? ` · 후불 ${won(plan.amount)}원`
      : collected
        ? ` · ${ADD_TIME_METHOD_LABEL[plan.method]} ${won(plan.amount)}원`
        : ` · 잔금 +${won(plan.amount)}원`;
  return `${guestName} 님 ${ADD_TIME_CTA} ${hours}${pay}`;
}

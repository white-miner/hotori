// 숙박 예약의 박 목록과 박별 약정 요금 — 순수 함수.
//  · 박별 요금은 실제로 적어 둔 값(night_rates)만 써요. 총액을 박마다 똑같이 나누거나 결제를 박에 붓지 않아요.
//  · 박별 요금이 없는 박은 amount = null(요금 미등록)이고, 객실 청구는 언제나 예약 총액(판매가 − 환불)이에요.
import { type Booking, addDays, daysBetween, isActive, stayEnd } from "./ledger";
import { hasFullNightMatrix } from "./nightrates";

export type PeriodBooking = Pick<
  Booking,
  "id" | "status" | "kind" | "checkIn" | "nights" | "price" | "priceUnset" | "earlyOut" | "refund" | "nightRates" | "payments" | "checkedOutAt" | "stayMode" | "openEnded"
>;

/** 박 단위 요금 대상: 활성 숙박 · 박 단위(장기 원장 제외) · 입실 박수 있음 */
export function isPeriodPayable(b: Pick<Booking, "status" | "kind" | "nights" | "stayMode">): boolean {
  return isActive(b) && b.kind === "stay" && !!b.nights && b.stayMode !== "long_stay";
}

/**
 * 묵는(조기 퇴실이면 묵은) 박 목록. amount = 그 박에 적어 둔 약정 요금 · 박별 요금이 모든 박에 없으면 null.
 * 총액에서 박 요금을 만들어 내지 않아요 (균등 분배 금지).
 */
export function stayNightRows(b: PeriodBooking): { date: string; amount: number | null }[] {
  if (!isPeriodPayable(b)) return [];
  const total = b.nights!;
  const used = Math.max(0, Math.min(total, daysBetween(b.checkIn, stayEnd(b))));
  const matrix = hasFullNightMatrix(b.checkIn, total, b.nightRates ?? null) ? b.nightRates!.nights! : null;
  return Array.from({ length: used }, (_, i) => {
    const date = addDays(b.checkIn, i);
    return { date, amount: matrix ? Math.max(0, Math.round(Number(matrix[date]) || 0)) : null };
  });
}

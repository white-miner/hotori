// 이용 기간 미정 (열린 숙박): 예약할 때 퇴실일을 안 정해도 돼요.
// 끝 날짜 없이 계속 묵는 것으로 저장하고, 앱이 오늘 밤까지만 박수를 이어 줘요 (shared/extend.ts planOpenFollow).
// 방 보호 일수는 방을 막아 두는 여유일 뿐, 청구·결제 주기가 아니에요.
import { STAY_NIGHTS_MAX, daysBetween } from "./ledger";

export const OPEN_BADGE = "∞ 미정";
export const OPEN_HOLD_DEFAULT = 1;
export const OPEN_HOLD_CHOICES = [0, 1, 2, 3, 7] as const;

export const clampHold = (n: number | null | undefined): number => Math.max(0, Math.min(30, Math.round(Number(n) || 0)));

/**
 * 청구 박수: 입실일 → 오늘 밤까지만 (앞으로 올 예약은 입실 첫 밤). 방 보호 일수(hold)는 박수·요금에 넣지 않아요 —
 * 방을 N일 앞까지 막아 둘 뿐이에요 (shared/ledger holdNightsOf · legsOf · occupiesNight).
 * 이후엔 앱이 날마다 같은 규칙으로 이어 줘요 (절대값이라 여러 번 실행해도 같아요).
 */
export function openStayNights(checkIn: string, today: string, _hold?: number): number {
  const past = Math.max(0, daysBetween(checkIn, today));
  return Math.max(1, Math.min(STAY_NIGHTS_MAX, past + 1));
}

export function openStayFields(checkIn: string, today: string, hold: number): { nights: number; openEnded: true; holdAhead: number } {
  const h = clampHold(hold);
  return { nights: openStayNights(checkIn, today, h), openEnded: true, holdAhead: h };
}

export function openStayHint(hold: number): string {
  return `끝 날짜 없이 계속 묵어요 · 앱이 오늘 밤까지 이어 줘요 · 방은 ${hold === 0 ? "오늘 밤만" : `${clampHold(hold)}일 앞까지`} 막아 둬요 (청구는 오늘 밤까지만)`;
}

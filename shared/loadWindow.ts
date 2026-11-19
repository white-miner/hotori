// 오래전에 입실한 긴 숙박도 화면에서 빠지지 않게: 평소 불러오는 입실일 범위 앞에서 시작해
// 그 범위 안까지 이어지는 숙박(박수가 범위보다 긴 숙박 · 장기 · 퇴실 미정)을 따로 찾아 합쳐요.
import { addDays, type Booking } from "./ledger";

/** DB에서 먼저 거르는 조건 (PostgREST or): 박수가 lookback보다 길거나, 장기·퇴실 미정 */
export function longReachOr(lookbackDays: number): string {
  const n = Math.max(0, Math.round(lookbackDays));
  return `nights.gt.${n},stay_mode.eq.long_stay,open_ended.eq.true`;
}

/** from 날짜(그 밤 포함) 이후까지 이어지는 숙박인지 */
export function reachesInto(
  b: Pick<Booking, "checkIn" | "nights" | "status" | "openEnded" | "stayMode" | "checkedOutAt">,
  from: string,
): boolean {
  if (b.status === "cancelled") return false;
  if ((b.openEnded || b.stayMode === "long_stay") && !b.checkedOutAt) return true;
  return addDays(b.checkIn, Math.max(1, b.nights ?? 1)) > from;
}

/** 두 목록을 id로 합쳐요 (앞 목록 우선) */
export function mergeBookings(primary: readonly Booking[], extra: readonly Booking[]): Booking[] {
  const seen = new Set(primary.map((b) => b.id));
  return [...primary, ...extra.filter((b) => !seen.has(b.id))];
}

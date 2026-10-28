// 입실일을 바꿀 때 고친 박별 요금을 어떻게 할지.
//  · "move": 몇 번째 박인지를 따라 요금이 같이 옮겨가요 (1박째 요금은 새 1박째로)
//  · "keep": 날짜에 붙은 요금은 그 날짜에 그대로 두고, 새로 생긴 날짜는 기본 요금으로 채워요
// 어느 쪽이든 요금을 지우지 않고, 합계를 나누거나 한 금액으로 덮지 않아요.
import { stayAddons } from "./extend";
import type { Booking } from "./ledger";
import { type NightAmountMap, priceFromNightMatrix, hasFullNightMatrix, type StayNightRates, occupiedNightDates, syncStayNightRates } from "./nightrates";

export type NightShiftMode = "move" | "keep";

/** 이전 요금표를 새 입실일·박수에 맞춰요. 비는 박은 기본 요금(`typeRate`·1박 요금)이 채워요. */
export function shiftNightRates(
  prev: StayNightRates | null | undefined,
  oldCheckIn: string,
  oldNights: number,
  newCheckIn: string,
  newNights: number,
  mode: NightShiftMode,
  fallbacks: { typeRate?: number | null } = {},
): StayNightRates {
  if (mode === "keep" || !prev?.nights) return syncStayNightRates(newCheckIn, newNights, prev, fallbacks);
  const oldDates = occupiedNightDates(oldCheckIn, oldNights);
  const newDates = occupiedNightDates(newCheckIn, newNights);
  const map: NightAmountMap = {};
  const n = Math.min(oldDates.length, newDates.length);
  for (let i = 0; i < n; i++) {
    const v = prev.nights[oldDates[i]!];
    if (v != null && Number.isFinite(Number(v))) map[newDates[i]!] = Math.max(0, Math.round(Number(v)));
  }
  return syncStayNightRates(newCheckIn, newNights, { ...prev, nights: map }, fallbacks);
}

/** 두 방식의 결과가 다른 박 (날짜 → [옮기기, 그대로 두기]). 비어 있으면 물어볼 필요가 없어요. */
export function shiftDifferences(
  prev: StayNightRates | null | undefined,
  oldCheckIn: string,
  oldNights: number,
  newCheckIn: string,
  newNights: number,
  fallbacks: { typeRate?: number | null } = {},
): { date: string; move: number; keep: number }[] {
  if (oldCheckIn === newCheckIn) return [];
  const a = shiftNightRates(prev, oldCheckIn, oldNights, newCheckIn, newNights, "move", fallbacks).nights ?? {};
  const b = shiftNightRates(prev, oldCheckIn, oldNights, newCheckIn, newNights, "keep", fallbacks).nights ?? {};
  return occupiedNightDates(newCheckIn, newNights)
    .map((date) => ({ date, move: a[date] ?? 0, keep: b[date] ?? 0 }))
    .filter((x) => x.move !== x.keep);
}

/** 입실일이 며칠 움직였는지 (뒤로 +, 앞으로 −) */
export const shiftDays = (oldCheckIn: string, newCheckIn: string): number => Math.round((Date.parse(`${newCheckIn}T00:00:00Z`) - Date.parse(`${oldCheckIn}T00:00:00Z`)) / 86_400_000);

/**
 * 단체 입실일을 바꿀 때 방 하나의 요금표와 판매가.
 *  · 박별 요금을 고친 적 없는 방(요금표 없음)은 null — 그대로 둬요
 *  · 박수가 늘면 새 박은 비워 두고(판매가는 그대로, 연장은 따로), 줄면 뒤 박을 빼요
 */
export function shiftMemberRates(
  m: Pick<Booking, "kind" | "price" | "nights" | "checkIn" | "nightRates" | "extraFee" | "earlyIn" | "lateOut" | "timeFee" | "arrival" | "carFee" | "walkOff">,
  newCheckIn: string,
  newNights: number,
  mode: NightShiftMode,
  typeRate?: number | null,
): { nightRates: StayNightRates; price: number } | null {
  const oldN = m.nights ?? 1;
  if (!m.nightRates?.nights || !m.checkIn) return null;
  const n = newNights > oldN ? oldN : newNights;
  const nightRates = shiftNightRates(m.nightRates, m.checkIn, oldN, newCheckIn, n, mode, { typeRate });
  if (newNights > oldN || !hasFullNightMatrix(newCheckIn, n, nightRates)) return { nightRates, price: m.price };
  return { nightRates, price: priceFromNightMatrix(nightRates, stayAddons(m)) };
}

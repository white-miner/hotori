import { type StayNightRates, extrasTotal, nightRatesFromTotal, occupiedNightDates, sumNightAmounts } from './nightrates';

export type StayPriceMode = 'uniform' | 'daily' | 'total';
/** An explicit input choice. Existing bookings have no draft until the user edits. */
export interface StayPriceDraft {
  mode: StayPriceMode;
  amount: string;
  rates?: StayNightRates | null;
}
export const priceDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 9);

export function resolveStayPrice(checkIn: string, nights: number, draft: StayPriceDraft, addons = 0) {
  const dates = occupiedNightDates(checkIn, nights);
  const rawAmount = Math.max(0, Math.round(Number(draft.amount) || 0));
  const amount = Math.min(100_000_000, rawAmount);
  let overLimit = rawAmount > 100_000_000;
  let rates: StayNightRates;
  if (draft.mode === 'total') {
    rates = nightRatesFromTotal(checkIn, nights, amount);
  } else if (draft.mode === 'uniform') {
    rates = { flat: amount, nights: Object.fromEntries(dates.map(d => [d, amount])) };
  } else {
    const map: Record<string, number> = {};
    for (const d of dates) {
      const v = draft.rates?.nights?.[d];
      if (v != null && Number.isFinite(v) && v >= 0) {
        if (v > 100_000_000) overLimit = true;
        map[d] = Math.min(100_000_000, Math.round(v));
      }
    }
    rates = { ...draft.rates, flat: null, weekday: null, weekend: null, nights: map };
  }
  if (draft.rates?.extras) rates.extras = draft.rates.extras.map(x => ({ ...x }));
  const complete = dates.length > 0 && dates.every(d => rates.nights?.[d] != null);
  const roomTotal = sumNightAmounts(rates.nights);
  const extra = extrasTotal(rates) + addons;
  return { rates, roomTotal, price: Math.max(0, roomTotal + extra), complete,
    error: overLimit ? '입력 금액은 100,000,000원 이하여야 합니다.' : !complete ? '모든 숙박일의 요금을 입력해 주세요.' : roomTotal <= 0 ? '객실 요금을 입력하거나 금액미정을 선택해 주세요.' : null };
}

/** Only a single confirmed room-night can be inferred without allocating a multi-night total. */
export function singleNightFromPrice(checkIn: string, nights: number, price: number, rates: StayNightRates | null | undefined, addons = 0): StayNightRates | null {
  if (nights !== 1 || !(price > 0) || rates?.nights?.[checkIn] != null) return rates ?? null;
  const room = Math.max(0, price - addons - extrasTotal(rates));
  return { ...rates, ...nightRatesFromTotal(checkIn, 1, room), ...(rates?.extras ? { extras: rates.extras } : {}) };
}

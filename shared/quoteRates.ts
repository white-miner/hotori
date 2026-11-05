import { addDays, type HotelSettings } from "./ledger";
import { quoteLineWithRates, type QuoteLine } from "./quoteDoc";

export function applyQuoteTypeRates(line: QuoteLine, start: string, settings: HotelSettings): QuoteLine {
  if (line.rateSource !== "type" || !line.typeId) return line;
  const checkIn = line.checkIn || start;
  const amount = settings.quoteTypeRates?.[line.typeId] ?? 0;
  return quoteLineWithRates(line, checkIn, Array<number>(Math.max(1, line.nights)).fill(amount));
}

export function missingQuoteTypeRate(line: QuoteLine, start: string): string | null {
  if (line.rateSource !== "type") return null;
  const checkIn = line.checkIn || start;
  for (let index = 0; index < line.nights; index++) {
    const date = addDays(checkIn, index);
    const night = line.nightAmounts?.[index];
    if (night?.date !== date || night.amount <= 0) return date;
  }
  return null;
}

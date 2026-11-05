import { addDays, daysBetween } from "./ledger";
import { normalizeQuoteLines, quoteLineWithRates, type QuoteDraft, type QuoteLine } from "./quoteDoc";

export type QuoteTemplate = Pick<QuoteDraft, "taxMode" | "showRoomNos"> & {
  id: string;
  name: string;
  anchor: string;
  lines: QuoteLine[];
};

export function quoteTemplateFromDraft(name: string, draft: QuoteDraft): QuoteTemplate {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 50),
    anchor: draft.checkIn!,
    taxMode: draft.taxMode,
    showRoomNos: draft.showRoomNos,
    lines: draft.lines.map((line) => ({ ...line, roomIds: [], roomLabels: undefined })),
  };
}

export function rebaseQuoteLine(line: QuoteLine, from: string, to: string): QuoteLine {
  const shift = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? addDays(to, daysBetween(from, day)) : day;
  return {
    ...line,
    checkIn: line.checkIn ? shift(line.checkIn) : to,
    nightAmounts: line.nightAmounts?.map((cell) => ({ ...cell, date: shift(cell.date) })),
  };
}

export function quoteTemplateLines(template: QuoteTemplate, start: string): QuoteLine[] {
  return template.lines.map((line) => ({
    ...rebaseQuoteLine(line, template.anchor, start),
    id: crypto.randomUUID(),
    roomIds: [],
    roomLabels: undefined,
  }));
}

export function readQuoteTemplates(raw: string | null): QuoteTemplate[] {
  try {
    const stored: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry): QuoteTemplate[] => {
      if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" ||
          typeof entry.anchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.anchor)) return [];
      const lines = normalizeQuoteLines(entry.lines);
      if (!lines.length) return [];
      const taxMode = entry.taxMode ?? entry.vat;
      return [{
        id: entry.id,
        name: entry.name,
        anchor: entry.anchor,
        lines,
        taxMode: taxMode === "included" || taxMode === "excluded" || taxMode === "exempt" ? taxMode : undefined,
        showRoomNos: !!entry.showRoomNos,
      }];
    }).slice(0, 20);
  } catch {
    return [];
  }
}

/** Preserve date-specific prices when resizing a quote row. */
export function resizeQuoteLine(line: QuoteLine, checkIn: string, rooms: number, nights: number, typeRate?: number): QuoteLine {
  const saved = line.nightAmounts ?? [];
  const byDate = new Map(saved.map((night) => [night.date, night.amount]));
  const uniform = saved.every((night) => night.amount === saved[0]?.amount);
  const fallback = uniform ? saved[0]?.amount ?? line.rate : typeRate ?? 0;
  const rates = Array.from({ length: nights }, (_, index) => {
    const date = addDays(checkIn, index);
    return byDate.get(date) ?? fallback;
  });
  return quoteLineWithRates({ ...line, rooms, roomIds: line.roomIds?.slice(0, rooms) }, checkIn, rates);
}

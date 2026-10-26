/** P1.3 — 견적 대비 (quote linked to group/stay). See docs/group-invoice-plan.md */

export type QuoteCompare = {
  quoteId: string;
  quoteTitle: string;
  quoteTotal: number;
  invoiceTotal: number;
  /** invoice − quote (양수=청구가 더 큼) */
  diff: number;
};

export const QUOTE_VARIANCE_COPY = {
  heading: "견적 대비",
  quoteTotal: "견적 합계",
  invoiceTotal: "청구 합계",
  diff: "차이",
  over: "초과",
  under: "미만",
  same: "동일",
} as const;

export function buildQuoteCompare(opts: {
  quoteId: string;
  quoteTitle: string;
  quoteTotal: number;
  invoiceTotal: number;
}): QuoteCompare {
  const quoteTotal = Math.max(0, Math.round(opts.quoteTotal) || 0);
  const invoiceTotal = Math.max(0, Math.round(opts.invoiceTotal) || 0);
  return {
    quoteId: opts.quoteId,
    quoteTitle: (opts.quoteTitle || "견적서").slice(0, 80),
    quoteTotal,
    invoiceTotal,
    diff: invoiceTotal - quoteTotal,
  };
}

/** Pick latest issued quote linked to this group (or overlapping booking ids). */
export function findLinkedQuote<T extends {
  id: string;
  status: string;
  groupId: string | null;
  bookingIds: string[];
  total: number;
  title: string;
  issuedAt: string | null;
  createdAt: string;
}>(
  quotes: T[] | null | undefined,
  opts: { groupId?: string | null; bookingIds?: string[] },
): T | null {
  if (!quotes?.length) return null;
  const g = opts.groupId ?? null;
  const bids = new Set((opts.bookingIds ?? []).filter(Boolean));
  const issued = quotes.filter((q) => q.status === "issued");
  const linked = issued.filter((q) => {
    if (g && q.groupId === g) return true;
    if (bids.size && (q.bookingIds ?? []).some((id) => bids.has(id))) return true;
    return false;
  });
  if (!linked.length) return null;
  linked.sort((a, b) => {
    const ta = a.issuedAt || a.createdAt;
    const tb = b.issuedAt || b.createdAt;
    return tb.localeCompare(ta);
  });
  return linked[0] ?? null;
}

/**
 * 발급 서류용 객실×날짜 단가 상세.
 * 예약에 night_rates 행렬이 있으면 그대로 · 총액만 있으면 균등(나머지 마지막 박) 분배.
 */
import { dayLabel, md } from "./ledger";
import {
  hasFullNightMatrix,
  nightRatesFromTotal,
  occupiedNightDates,
  splitAmountLast,
  type StayNightRates,
} from "./nightrates";

export type IssuanceNightCell = {
  date: string;
  amount: number;
};

/** 인쇄·미리보기용 한 줄 단가 상세 */
export function issuanceNightCells(opts: {
  checkIn: string;
  nights: number;
  /** LOS 총액 (분배 기준) */
  total: number;
  nightRates?: StayNightRates | null;
}): IssuanceNightCell[] {
  const { checkIn, nights, total, nightRates } = opts;
  const dates = occupiedNightDates(checkIn, nights);
  if (!dates.length) return [];
  if (hasFullNightMatrix(checkIn, nights, nightRates)) {
    return dates.map((date) => ({
      date,
      amount: Math.max(0, Math.round(Number(nightRates!.nights![date]) || 0)),
    }));
  }
  if (nightRates?.flat != null && nightRates.flat > 0 && nights >= 1) {
    const flat = Math.round(nightRates.flat);
    const amounts = splitAmountLast(flat * nights === total ? total : flat * nights, dates.length);
    // Prefer staying on settle/quote total when provided
    const use = total > 0 ? splitAmountLast(total, dates.length) : amounts;
    return dates.map((date, i) => ({ date, amount: use[i]! }));
  }
  if (total <= 0) {
    return dates.map((date) => ({ date, amount: 0 }));
  }
  const fromTotal = nightRatesFromTotal(checkIn, nights, total);
  return dates.map((date) => ({
    date,
    amount: Math.max(0, Math.round(Number(fromTotal.nights?.[date]) || 0)),
  }));
}

/** Σ night cells — line amount truth when staff edited detail */
export function sumIssuanceNightCells(cells: IssuanceNightCell[] | null | undefined): number {
  if (!cells?.length) return 0;
  return cells.reduce((n, c) => n + Math.max(0, Math.round(c.amount || 0)), 0);
}

/** 표시용 1박 단가 (평균 · 0 nights → 0) */
export function unitRateFromCells(cells: IssuanceNightCell[], fallbackTotal = 0, nights = 0): number {
  if (cells.length) {
    return Math.round(sumIssuanceNightCells(cells) / cells.length);
  }
  if (nights >= 1 && fallbackTotal > 0) return Math.round(fallbackTotal / nights);
  return 0;
}

/**
 * 한 칸 수정. keepTotal이면 나머지 칸으로 Σ를 유지(편집 칸 제외 균등 재분배 아님 —
 * 마지막 칸이 잔액). keepTotal null이면 합 변경 허용.
 */
export function patchIssuanceNightCell(
  cells: IssuanceNightCell[],
  index: number,
  amount: number,
  keepTotal: number | null,
): IssuanceNightCell[] {
  if (!cells.length) return cells;
  const next = cells.map((c, i) =>
    i === index ? { ...c, amount: Math.max(0, Math.round(amount || 0)) } : { ...c },
  );
  if (keepTotal == null || next.length === 1) return next;
  const lastIdx = next.length - 1;
  if (index === lastIdx) {
    const head = next.slice(0, lastIdx).reduce((n, c) => n + c.amount, 0);
    next[lastIdx] = { ...next[lastIdx]!, amount: Math.max(0, Math.round(keepTotal) - head) };
    return next;
  }
  const head = next.slice(0, lastIdx).reduce((n, c) => n + c.amount, 0);
  next[lastIdx] = { ...next[lastIdx]!, amount: Math.max(0, Math.round(keepTotal) - head) };
  return next;
}

/** 총액 기준으로 균등 재분배 */
export function redistributeIssuanceNights(
  checkIn: string,
  nights: number,
  total: number,
): IssuanceNightCell[] {
  return issuanceNightCells({ checkIn, nights, total, nightRates: null });
}

export function formatIssuanceNightDate(date: string, lang: "ko" | "en" = "ko"): string {
  if (lang === "en") return date;
  try {
    return dayLabel(date);
  } catch {
    return md(date);
  }
}

/** Quote line: flat rate → per-night cells (same rate × 1실; rooms applied outside) */
export function quoteLineNightCells(opts: {
  checkIn: string | null | undefined;
  nights: number;
  rate: number;
  /** 1실 총액 (rooms 제외) — rate×nights 또는 override */
  roomTotal?: number;
  nightAmounts?: IssuanceNightCell[] | null;
}): IssuanceNightCell[] {
  if (opts.nightAmounts?.length) return opts.nightAmounts.map((c) => ({ ...c }));
  const nights = Math.max(0, Math.round(opts.nights) || 0);
  const checkIn = opts.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(opts.checkIn) ? opts.checkIn : null;
  const roomTotal =
    opts.roomTotal != null && opts.roomTotal > 0
      ? opts.roomTotal
      : Math.max(0, Math.round(opts.rate) * nights);
  if (!checkIn) {
    const amounts = splitAmountLast(roomTotal, nights || 1);
    return amounts.map((amount, i) => ({ date: `N${i + 1}`, amount }));
  }
  return issuanceNightCells({ checkIn, nights, total: roomTotal, nightRates: { flat: opts.rate || null } });
}

export function quoteAmountFromNightCells(rooms: number, cells: IssuanceNightCell[]): number {
  return Math.max(0, Math.round(rooms) * sumIssuanceNightCells(cells));
}

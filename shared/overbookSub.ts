/**
 * 오버부킹 → 지정 대체 객실 (타입 × 숙박일).
 * See docs/overbook-substitute-rooms-plan.md
 * (ledger와 순환 import 금지)
 */

export interface OverbookSub {
  id: string;
  /** night YYYY-MM-DD */
  date: string;
  /** overbooked type receiving relief */
  overTypeId: string;
  /** substitute type whose spare is deducted */
  fromTypeId: string;
  /** ≥ 1 */
  qty: number;
  createdAt: string;
}

export type OverbookSubAlloc = { fromTypeId: string; qty: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeOverbookSubs(raw: unknown): OverbookSub[] {
  if (!Array.isArray(raw)) return [];
  const out: OverbookSub[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const date = typeof o.date === "string" ? o.date : "";
    const overTypeId = typeof o.overTypeId === "string" ? o.overTypeId : "";
    const fromTypeId = typeof o.fromTypeId === "string" ? o.fromTypeId : "";
    const qty = Math.round(Number(o.qty));
    if (!id || !DATE_RE.test(date) || !overTypeId || !fromTypeId) continue;
    if (overTypeId === fromTypeId) continue;
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof o.createdAt === "string" && o.createdAt ? o.createdAt : new Date().toISOString();
    out.push({ id, date, overTypeId, fromTypeId, qty, createdAt });
  }
  return out;
}

export function subsForNight(
  subs: readonly OverbookSub[],
  overTypeId: string,
  date: string,
): OverbookSub[] {
  return subs.filter((x) => x.overTypeId === overTypeId && x.date === date);
}

export function qtyGivenTo(subs: readonly OverbookSub[], overTypeId: string, date: string): number {
  return subsForNight(subs, overTypeId, date).reduce((n, x) => n + x.qty, 0);
}

export function qtyTakenFrom(subs: readonly OverbookSub[], fromTypeId: string, date: string): number {
  let n = 0;
  for (const x of subs) {
    if (x.fromTypeId === fromTypeId && x.date === date) n += x.qty;
  }
  return n;
}

export function hasSubsForNight(subs: readonly OverbookSub[], overTypeId: string, date: string): boolean {
  return qtyGivenTo(subs, overTypeId, date) > 0;
}

export function clearSubsForNight(
  subs: readonly OverbookSub[],
  overTypeId: string,
  date: string,
): OverbookSub[] {
  return subs.filter((x) => !(x.overTypeId === overTypeId && x.date === date));
}

export function setSubsForNight(
  subs: readonly OverbookSub[],
  overTypeId: string,
  date: string,
  allocs: readonly OverbookSubAlloc[],
  nowIso?: string,
): OverbookSub[] {
  const base = clearSubsForNight(subs, overTypeId, date);
  const createdAt = nowIso ?? new Date().toISOString();
  const next: OverbookSub[] = [...base];
  for (const a of allocs) {
    const qty = Math.round(Number(a.qty));
    if (!a.fromTypeId || a.fromTypeId === overTypeId) continue;
    if (!Number.isFinite(qty) || qty < 1) continue;
    next.push({
      id: `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      date,
      overTypeId,
      fromTypeId: a.fromTypeId,
      qty,
      createdAt,
    });
  }
  return next;
}

/**
 * Validate allocations against spare map (typeId → remaining for that night,
 * computed WITHOUT this overType's current night subs).
 */
export function planOverbookSubs(input: {
  overTypeId: string;
  date: string;
  /** raw remaining of over type (negative when overbooked) before this night's relief */
  overRem: number;
  /** other types' remaining (after stripping this night's over-subs) */
  spareByType: ReadonlyMap<string, number>;
  allocs: readonly OverbookSubAlloc[];
}): { ok: OverbookSubAlloc[] } | { err: string } {
  const { overTypeId, date, overRem, spareByType, allocs } = input;
  if (!DATE_RE.test(date) || !overTypeId) return { err: "날짜·타입을 확인해 주세요" };
  const need = Math.max(0, -overRem);
  if (need <= 0 && allocs.every((a) => Math.round(Number(a.qty)) <= 0)) {
    return { ok: [] };
  }
  const cleaned: OverbookSubAlloc[] = [];
  let total = 0;
  for (const a of allocs) {
    const qty = Math.round(Number(a.qty));
    if (!a.fromTypeId || a.fromTypeId === overTypeId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const spare = spareByType.get(a.fromTypeId) ?? 0;
    if (qty > spare) return { err: "대체 타입 여유보다 많이 지정했어요" };
    cleaned.push({ fromTypeId: a.fromTypeId, qty });
    total += qty;
  }
  if (need > 0 && total > need) return { err: `초과 ${need}실보다 많이 지정했어요` };
  return { ok: cleaned };
}

export const OVERBOOK_SUB_TITLE = "지정 대체 객실";
export const OVERBOOK_SUB_SAVE = "저장";
export const OVERBOOK_SUB_CLEAR = "대체 해제";
export const OVERBOOK_SUB_SRC_HINT = "대체";

// 인원 추가 요금 등급 · 특별일 (설정 저장 모양). ledger.ts가 불러서 따로 둬요
export interface SurchargeTier {
  id: string;
  name: string; // 일반 · 독채 …
  weekday: number; // 1명 1박 (일~목 밤)
  weekend: number; // 1명 1박 (금·토 밤, 특별일)
}
export const DEFAULT_TIERS: SurchargeTier[] = [
  { id: "normal", name: "일반", weekday: 10000, weekend: 20000 },
  { id: "house", name: "독채", weekday: 20000, weekend: 30000 },
];
export const DEFAULT_BASE_GUESTS = 2;
export const GUESTS_MAX = 99;
export const TIER_NAME_MAX = 10;
export const SURCHARGE_MAX = 10_000_000;

export const intIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
/** 설정의 추가 요금 등급: 없거나 망가졌으면 기본(일반·독채) */
export function normalizeTiers(raw: unknown): SurchargeTier[] {
  if (!Array.isArray(raw)) return DEFAULT_TIERS.map((t) => ({ ...t }));
  const seen = new Set<string>();
  const out: SurchargeTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      name: typeof o.name === "string" ? o.name.slice(0, TIER_NAME_MAX) : "",
      weekday: intIn(o.weekday, 0, SURCHARGE_MAX) ?? 0,
      weekend: intIn(o.weekend, 0, SURCHARGE_MAX) ?? 0,
    });
  }
  return out.length ? out : DEFAULT_TIERS.map((t) => ({ ...t }));
}
export function normalizeSpecialDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}


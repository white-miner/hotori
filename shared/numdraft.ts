// 숫자 칸: 적는 동안에는 글자 그대로 들고 있고, 칸을 벗어날 때만 범위를 맞춰요.
// (예전에는 글자를 칠 때마다 잘라 맞춰서 '10'을 치면 '1'이 앞에 붙어 110 → 99처럼 튀었어요)
export interface DraftOpts {
  min: number;
  max: number;
  /** 소수점 허용 (수수료율 %) */
  decimal?: boolean;
}
/** 적는 중인 글자에서 숫자 · 소수점만 (쉼표는 빼요) */
export function cleanDraft(raw: string, decimal = false): string {
  const s = raw.replace(decimal ? /[^\d.]/g : /\D/g, "");
  if (!decimal) return s.slice(0, 12);
  const i = s.indexOf(".");
  return (i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "")).slice(0, 12);
}
/** 적는 중: 범위 안의 숫자일 때만 바로 반영 (범위 밖이면 반영하지 않고 글자는 그대로) */
export function liveValue(raw: string, o: DraftOpts): number | null {
  const s = cleanDraft(raw, o.decimal);
  if (s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= o.min && n <= o.max ? n : null;
}
/** 칸을 벗어날 때: 비었으면 null, 아니면 범위에 맞춰요 */
export function commitDraft(raw: string, o: DraftOpts): number | null {
  const s = cleanDraft(raw, o.decimal);
  if (s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const r = o.decimal ? Math.round(n * 100) / 100 : Math.round(n);
  return Math.min(o.max, Math.max(o.min, r));
}
/** 기본 인원 ≤ 최대 인원 안내 (값은 고치지 않아요) */
export function guestRangeMsg(base: number, max: number): string | null {
  return base > max ? `기본 인원(${base}명)이 최대 인원(${max}명)보다 많아요. 최대 인원을 늘려 주세요.` : null;
}

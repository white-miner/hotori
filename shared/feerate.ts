// 수수료율 · 플랫폼 수수료 설정 정리 (ledger.ts가 설정을 읽을 때 같이 써요)
export const RATE_MAX = 50; // %
export const PAYOUT_DAYS_MAX = 90;

/** 수수료율 %: 0 초과 50 이하, 소수 둘째 자리까지. 비었거나 이상하면 null (= 수수료 없음) */
export function normalizeRate(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(RATE_MAX, n) * 100) / 100;
}
/** 정산 주기 (퇴실 후 N일): 0~90, 비면 null */
export function normalizeDays(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(PAYOUT_DAYS_MAX, n) : null;
}
/** 플랫폼의 수수료 칸만 정리하고 나머지 칸은 그대로 둬요 (예전 앱이 저장해도 안 지워지게) */
export function normalizePlatformFee<T extends object>(raw: T): T {
  const p = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...p };
  const rate = normalizeRate(p.feeRate);
  if (rate == null) delete out.feeRate;
  else out.feeRate = rate;
  if (p.feeBasis === "net") out.feeBasis = "net";
  else delete out.feeBasis;
  if (p.couponHotel === true) out.couponHotel = true;
  else delete out.couponHotel;
  const days = normalizeDays(p.payoutDays);
  if (days == null) delete out.payoutDays;
  else out.payoutDays = days;
  return out as T;
}
/** '10' · '9.5' · '2.75' (불필요한 0은 빼요) */
export const rateLabel = (r: number) => String(Math.round(r * 100) / 100);

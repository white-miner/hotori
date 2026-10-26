/**
 * Pro / paywall gates for FO features (장부·지출 엑셀, 매점 한도, 공유 링크 UI 등).
 *
 * 개발 중: `PRO_GATES_ENABLED = false` → 모든 호텔이 Pro 기능 사용.
 * 판매 시점: `true`로 한 번만 바꾸면 Free/Pro 제약이 다시 켜져요.
 *
 * 참고: 현황 공유 `get_shared_status` / `share_link_create` SQL은 여전히
 * `hotels.plan = 'pro'`를 봅니다. 판매 전에 공유까지 풀려면 DB plan 또는 RPC도 맞춰요.
 */
export const PRO_GATES_ENABLED = false;

export type HotelPlan = "free" | "pro";

/** FO Pro 기능 사용 가능 여부. 게이트 OFF면 plan과 무관하게 true. */
export function hasProAccess(plan: HotelPlan | string): boolean {
  if (!PRO_GATES_ENABLED) return true;
  return plan === "pro";
}

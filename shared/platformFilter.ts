/**
 * 플랫폼별 보기 필터 — 현황·배치 보드 공용.
 * 필터는 칸을 숨기지 않고 흐리게만 해요 (재고·초과 칩은 전체 기준 그대로).
 *
 * 선택값(string[])
 *  - 플랫폼 id            : 그 플랫폼
 *  - PF_ONSITE ("__onsite") : 직접 예약 = 현장·전화 등 onsite 플랫폼 전부
 *  - PF_OTHER  ("__other")  : 삭제됐거나 알 수 없는 플랫폼
 *  빈 배열 = 전체 (필터 없음)
 */
import type { Booking, Platform } from "./ledger";
import { isOnsite } from "./payment";

export const PF_ONSITE = "__onsite";
export const PF_OTHER = "__other";
export const PLATFORM_FILTER_STORAGE_KEY = "hotori.platformFilter";

export interface PlatformChip {
  /** 선택값 (플랫폼 id | PF_ONSITE | PF_OTHER) */
  id: string;
  label: string;
}

type PlatLike = Pick<Platform, "id" | "name"> & { onsite?: boolean | null };

/** 예약이 선택된 플랫폼 칩에 걸리는지. 선택이 비어 있으면 항상 true. */
export function platformMatch(
  booking: Pick<Booking, "platformId">,
  selected: readonly string[],
  platforms: readonly PlatLike[],
): boolean {
  if (!selected.length) return true;
  const p = platforms.find((x) => x.id === booking.platformId);
  if (!p) return selected.includes(PF_OTHER);
  if (selected.includes(p.id)) return true;
  return selected.includes(PF_ONSITE) && isOnsite(p);
}

/** 칩 목록: 직접(onsite 묶음) → 나머지 플랫폼(설정 순서) → 기타(알 수 없는 플랫폼 예약이 있을 때만) */
export function platformChips(
  platforms: readonly PlatLike[],
  bookings: readonly Pick<Booking, "platformId">[] = [],
): PlatformChip[] {
  const chips: PlatformChip[] = [];
  if (platforms.some((p) => isOnsite(p))) chips.push({ id: PF_ONSITE, label: "직접" });
  for (const p of platforms) if (!isOnsite(p)) chips.push({ id: p.id, label: p.name });
  const known = new Set(platforms.map((p) => p.id));
  if (bookings.some((b) => typeof b.platformId === "string" && !known.has(b.platformId))) chips.push({ id: PF_OTHER, label: "기타" });
  return chips;
}

/** 저장값 정리: 사라진 플랫폼 id·중복·깨진 값 제거. onsite 플랫폼 id는 PF_ONSITE로 흡수. */
export function normalizePlatformFilter(raw: unknown, platforms: readonly PlatLike[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    let id = v;
    const p = platforms.find((x) => x.id === v);
    if (p && isOnsite(p)) id = PF_ONSITE;
    else if (!p && v !== PF_ONSITE && v !== PF_OTHER) continue;
    if (id === PF_ONSITE && !platforms.some((x) => isOnsite(x))) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function togglePlatformChoice(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

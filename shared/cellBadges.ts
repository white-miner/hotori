/**
 * 객실 칸 뱃지 — 이름 줄과 분리된 전용 줄에 모양+색으로 표시.
 * 세게 보이는 건 청소X(빨강)와 단체(단체 색)뿐 · 바로입실=검정 · 임시=노랑 점선 · 장기=파랑 외곽선.
 */
import { hashGroupBadgeColor } from "./group";
import type { GroupBadgeColor } from "./settle";

export type CellBadgeKind = "noClean" | "walkIn" | "tentative" | "longStay" | "openEnded";

/** 표시 순서 = 눈에 먼저 띄어야 하는 순 (청소X → 바로입실 → 임시 → 장기). 단체는 별도 리본. */
export const CELL_BADGE_ORDER: CellBadgeKind[] = ["noClean", "walkIn", "tentative", "longStay", "openEnded"];

export interface CellBadgeFlags {
  noClean?: boolean;
  walkIn?: boolean;
  tentative?: boolean;
  longStay?: boolean;
  openEnded?: boolean;
}

export function cellBadgeKinds(f: CellBadgeFlags): CellBadgeKind[] {
  return CELL_BADGE_ORDER.filter((k) => !!f[k]);
}

export const CELL_BADGE_LABEL: Record<CellBadgeKind, string> = {
  noClean: "청소X",
  walkIn: "바로입실",
  tentative: "임시",
  longStay: "장기",
  openEnded: "∞ 계속",
};

/** 단체 색: 저장된 badgeColor 우선 · 없으면 groupId 해시색(표시 전용, 저장 안 함) */
export function groupDisplayColor(groupId: string, saved: GroupBadgeColor | null | undefined): GroupBadgeColor {
  return saved ?? hashGroupBadgeColor(groupId);
}

// 왼쪽 사이드바 통합 — 화면과 무관한 순수 규칙 (고정 저장 · Esc · 선택 자동 해제)
// 기획서: 좌측사이드바 통합기획서 §16(T1·T2) · §17(S1·M2) · §20

/** 고정 열림 저장 키 (이 기기 기억) */
export const SIDEBAR_PIN_KEY = "hotori.sidebarPinned";

/** 저장된 고정 값 → 고정 여부 */
export const parsePinned = (stored: string | null): boolean => stored === "1";

/**
 * Esc 한 번에 사이드바 쪽에서 무엇을 닫을까 (M2: 열린 창·검색·이동 모드가 먼저 처리한다).
 * - 다른 곳이 이미 Esc 를 처리(preventDefault)했으면 아무것도 안 함
 * - 열린 창(.dim)이 있으면 아무것도 안 함
 * - 계정 메뉴가 열려 있으면 그것만 닫음, 아니면 임시 펼침을 닫음 (고정은 Esc 로 닫지 않음)
 */
export function escSidebarAction(o: {
  defaultPrevented: boolean;
  modalOpen: boolean;
  menuOpen: boolean;
  expanded: boolean;
  pinned: boolean;
}): "menu" | "collapse" | null {
  if (o.defaultPrevented || o.modalOpen) return null;
  if (o.menuOpen) return "menu";
  if (o.expanded && !o.pinned) return "collapse";
  return null;
}

/**
 * 필터가 선택한 객실을 화면에서 감추면 선택에서 뺀다 (기획서 §20: 사용자 결정).
 * 보이는 객실만 남기고, 하나도 안 변했으면 같은 배열을 돌려준다(불필요한 갱신 방지).
 */
export function selectionAfterFilter(selected: readonly string[], visible: ReadonlySet<string>): readonly string[] {
  if (!selected.length) return selected;
  const kept = selected.filter((id) => visible.has(id));
  return kept.length === selected.length ? selected : kept;
}

/**
 * 현황 화면에서 지금 보이는 객실 id 모음 — 건물 · 층 · 「임시만」 필터가 감추지 않는 객실.
 * 플랫폼·손님 검색·미니맵 필터는 칸을 흐리게만 하고 감추지 않으므로 여기에 넣지 않는다.
 */
export function visibleNowRoomIds(
  floors: readonly { id: string; buildingId?: string | null; rooms: readonly { id: string }[] }[],
  o: { buildingScope: string | null; floorTab: string; tentativeOnly: boolean; isTentative: (roomId: string) => boolean },
): Set<string> {
  const out = new Set<string>();
  for (const f of floors) {
    if (o.buildingScope && f.buildingId !== o.buildingScope) continue;
    if (o.floorTab !== "all" && o.floorTab !== f.id) continue;
    for (const r of f.rooms) {
      if (o.tentativeOnly && !o.isTentative(r.id)) continue;
      out.add(r.id);
    }
  }
  return out;
}

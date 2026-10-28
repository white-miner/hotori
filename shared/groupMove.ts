// 객실을 다른 단체로 옮기기 / 단체에서 빼기 — 순수 함수 (저장은 data.moveBookingGroup)
//  · 객실의 박별 요금·객실 결제는 예약에 붙어 있으니 그대로 따라가요 (다시 계산하지 않아요)
//  · 단체로 받은 결제(선수금)는 원래 단체에 남아요
import { groupStayPeers } from "./nowboard";
import type { Booking } from "./ledger";

export interface GroupMoveTarget {
  groupId: string;
  name: string;
  /** 이 단체에 묵는 객실 id들 (표시용) */
  roomIds: string[];
}

/** 옮겨 갈 수 있는 다른 단체들 (투숙 중·예정 숙박이 있는 단체만 · 이름순) */
export function groupMoveTargets(bookings: readonly Booking[], fromGroupId: string | null): GroupMoveTarget[] {
  const ids = new Set<string>();
  for (const b of bookings) if (b.groupId && b.groupId !== fromGroupId) ids.add(b.groupId);
  const out: GroupMoveTarget[] = [];
  for (const gid of ids) {
    const peers = groupStayPeers(bookings, gid);
    if (!peers.length) continue;
    out.push({ groupId: gid, name: peers[0]!.groupName?.trim() || "단체", roomIds: peers.map((p) => p.roomId).filter((x): x is string => !!x) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 변경 기록 한 줄 */
export function groupMoveSummary(roomNo: string, from: string | null, to: string | null): string {
  if (to == null) return `${roomNo} 단체에서 뺌${from ? ` · ${from}` : ""} (개인 예약으로)`;
  return `${roomNo} 단체 이동 · ${from ?? "개인 예약"} → ${to}`;
}

/** DB 저장값: group_id · group_name은 같이 있거나 같이 없어야 해요 */
export function groupMoveRow(target: { groupId: string; name: string } | null): { group_id: string | null; group_name: string | null } {
  if (!target) return { group_id: null, group_name: null };
  return { group_id: target.groupId, group_name: (target.name.trim() || "단체").slice(0, 40) };
}

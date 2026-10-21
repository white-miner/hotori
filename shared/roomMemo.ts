// 객실 특이사항: 「현황」보드 화이트보드 말풍선 · 호텔 단위 저장 · 인수인계(handoff)용 스키마
// kind: issue=특이사항 · delivery=전달사항 (MVP 기본 issue, 인수인계에서 미해결 둘 다 pull)
// status: open=미해결 · resolved=해결
// UI 1차 라벨은 「특이사항」(메모라고 부르지 않음). 테이블명 room_memos는 기술 식별자.

export type RoomMemoStatus = "open" | "resolved";
export type RoomMemoKind = "issue" | "delivery";

export const ROOM_MEMO_BODY_MAX = 120;
export const ROOM_MEMO_ROOM_ID_MAX = 40;

export const ROOM_MEMO_STATUS_LABEL: Record<RoomMemoStatus, string> = {
  open: "미해결",
  resolved: "해결",
};
export const ROOM_MEMO_KIND_LABEL: Record<RoomMemoKind, string> = {
  issue: "특이사항",
  delivery: "전달사항",
};

export const isRoomMemoStatus = (v: unknown): v is RoomMemoStatus => v === "open" || v === "resolved";
export const isRoomMemoKind = (v: unknown): v is RoomMemoKind => v === "issue" || v === "delivery";

export interface RoomMemo {
  id: string;
  roomId: string;
  body: string;
  status: RoomMemoStatus;
  kind: RoomMemoKind;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RoomMemoDraft = {
  roomId: string;
  body: string;
  kind?: RoomMemoKind;
  status?: RoomMemoStatus;
};

/** 본문·호실 id 검사. 통과하면 null, 아니면 한글 안내 */
export function validateRoomMemoDraft(d: RoomMemoDraft): string | null {
  const roomId = d.roomId?.trim() ?? "";
  if (!roomId || roomId.length > ROOM_MEMO_ROOM_ID_MAX) return "방을 확인해 주세요";
  const body = d.body?.trim() ?? "";
  if (!body) return "특이사항을 적어 주세요";
  if (body.length > ROOM_MEMO_BODY_MAX) return `특이사항은 ${ROOM_MEMO_BODY_MAX}자까지예요`;
  if (d.kind != null && !isRoomMemoKind(d.kind)) return "종류를 확인해 주세요";
  if (d.status != null && !isRoomMemoStatus(d.status)) return "해결 상태를 확인해 주세요";
  return null;
}

/** 방마다 미해결 건수 (말풍선 표시용) */
export function openMemoCounts(list: RoomMemo[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) {
    if (x.status !== "open") continue;
    m.set(x.roomId, (m.get(x.roomId) ?? 0) + 1);
  }
  return m;
}

/** 「현황」말풍선용: 최신 미해결 본문 미리보기 + 건수 (+툴팁용 전체) */
export type OpenMemoGlance = { count: number; preview: string; title: string };

export function openMemoGlances(list: RoomMemo[]): Map<string, OpenMemoGlance> {
  type Acc = { count: number; preview: string; createdAt: string; bodies: string[] };
  const acc = new Map<string, Acc>();
  for (const x of list) {
    if (x.status !== "open") continue;
    const cur = acc.get(x.roomId);
    if (!cur) {
      acc.set(x.roomId, { count: 1, preview: x.body, createdAt: x.createdAt, bodies: [x.body] });
      continue;
    }
    cur.count += 1;
    cur.bodies.push(x.body);
    if (x.createdAt.localeCompare(cur.createdAt) > 0) {
      cur.preview = x.body;
      cur.createdAt = x.createdAt;
    }
  }
  const out = new Map<string, OpenMemoGlance>();
  for (const [roomId, a] of acc) {
    out.set(roomId, { count: a.count, preview: a.preview, title: a.bodies.join(" · ") });
  }
  return out;
}

/** 한 방 목록: 미해결 위 · 최신순 */
export function memosForRoom(list: RoomMemo[], roomId: string): RoomMemo[] {
  return list
    .filter((x) => x.roomId === roomId)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

/**
 * 인수인계(handoff)용: 미해결 특이사항 + 미해결 전달사항.
 * 시트 Next에서 그대로 끌어올 때 쓰는 필터예요.
 */
export function openForHandoff(list: RoomMemo[]): { issues: RoomMemo[]; deliveries: RoomMemo[] } {
  const issues: RoomMemo[] = [];
  const deliveries: RoomMemo[] = [];
  for (const x of list) {
    if (x.status !== "open") continue;
    if (x.kind === "delivery") deliveries.push(x);
    else issues.push(x);
  }
  const byRoomThenNew = (a: RoomMemo, b: RoomMemo) => a.roomId.localeCompare(b.roomId, "ko") || b.createdAt.localeCompare(a.createdAt);
  issues.sort(byRoomThenNew);
  deliveries.sort(byRoomThenNew);
  return { issues, deliveries };
}

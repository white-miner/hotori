/**
 * 확인 필요 (꼬임) 탐지 — 순수 함수. 안내만 하고 저장·입실·퇴실·결제를 막지 않아요.
 * 규칙마다 `signature`가 있어요: 값이 바뀌면 달라져서 "이대로 둠"이 풀리고 다시 나타나요.
 */
import { type Booking, type Leg, addDays, legsClash, legsOf, md, occupiesRoom } from "./ledger";

export type TangleRule = "T08" | "T11";
export type TangleSeverity = "high" | "mid" | "low";

export interface Tangle {
  /** 규칙 + 대상 id (안정적) */
  key: string;
  rule: TangleRule;
  severity: TangleSeverity;
  /** 대상 예약 id (정렬됨) */
  ids: string[];
  /** 한 줄 설명 */
  title: string;
  /** 보조 한 줄 */
  detail: string;
  /** 값이 바뀌면 달라지는 서명 ("이대로 둠" 기억용) */
  signature: string;
}

export type RoomLabel = (roomId: string | null | undefined) => string;
const defaultLabel: RoomLabel = (id) => id ?? "?";
const nameOf = (b: Booking) => (b.guestName || "").trim() || "(이름 없음)";

/** T08 · 같은 방 같은 밤을 정상 예약 둘 이상이 써요 (방 이동 구간 포함, 퇴실 처리된 건 제외) */
export function findOverlaps(bookings: readonly Booking[], label: RoomLabel = defaultLabel): Tangle[] {
  const byRoom = new Map<string, { b: Booking; leg: Leg }[]>();
  for (const b of bookings) {
    if (b.kind !== "stay" || !occupiesRoom(b)) continue;
    for (const leg of legsOf(b)) {
      if (!leg.roomId) continue;
      const l = byRoom.get(leg.roomId);
      if (l) l.push({ b, leg });
      else byRoom.set(leg.roomId, [{ b, leg }]);
    }
  }
  const out: Tangle[] = [];
  const seen = new Set<string>();
  for (const [roomId, list] of byRoom) {
    list.sort((x, y) => x.leg.checkIn.localeCompare(y.leg.checkIn));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const c = list[j]!;
        // 정렬돼 있으니 c 가 a 끝 이후에 시작하면 이후도 전부 안 겹침
        if (c.leg.checkIn >= addDays(a.leg.checkIn, a.leg.nights)) break;
        if (a.b.id === c.b.id || !legsClash(a.leg, c.leg)) continue;
        const ids = [a.b.id, c.b.id].sort();
        const key = `T08:${roomId}:${ids.join("+")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const first = a.leg.checkIn > c.leg.checkIn ? a.leg.checkIn : c.leg.checkIn;
        out.push({
          key,
          rule: "T08",
          severity: "high",
          ids,
          title: `${label(roomId)}호 ${md(first)} 밤에 예약이 겹쳐요`,
          detail: `${nameOf(a.b)} · ${nameOf(c.b)} (한 쪽을 다른 방으로 옮기면 돼요)`,
          signature: `${roomId}|${a.leg.checkIn}+${a.leg.nights}|${c.leg.checkIn}+${c.leg.nights}`,
        });
      }
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/** T11 · 단체가 아닌 예약이 이름·입실·박수·플랫폼·금액까지 똑같아요 (실수로 두 번 넣었을 수 있어요) */
export function findDuplicates(bookings: readonly Booking[], label: RoomLabel = defaultLabel): Tangle[] {
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.kind !== "stay" || b.status !== "active" || b.groupId) continue;
    const name = (b.guestName || "").trim();
    if (!name) continue;
    const k = [name, b.checkIn, b.nights ?? "", b.platformId, b.price].join("|");
    const l = groups.get(k);
    if (l) l.push(b);
    else groups.set(k, [b]);
  }
  const out: Tangle[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const ids = list.map((b) => b.id).sort();
    const rooms = list.map((b) => (b.roomId ? `${label(b.roomId)}호` : "방 미정"));
    const f = list[0]!;
    out.push({
      key: `T11:${ids.join("+")}`,
      rule: "T11",
      severity: "low",
      ids,
      title: `${nameOf(f)} 님 예약이 ${list.length}건 똑같아요`,
      detail: `입실 ${md(f.checkIn)} · ${f.nights ?? "?"}박 · ${rooms.join(", ")} (여러 방이면 그대로 두세요)`,
      signature: k,
    });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/** 겹침 + 중복 */
export function findTangles(bookings: readonly Booking[], label: RoomLabel = defaultLabel): Tangle[] {
  return [...findOverlaps(bookings, label), ...findDuplicates(bookings, label)];
}

/** 이전 목록에 없던 새 꼬임만 (저장 직후 한 번만 알려주려고) */
export function newTangles(prev: readonly Tangle[], next: readonly Tangle[]): Tangle[] {
  const had = new Set(prev.map((t) => `${t.key}#${t.signature}`));
  return next.filter((t) => !had.has(`${t.key}#${t.signature}`));
}

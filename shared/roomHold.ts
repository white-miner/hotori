/**
 * 객실 임시마감(홀드) — 호실 × 숙박일 구간. 게스트 예약 아님.
 * See docs/room-temporary-hold-plan.md
 * (ledger와 순환 import 금지 — 날짜 헬퍼 최소 복제)
 */

export const ROOM_HOLD_NOTE_MAX = 40;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

export interface RoomHold {
  id: string;
  roomId: string;
  /** inclusive night YYYY-MM-DD */
  from: string;
  /** inclusive night YYYY-MM-DD */
  to: string;
  note?: string | null;
  createdAt: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeRoomHolds(raw: unknown): RoomHold[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomHold[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const roomId = typeof o.roomId === "string" ? o.roomId : "";
    let from = typeof o.from === "string" ? o.from : "";
    let to = typeof o.to === "string" ? o.to : "";
    if (!id || !roomId || !DATE_RE.test(from) || !DATE_RE.test(to)) continue;
    if (to < from) {
      const t = from;
      from = to;
      to = t;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const noteRaw = typeof o.note === "string" ? o.note.trim().slice(0, ROOM_HOLD_NOTE_MAX) : "";
    const createdAt = typeof o.createdAt === "string" && o.createdAt ? o.createdAt : new Date().toISOString();
    out.push({
      id,
      roomId,
      from,
      to,
      note: noteRaw || null,
      createdAt,
    });
  }
  return out;
}

/** night ∈ [from, to] */
export function holdCoversNight(h: Pick<RoomHold, "from" | "to">, night: string): boolean {
  return night >= h.from && night <= h.to;
}

export function holdOnNight(holds: readonly RoomHold[], roomId: string, night: string): RoomHold | null {
  for (const h of holds) {
    if (h.roomId === roomId && holdCoversNight(h, night)) return h;
  }
  return null;
}

export function isRoomHeld(holds: readonly RoomHold[], roomId: string, night: string): boolean {
  return !!holdOnNight(holds, roomId, night);
}

/** stay nights checkIn .. checkIn+nights-1 overlap hold */
export function holdOverlapsStay(
  h: Pick<RoomHold, "roomId" | "from" | "to">,
  roomId: string,
  checkIn: string,
  nights: number,
): boolean {
  if (h.roomId !== roomId || nights <= 0) return false;
  const end = addDays(checkIn, nights - 1);
  return h.from <= end && checkIn <= h.to;
}

export function roomsHeldForStay(
  holds: readonly RoomHold[],
  checkIn: string,
  nights: number,
): Set<string> {
  const out = new Set<string>();
  if (nights <= 0) return out;
  for (const h of holds) {
    if (holdOverlapsStay(h, h.roomId, checkIn, nights)) out.add(h.roomId);
  }
  return out;
}

export type RoomHoldDraft = {
  roomId: string;
  from: string;
  nights: number;
  note?: string | null;
  nowIso?: string;
};

export function planRoomHold(
  holds: readonly RoomHold[],
  draft: RoomHoldDraft,
): { ok: RoomHold } | { err: string } {
  const nights = Math.round(Number(draft.nights));
  if (!draft.roomId) return { err: "호실을 확인해 주세요" };
  if (!DATE_RE.test(draft.from)) return { err: "시작일을 확인해 주세요" };
  if (!Number.isFinite(nights) || nights < 1 || nights > 90) return { err: "박수는 1~90으로 해 주세요" };
  const to = addDays(draft.from, nights - 1);
  for (const h of holds) {
    if (holdOverlapsStay(h, draft.roomId, draft.from, nights)) {
      return { err: "이미 마감된 기간과 겹쳐요. 취소 마감 후 다시 해 주세요" };
    }
  }
  const note = (draft.note ?? "").trim().slice(0, ROOM_HOLD_NOTE_MAX) || null;
  return {
    ok: {
      id: `rh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      roomId: draft.roomId,
      from: draft.from,
      to,
      note,
      createdAt: draft.nowIso ?? new Date().toISOString(),
    },
  };
}

export function addRoomHold(holds: readonly RoomHold[], hold: RoomHold): RoomHold[] {
  return [...holds, hold];
}

export function releaseRoomHold(holds: readonly RoomHold[], holdId: string): RoomHold[] {
  return holds.filter((h) => h.id !== holdId);
}

/** inclusive nights count */
export function holdNights(h: Pick<RoomHold, "from" | "to">): number {
  return Math.max(1, daysBetween(h.from, h.to) + 1);
}

export function holdDateLabel(h: Pick<RoomHold, "from" | "to">): string {
  const n = holdNights(h);
  if (n === 1) return h.from;
  return `${h.from}~${h.to}`;
}

/** 짧은 칸 표시 (노트 없으면 「마감」) */
export function holdCellNote(h: Pick<RoomHold, "note"> | null | undefined): string {
  const n = (h?.note ?? "").trim();
  return n || "마감";
}

export const ROOM_HOLD_NOTE_CHIPS = ["상담중", "예비"] as const;
export const ROOM_HOLD_CREATE_CTA = "임시 마감";
export const ROOM_HOLD_RELEASE_CTA = "취소 마감";
export const ROOM_HOLD_STATUS = "마감";

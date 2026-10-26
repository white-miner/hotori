/**
 * 「미니맵」상태 색 — 보드와 동일 occupancy 경로의 색 4종.
 * MiniFloorPlan(피커)과 분리 · 새 점유 엔진 금지.
 */
import type { Booking } from "./ledger";
import { boardEntryForRoom, isActive, occupiesRoom } from "./ledger";
import { type NowFlags, type NowKind, type NowOpts, nowFlags } from "./nowboard";

/** 미니맵 색 (lateOut → 퇴실예정 묶음 · held = 객실 임시마감) */
export type GlanceMapKind = "empty" | "arriving" | "inhouse" | "departing" | "held";

export function glanceMapKindFromNow(kind: NowKind): GlanceMapKind {
  switch (kind) {
    case "arriving":
      return "arriving";
    case "inhouse":
      return "inhouse";
    case "departing":
    case "lateOut":
      return "departing";
    case "empty":
    case "unassigned":
    default:
      return "empty";
  }
}

export function glanceMapKindFromFlags(f: NowFlags): GlanceMapKind {
  return glanceMapKindFromNow(f.kind);
}

/** 「현황」: nowByRoom + nowFlags */
export function glanceMapKindNow(
  booking: Booking | null | undefined,
  boardDate: string,
  opts?: NowOpts,
): GlanceMapKind {
  return glanceMapKindFromFlags(nowFlags(booking, boardDate, opts));
}

/**
 * 「배치」: boardEntryForRoom + occupiesRoom → nowFlags.
 * 오늘/미래: 퇴실처리된 활성 예약은 공실 (placement-stale SoT · #125).
 * 과거(`night < today`): 역사 점유 → arrived면 inhouse / 아니면 arriving.
 */
export function glanceMapKindPlacement(
  bookings: Booking[],
  roomId: string,
  night: string,
  opts?: NowOpts,
  today?: string,
): GlanceMapKind {
  const b = boardEntryForRoom(bookings, roomId, night, today);
  if (!b) return "empty";
  if (occupiesRoom(b)) return glanceMapKindNow(b, night, opts);
  if (today && night < today && isActive(b)) return b.arrived ? "inhouse" : "arriving";
  return "empty";
}

/** 총/사용/남음 칩 필터 — null=전체 · used=점유 묶음 · left=공실 */
export type GlanceOccFilter = "used" | "left" | null;

/** 미니맵 kind가 현재 점유 필터에 맞는지 (사용=empty 제외 · 남음=empty만 · held≠공실) */
export function glanceKindMatchesOccFilter(kind: GlanceMapKind, filter: GlanceOccFilter): boolean {
  if (!filter) return true;
  const vacant = kind === "empty";
  return filter === "left" ? vacant : !vacant;
}

/** 남은 호수 압축 칩 기본 노출 수 (펼침 전) */
export const GLANCE_ROOM_CHIP_CAP = 6;

/** 타입 여유 칩 기본 노출 (펼침 시 전부 · 접힌 바에는 미표시) */
export const GLANCE_TYPE_CHIP_CAP = 8;

export const GLANCE_OPEN_KEY = {
  now: "hotori.boardGlance.open.now",
  rooms: "hotori.boardGlance.open.rooms",
} as const;

export type GlanceSurface = keyof typeof GLANCE_OPEN_KEY;

/**
 * 「현황 한눈」상태 미니맵 — 보드와 동일 occupancy 경로의 색 4종.
 * MiniFloorPlan(피커)과 분리 · 새 점유 엔진 금지.
 */
import type { Booking } from "./ledger";
import { boardEntryForRoom, occupiesRoom } from "./ledger";
import { type NowFlags, type NowKind, type NowOpts, nowFlags } from "./nowboard";

/** 미니맵 MVP 4색 (lateOut → 퇴실예정 묶음) */
export type GlanceMapKind = "empty" | "arriving" | "inhouse" | "departing";

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
 * 퇴실처리된 활성 예약은 공실 (placement-stale SoT).
 */
export function glanceMapKindPlacement(
  bookings: Booking[],
  roomId: string,
  night: string,
  opts?: NowOpts,
): GlanceMapKind {
  const b = boardEntryForRoom(bookings, roomId, night);
  if (!b || !occupiesRoom(b)) return "empty";
  return glanceMapKindNow(b, night, opts);
}

/** 남은 호수 압축 칩 기본 노출 수 (펼침 전) */
export const GLANCE_ROOM_CHIP_CAP = 6;

/** 타입 여유 칩 기본 노출 (접힌 바는 별도 1개) */
export const GLANCE_TYPE_CHIP_CAP = 8;

export const GLANCE_OPEN_KEY = {
  now: "hotori.boardGlance.open.now",
  rooms: "hotori.boardGlance.open.rooms",
} as const;

export type GlanceSurface = keyof typeof GLANCE_OPEN_KEY;

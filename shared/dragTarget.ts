/**
 * 객실 칸 끌어서 옮기기 — 화면과 상관없는 순수 판단만.
 * (포인터 이벤트 연결은 src/useBoardDrag.ts, 옮기기 자체는 기존 옮기기 모드)
 */

/** 마우스: 이만큼 움직이면 끌기 시작 (그 전엔 그냥 클릭) */
export const DRAG_MOUSE_PX = 6;
/** 터치: 이만큼 꾹 누르면 끌기 시작 (그 전에 움직이면 스크롤) */
export const DRAG_TOUCH_HOLD_MS = 350;
/** 터치: 꾹 누르는 동안 이만큼까지는 손가락이 흔들려도 봐줘요 */
export const DRAG_TOUCH_SLOP_PX = 8;

export type DragIntent = "wait" | "start" | "cancel";

/** 누른 뒤 지금까지의 움직임(dx,dy px)·누른 시간(ms)으로 끌기 시작/취소/대기를 정해요 */
export function dragIntent(i: { pointerType: string; dx: number; dy: number; heldMs: number }): DragIntent {
  const dist = Math.hypot(i.dx, i.dy);
  if (i.pointerType === "touch") {
    if (i.heldMs >= DRAG_TOUCH_HOLD_MS) return "start";
    return dist > DRAG_TOUCH_SLOP_PX ? "cancel" : "wait"; // 일찍 움직이면 스크롤
  }
  return dist >= DRAG_MOUSE_PX ? "start" : "wait";
}

export type DropResolution =
  | { kind: "move"; roomId: string; /** 같은 타입이면 바로, 다른 타입이면 확인을 거쳐요 */ confirm: boolean }
  | { kind: "swap"; roomId: string }
  | { kind: "none"; reason: "outside" | "source" | "blocked" };

/** 놓은 칸이 어떤 이동인지: 점유 방=맞교환, 빈 방=이동 (기존 옮기기와 같은 후보만) */
export function resolveDrop(i: {
  roomId: string | null;
  from: string | null | undefined;
  targets: ReadonlySet<string>;
  swapTargets: ReadonlyMap<string, unknown>;
  bookedTypeId: string | null | undefined;
  typeOf: (roomId: string) => string | null | undefined;
}): DropResolution {
  const { roomId } = i;
  if (!roomId) return { kind: "none", reason: "outside" };
  if (roomId === i.from) return { kind: "none", reason: "source" };
  if (i.swapTargets.has(roomId)) return { kind: "swap", roomId };
  if (i.targets.has(roomId)) return { kind: "move", roomId, confirm: (i.typeOf(roomId) ?? null) !== (i.bookedTypeId ?? null) };
  return { kind: "none", reason: "blocked" };
}

/** 끌다가 화면 가장자리에 가까우면 스크롤할 양(px/프레임): 위쪽은 음수, 아래쪽은 양수, 가운데는 0 */
export function edgeScrollDelta(pos: number, min: number, max: number, edge = 64, maxSpeed = 22): number {
  if (!(max > min)) return 0;
  const e = Math.min(edge, (max - min) / 3);
  if (pos < min + e) return -Math.round(maxSpeed * Math.min(1, (min + e - pos) / e));
  if (pos > max - e) return Math.round(maxSpeed * Math.min(1, (pos - (max - e)) / e));
  return 0;
}

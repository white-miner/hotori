import { useEffect, useRef } from "react";
import { dragIntent, DRAG_TOUCH_HOLD_MS, edgeScrollDelta } from "../shared/dragTarget";

export interface DragStart {
  id: string;
  night: string;
}
export interface BoardDragOptions {
  /** 이 칸에서 끌기를 시작해도 되는지 (안 되면 null) — 최신 화면 상태로 판단 */
  getStart: (roomId: string) => DragStart | null;
  /** 끌기가 실제로 시작됨 → 기존 옮기기 모드로 */
  onStart: (m: DragStart, roomId: string) => void;
  /** 놓음 (칸 밖이면 roomId=null) */
  onDrop: (roomId: string | null) => void;
  /** Esc·터치 취소 */
  onCancel: () => void;
  /** 놓을 수 있는 칸인지 (마우스 올린 칸 표시용) */
  isValid: (roomId: string) => boolean;
  /** 떠다니는 이름표 글자 */
  ghostLabel: (roomId: string) => string;
}

const INTERACTIVE = "button, a, input, select, textarea, label, [contenteditable], .nowmemo, .dumark";

function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

/**
 * 객실 칸을 마우스로 끌거나(6px) 터치로 꾹 눌러(0.35초) 다른 방에 놓아 옮기기.
 * 옮기기·맞교환 규칙은 기존 옮기기 모드(타깃·확인창·6초 되돌리기)를 그대로 써요.
 * 클릭으로 옮기기는 그대로 남아 있어요.
 */
export function useBoardDrag(enabled: boolean, opts: BoardDragOptions) {
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    if (!enabled) return;
    let st: {
      pid: number;
      type: string;
      x0: number;
      y0: number;
      t0: number;
      x: number;
      y: number;
      roomId: string;
      start: DragStart;
      active: boolean;
      timer: number | null;
      ghost: HTMLElement | null;
      over: HTMLElement | null;
      raf: number | null;
    } | null = null;

    const cellAt = (x: number, y: number): HTMLElement | null => {
      const el = document.elementFromPoint(x, y);
      return (el?.closest(".board-page .cell[data-room-id]") as HTMLElement | null) ?? null;
    };
    const setOver = (cell: HTMLElement | null) => {
      if (!st || st.over === cell) return;
      st.over?.removeAttribute("data-drag-over");
      st.over = cell;
      if (cell) cell.setAttribute("data-drag-over", o.current.isValid(cell.dataset.roomId!) ? "ok" : "no");
    };
    const place = () => {
      if (!st?.ghost) return;
      st.ghost.style.transform = `translate(${st.x + 14}px, ${st.y + 14}px)`;
    };
    const tick = () => {
      if (!st?.active) return;
      const under = document.elementFromPoint(st.x, st.y);
      const sp = scrollParent(under);
      const [min, max] = sp ? [sp.getBoundingClientRect().top, sp.getBoundingClientRect().bottom] : [0, window.innerHeight];
      const d = edgeScrollDelta(st.y, min, max);
      if (d) {
        if (sp) sp.scrollTop += d;
        else window.scrollBy(0, d);
        setOver(cellAt(st.x, st.y));
      }
      st.raf = requestAnimationFrame(tick);
    };
    const swallowClick = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const cleanup = () => {
      if (!st) return;
      if (st.timer != null) clearTimeout(st.timer);
      if (st.raf != null) cancelAnimationFrame(st.raf);
      st.over?.removeAttribute("data-drag-over");
      st.ghost?.remove();
      document.body.classList.remove("dragging-move");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancelEv);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("selectstart", onSel, true);
      st = null;
    };
    const activate = () => {
      if (!st || st.active) return;
      st.active = true;
      if (st.timer != null) clearTimeout(st.timer);
      st.timer = null;
      window.getSelection()?.removeAllRanges();
      document.body.classList.add("dragging-move");
      const g = document.createElement("div");
      g.className = "drag-ghost";
      g.textContent = o.current.ghostLabel(st.roomId);
      document.body.appendChild(g);
      st.ghost = g;
      place();
      if (st.type === "touch") navigator.vibrate?.(12);
      o.current.onStart(st.start, st.roomId);
      st.raf = requestAnimationFrame(tick);
    };
    function onMove(e: PointerEvent) {
      if (!st || e.pointerId !== st.pid) return;
      st.x = e.clientX;
      st.y = e.clientY;
      if (!st.active) {
        const it = dragIntent({ pointerType: st.type, dx: st.x - st.x0, dy: st.y - st.y0, heldMs: performance.now() - st.t0 });
        if (it === "cancel") cleanup();
        else if (it === "start") activate();
        if (!st?.active) return;
      }
      e.preventDefault();
      place();
      setOver(cellAt(st.x, st.y));
    }
    function onUp(e: PointerEvent) {
      if (!st || e.pointerId !== st.pid) return;
      if (!st.active) return cleanup();
      const cell = cellAt(e.clientX, e.clientY);
      const roomId = cell?.dataset.roomId ?? null;
      // 놓은 뒤 따라오는 클릭이 칸을 또 누르지 않게
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallowClick, true), 60);
      cleanup();
      o.current.onDrop(roomId);
    }
    function onCancelEv(e: PointerEvent) {
      if (!st || e.pointerId !== st.pid) return;
      const was = st.active;
      cleanup();
      if (was) o.current.onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (!st || e.key !== "Escape") return;
      const was = st.active;
      cleanup();
      if (was) {
        e.preventDefault();
        o.current.onCancel();
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (st?.active && e.cancelable) e.preventDefault(); // 끌기 시작 뒤엔 화면이 따라 스크롤되지 않게
    }
    function onCtx(e: Event) {
      if (st) e.preventDefault(); // 꾹 누르기 메뉴 방지
    }
    function onSel(e: Event) {
      if (st?.active) e.preventDefault();
    }
    const onDown = (e: PointerEvent) => {
      if (st || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const t = e.target as Element | null;
      const cell = t?.closest(".board-page .cell[data-room-id]") as HTMLElement | null;
      if (!cell) return;
      const hit = t!.closest(INTERACTIVE);
      if (hit && hit !== cell && cell.contains(hit)) return;
      const roomId = cell.dataset.roomId!;
      const start = o.current.getStart(roomId);
      if (!start) return;
      st = { pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), roomId, start, active: false, timer: null, ghost: null, over: null, raf: null };
      if (e.pointerType === "touch") st.timer = window.setTimeout(activate, DRAG_TOUCH_HOLD_MS);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancelEv);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("contextmenu", onCtx, true);
      window.addEventListener("selectstart", onSel, true);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      cleanup();
    };
  }, [enabled]);
}

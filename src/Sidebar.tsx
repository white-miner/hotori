import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pin, PinOff, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SIDEBAR_PIN_KEY, escSidebarAction, parsePinned } from "../shared/sidebar";

/**
 * 왼쪽 사이드바 (항상 켜짐 · 데스크톱만).
 * 평소 56px 아이콘 레일 → 눌러서 320px 로 임시 펼침(본문 위에 겹침, 열 수 변함 없음) 또는 고정(본문이 좁아짐).
 * 상태(선택 객실·모드·이동·배정)는 Dashboard 에 그대로 두고, Dashboard 가 아래 칸(slot)으로 그려 넣는다 (portal · 상태 이동 없음).
 */

/** Dashboard 가 그려 넣는 칸 이름 */
export type SbSlot = "views" | "date" | "ops";
/** 사이드바 안 고정 순서 (포털 순서에 기대지 않음) — 기획서 B: 보기 · 날짜 · 건물 · 검색 · 플랫폼 · 현황 필터/층 · 미니맵 */

interface SbCtx {
  /** 사이드바를 쓰는 중 (데스크톱) */
  active: boolean;
  slots: Partial<Record<SbSlot, HTMLElement>>;
  reveal: () => void;
}
const SidebarCtx = createContext<SbCtx>({ active: false, slots: {}, reveal: () => {} });
export const SidebarProvider = SidebarCtx.Provider;

/**
 * Dashboard 용: 이 칸에 그려 넣을 위치. 사이드바를 안 쓰면 null (제자리에 그림).
 * 사이드바를 쓰는데 칸이 아직 안 생겼으면 "wait" (잠깐 아무것도 안 그림 — 두 곳에 같은 단추가 보이지 않게).
 */
export function useSidebarSlots(): { active: boolean; reveal: () => void; into: (slot: SbSlot, node: ReactNode) => ReactNode } {
  const { active, slots, reveal } = useContext(SidebarCtx);
  const into = useCallback(
    (slot: SbSlot, node: ReactNode): ReactNode => {
      if (!active || node == null || node === false) return node;
      const el = slots[slot];
      return el ? createPortal(node, el) : null;
    },
    [active, slots],
  );
  return { active, into, reveal };
}

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 개인 정보 보호 모드 */
  }
};

function useMobile(): boolean {
  const q = "(max-width: 760px)";
  const [m, setM] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export interface SidebarState {
  active: boolean;
  /** 임시 펼침 */
  expanded: boolean;
  pinned: boolean;
  /** 320px 로 보이는 중 (임시 펼침 또는 고정) */
  open: boolean;
  toggle: () => void;
  togglePin: () => void;
  ctx: SbCtx;
  setSlot: (name: SbSlot) => (el: HTMLElement | null) => void;
}

/** 사이드바 상태를 만든다. 데스크톱은 항상 켜짐. 모바일(≤760px)은 단계 6 전까지 지금 화면 그대로라 active=false. */
export function useSidebarState(menuOpen: boolean, closeMenu: () => void): SidebarState {
  const mobile = useMobile();
  const active = !mobile;
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(() => parsePinned(lsGet(SIDEBAR_PIN_KEY)));
  const [els, setEls] = useState<Partial<Record<SbSlot, HTMLElement>>>({});
  const setters = useRef<Partial<Record<SbSlot, (el: HTMLElement | null) => void>>>({});
  const setSlot = useCallback((name: SbSlot) => {
    return (setters.current[name] ??= (el: HTMLElement | null) =>
      setEls((p) => {
        if ((p[name] ?? null) === el) return p;
        const n = { ...p };
        if (el) n[name] = el;
        else delete n[name];
        return n;
      }));
  }, []);
  const togglePin = useCallback(() => {
    setPinned((p) => {
      lsSet(SIDEBAR_PIN_KEY, p ? null : "1");
      return !p;
    });
    setExpanded(false);
  }, []);
  const toggle = useCallback(() => setExpanded((e) => !e), []);
  // Esc: 열린 창·검색·이동 모드가 먼저(그쪽이 preventDefault), 그다음 계정 메뉴 → 임시 펼침
  const live = useRef({ menuOpen, expanded, pinned });
  live.current = { menuOpen, expanded, pinned };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 다른 Esc 처리기가 먼저 돌 시간을 준 뒤 판단 (같은 이벤트의 defaultPrevented 확인)
      window.setTimeout(() => {
        const a = escSidebarAction({
          defaultPrevented: e.defaultPrevented,
          modalOpen: !!document.querySelector(".dim"),
          menuOpen: live.current.menuOpen,
          expanded: live.current.expanded,
          pinned: live.current.pinned,
        });
        if (a === "menu") closeMenu();
        else if (a === "collapse") setExpanded(false);
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeMenu]);
  const reveal = useCallback(() => setExpanded(true), []);
  const ctx = useMemo<SbCtx>(() => ({ active, slots: els, reveal }), [active, els, reveal]);
  return { active, expanded, pinned, open: expanded || pinned, toggle, togglePin, ctx, setSlot };
}

/** 사이드바 틀. top = 간단 예약·화면 이동 (A). 로고·호텔 이름·알림·공지·설정·계정은 페이지 맨 위 가로 줄(AppTopBar) */
export function Sidebar({ st, top }: { st: SidebarState; top?: ReactNode }) {
  const cls = `sb ${st.open ? "open" : "rail"}${st.pinned ? " pinned" : ""}`;
  return (
    <aside className={cls} aria-label="사이드바">
      <div className="sb-head">
        {st.pinned ? null : (
          <button
            type="button"
            className="sb-ico"
            aria-label={st.open ? "사이드바 접기" : "사이드바 펼치기"}
            aria-expanded={st.open}
            title={st.open ? "접기" : "펼치기"}
            onClick={st.toggle}
          >
            {st.open ? <PanelLeftClose size={18} strokeWidth={2.2} /> : <PanelLeftOpen size={18} strokeWidth={2.2} />}
          </button>
        )}
        {st.open ? (
          <button
            type="button"
            className={`sb-ico sb-pin${st.pinned ? " on" : ""}`}
            aria-label={st.pinned ? "고정 풀기" : "고정"}
            aria-pressed={st.pinned}
            title={st.pinned ? "고정 풀기" : "고정"}
            onClick={st.togglePin}
          >
            {st.pinned ? <PinOff size={17} strokeWidth={2.2} /> : <Pin size={17} strokeWidth={2.2} />}
          </button>
        ) : null}
      </div>
      {top ? <div className="sb-a">{top}</div> : null}
      <div className="sb-scroll">
        {/* 순서: 보기(화면 전환) → 날짜 이동 → 운영 패널. 건물·손님 검색·플랫폼·필터·미니맵은 본문 맨 위 줄 */}
        <div className="sb-b sb-b-views">
          <div className="sb-slot sb-slot-views" ref={st.setSlot("views")} />
          <div className="sb-slot sb-slot-date" ref={st.setSlot("date")} />
        </div>
        <div className="sb-c">
          <div className="sb-slot sb-slot-ops" ref={st.setSlot("ops")} />
        </div>
      </div>
    </aside>
  );
}

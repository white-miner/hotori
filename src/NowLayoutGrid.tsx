import { useEffect, useRef, type ReactNode } from "react";

/**
 * 「현황」 보드 + 우측 운영패널 2열 레이아웃.
 * 운영패널의 윗선을 첫 객실카드 줄(첫 카드의 윗변)에 맞춘다.
 * 위쪽(건물칩·검색·미니맵) 높이는 내용에 따라 달라지므로 첫 카드의 실제 위치를 재서
 * CSS 변수 --now-panel-top 으로 넘긴다. 패널 안 내용·동작은 건드리지 않는다.
 * 좁은 화면(≤960px)은 CSS 에서 이 값을 쓰지 않아 지금처럼 위아래로 쌓인다.
 */
export default function NowLayoutGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const first = el.querySelector<HTMLElement>(".nowgrid .rooms > *");
      if (!first) {
        el.style.removeProperty("--now-panel-top");
        return;
      }
      const top = first.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.style.setProperty("--now-panel-top", `${Math.max(0, Math.round(top * 100) / 100)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const board = el.querySelector(".nowboard");
    if (board) ro.observe(board);
    const chrome = el.querySelector(".board-chrome-sticky");
    if (chrome) ro.observe(chrome);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div className="nowlayout" ref={ref}>
      {children}
    </div>
  );
}

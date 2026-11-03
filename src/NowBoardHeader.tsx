import { useId, useRef, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import "./NowBoardHeader.css";

export type NowHeaderPanel = "view" | "filter" | "work" | null;
export type NowHeaderFilter = { key: string; label: string; onClear: () => void };

/** Header slots reuse Dashboard's booking/search/setting callbacks without owning hotel data. */
export default function NowBoardHeader({ dateNav, buildings, search, summary, view, filter, work, panel, onPanelChange, activeFilters, onClearFilters }: {
  dateNav: ReactNode; buildings: ReactNode; search: ReactNode; summary: ReactNode;
  view: ReactNode; filter?: ReactNode; work?: ReactNode;
  panel: NowHeaderPanel; onPanelChange: (next: NowHeaderPanel) => void;
  activeFilters: NowHeaderFilter[]; onClearFilters: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => { onPanelChange(null); trigger.current?.focus(); };
  const toggle = (next: Exclude<NowHeaderPanel, null>, button: HTMLButtonElement) => {
    trigger.current = button;
    onPanelChange(panel === next ? null : next);
  };
  const triggerButton = (name: Exclude<NowHeaderPanel, null>, label: ReactNode) => <button type="button" className="now-header-trigger" aria-expanded={panel === name} aria-controls={`${id}-${name}`}
    onClick={e => toggle(name, e.currentTarget)}>{label}</button>;
  const section = (name: Exclude<NowHeaderPanel, null>, title: string, content: ReactNode) => <section className="now-header-panel" id={`${id}-${name}`} aria-label={title} hidden={panel !== name}>
    <div className="now-header-panel-head"><h2>{title}</h2><button type="button" className="now-header-close" aria-label={`${title} 닫기`} onClick={close}><X size={18} aria-hidden />닫기</button></div>
    {content}
  </section>;
  return <header className="now-board-header" aria-label="현황 조작" onKeyDown={e => {
    if (e.key === "Escape" && !e.defaultPrevented && panel && e.currentTarget.contains(e.target as Node)) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  }}>
    <div className="now-header-top">
      <div className="now-header-date"><h1>현황</h1><div className="dnav">{dateNav}</div></div>
      <div className="now-header-tools">
        {triggerButton("view", <><SlidersHorizontal size={17} aria-hidden />보기 설정</>)}
        {work ? triggerButton("work", <>업무<ChevronDown size={16} aria-hidden /></>) : null}
      </div>
    </div>
    <div className={`now-header-find${buildings ? "" : " single-building"}`}>
      {buildings ? <div className="now-header-buildings">{buildings}</div> : null}
      {search ? <div className="now-header-search">{search}</div> : <span />}
      {filter ? triggerButton("filter", <>필터{activeFilters.length ? <span className="now-header-filter-count">{activeFilters.length}</span> : null}<ChevronDown size={16} aria-hidden /></>) : null}
    </div>
    {activeFilters.length && filter ? <div className="now-header-active" aria-label="적용 중인 조건">
      {activeFilters.map(f => <button type="button" key={f.key} className="now-header-condition" aria-label={`${f.label} 해제`} onClick={f.onClear}>{f.label}<X size={14} aria-hidden /></button>)}
      <button type="button" className="now-header-clear" onClick={onClearFilters}>전체 해제</button>
    </div> : null}
    {section("view", "보기 설정", view)}
    {filter ? section("filter", "필터·단체 관리", filter) : null}
    {work ? section("work", "업무", work) : null}
    {summary ? <div className="now-header-summary">{summary}</div> : null}
  </header>;
}

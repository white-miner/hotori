import { useEffect, useRef, type ComponentType } from "react";
import { AlertTriangle, Bell, ClipboardList, LogOut, Menu, Settings as Gear } from "lucide-react";
import { Brand } from "./ui";
import { HeaderCTA } from "./primitives/HeaderCTA";

/** 특이사항·공지·확인 필요·설정 단추 묶음 — 모바일 헤더와 데스크톱 맨 위 가로 줄이 같은 것을 쓴다. */
export interface TopAlertsProps {
  issueBadge: string | null;
  issueCount: number;
  noticeBadge: string | null;
  noticeCount: number;
  tangleBadge: string | null;
  tangleCount: number;
  settingsOn: boolean;
  onIssues: () => void;
  onNotices: () => void;
  onTangles: () => void;
  onSettings: () => void;
}
export function TopAlerts(p: TopAlertsProps) {
  return (
    <div className="top-alerts" role="group" aria-label="특이사항·공지·설정">
      <button
        type="button"
        className={`top-alert-btn${p.issueBadge ? " has" : ""}`}
        aria-label={p.issueBadge ? `특이사항 미해결 ${p.issueCount}건` : "특이사항"}
        title="특이사항"
        onClick={p.onIssues}
      >
        <Bell size={18} strokeWidth={2.2} aria-hidden />
        {p.issueBadge ? <span className="top-alert-badge danger">{p.issueBadge}</span> : null}
      </button>
      <button
        type="button"
        className={`top-alert-btn top-notice-btn${p.noticeBadge ? " has" : ""}`}
        aria-label={p.noticeBadge ? `공지 미해결 ${p.noticeCount}건` : "공지"}
        title="호텔 공지"
        onClick={p.onNotices}
      >
        <ClipboardList size={18} strokeWidth={2.2} aria-hidden />
        <span className="top-notice-label">공지</span>
        {p.noticeBadge ? <span className="top-alert-badge warn">{p.noticeBadge}</span> : null}
      </button>
      <button
        type="button"
        className={`top-alert-btn top-notice-btn${p.tangleCount ? " has" : ""}`}
        aria-label={p.tangleCount ? `확인 필요 ${p.tangleCount}건` : "확인 필요"}
        title="확인 필요"
        onClick={p.onTangles}
      >
        <AlertTriangle size={18} strokeWidth={2.2} aria-hidden />
        <span className="top-notice-label">확인 필요</span>
        {p.tangleCount ? <span className="top-alert-badge tng">{p.tangleBadge}</span> : null}
      </button>
      <button type="button" className={`top-alert-btn${p.settingsOn ? " has" : ""}`} aria-label="설정" title="설정" onClick={p.onSettings}>
        <Gear size={18} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}

/** 계정 단추 + 메뉴(이메일·로그아웃). 모바일 헤더는 마우스가 벗어나면 닫히고(예전 그대로), 데스크톱 맨 위 줄은 바깥 클릭·Esc 로 닫힌다. */
export function AccountMenu({
  email,
  open,
  setOpen,
  closeOnLeave,
  closeOnOutside,
  onSignOut,
}: {
  email: string;
  open: boolean;
  setOpen: (v: boolean | ((o: boolean) => boolean)) => void;
  closeOnLeave?: boolean;
  closeOnOutside?: boolean;
  onSignOut: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !closeOnOutside) return;
    const on = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [open, closeOnOutside, setOpen]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="av" aria-label="메뉴" onClick={() => setOpen((m) => !m)}>
        <span className="av-l">{(email[0] ?? "H").toUpperCase()}</span>
        <Menu className="av-m" size={18} />
      </button>
      {open ? (
        <div className="pop" onMouseLeave={closeOnLeave ? () => setOpen(false) : undefined}>
          <div className="pop-h">{email}</div>
          <button className="pop-i" onClick={onSignOut}>
            <LogOut size={15} /> 로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface SbNavItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  shortcut?: string;
}

/** 페이지 맨 위 가로 줄(데스크톱): 로고(→ 보드 처음 화면) · 호텔 이름 · 표시 · 특이사항·공지·확인 필요·설정 · 계정. 모바일은 기존 헤더. */
export function AppTopBar({
  hotelName,
  isDemo,
  hasError,
  onHome,
  alerts,
  account,
}: {
  hotelName: string;
  isDemo: boolean;
  hasError: boolean;
  onHome: () => void;
  alerts: TopAlertsProps;
  account: { email: string; open: boolean; setOpen: (v: boolean | ((o: boolean) => boolean)) => void; onSignOut: () => void };
}) {
  return (
    <header className="topbar">
      <div className="topbar-l">
        <Brand sub={hotelName} onHome={onHome} />
        {isDemo ? <span className="demo">예시 데이터</span> : null}
        {hasError ? <span className="demo warn">연결 확인 중</span> : null}
      </div>
      <div className="topbar-r">
        <TopAlerts {...alerts} />
        <AccountMenu {...account} closeOnOutside />
      </div>
    </header>
  );
}

/** 사이드바 위: 간단 예약 · 화면 이동 */
export function SidebarTop({
  onSimple,
  nav,
  view,
  onPick,
}: {
  onSimple: () => void;
  nav: SbNavItem[];
  view: string;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <HeaderCTA className="sb-cta" aria-label="간단 예약" onClick={onSimple} />
      <nav className="sb-nav" aria-label="화면">
        {nav.map((v) => (
          <a
            key={v.id}
            href={`#/${v.id}`}
            className={view === v.id ? "on" : ""}
            title={v.label}
            aria-label={v.label}
            aria-keyshortcuts={v.shortcut}
            onClick={() => onPick(v.id)}
          >
            <v.icon size={18} strokeWidth={view === v.id ? 2.3 : 1.9} />
            <span className="sb-lab">{v.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}

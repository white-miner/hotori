import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, FileStack, LayoutGrid, Settings as Gear, ShoppingBag, Wallet } from "lucide-react";
import { configured, supabase } from "./supabase";
import { createHotel, loadMyHotelId, useHotelData, useHotelNotices, useRoomMemos } from "./data";
import { type Booking, businessDate, checkOut, dayLabel, earlyOutUndoBlock, isEarlyOut } from "../shared/ledger";
import { badgeCountLabel, openForHandoff } from "../shared/roomMemo";
import { unresolvedNoticeCount } from "../shared/hotelNotice";
import { ISSUANCE_COPY } from "../shared/hotelDocuments";
import { Brand, isTypingTarget, lookups } from "./ui";
import { HeaderCTA } from "./primitives/HeaderCTA";
import AuthScreen from "./Auth";
import Dashboard from "./Dashboard";
import Entry from "./Entry";
import HandoverAlertsPanel from "./HandoverAlertsPanel";
import TangleInbox from "./TangleInbox";
import ManagementRecords from "./ManagementRecords";
import { useTangles } from "./useTangles";
import { useOpenFollow } from "./useOpenFollow";
import { applyCheckoutMany, applyTangleFix } from "./tangleFix";
import NoticesHubPanel, { type NoticesHubTab } from "./NoticesHubPanel";
import SimpleBooking from "./SimpleBooking";
import { ExpensesPage } from "./Expenses";
import Ledger from "./Ledger";
import Issuance from "./Issuance";
import Settings from "./Settings";
import Shop from "./Shop";
import { AccountMenu, AppTopBar, SidebarTop, TopAlerts, type SbNavItem, type TopAlertsProps } from "./SidebarParts";
import { Sidebar, SidebarProvider, useSidebarState } from "./Sidebar";

type View = "board" | "ledger" | "expenses" | "shop" | "issuance" | "settings";
/** 데스크톱 텍스트 내비: 설정은 우측 톱니로 이동 (공지와 자리 교체) */
const NAV_VIEWS: { id: View; label: string }[] = [
  { id: "board", label: "보드" },
  { id: "shop", label: "매점" },
  { id: "expenses", label: "지출" },
  { id: "ledger", label: "장부" },
  { id: "issuance", label: ISSUANCE_COPY.viewLabel },
];
const TAB_VIEWS: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: "board", label: "보드", icon: LayoutGrid },
  { id: "shop", label: "매점", icon: ShoppingBag },
  { id: "expenses", label: "지출", icon: Wallet },
  { id: "ledger", label: "장부", icon: BookOpen },
  { id: "issuance", label: ISSUANCE_COPY.viewLabel, icon: FileStack },
  { id: "settings", label: "설정", icon: Gear },
];
/** 사이드바 화면 이동 (같은 5개 · 같은 순서) */
const SB_NAV: SbNavItem[] = NAV_VIEWS.map((v) => ({ ...v, icon: TAB_VIEWS.find((t) => t.id === v.id)!.icon, shortcut: v.id === "shop" ? "M" : undefined }));
const viewFromHash = (): View => {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";
  return h === "ledger" || h === "expenses" || h === "settings" || h === "shop" || h === "issuance" ? h : "board";
};

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!configured)
    return <div className="center-msg">서버 연결 설정이 없어요. 관리자에게 알려 주세요.</div>;
  if (session === undefined) return <div className="center-msg">불러오는 중…</div>;
  if (!session) return <AuthScreen />;
  return <HotelGate session={session} />;
}

function HotelGate({ session }: { session: Session }) {
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let id = await loadMyHotelId();
        if (!id) id = await createHotel(String(session.user.user_metadata?.hotel_name ?? "우리 호텔"));
        if (alive) setHotelId(id);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "호텔 정보를 불러오지 못했어요");
      }
    })();
    return () => {
      alive = false;
    };
  }, [session.user.id]);
  if (err)
    return (
      <div className="center-msg">
        {err}
        <button className="btn" onClick={() => location.reload()}>
          다시 시도
        </button>
      </div>
    );
  if (!hotelId) return <div className="center-msg">호텔 정보를 불러오는 중…</div>;
  return <Shell hotelId={hotelId} email={session.user.email ?? ""} userId={session.user.id} />;
}

export interface EntryRequest {
  booking?: Booking; // 수정
  preset?: Partial<Booking>; // 신규 등록
  n?: number;
  night?: string; // 객실 배치에서 열었으면 그 밤 (위에 '객실 이동' 단추)
  /** 「현황」 빠른 액션: 예약 창을 열고 1박 연장 패널을 바로 펴요 */
  openExtend?: boolean;
  /** 「현황」 사이드: +추가금 시트 바로 펴요 (1박 연장과 분리) */
  openSurcharge?: boolean;
  /** 객실 카드 인원 버튼: 기존 예약 수정의 인원 항목으로 바로 이동 */
  openGuests?: boolean;
  /** 상태 변경 모달에서 기존 중도 퇴실·잔액 처리 폼으로 직접 이동 */
  openEarlyOut?: boolean;
  /** 간단 예약 축약 폼 (미배정/즉시 배정) */
  simple?: boolean;
  /** 「현황」공실 복수선택 → Path B 호실 prefill (다타입 OK · #70) */
  roomIds?: string[];
}
/** 현황에서 빈/점유 방을 눌러 옮기는 중: 예약 id와 보던 밤 */
export interface BoardMove {
  id: string;
  night: string;
}
export interface ToastOpt {
  action?: { label: string; run: () => void };
  ms?: number;
}

function Shell({ hotelId, email, userId }: { hotelId: string; email: string; userId: string }) {
  const data = useHotelData(hotelId);
  const memos = useRoomMemos(hotelId);
  const notices = useHotelNotices(hotelId, userId);
  const [view, setView] = useState<View>(viewFromHash);
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [today, setToday] = useState(businessDate());
  const [selDate, setSelDate] = useState(today);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const sb = useSidebarState(menu, closeMenu);
  const [toast, setToast] = useState<{ m: string; opt?: ToastOpt; n: number } | null>(null);
  const [boardMove, setBoardMove] = useState<BoardMove | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [tangleOpen, setTangleOpen] = useState(false);
  const [noticesTab, setNoticesTab] = useState<NoticesHubTab | null>(null);
  /** `/` → 장부 통합 이용내역 검색 포커스 */
  const ledgerSearchRef = useRef<HTMLInputElement>(null);
  const [ledgerFocusTick, setLedgerFocusTick] = useState(0);
  const handoffOpen = useMemo(() => openForHandoff(memos.list ?? []), [memos.list]);
  const issueBadge = badgeCountLabel(handoffOpen.issues.length);
  const noticeBadge = badgeCountLabel(unresolvedNoticeCount(notices.list ?? []));

  useEffect(() => {
    const on = () => setView(viewFromHash());
    window.addEventListener("hashchange", on);
    const t = setInterval(() => setToday(businessDate()), 60000);
    return () => {
      window.removeEventListener("hashchange", on);
      clearInterval(t);
    };
  }, []);
  const go = (v: View) => {
    location.hash = `#/${v}`;
    setView(v);
    setMenu(false);
  };
  // 로고 → 처음 화면: 현황판 › 「현황」(현장) · 오늘, 열린 창·검색·필터를 닫고 비워요 (새로 고침 없이)
  const [home, setHome] = useState(0);
  const goHome = () => {
    const d = businessDate();
    setEntry(null);
    setMenu(false);
    setBoardMove(null);
    setQuery("");
    setToday(d);
    setSelDate(d);
    try {
      localStorage.setItem("hotori.boardTab", "now");
      localStorage.setItem("hotori.boardBuilding", "all"); // 건물 필터도 '전체'로
    } catch {
      /* 개인 정보 보호 모드 */
    }
    if (location.hash !== "#/board/now") history.pushState(history.state, "", `${location.pathname}${location.search}#/board/now`);
    setView("board");
    setHome((n) => n + 1); // 현황판을 새로 그려 층·기간·고른 방 같은 화면 상태를 처음으로
    window.scrollTo({ top: 0 });
  };
  const notify = useCallback((m: string, opt?: ToastOpt) => {
    const n = Date.now() + Math.random();
    setToast({ m, opt, n });
    setTimeout(() => setToast((x) => (x?.n === n ? null : x)), opt?.ms ?? 2600);
  }, []);
  useOpenFollow(data, today, notify, !data.hotel?.isDemo);
  const tangles = useTangles(data, hotelId, today, notify);
  const tangleLabel = useCallback(
    (id: string | null | undefined) => (id && data.hotel?.settings ? lookups(data.hotel.settings).roomLabel(id) ?? id : "?"),
    [data.hotel?.settings],
  );
  const openNew = useCallback((preset?: Partial<Booking>) => setEntry({ preset, n: Date.now() }), []);
  const openSimple = useCallback(
    (preset?: Partial<Booking>, opts?: { roomIds?: string[] }) =>
      setEntry({ preset, roomIds: opts?.roomIds, simple: true, n: Date.now() }),
    [],
  );
  // 조기 퇴실 되돌리기 (예약 창 단추·알림의 되돌리기): 비운 밤이 다시 팔렸으면 막아요
  const bkRef = useRef(data.bookings);
  bkRef.current = data.bookings;
  const hotelRef = useRef(data.hotel);
  hotelRef.current = data.hotel;
  const undoEarlyOut = useCallback(
    async (id: string): Promise<boolean> => {
      const b = bkRef.current.find((x) => x.id === id);
      const s = hotelRef.current?.settings;
      if (!b || !s || !isEarlyOut(b)) return false;
      const block = earlyOutUndoBlock(s, bkRef.current, b, lookups(s).roomLabel);
      if (block) {
        notify(block, { ms: 7000 });
        return false;
      }
      try {
        await data.setEarlyOut(id, null, null);
        notify(`${b.guestName} 님 조기 퇴실을 되돌렸어요 · 원래대로 ${dayLabel(checkOut(b))} 퇴실`);
        return true;
      } catch (e) {
        notify(e instanceof Error ? `되돌리지 못했어요: ${e.message}` : "되돌리지 못했어요", { ms: 7000 });
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify, data.setEarlyOut],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (entry || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.code === "KeyN") {
        e.preventDefault();
        openSimple({ checkIn: selDate });
      } else if (e.code === "KeyM") {
        e.preventDefault();
        go("shop");
      } else if (e.key === "/") {
        e.preventDefault();
        if (view !== "ledger") {
          go("ledger");
          setLedgerFocusTick((n) => n + 1);
        } else {
          ledgerSearchRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, openSimple, selDate, view]);

  useEffect(() => {
    if (!ledgerFocusTick || view !== "ledger") return;
    const id = requestAnimationFrame(() => ledgerSearchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [ledgerFocusTick, view]);

  const { hotel } = data;
  if (!hotel)
    return <div className="center-msg">{data.error ? `불러오지 못했어요: ${data.error}` : "장부를 불러오는 중…"}</div>;

  // 특이사항·공지·확인 필요·설정: 모바일 헤더와 데스크톱 맨 위 가로 줄이 같은 단추 묶음을 쓴다
  const alertProps: TopAlertsProps = {
    issueBadge,
    issueCount: handoffOpen.issues.length,
    noticeBadge,
    noticeCount: unresolvedNoticeCount(notices.list ?? []),
    tangleBadge: badgeCountLabel(tangles.visible.length),
    tangleCount: tangles.visible.length,
    settingsOn: view === "settings",
    onIssues: () => {
      setNoticesTab(null);
      setIssuesOpen(true);
    },
    onNotices: () => {
      setIssuesOpen(false);
      setNoticesTab("notices");
    },
    onTangles: () => {
      setIssuesOpen(false);
      setNoticesTab(null);
      setTangleOpen(true);
    },
    onSettings: () => go("settings"),
  };
  const signOut = () => void supabase.auth.signOut();

  return (
    <SidebarProvider value={sb.ctx}>
    <div className={sb.active ? `app sb-active${sb.pinned ? " sb-pinned" : ""}` : "app"}>
      {sb.active ? null : (
      <header className="top">
        <Brand sub={hotel.name} onHome={goHome} />
        <nav className="nav">
          {NAV_VIEWS.map((v) => (
            <a
              key={v.id}
              href={`#/${v.id}`}
              className={view === v.id ? "on" : ""}
              onClick={() => setView(v.id)}
              aria-keyshortcuts={v.id === "shop" ? "M" : undefined}
            >
              {v.label}
            </a>
          ))}
        </nav>
        <div className="right">
          {hotel.isDemo ? <span className="demo">예시 데이터</span> : null}
          {data.error ? <span className="demo warn">연결 확인 중</span> : null}
          <TopAlerts {...alertProps} />
          <HeaderCTA onClick={() => openSimple({ checkIn: selDate })} />
          <AccountMenu email={email} open={menu} setOpen={setMenu} closeOnLeave onSignOut={signOut} />
        </div>
      </header>
      )}

      {sb.active ? (
        <>
          <AppTopBar
            hotelName={hotel.name}
            isDemo={!!hotel.isDemo}
            hasError={!!data.error}
            onHome={goHome}
            alerts={alertProps}
            account={{ email, open: menu, setOpen: setMenu, onSignOut: signOut }}
          />
          <Sidebar
            st={sb}
            top={<SidebarTop onSimple={() => openSimple({ checkIn: selDate })} nav={SB_NAV} view={view} onPick={(id) => setView(id as View)} />}
          />
        </>
      ) : null}

      {view === "board" ? (
        <Dashboard
          key={home}
          data={data}
          today={today}
          selDate={selDate}
          setSelDate={setSelDate}
          onOpen={(b, night, opts) => setEntry({ booking: b, night, openExtend: opts?.openExtend, openSurcharge: opts?.openSurcharge, openGuests: opts?.openGuests, openEarlyOut: opts?.openEarlyOut })}
          onNew={openNew}
          onSimple={openSimple}
          notify={notify}
          move={boardMove}
          onMoveStart={(m) => setBoardMove(m)}
          onMoveEnd={() => setBoardMove(null)}
        />
      ) : view === "ledger" ? (
        <Ledger
          data={data}
          hotelId={hotelId}
          today={today}
          query={query}
          setQuery={setQuery}
          searchRef={ledgerSearchRef}
          onOpen={(b, opts) => setEntry({ booking: b, openExtend: opts?.openExtend, openSurcharge: opts?.openSurcharge })}
          notify={notify}
        />
      ) : view === "issuance" ? (
        <Issuance data={data} hotelId={hotelId} today={today} notify={notify} />
      ) : view === "expenses" ? (
        <ExpensesPage data={data} hotelId={hotelId} today={today} notify={notify} />
      ) : view === "shop" ? (
        <Shop data={data} hotelId={hotelId} today={today} notify={notify} />
      ) : (
        <Settings data={data} email={email} notify={notify} />
      )}

      {view === "shop" || view === "expenses" ? null : (
        <HeaderCTA variant="fab" onClick={() => openSimple({ checkIn: selDate })} />
      )}
      {/* 휴대폰: 아래 탭으로 한 번에 이동 */}
      <nav className="tabbar" aria-label="화면">
        {TAB_VIEWS.map((v) => (
          <a key={v.id} href={`#/${v.id}`} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
            <v.icon size={20} strokeWidth={view === v.id ? 2.3 : 1.8} />
            {v.label}
          </a>
        ))}
      </nav>

      {entry?.simple ? (
        <SimpleBooking
          key={`simple-${entry.n ?? 0}`}
          data={data}
          today={today}
          req={entry}
          onClose={() => setEntry(null)}
          notify={notify}
          onOpenFull={(preset) => setEntry({ preset, n: Date.now() })}
          onSaved={(m) => {
            notify(m);
            setEntry(null);
          }}
        />
      ) : entry ? (
        <Entry
          key={entry.booking?.id ?? `new-${entry.n ?? 0}`}
          data={data}
          today={today}
          req={entry}
          onClose={() => setEntry(null)}
          notify={notify}
          undoEarlyOut={undoEarlyOut}
          onOpenSimple={(preset) => setEntry({ preset, simple: true, n: Date.now() })}
          onBoardMove={
            entry.night && entry.booking && view === "board"
              ? () => {
                  setBoardMove({ id: entry.booking!.id, night: entry.night! });
                  setEntry(null);
                }
              : undefined
          }
          onSaved={(m, again) => {
            notify(m);
            setEntry(again ? { preset: again, n: Date.now() } : null);
          }}
        />
      ) : null}
      {tangleOpen ? (
        <ManagementRecords records={memos.list} loadError={memos.error} onRefresh={memos.refresh} settings={hotel.settings} checkCount={tangles.visible.length}
          onClose={() => setTangleOpen(false)} onSave={memos.save} onSetStatus={memos.setStatus} notify={notify}
          checks={
        <TangleInbox
          embedded
          tangles={tangles.visible}
          ignoredCount={tangles.ignoredCount}
          onClose={() => setTangleOpen(false)}
          onIgnore={(l) => void tangles.ignore(l)}
          onRestore={() => void tangles.restoreAll()}
          onFix={async (t) => {
            try {
              const done = await applyTangleFix(data, t, data.bookings, tangleLabel, notify);
              if (!done) {
                const b = data.bookings.find((x) => x.id === t.ids[0]);
                if (b) {
                  setTangleOpen(false);
                  setEntry({ booking: b });
                }
              }
            } catch (e) {
              notify(e instanceof Error ? e.message : "고치지 못했어요");
            }
          }}
          onFixMany={async (l) => {
            try {
              await applyCheckoutMany(data, l, notify);
            } catch (e) {
              notify(e instanceof Error ? e.message : "일부를 처리하지 못했어요");
            }
          }}
        />
          } />
      ) : null}
      {issuesOpen && hotel.settings ? (
        <HandoverAlertsPanel
          stream="issues"
          list={memos.list ?? []}
          settings={hotel.settings}
          onClose={() => setIssuesOpen(false)}
          onSave={memos.save}
          onSetStatus={memos.setStatus}
          notify={notify}
        />
      ) : null}
      {noticesTab && hotel.settings ? (
        <NoticesHubPanel
          tab={noticesTab}
          onTab={setNoticesTab}
          notices={notices.list ?? []}
          memos={memos.list ?? []}
          settings={hotel.settings}
          email={email}
          onClose={() => setNoticesTab(null)}
          onSaveNotice={notices.save}
          onSetNoticeStatus={notices.setStatus}
          onRemoveNotice={notices.remove}
          onAckNotice={notices.ack}
          onSaveMemo={memos.save}
          onSetMemoStatus={memos.setStatus}
          notify={notify}
        />
      ) : null}
      {toast ? (
        <div className={`toast ${toast.opt?.action ? "act" : ""}`} role="status">
          {toast.m}
          {toast.opt?.action ? (
            <>
              <span className="tsep">·</span>
              <button
                type="button"
                className="tact"
                onClick={() => {
                  toast.opt!.action!.run();
                  setToast(null);
                }}
              >
                {toast.opt.action.label}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
    </SidebarProvider>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, LayoutGrid, LogOut, Menu, Plus, Search, Settings as Gear, ShoppingBag } from "lucide-react";
import { configured, supabase } from "./supabase";
import { createHotel, loadMyHotelId, useHotelData } from "./data";
import { type Booking, businessDate, checkOut, dayLabel, earlyOutUndoBlock, isEarlyOut } from "../shared/ledger";
import { Brand, isTypingTarget, lookups } from "./ui";
import AuthScreen from "./Auth";
import Dashboard from "./Dashboard";
import Entry from "./Entry";
import Ledger from "./Ledger";
import Settings from "./Settings";
import Shop from "./Shop";

type View = "board" | "ledger" | "shop" | "settings";
const VIEWS: { id: View; label: string; icon: typeof Search }[] = [
  { id: "board", label: "현황판", icon: LayoutGrid },
  { id: "ledger", label: "장부", icon: BookOpen },
  { id: "shop", label: "매점", icon: ShoppingBag },
  { id: "settings", label: "설정", icon: Gear },
];
const viewFromHash = (): View => {
  const h = location.hash.replace("#/", "");
  return h === "ledger" || h === "settings" || h === "shop" ? h : "board";
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
  return <Shell hotelId={hotelId} email={session.user.email ?? ""} />;
}

export interface EntryRequest {
  booking?: Booking; // 수정
  preset?: Partial<Booking>; // 새로 적기
  n?: number;
  night?: string; // 객실 배치에서 열었으면 그 밤 (위에 '객실 이동' 단추)
}
/** 객실 배치에서 빈 방을 눌러 옮기는 중: 예약 id와 보던 밤 */
export interface BoardMove {
  id: string;
  night: string;
}
export interface ToastOpt {
  action?: { label: string; run: () => void };
  ms?: number;
}

function Shell({ hotelId, email }: { hotelId: string; email: string }) {
  const data = useHotelData(hotelId);
  const [view, setView] = useState<View>(viewFromHash);
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [today, setToday] = useState(businessDate());
  const [selDate, setSelDate] = useState(today);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<{ m: string; opt?: ToastOpt; n: number } | null>(null);
  const [boardMove, setBoardMove] = useState<BoardMove | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
  const notify = useCallback((m: string, opt?: ToastOpt) => {
    const n = Date.now() + Math.random();
    setToast({ m, opt, n });
    setTimeout(() => setToast((x) => (x?.n === n ? null : x)), opt?.ms ?? 2600);
  }, []);
  const openNew = useCallback((preset?: Partial<Booking>) => setEntry({ preset, n: Date.now() }), []);
  // 중도 퇴실 되돌리기 (예약 창 단추·알림의 되돌리기): 비운 밤이 다시 팔렸으면 막아요
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
        notify(`${b.guestName} 님 중도 퇴실을 되돌렸어요 · 원래대로 ${dayLabel(checkOut(b))} 퇴실`);
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
        openNew({ checkIn: selDate });
      } else if (e.code === "KeyM") {
        e.preventDefault();
        go("shop");
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, openNew, selDate]);

  const { hotel } = data;
  if (!hotel)
    return <div className="center-msg">{data.error ? `불러오지 못했어요: ${data.error}` : "장부를 불러오는 중…"}</div>;

  const search = (q: string) => {
    setQuery(q);
    if (view !== "ledger") go("ledger");
  };

  return (
    <div className="app">
      <header className="top">
        <Brand sub={hotel.name} />
        <nav className="nav">
          {VIEWS.map((v) => (
            <a key={v.id} href={`#/${v.id}`} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
              {v.label}
              {v.id === "shop" ? <kbd className="nk">M</kbd> : null}
            </a>
          ))}
        </nav>
        <div className="right">
          {hotel.isDemo ? <span className="demo">예시 데이터</span> : null}
          {data.error ? <span className="demo warn">연결 확인 중</span> : null}
          <label className="search">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              placeholder="이름·플랫폼으로 찾기"
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), search(""))}
            />
            <kbd>/</kbd>
          </label>
          <button className="addbtn" onClick={() => openNew({ checkIn: selDate })}>
            <Plus size={17} strokeWidth={2.4} />
            예약 기록<kbd>N</kbd>
          </button>
          <div className="menu-wrap">
            <button className="av" aria-label="메뉴" onClick={() => setMenu((m) => !m)}>
              <span className="av-l">{(email[0] ?? "H").toUpperCase()}</span>
              <Menu className="av-m" size={18} />
            </button>
            {menu ? (
              <div className="pop" onMouseLeave={() => setMenu(false)}>
                <div className="pop-h">{email}</div>
                <button className="pop-i" onClick={() => void supabase.auth.signOut()}>
                  <LogOut size={15} /> 로그아웃
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {view === "board" ? (
        <Dashboard
          data={data}
          today={today}
          selDate={selDate}
          setSelDate={setSelDate}
          onOpen={(b, night) => setEntry({ booking: b, night })}
          onNew={openNew}
          notify={notify}
          move={boardMove}
          onMoveEnd={() => setBoardMove(null)}
        />
      ) : view === "ledger" ? (
        <Ledger data={data} hotelId={hotelId} today={today} query={query} setQuery={setQuery} onOpen={(b) => setEntry({ booking: b })} notify={notify} />
      ) : view === "shop" ? (
        <Shop data={data} hotelId={hotelId} today={today} notify={notify} />
      ) : (
        <Settings data={data} email={email} notify={notify} />
      )}

      {view === "shop" ? null : (
        <button className="fab" onClick={() => openNew({ checkIn: selDate })}>
          <Plus size={19} strokeWidth={2.4} />
          기록
        </button>
      )}
      {/* 휴대폰: 아래 탭으로 한 번에 이동 */}
      <nav className="tabbar" aria-label="화면">
        {VIEWS.map((v) => (
          <a key={v.id} href={`#/${v.id}`} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
            <v.icon size={20} strokeWidth={view === v.id ? 2.3 : 1.8} />
            {v.label}
          </a>
        ))}
      </nav>

      {entry ? (
        <Entry
          key={entry.booking?.id ?? `new-${entry.n ?? 0}`}
          data={data}
          today={today}
          req={entry}
          onClose={() => setEntry(null)}
          notify={notify}
          undoEarlyOut={undoEarlyOut}
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
  );
}

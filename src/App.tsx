import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  Clock3,
  LoaderCircle,
  Menu,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type {
  AppState,
  CommandResult,
  CommandType,
  Reservation,
} from "../shared/types";
import { ReservationForm } from "./components/ReservationForm";
import { RoomPanel, type PanelState } from "./components/RoomPanel";
import { Brand, Dialog } from "./components/ui";
import {
  api,
  type CommandFn,
  type Ctx,
  type DayEvent,
  hm,
  isHourly,
  kindOf,
  kstDate,
  roomNumbers,
  roomView,
  type RoomView,
} from "./lib";
import { BuildingView, type Layout } from "./views/BuildingView";
import { GuestsView, ReservationsView, SettleView } from "./views/Pages";
import { SettingsView } from "./views/SettingsView";
import { eventAction, TimelineView } from "./views/TimelineView";

type Page =
  "building" | "timeline" | "reservations" | "guests" | "settle" | "settings";
const NAV: { id: Page; label: string; icon: typeof Building2 }[] = [
  { id: "building", label: "건물", icon: Building2 },
  { id: "timeline", label: "시간표", icon: Clock3 },
  { id: "reservations", label: "예약", icon: CalendarDays },
  { id: "guests", label: "손님", icon: Users },
  { id: "settle", label: "정산", icon: Receipt },
  { id: "settings", label: "설정", icon: Settings2 },
];
type Modal =
  | { kind: "reservation"; reservation?: Reservation }
  | { kind: "cancel"; reservation: Reservation }
  | { kind: "roomCreate" }
  | { kind: "member" }
  | null;
interface Toast {
  id: number;
  message: string;
  undoToken?: string;
  until?: number;
}

function useLayout(): Layout {
  const get = (): Layout =>
    window.innerWidth >= 1100 ? "pc" : window.innerWidth >= 700 ? "tab" : "mob";
  const [layout, setLayout] = useState<Layout>(get);
  useEffect(() => {
    const on = () => setLayout(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return layout;
}
const initialPage = (): Page => {
  const h = location.hash.replace("#", "") as Page;
  return NAV.some((n) => n.id === h) ? h : "building";
};

export default function App() {
  const layout = useLayout();
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<Page>(initialPage);
  const [date, setDate] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const loadRef = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  const load = useCallback(async (day?: string) => {
    const version = ++loadRef.current;
    setRefreshing(true);
    try {
      const value = await api<AppState>(
        `/api/state${day ? "?date=" + day : ""}`,
      );
      if (version !== loadRef.current) return;
      setOffset(Date.parse(value.serverNow) - Date.now());
      setState(value);
      setDate(value.selectedDate);
      setLoadError("");
    } catch (e) {
      if (version === loadRef.current) setLoadError((e as Error).message);
    } finally {
      if (version === loadRef.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  // 다른 기기에서 바꾼 내용도 30초마다 다시 불러와요.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlight.current && !modal)
        void load(date && state && date !== state.today ? date : undefined);
    }, 30000);
    return () => clearInterval(t);
  }, [load, date, state, modal]);
  useEffect(() => {
    if (!toast) return;
    const ms = toast.until ? Math.max(0, toast.until - Date.now()) : 4500;
    const timer = setTimeout(
      () => setToast((t) => (t?.id === toast.id ? null : t)),
      ms,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape" && !modal) {
        if (searchOpen) setSearchOpen(false);
        else if (panel) setPanel(null);
        else if (menuOpen) setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [searchOpen, panel, menuOpen, modal]);
  useEffect(() => {
    history.replaceState(null, "", `#${page}`);
  }, [page]);

  const command: CommandFn = async (type: CommandType, data, options = {}) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ type, data });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = pending.current.requestId;
    try {
      const result = await api<CommandResult>("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data, requestId }),
      });
      pending.current = null;
      if (options.close !== false) {
        setModal(null);
        setPanel(null);
      }
      setToast({
        id: Date.now(),
        message:
          result.undoToken && options.undoLabel
            ? options.undoLabel
            : result.message,
        undoToken: result.undoToken,
        until: result.undoToken ? Date.now() + 5000 : undefined,
      });
      await load(
        type === "demo.plan"
          ? undefined
          : page === "reservations"
            ? date
            : undefined,
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  async function undo(token: string) {
    setToast(null);
    await command("undo", { token }, { close: false });
  }
  function navigate(next: Page) {
    setPage(next);
    setMenuOpen(false);
    setPanel(null);
    setError("");
    if (next !== "reservations" && state && date !== state.today) void load();
    window.scrollTo({ top: 0 });
  }
  const now = tick + offset;
  const ctx: Ctx | null = useMemo(() => {
    if (!state) return null;
    const bd = kstDate(now - state.businessDayCutoffHour * 3600000);
    return { s: state, now, bd };
  }, [state, now]);
  const views = useMemo(() => {
    const m = new Map<string, RoomView>();
    if (ctx)
      for (const room of ctx.s.rooms) m.set(room.id, roomView(ctx, room));
    return m;
  }, [ctx]);

  if (!state || !ctx)
    return (
      <div className="startup">
        <Brand />
        <div className="wave" />
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <button className="btn solid" onClick={() => void load()}>
              다시 불러오기
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={18} /> 호텔의 하루를 준비하고
            있어요
          </p>
        )}
      </div>
    );
  const s = state;
  const openRoom = (roomId: string, tab: PanelState["tab"] = "guest") => {
    setError("");
    if (page !== "building" && page !== "timeline") setPage("building");
    setPanel({ roomId, tab });
  };
  const openReservation = (r?: Reservation) => {
    setError("");
    setModal({ kind: "reservation", reservation: r });
  };
  const quick = (
    v: RoomView,
    action: "checkin" | "checkout" | "cleanStart" | "cleanDone" | "open",
  ) => {
    const n = v.room.number;
    if (action === "open") return openRoom(v.room.id);
    if (action === "checkin" && v.next)
      void command(
        "reservation.checkin",
        { id: v.next.id, version: v.next.version },
        { undoLabel: `${n}호 ${v.next.guestName} 님 체크인했어요` },
      );
    if (action === "checkout" && v.stay)
      void command(
        "reservation.checkout",
        { id: v.stay.id, version: v.stay.version },
        { undoLabel: `${n}호 퇴실 처리했어요 · 청소 필요` },
      );
    if (action === "cleanStart")
      void command(
        "room.update",
        { id: v.room.id, version: v.room.version, cleaning: "cleaning" },
        { undoLabel: `${n}호 청소 시작` },
      );
    if (action === "cleanDone")
      void command(
        "room.update",
        { id: v.room.id, version: v.room.version, cleaning: "clean" },
        { undoLabel: `${n}호 청소 끝 · 판매 가능` },
      );
  };
  const onOpenEvent = (e: DayEvent) => {
    if (e.room) openRoom(e.room.id);
    else if (e.reservation) openReservation(e.reservation);
  };
  const onEventAction = (e: DayEvent) => {
    const a = eventAction(ctx, e);
    if (!a) return onOpenEvent(e);
    const room = e.room;
    if (e.kind === "cleanWait" && room)
      return void command(
        "room.update",
        { id: room.id, version: room.version, cleaning: "cleaning" },
        { undoLabel: `${room.number}호 청소 시작` },
      );
    if (e.kind === "cleanEnd" && room)
      return void command(
        "room.update",
        { id: room.id, version: room.version, cleaning: "clean" },
        { undoLabel: `${room.number}호 청소 끝` },
      );
    const r = e.reservation!;
    if (e.kind === "leave")
      return void command(
        "reservation.checkout",
        { id: r.id, version: r.version },
        { undoLabel: `${roomNumbers(s, r)}호 퇴실 처리했어요` },
      );
    if (a.label === "배정") return openReservation(r);
    return void command(
      "reservation.checkin",
      { id: r.id, version: r.version },
      { undoLabel: `${roomNumbers(s, r)}호 체크인했어요` },
    );
  };
  const panelNode = panel && (
    <RoomPanel
      ctx={ctx}
      views={views}
      panel={panel}
      setPanel={setPanel}
      busy={busy}
      error={error}
      command={command}
      onClose={() => !busy && (setPanel(null), setError(""))}
      onOpenReservation={(r) => openReservation(r)}
      sheet={layout !== "pc"}
    />
  );
  const inlinePanel = layout === "pc" && page === "building" && panel;
  const dockCta = page === "timeline" ? "대실 받기" : "체크인";
  return (
    <div className={`app ${layout}`}>
      {layout === "pc" ? (
        <header className="top">
          <button
            type="button"
            className="brand-btn"
            onClick={() => navigate("building")}
            aria-label="호토리 건물 화면"
          >
            <Brand sub={s.property.name} />
          </button>
          <nav className="nav" aria-label="주 메뉴">
            {NAV.map((n) => (
              <button
                type="button"
                key={n.id}
                className={page === n.id ? "on" : ""}
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => navigate(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="right">
            {s.property.demo && <span className="demo">예시 데이터</span>}
            <button
              type="button"
              className="searchbox"
              onClick={() => setSearchOpen(true)}
              aria-label="검색 열기 (Ctrl K)"
            >
              <Search size={15} />방 번호나 손님 이름
              <span className="kbd">Ctrl K</span>
            </button>
            <span className="av" title="호텔 운영자">
              운
            </span>
          </div>
        </header>
      ) : (
        <header className="top">
          <button
            type="button"
            className="brand-btn"
            onClick={() => navigate("building")}
            aria-label="호토리 건물 화면"
          >
            <Brand sub={layout === "tab" ? s.property.name : undefined} />
          </button>
          <div className="right">
            {s.property.demo && <span className="demo">예시 데이터</span>}
            {layout === "tab" && (
              <span className="page-pill">
                {NAV.find((n) => n.id === page)?.label}
              </span>
            )}
            <span className="av">운</span>
          </div>
        </header>
      )}
      <div className="horizon" />
      {loadError && (
        <div className="banner" role="alert">
          {loadError}
          <button onClick={() => void load()}>다시 시도</button>
        </div>
      )}
      {error && !modal && !panel && (
        <div className="banner" role="alert">
          {error}
          <button onClick={() => setError("")}>닫기</button>
        </div>
      )}
      <main className={`main-area page-${page}`}>
        {page === "building" && (
          <BuildingView
            ctx={ctx}
            views={views}
            layout={layout}
            selectedRoomId={panel?.roomId}
            busy={busy}
            onOpenRoom={(id) => openRoom(id)}
            onOpenEvent={onOpenEvent}
            quick={quick}
            command={command}
            side={
              inlinePanel ? (
                <aside className="panel">{panelNode}</aside>
              ) : undefined
            }
          />
        )}
        {page === "timeline" && (
          <TimelineView
            ctx={ctx}
            views={views}
            layout={layout}
            busy={busy}
            onOpenRoom={(id, r) =>
              r && r.status === "checked_out"
                ? openReservation(r)
                : openRoom(id)
            }
            onSlot={(roomId, startMs) => (
              setError(""),
              setPanel({ roomId, mode: "hourly", startMs })
            )}
            onQuick={(mode) => (setError(""), setPanel({ mode }))}
            onOpenEvent={onOpenEvent}
            onEventAction={onEventAction}
          />
        )}
        {page === "reservations" && (
          <ReservationsView
            s={s}
            date={date}
            onDate={(d) => void load(d)}
            refreshing={refreshing}
            onOpen={openReservation}
            onNew={() => openReservation()}
          />
        )}
        {page === "guests" && (
          <GuestsView s={s} now={now} onOpen={openReservation} />
        )}
        {page === "settle" && (
          <SettleView
            key={s.revision}
            s={s}
            goSettings={() => navigate("settings")}
          />
        )}
        {page === "settings" && (
          <SettingsView
            s={s}
            busy={busy}
            command={command}
            onRoomCreate={() => (
              setError(""),
              setModal({ kind: "roomCreate" })
            )}
            onMember={() => (setError(""), setModal({ kind: "member" }))}
            onOpenRoom={(id) => {
              setPage("building");
              setPanel({ roomId: id, tab: "room" });
            }}
          />
        )}
      </main>
      {panel && !inlinePanel && (
        <div
          className={`dim ${layout === "pc" ? "drawer-dim" : ""}`}
          onClick={(e) =>
            e.target === e.currentTarget && !busy && setPanel(null)
          }
        >
          <aside
            className={layout === "pc" ? "panel drawer" : "panel sheet"}
            role="dialog"
            aria-modal="true"
            aria-label="객실 패널"
          >
            {layout !== "pc" && <div className="grab" />}
            {panelNode}
          </aside>
        </div>
      )}
      {layout !== "pc" && (
        <div className="dock" role="navigation" aria-label="빠른 메뉴">
          <button
            type="button"
            className="d-i"
            aria-label="메뉴"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            className="d-s"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} />방 번호, 손님 이름
          </button>
          <button
            type="button"
            className="d-p"
            onClick={() => (
              setError(""),
              page !== "timeline" && page !== "building" && setPage("building"),
              setPanel(page === "timeline" ? { mode: "hourly" } : {})
            )}
          >
            <Plus size={18} strokeWidth={2.4} />
            {dockCta}
          </button>
        </div>
      )}
      {menuOpen && layout !== "pc" && (
        <div
          className="dim"
          onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}
        >
          <nav className="menu-sheet" aria-label="주 메뉴">
            <div className="grab" />
            <div className="menu-head">
              <Brand sub={s.property.name} />
              <button
                type="button"
                className="icb"
                aria-label="닫기"
                onClick={() => setMenuOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="menu-grid">
              {NAV.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={page === n.id ? "on" : ""}
                  aria-current={page === n.id ? "page" : undefined}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={20} />
                  {n.label}
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}
      {searchOpen && (
        <SearchPalette
          ctx={ctx}
          views={views}
          onClose={() => setSearchOpen(false)}
          onRoom={(id) => (setSearchOpen(false), openRoom(id))}
          onReservation={(r) => (setSearchOpen(false), openReservation(r))}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.undoToken ? "undo" : ""}`}
          role="status"
          key={toast.id}
        >
          <span>{toast.message}</span>
          {toast.undoToken && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void undo(toast.undoToken!)}
            >
              <RotateCcw size={14} />
              되돌리기
            </button>
          )}
          <button
            type="button"
            className="x"
            aria-label="알림 닫기"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
          {toast.undoToken && <i className="countdown" />}
        </div>
      )}
      {modal && (
        <Dialog
          wide={modal.kind === "reservation"}
          title={
            modal.kind === "reservation"
              ? modal.reservation
                ? `${modal.reservation.guestName} 님 ${kindOf(modal.reservation)}`
                : "새 숙박 예약"
              : modal.kind === "cancel"
                ? "예약을 취소할까요?"
                : modal.kind === "member"
                  ? "구성원 등록"
                  : "객실 등록"
          }
          sub={
            modal.kind === "reservation" && modal.reservation
              ? `${roomNumbers(s, modal.reservation) || "방 배정 전"}${isHourly(modal.reservation) ? ` · ${hm(modal.reservation.startAt!)}–${hm(modal.reservation.endAt!)}` : ` · ${modal.reservation.checkIn} → ${modal.reservation.checkOut}`}`
              : undefined
          }
          onClose={() => !busy && (setModal(null), setError(""))}
          busy={busy}
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "reservation" && (
            <ReservationForm
              key={modal.reservation?.id || "new"}
              state={s}
              reservation={modal.reservation}
              busy={busy}
              command={command}
              now={now}
              onCancel={(r) => setModal({ kind: "cancel", reservation: r })}
            />
          )}
          {modal.kind === "cancel" && (
            <>
              <p className="helper big">
                <strong>{modal.reservation.guestName}</strong>님의{" "}
                {modal.reservation.checkIn} {kindOf(modal.reservation)} 예약을
                취소해요. 취소하면 그 방을 다시 팔 수 있어요.
              </p>
              <div className="form-actions">
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    setModal({
                      kind: "reservation",
                      reservation: modal.reservation,
                    })
                  }
                >
                  돌아가기
                </button>
                <button
                  className="btn coral"
                  disabled={busy}
                  onClick={() =>
                    void command(
                      "reservation.cancel",
                      {
                        id: modal.reservation.id,
                        version: modal.reservation.version,
                      },
                      { undoLabel: "예약을 취소했어요" },
                    )
                  }
                >
                  예약 취소 확정
                </button>
              </div>
            </>
          )}
          {modal.kind === "roomCreate" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void command("room.create", {
                  number: f.get("number"),
                  building: f.get("building"),
                  floor: Number(f.get("floor")),
                  typeId: f.get("typeId"),
                });
              }}
            >
              <p className="helper">
                현재 {s.rooms.length}실 등록 ·{" "}
                {s.plan === "free"
                  ? "무료 최대 20실"
                  : "프로 객실 수 제한 없음"}
              </p>
              <div className="fields two">
                <label className="flabel2">
                  객실 번호
                  <input
                    name="number"
                    required
                    maxLength={20}
                    placeholder="예: 501"
                  />
                </label>
                <label className="flabel2">
                  건물동
                  <input
                    name="building"
                    required
                    defaultValue={s.rooms[0]?.building || "본관"}
                    maxLength={30}
                  />
                </label>
                <label className="flabel2">
                  층
                  <input
                    name="floor"
                    type="number"
                    required
                    step={1}
                    min={-10}
                    max={200}
                    defaultValue={5}
                  />
                </label>
                <label className="flabel2">
                  객실 타입
                  <select name="typeId">
                    {s.roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button className="btn solid" disabled={busy}>
                  {busy ? "등록 중…" : "객실 등록"}
                </button>
              </div>
            </form>
          )}
          {modal.kind === "member" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void command("member.create", {
                  name: f.get("name"),
                  role: f.get("role"),
                });
              }}
            >
              <p className="helper">
                등록된 구성원은 데모 호텔의 업무·근무 기록에 쓰여요.
              </p>
              <div className="fields two">
                <label className="flabel2">
                  이름
                  <input
                    name="name"
                    required
                    maxLength={40}
                    placeholder="구성원 이름"
                  />
                </label>
                <label className="flabel2">
                  역할
                  <select name="role">
                    <option value="front">프런트</option>
                    <option value="manager">매니저</option>
                    <option value="housekeeping">객실관리</option>
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button className="btn solid" disabled={busy}>
                  {busy ? "저장 중…" : "구성원 등록"}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </div>
  );
}

function SearchPalette({
  ctx,
  views,
  onClose,
  onRoom,
  onReservation,
}: {
  ctx: Ctx;
  views: Map<string, RoomView>;
  onClose: () => void;
  onRoom: (id: string) => void;
  onReservation: (r: Reservation) => void;
}) {
  const { s } = ctx;
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const term = q.trim().toLocaleLowerCase();
  const rooms = term
    ? s.rooms
        .filter(
          (r) =>
            r.number.toLocaleLowerCase().includes(term) ||
            (r.label || "").toLocaleLowerCase().includes(term),
        )
        .slice(0, 6)
    : [];
  const people = term
    ? s.reservations
        .filter(
          (r) =>
            r.status !== "cancelled" &&
            `${r.guestName} ${r.phone}`.toLocaleLowerCase().includes(term),
        )
        .sort(
          (a, b) =>
            Number(b.status === "checked_in") -
              Number(a.status === "checked_in") ||
            b.checkIn.localeCompare(a.checkIn),
        )
        .slice(0, 8)
    : [];
  const items: ({ t: "room"; id: string } | { t: "res"; r: Reservation })[] = [
    ...rooms.map((r) => ({ t: "room" as const, id: r.id })),
    ...people.map((r) => ({ t: "res" as const, r })),
  ];
  const go = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (it.t === "room") onRoom(it.id);
    else onReservation(it.r);
  };
  return (
    <div
      className="dim top"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="빠른 검색"
      >
        <label className="pal-in">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="방 번호나 손님 이름"
            aria-label="빠른 검색"
            onChange={(e) => (setQ(e.target.value), setIdx(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown")
                (e.preventDefault(),
                  setIdx(Math.min(items.length - 1, idx + 1)));
              if (e.key === "ArrowUp")
                (e.preventDefault(), setIdx(Math.max(0, idx - 1)));
              if (e.key === "Enter") go(idx);
              if (e.key === "Escape") onClose();
            }}
          />
          <span className="kbd">Esc</span>
        </label>
        <div className="pal-list">
          {!term && <p className="quiet">예: 302, 김하늘, 010-…</p>}
          {term && !items.length && (
            <p className="quiet">찾는 방이나 손님이 없어요.</p>
          )}
          {rooms.length > 0 && <h4>방</h4>}
          {rooms.map((r, i) => {
            const v = views.get(r.id)!;
            return (
              <button
                type="button"
                key={r.id}
                className={`pal-item ${idx === i ? "on" : ""}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(i)}
              >
                <span className={`rb num ${v.status}`}>{r.number}</span>
                <span className="pal-tx">
                  <b>
                    {r.number}호 · {v.typeName}
                    {r.label ? ` · ${r.label}` : ""}
                  </b>
                  <span>
                    {
                      {
                        use: `${v.kind} · ${v.stay?.guestName} 님`,
                        rsv: `예약 · ${v.next?.guestName} 님`,
                        vac: "빈방 · 판매 가능",
                        cln: "청소",
                        chk: "점검",
                      }[v.status]
                    }
                  </span>
                </span>
              </button>
            );
          })}
          {people.length > 0 && <h4>손님</h4>}
          {people.map((r, j) => {
            const i = rooms.length + j;
            return (
              <button
                type="button"
                key={r.id}
                className={`pal-item ${idx === i ? "on" : ""}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(i)}
              >
                <span className="rb num use">
                  {roomNumbers(s, r).split(",")[0] || "—"}
                </span>
                <span className="pal-tx">
                  <b>{r.guestName}</b>
                  <span>
                    {kindOf(r)} ·{" "}
                    {isHourly(r)
                      ? `${r.checkIn} ${hm(r.startAt!)}`
                      : `${r.checkIn} → ${r.checkOut}`}{" "}
                    ·{" "}
                    {
                      {
                        confirmed: "예약",
                        checked_in: "투숙 중",
                        checked_out: "퇴실",
                        cancelled: "취소",
                      }[r.status]
                    }
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

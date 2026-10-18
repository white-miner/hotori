import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import {
  type BoardTab,
  type Booking,
  addDays,
  allOverbookings,
  boardTabFromHash,
  type StockPeriod,
  clampRange,
  dateList,
  isStockPeriod,
  shiftStockAnchor,
  stockRange,
  stockRangeLabel,
  isMultiBuilding,
  unassignedStays,
  dayLabel,
  allRooms,
  firstOverbooking,
  freeRooms,
  isActive,
  md,
  nightBoard,
  orderedFloors,
  stockLevel,
  stockTable,
  typeLabel,
  typeTotals,
  weekday,
  won,
  legsOf,
} from "../shared/ledger";
import { type HotelData, WINDOW_BACK, queryStays } from "./data";
import RoomCalendar from "./RoomCalendar";
import { DateChip, FitText, PlatBadge, Ring, TypeBadge, TypeLine, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  selDate: string;
  setSelDate: (d: string) => void;
  onOpen: (b: Booking) => void;
  onNew: (preset: Partial<Booking>) => void;
  notify: (m: string) => void;
  /** 현황 공유 링크: 보기만 해요 (고치기·입실 표시·방 배정·가격 없음) */
  readOnly?: boolean;
  /** 공유 보기에서 고를 수 있는 날짜 범위 */
  minDate?: string;
  maxDate?: string;
}
const DAYS = 14;
const nowLabel = () =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
const STATUS: Record<string, string> = { cancelled: "취소", noshow: "노쇼" };

/** 현황판 탭: 주소(#/board/stock · rooms · calendar)가 먼저, 없으면 이 기기에서 마지막으로 본 탭, 처음이면 재고 현황 */
const TAB_KEY = "hotori.boardTab";
const B_KEY = "hotori.boardBuilding";
const P_KEY = "hotori.stockPeriod";
const R_KEY = "hotori.stockRange";
const PERIODS: { id: StockPeriod; label: string }[] = [
  { id: "d14", label: "14일" },
  { id: "week", label: "주" },
  { id: "month", label: "월" },
  { id: "range", label: "기간" },
];
const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 개인 정보 보호 모드 */
  }
};
function useBoardTab(): [BoardTab, (t: BoardTab) => void] {
  const read = (): BoardTab => {
    const h = boardTabFromHash(location.hash);
    if (h) return h;
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v === "rooms" || v === "calendar" ? v : "stock";
    } catch {
      return "stock";
    }
  };
  const [tab, setTabState] = useState<BoardTab>(read);
  const remember = (x: BoardTab) => {
    try {
      localStorage.setItem(TAB_KEY, x);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  useEffect(() => {
    // 주소에 탭이 없으면(#/ · #/board) 지금 탭을 주소에 붙여 둬요 → 뒤로 가기가 탭 사이를 오가요
    const fill = (x: BoardTab) => {
      if (/^(#\/?|#\/board\/?)?$/.test(location.hash)) history.replaceState(history.state, "", `${location.pathname}${location.search}#/board/${x}`);
    };
    fill(read());
    const h0 = boardTabFromHash(location.hash);
    if (h0) remember(h0); // 주소로 바로 들어와도 이 탭을 기억해요
    const on = () => {
      const h = boardTabFromHash(location.hash);
      if (h) {
        setTabState(h);
        remember(h);
      } else fill(read());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setTab = (x: BoardTab) => {
    setTabState(x);
    remember(x);
    const want = `#/board/${x}`;
    if (location.hash !== want) location.hash = want; // 뒤로 가기로 탭을 돌아가요
    window.scrollTo({ top: 0 });
  };
  return [tab, setTab];
}

export default function Dashboard({ data, today, selDate, setSelDate: setSelRaw, onOpen: openRaw, onNew: newRaw, notify, readOnly = false, minDate, maxDate }: Props) {
  const setSelDate = (d: string) => setSelRaw(minDate && d < minDate ? minDate : maxDate && d > maxDate ? maxDate : d);
  const onOpen = readOnly ? () => {} : openRaw;
  const onNew = readOnly ? () => {} : newRaw;
  const act = readOnly ? {} : { role: "button" as const, tabIndex: 0 };
  const [tab, setTab] = useBoardTab();
  const s = data.hotel!.settings;
  const { bookings } = data;
  const L = useMemo(() => lookups(s), [s]);
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  // 건물 탭(전체·건물별): 두 탭이 같이 쓰고, 이 기기에서 마지막으로 고른 건물을 기억해요
  const [bTab, setBTabState] = useState<string>(() => {
    try {
      return localStorage.getItem(B_KEY) ?? "all";
    } catch {
      return "all";
    }
  });
  const setBTab = (id: string) => {
    setBTabState(id);
    try {
      localStorage.setItem(B_KEY, id);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  const multi = isMultiBuilding(s);
  const bScope = multi && s.buildings.some((x) => x.id === bTab) ? bTab : "all";
  const scopeId = bScope === "all" ? null : bScope;
  const tableAll = useMemo(() => stockTable(s, bookings, dates), [s, bookings, dates]);
  const table = useMemo(() => (scopeId ? stockTable(s, bookings, dates, scopeId) : tableAll), [s, bookings, dates, scopeId, tableAll]);
  const totals = useMemo(() => typeTotals(s, scopeId), [s, scopeId]);
  const over = firstOverbooking(s, table, dates);
  const overs = useMemo(() => allOverbookings(s, table, dates), [s, table, dates]);
  // 건물 하나를 보는 중이어도 호텔 전체에 오버부킹이 있으면 알려 줘요 (방 미배정 숙박 때문일 수 있어요)
  const overAll = scopeId ? firstOverbooking(s, tableAll, dates) : over;
  const oversAll = useMemo(() => (scopeId ? allOverbookings(s, tableAll, dates) : overs), [s, tableAll, dates, scopeId, overs]);
  const unassigned = useMemo(() => (scopeId ? unassignedStays(s, bookings, dates) : 0), [s, bookings, dates, scopeId]);

  // 재고 현황 보는 기간: 14일(기본) · 주(월~일) · 월 · 기간. 고른 방식은 기기마다 기억해요. 공유 보기는 14일만.
  const [periodRaw, setPeriodRaw] = useState<StockPeriod>(() => {
    const v = lsGet(P_KEY);
    return isStockPeriod(v) ? v : "d14";
  });
  const period: StockPeriod = readOnly ? "d14" : periodRaw;
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustomRaw] = useState<{ from: string; to: string }>(() => {
    try {
      const v = JSON.parse(lsGet(R_KEY) ?? "null");
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}-\d{2}$/.test(v.to)) return clampRange(v.from, v.to);
    } catch {
      /* 무시 */
    }
    return { from: today, to: addDays(today, 29) };
  });
  const setCustom = (from: string, to: string) => {
    const c = clampRange(from, to);
    if (c.capped) notify(`기간은 최대 92일까지 볼 수 있어요. 끝 날짜를 ${dayLabel(c.to)}로 맞췄어요`);
    else if (c.swapped) notify("끝 날짜가 시작보다 앞이라 둘을 바꿔서 보여 드려요");
    setCustomRaw({ from: c.from, to: c.to });
    lsSet(R_KEY, JSON.stringify({ from: c.from, to: c.to }));
  };
  const setPeriod = (p: StockPeriod) => {
    setPeriodRaw(p);
    lsSet(P_KEY, p);
    setAnchor(today);
  };
  const view = readOnly ? { from: today, to: addDays(today, DAYS - 1) } : stockRange(period, anchor, custom);
  const viewDates = useMemo(() => dateList(view.from, view.to), [view.from, view.to]);
  const atToday = period === "range" ? custom.from === today : stockRange(period, today, custom).from === view.from;
  const shift = (dir: 1 | -1) => {
    if (period === "range") {
      const len = viewDates.length;
      const from = shiftStockAnchor("range", view.from, dir, custom);
      setCustom(from, addDays(from, len - 1));
    } else setAnchor(shiftStockAnchor(period, anchor, dir));
  };
  const goToday = () => {
    if (period === "range") setCustom(today, addDays(today, viewDates.length - 1));
    else setAnchor(today);
  };
  // 오래전 기간: 늘 들고 있는 예약(입실 오늘 − 120일부터)으로는 모자라서, 그 기간 숙박만 따로 불러와요
  const needOld = view.from < addDays(today, -(WINDOW_BACK - 90));
  const [old, setOld] = useState<{ key: string; list: Booking[] } | null>(null);
  const oldKey = `${view.from}~${view.to}`;
  useEffect(() => {
    if (!needOld || readOnly) return;
    let alive = true;
    queryStays(data.hotel!.id, view.from, view.to)
      .then((list) => alive && setOld({ key: oldKey, list }))
      .catch(() => alive && notify("지난 예약을 불러오지 못했어요. 잠시 뒤 다시 볼게요"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needOld, oldKey, data.syncedAt]);
  const viewLoading = needOld && old?.key !== oldKey;
  const viewBookings = needOld ? (old?.key === oldKey ? old.list : []) : bookings;
  const viewTable = useMemo(() => stockTable(s, viewBookings, viewDates, scopeId), [s, viewBookings, viewDates, scopeId]);
  const viewOvers = useMemo(() => allOverbookings(s, viewTable, viewDates), [s, viewTable, viewDates]);
  // 넓은 표(월·긴 기간): 오늘이 들어 있으면 오늘 열이 보이게 옆으로 밀어 둬요
  const wideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wideRef.current;
    if (!w || !w.classList.contains("wide")) return;
    const th = w.querySelector<HTMLElement>(".shead .th.td");
    const lab = w.querySelector<HTMLElement>(".shead .th.lab");
    if (!th) {
      w.scrollLeft = 0;
      return;
    }
    const x = th.getBoundingClientRect().left - w.getBoundingClientRect().left + w.scrollLeft - (lab?.offsetWidth ?? 0) - 8;
    w.scrollLeft = Math.max(0, x - 3 * th.offsetWidth); // 오늘 앞 사흘도 보이게
  }, [view.from, view.to, tab]);
  const board = useMemo(() => nightBoard(s, bookings, selDate), [s, bookings, selDate]);
  const roomCount = s.floors.reduce((n, f) => n + f.rooms.length, 0);
  const [floorTab, setFloorTab] = useState<string>("all");
  const [assigning, setAssigning] = useState<string | null>(null);
  const dayuseByRoom = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const d of board.dayuse) if (d.roomId && isActive(d)) m.set(d.roomId, [...(m.get(d.roomId) ?? []), d]);
    return m;
  }, [board.dayuse]);
  const dayTotal = bookings
    .filter((b) => isActive(b) && b.checkIn === selDate)
    .reduce((n, b) => n + b.price, 0);

  if (!s.types.length || !roomCount)
    return (
      <main className="page">
        <div className="empty-setup">
          <h1>먼저 우리 호텔 객실을 등록해 주세요</h1>
          <p>설정에서 층, 방 번호, 객실 타입, 플랫폼을 한 번만 적으면 바로 장부를 쓸 수 있어요.</p>
          {readOnly ? null : (
            <a className="btn red" href="#/settings">
              설정으로 가기
            </a>
          )}
        </div>
      </main>
    );

  const goRooms = (d: string) => {
    setSelDate(d);
    setTab("rooms");
  };
  const toggleArrived = (b: Booking) =>
    data.patchBooking(b.id, { arrived: !b.arrived }).catch(() => notify("입실 표시를 저장하지 못했어요"));
  const assign = (b: Booking, roomId: string) =>
    data
      .patchBooking(b.id, { roomId })
      .then(() => {
        setAssigning(null);
        notify(`${b.guestName} 님 → ${L.roomLabel(roomId)}호`);
      })
      .catch(() => notify("방을 배정하지 못했어요"));

  const stockCell = (typeId: string, d: string) => {
    const r = viewTable.get(typeId)?.get(d) ?? 0;
    const lv = stockLevel(r, totals.get(typeId) ?? 0, s.lowThreshold);
    return (
      <button key={d} className={`sc lv-${lv} ${d === selDate ? "selc" : ""} ${d === today ? "tdc" : ""}`} onClick={() => goRooms(d)} title={`${dayLabel(d)} 밤 객실 배치 보기`}>
        {r < 0 ? `−${-r}` : r}
        {lv === "over" ? <small>초과</small> : lv === "full" ? <small>만실</small> : null}
      </button>
    );
  };

  const roomCell = (r: (typeof s.floors)[number]["rooms"][number], fColor: string | null | undefined) => {
    const b = board.byRoom.get(r.id);
    const t = r.typeId ? L.types.get(r.typeId) : null;
    const du = dayuseByRoom.get(r.id) ?? [];
    const strip = r.color ?? fColor ?? null;
    const k = /^\d+$/.test(r.no) ? "" : "k";
    const head = (
      <div className={`r1 ${strip ? "strip" : ""}`} style={strip ? { background: strip } : undefined}>
        <FitText className={`no ${k}`} text={r.no} />
      </div>
    );
    const tline = <TypeLine t={t} />;
    const duTags = du.map((d) => (
      <span key={d.id} className="du">
        대실 {d.startTime}~{d.endTime}
      </span>
    ));
    if (!b)
      return (
        <div
          key={r.id}
          {...act}
          className={`cell em ${du.length ? "duc" : ""} ${readOnly ? "ro" : ""}`}
          onClick={() => onNew({ checkIn: selDate, roomId: r.id, typeId: r.typeId ?? undefined })}
        >
          {head}
          {tline}
          <div className="emt">빈 방</div>
          {duTags.length ? <div className="dus">{duTags}</div> : null}
        </div>
      );
    const nth = Math.round((Date.parse(selDate) - Date.parse(b.checkIn)) / 864e5) + 1;
    const cancelled = !isActive(b);
    const sold = b.typeId !== r.typeId ? L.types.get(b.typeId) : null;
    // 객실 이동: 이 방 구간 앞뒤 방을 짧게 (예: 301→ · →305)
    const legs = legsOf(b);
    const li = legs.findIndex((l) => l.roomId === r.id && l.checkIn <= selDate && selDate < addDays(l.checkIn, l.nights));
    const no = (id: string | null | undefined) => (id ? (L.rooms.get(id)?.no ?? "?") : "?");
    const mvTag = legs.length > 1 && li >= 0 ? [li > 0 ? `${no(legs[li - 1].roomId)}→` : "", li < legs.length - 1 ? `→${no(legs[li + 1].roomId)}` : ""].filter(Boolean).join(" ") : null;
    return (
      <div
        key={r.id}
        {...act}
        className={`cell bk ${cancelled ? "cx" : du.length ? "st hasdu" : "st"} ${readOnly ? "ro" : ""}`}
        onClick={() => onOpen(b)}
      >
        {!cancelled && du.length ? (
          <span className="dumark" title={du.map((d) => `대실 ${d.startTime}~${d.endTime}`).join(" · ")}>
            <i>대실 </i>
            {du[0].startTime}
            {du.length > 1 ? <em> +{du.length - 1}</em> : null}
          </span>
        ) : null}
        {head}
        {tline}
        <div className="nm">
          <PlatBadge p={L.plats.get(b.platformId)} />
          <span>{b.guestName}</span>
        </div>
        <div className="r3 rp">
          {readOnly ? <span /> : <span className="pr">{won(b.price)}</span>}
          {cancelled ? <span className="cxt">{STATUS[b.status]}</span> : mvTag ? <span className="up mvt" title={`객실 이동 ${L.stayRoomLabel(b)}`}>{mvTag}</span> : sold ? <span className="up">{typeLabel(sold)}로 판매</span> : null}
        </div>
        <div className="r3">
          <span>{b.nights === 1 ? "1박" : `${b.nights}박 중 ${nth}박째`}</span>
          {cancelled ? null : readOnly ? (
            <Ring on={b.arrived} size={17} filled />
          ) : (
            <button
              className="ringbtn"
              aria-label="입실 표시"
              onClick={(e) => {
                e.stopPropagation();
                void toggleArrived(b);
              }}
            >
              <Ring on={b.arrived} size={17} filled />
            </button>
          )}
        </div>
        {cancelled && duTags.length ? <div className="dus">{duTags}</div> : null}
      </div>
    );
  };

  const scopeFloors = orderedFloors(s).filter((f) => f.rooms.length && (bScope === "all" || f.buildingId === bScope));
  const floors = scopeFloors.filter((f) => floorTab === "all" || floorTab === f.id);
  const groups = (multi ? s.buildings : s.buildings.slice(0, 1))
    .map((bd) => ({ bd, floors: multi ? floors.filter((f) => f.buildingId === bd.id) : floors }))
    .filter((g) => g.floors.length);
  const nightIn = (fl: typeof floors) => fl.reduce((n, f) => n + f.rooms.filter((r) => { const x = board.byRoom.get(r.id); return x && isActive(x); }).length, 0);
  const roomsIn = (fl: typeof floors) => fl.reduce((n, f) => n + f.rooms.length, 0);
  const activeDayuse = board.dayuse.filter(isActive).length;

  const tabs = (
    <div className="boardtabs seg" role="tablist" aria-label="현황판">
      <button role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>
        재고 현황
        {(over ? overs : oversAll).length ? (
          <span className="obdot num" aria-label={`오버부킹 ${(over ? overs : oversAll).length}건`}>
            {(over ? overs : oversAll).length}
          </span>
        ) : null}
      </button>
      <button role="tab" aria-selected={tab === "rooms"} className={tab === "rooms" ? "on" : ""} onClick={() => setTab("rooms")}>
        객실 배치
      </button>
      <button role="tab" aria-selected={tab === "calendar"} className={tab === "calendar" ? "on" : ""} onClick={() => setTab("calendar")}>
        객실 캘린더
      </button>
    </div>
  );
  // 오버부킹이 하나라도 있으면 두 탭 모두 맨 위에 빨간 알림 (누르면 재고 현황)
  const bName = (id: string) => (id === "all" ? "전체" : (L.buildings.get(id)?.name ?? ""));
  const shownOver = over ?? overAll;
  const shownOvers = over ? overs : oversAll;
  const banner = shownOver ? (
    <button
      className="ob-banner"
      role="alert"
      onClick={() => {
        if (!over) setBTab("all"); // 이 건물엔 없고 전체에 있으면 전체로
        setTab("stock");
      }}
    >
      <TriangleAlert size={18} strokeWidth={2.4} />
      <span>
        <b>
          {scopeId ? `${bName(over ? bScope : "all")} · ` : ""}
          {dayLabel(shownOver.date)} {typeLabel(shownOver.type)} {shownOver.over}실 초과
        </b>
        {shownOvers.length > 1 ? <span className="ob-more"> 외 {shownOvers.length - 1}건</span> : null}
        <span className="hl-tail"> — 메인 플랫폼에서 마감해 주세요</span>
      </span>
    </button>
  ) : null;
  const buildingTabs = multi ? (
    <div className="btabs" role="tablist" aria-label="건물">
      {["all", ...s.buildings.map((x) => x.id)].map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={bScope === id}
          className={bScope === id ? "on" : ""}
          title={bName(id)}
          onClick={() => {
            setBTab(id);
            if (floorTab !== "dayuse") setFloorTab("all");
          }}
        >
          <span className="bn">{bName(id)}</span>
          {id !== "all" ? <small>{roomsIn(orderedFloors(s).filter((f) => f.buildingId === id))}</small> : null}
        </button>
      ))}
    </div>
  ) : null;

  // 재고 현황과 객실 캘린더는 보는 기간(14일·주·월·기간)을 함께 써요
  const periodSeg = readOnly ? null : (
    <div className="seg period" role="tablist" aria-label="보는 기간">
      {PERIODS.map((p) => (
        <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  );
  const rangeNav = readOnly ? null : (
    <div className="rnav">
      <button className="ar" aria-label="이전" onClick={() => shift(-1)}>
        <ChevronLeft size={16} />
      </button>
      {period === "range" ? (
        <span className="rnav-r">
          <DateChip value={custom.from} label="시작 날짜" onChange={(v) => setCustom(v, custom.to < v ? v : custom.to)} />
          <span className="muted">~</span>
          <DateChip value={custom.to} label="끝 날짜" onChange={(v) => setCustom(custom.from, v)} />
        </span>
      ) : (
        <b className="rnav-l">{stockRangeLabel(period, view.from, view.to, today)}</b>
      )}
      <button className="ar" aria-label="다음" onClick={() => shift(1)}>
        <ChevronRight size={16} />
      </button>
      <button className="btn sm" disabled={atToday} onClick={goToday}>
        오늘
      </button>
      <span className="rnav-n muted">
        {period === "range" ? `${viewDates.length}일` : null}
        {viewLoading ? " 불러오는 중…" : null}
      </span>
      {viewOvers.length && !(period === "d14" && view.from === today) ? (
        <span className="rnav-o">이 기간 오버부킹 {viewOvers.length}건</span>
      ) : null}
    </div>
  );

  if (tab === "stock")
    return (
      <main className="page board-page one">
        <div className="main">
          {tabs}
          {banner}
          <div className="hl">
            <div>
              <div className="hl-t">
                <h1>재고 현황</h1>
                {periodSeg}
              </div>
              <div className="when">
                {nowLabel()} · 남은 객실{scopeId ? ` · ${bName(scopeId)}만` : ""}
              </div>
              {over ? null : <div className="hl-ok">앞으로 14일 오버부킹 없음</div>}
            </div>
            <div className="lg">
              <span>
                <i className="lv-ok bordered">5</i>여유
              </span>
              <span>
                <i className="lv-low">2</i>적음 ({s.lowThreshold}실 이하)
              </span>
              <span>
                <i className="lv-full">0</i>만실
              </span>
              <span>
                <i className="lv-over">−1</i>초과 (오버부킹)
              </span>
            </div>
          </div>

          {rangeNav}
          {buildingTabs}
          {scopeId && unassigned ? (
            <div className="b-note">방을 안 정한 숙박 {unassigned}건은 어느 건물인지 몰라서 '전체'에만 들어가요.</div>
          ) : null}
          <div ref={wideRef} className={`stock-wrap big ${viewDates.length > DAYS ? "wide" : ""}`}>
            <div className="stock" style={{ ["--days" as string]: viewDates.length }}>
              <div className="srow shead">
                <div className="th lab">객실 타입</div>
                {viewDates.map((d) => (
                  <button
                    key={d}
                    className={`th ${d === selDate ? "sel" : ""} ${d === today ? "td" : ""} ${["토", "일"].includes(weekday(d)) ? "we" : ""}`}
                    onClick={() => goRooms(d)}
                    title={`${dayLabel(d)} 밤 객실 배치 보기`}
                  >
                    <b>{md(d)}</b>
                    {d === today ? "오늘" : weekday(d)}
                  </button>
                ))}
              </div>
              {s.types.filter((t) => (totals.get(t.id) ?? 0) > 0 || (!scopeId && typeLabel(t))).map((t) => (
                <div className="srow" key={t.id}>
                  <div className="tn">
                    <TypeBadge t={t} />
                    <small>{totals.get(t.id) ?? 0}실</small>
                  </div>
                  {viewDates.map((d) => stockCell(t.id, d))}
                </div>
              ))}
              <div className="srow total">
                <div className="tn"><span className="tl-l">합계</span><span className="tl-s">합계</span></div>
                {viewDates.map((d) => (
                  <button key={d} className={`sc ${d === selDate ? "selc" : ""} ${["토", "일"].includes(weekday(d)) ? "we" : ""}`} onClick={() => goRooms(d)}>
                    {s.types.reduce((n, t) => n + Math.max(0, viewTable.get(t.id)?.get(d) ?? 0), 0)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="stock-hint">날짜나 숫자를 누르면 그날 밤 객실 배치로 가요</p>
        </div>
      </main>
    );

  if (tab === "calendar")
    return (
      <main className="page board-page one">
        <div className="main">
          {tabs}
          {banner}
          <div className="hl">
            <div>
              <div className="hl-t">
                <h1>객실 캘린더</h1>
                {periodSeg}
              </div>
              <div className="when">
                {nowLabel()} · 방마다 숙박 막대{scopeId ? ` · ${bName(scopeId)}만` : ""}
              </div>
            </div>
            <div className="lg cal-lg">
              <span><i className="lg-bar" />숙박</span>
              <span><i className="lg-bar cx" />취소·노쇼</span>
              <span><i className="lg-dot" />대실</span>
              <span><Ring on size={13} />입실 완료</span>
            </div>
          </div>
          {rangeNav}
          {buildingTabs}
          {scopeId && unassigned ? (
            <div className="b-note">방을 안 정한 숙박 {unassigned}건은 어느 건물인지 몰라서 '전체'에만 보여요.</div>
          ) : null}
          <RoomCalendar
            s={s}
            L={L}
            bookings={viewBookings}
            dates={viewDates}
            today={today}
            scopeId={scopeId}
            multi={multi}
            readOnly={readOnly}
            onOpen={onOpen}
            onNew={onNew}
          />
        </div>
      </main>
    );

  return (
    <main className="page board-page">
      <div className="main">
        {tabs}
        {banner}
        <div className="bdh">
          <div>
            <h1>객실 배치 현황</h1>
            <div className="bdh-s">{readOnly ? "보기 전용 · ◯는 입실 완료" : "칸을 누르면 예약을 고치고, ◯를 누르면 입실로 표시해요"}</div>
          </div>
          <div className="dnav">
            <span className="cnt-m">
              숙박 {board.nightCount}/{roomCount}
            </span>
            <button className="ar" aria-label="전날" onClick={() => setSelDate(addDays(selDate, -1))}>
              <ChevronLeft size={16} />
            </button>
            <span className="dn-day">{dayLabel(selDate)} 밤</span>
            <button className="ar" aria-label="다음날" onClick={() => setSelDate(addDays(selDate, 1))}>
              <ChevronRight size={16} />
            </button>
            <button className="btn sm" disabled={selDate === today} onClick={() => setSelDate(today)}>
              오늘
            </button>
          </div>
        </div>
        {buildingTabs}
        <div className="fchips">
          <button className={floorTab === "all" ? "on" : ""} onClick={() => setFloorTab("all")}>
            전체
          </button>
          {/* 건물이 여럿이면 위 건물 탭을 먼저 고르고, 그 건물의 층만 보여 줘요 */}
          {(multi && bScope === "all" ? [] : scopeFloors).map((f) => (
            <button key={f.id} className={floorTab === f.id ? "on" : ""} onClick={() => setFloorTab(f.id)}>
              {f.name}
            </button>
          ))}
          <button className={floorTab === "dayuse" ? "on" : ""} onClick={() => setFloorTab("dayuse")}>
            대실 {activeDayuse}
          </button>
        </div>
        {floorTab !== "dayuse"
          ? groups.map((g) => (
              <section className={multi ? "bsec" : undefined} key={g.bd.id}>
                {multi ? (
                  <div className="bsh">
                    <b title={bName(g.bd.id)}>{bName(g.bd.id)}</b>
                    <span>
                      숙박 {nightIn(g.floors)}/{roomsIn(g.floors)}
                    </span>
                  </div>
                ) : null}
                {g.floors.map((f) => (
                  <div className="floor" key={f.id}>
                    <div className="fl" title={f.name}>
                      <span className="fdot" style={f.color ? { background: f.color } : undefined} />
                      <span className="fln">{f.name}</span>
                    </div>
                    <div className="rooms">{f.rooms.map((r) => roomCell(r, f.color))}</div>
                  </div>
                ))}
              </section>
            ))
          : null}
      </div>

      <aside className={`side ${floorTab === "dayuse" ? "show-m" : ""}`}>
        <h3>
          {dayLabel(selDate)} 대실 <small>{activeDayuse}건 · 남은 객실에 포함되지 않아요</small>
        </h3>
        <div className="lst">
          {board.dayuse.length ? (
            board.dayuse.map((d) => (
              <div key={d.id} {...act} className={`it ${isActive(d) ? "" : "cx"}`} onClick={() => onOpen(d)}>
                <span className="tm">
                  {d.startTime}~{d.endTime}
                </span>
                <div className="md">
                  <b>
                    <PlatBadge p={L.plats.get(d.platformId)} />
                    <span className="gn">{d.guestName}</span>
                    {isActive(d) ? null : <span className="cxt">{STATUS[d.status]}</span>}
                  </b>
                  <span>
                    {d.roomId ? `${L.roomLabel(d.roomId) ?? "?"}호` : "방 미배정"} · {typeLabel(L.types.get(d.typeId)) || "?"}
                    {readOnly ? null : ` · ${won(d.price)}원`}
                  </span>
                </div>
                {isActive(d) && readOnly ? (
                  <Ring on={d.arrived} />
                ) : isActive(d) ? (
                  <button
                    className="ringbtn"
                    aria-label="입실 표시"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleArrived(d);
                    }}
                  >
                    <Ring on={d.arrived} />
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="it muted">이날 대실 기록이 없어요</div>
          )}
          {readOnly ? null : (
            <button className="add" onClick={() => onNew({ kind: "dayuse", checkIn: selDate })}>
              + 대실 기록
            </button>
          )}
        </div>

        <h3>
          방 미배정 숙박 <small>{board.unassigned.filter(isActive).length}건</small>
        </h3>
        <div className="lst">
          {board.unassigned.length ? (
            board.unassigned.map((b) => {
              const open = assigning === b.id;
              const free = open ? freeRooms(s, bookings, b) : null;
              const t = L.types.get(b.typeId);
              const options = free
                ? allRooms(s)
                    .filter((r) => free.has(r.id))
                    .sort((a, c) => Number(a.typeId !== b.typeId) - Number(c.typeId !== b.typeId))
                : [];
              return (
                <div key={b.id} className={`it col ${isActive(b) ? "" : "cx"}`}>
                  <div className="itr">
                    <div className="md" {...act} onClick={() => onOpen(b)}>
                      <b>
                        <TypeBadge t={t} />
                        <PlatBadge p={L.plats.get(b.platformId)} />
                        <span className="gn">{b.guestName}</span>
                        {isActive(b) ? null : <span className="cxt">{STATUS[b.status]}</span>}
                      </b>
                      <span>
                        {b.nights}박{readOnly ? "" : ` · ${won(b.price)}원`}{b.checkIn !== selDate ? ` · ${md(b.checkIn)} 입실` : ""}
                      </span>
                    </div>
                    {isActive(b) && !readOnly ? (
                      <button className="btn line sm" onClick={() => setAssigning(open ? null : b.id)}>
                        {open ? "닫기" : "방 배정"}
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="rpick">
                      {options.length ? (
                        options.slice(0, 24).map((r) => (
                          <button key={r.id} className={`rchip ${r.typeId !== b.typeId ? "other" : ""}`} title={L.roomLabel(r.id) ?? r.no} onClick={() => void assign(b, r.id)}>
                            {multi ? <em className="bpre">{L.buildings.get(r.buildingId)?.name}</em> : null}
                            {r.no}
                            {r.typeId !== b.typeId ? <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i> : null}
                          </button>
                        ))
                      ) : (
                        <span className="muted">그 기간에 빈 방이 없어요</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="it muted">모든 숙박에 방이 배정됐어요</div>
          )}
        </div>

        <div className="sum">
          <div>
            <span>{dayLabel(selDate)} 밤 숙박</span>
            <b>
              {board.nightCount}실 / {roomCount}실
            </b>
          </div>
          {readOnly ? null : (
            <div>
              <span>이날 입실 예약 금액</span>
              <b>{won(dayTotal)}원</b>
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import {
  type BoardTab,
  type Booking,
  addDays,
  allOverbookings,
  boardTabFromHash,
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
} from "../shared/ledger";
import type { HotelData } from "./data";
import { FitText, PlatBadge, Ring, TypeBadge, TypeLine, lookups } from "./ui";

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

/** 현황판 탭: 주소(#/board/stock · #/board/rooms)가 먼저, 없으면 이 기기에서 마지막으로 본 탭, 처음이면 재고 현황 */
const TAB_KEY = "hotori.boardTab";
const B_KEY = "hotori.boardBuilding";
function useBoardTab(): [BoardTab, (t: BoardTab) => void] {
  const read = (): BoardTab => {
    const h = boardTabFromHash(location.hash);
    if (h) return h;
    try {
      return localStorage.getItem(TAB_KEY) === "rooms" ? "rooms" : "stock";
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
    const r = table.get(typeId)?.get(d) ?? 0;
    const lv = stockLevel(r, totals.get(typeId) ?? 0, s.lowThreshold);
    return (
      <button key={d} className={`sc lv-${lv} ${d === selDate ? "selc" : ""}`} onClick={() => goRooms(d)} title={`${dayLabel(d)} 밤 객실 배치 보기`}>
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
          className={`cell em ${readOnly ? "ro" : ""}`}
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
    return (
      <div key={r.id} {...act} className={`cell bk ${cancelled ? "cx" : ""} ${readOnly ? "ro" : ""}`} onClick={() => onOpen(b)}>
        {head}
        {tline}
        <div className="nm">
          <PlatBadge p={L.plats.get(b.platformId)} />
          <span>{b.guestName}</span>
        </div>
        <div className="r3 rp">
          {readOnly ? <span /> : <span className="pr">{won(b.price)}</span>}
          {cancelled ? <span className="cxt">{STATUS[b.status]}</span> : sold ? <span className="up">{typeLabel(sold)}로 판매</span> : null}
        </div>
        <div className="r3">
          <span>{b.nights === 1 ? "1박" : `${b.nights}박 중 ${nth}박째`}</span>
          {cancelled ? null : readOnly ? (
            <Ring on={b.arrived} size={17} />
          ) : (
            <button
              className="ringbtn"
              aria-label="입실 표시"
              onClick={(e) => {
                e.stopPropagation();
                void toggleArrived(b);
              }}
            >
              <Ring on={b.arrived} size={17} />
            </button>
          )}
        </div>
        {duTags.length ? <div className="dus">{duTags}</div> : null}
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

  if (tab === "stock")
    return (
      <main className="page board-page one">
        <div className="main">
          {tabs}
          {banner}
          <div className="hl">
            <div>
              <h1>재고 현황</h1>
              <div className="when">
                {nowLabel()} · 오늘부터 14일 남은 객실{scopeId ? ` · ${bName(scopeId)}만` : ""}
              </div>
              {over ? null : <div className="hl-ok">오버부킹 없음</div>}
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

          {buildingTabs}
          {scopeId && unassigned ? (
            <div className="b-note">방을 안 정한 숙박 {unassigned}건은 어느 건물인지 몰라서 '전체'에만 들어가요.</div>
          ) : null}
          <div className="stock-wrap big">
            <div className="stock" style={{ ["--days" as string]: DAYS }}>
              <div className="srow">
                <div className="th lab">객실 타입</div>
                {dates.map((d) => (
                  <button key={d} className={`th ${d === selDate ? "sel" : ""}`} onClick={() => goRooms(d)} title={`${dayLabel(d)} 밤 객실 배치 보기`}>
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
                  {dates.map((d) => stockCell(t.id, d))}
                </div>
              ))}
              <div className="srow total">
                <div className="tn"><span className="tl-l">합계</span><span className="tl-s">합계</span></div>
                {dates.map((d) => (
                  <button key={d} className={`sc ${d === selDate ? "selc" : ""}`} onClick={() => goRooms(d)}>
                    {s.types.reduce((n, t) => n + Math.max(0, table.get(t.id)?.get(d) ?? 0), 0)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="stock-hint">날짜나 숫자를 누르면 그날 밤 객실 배치로 가요</p>
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

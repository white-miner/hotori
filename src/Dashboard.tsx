import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type Booking,
  addDays,
  dayLabel,
  firstOverbooking,
  freeRooms,
  isActive,
  md,
  nightBoard,
  stockLevel,
  stockTable,
  typeTotals,
  weekday,
  won,
} from "../shared/ledger";
import type { HotelData } from "./data";
import { PlatBadge, Ring, TypeBadge, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  selDate: string;
  setSelDate: (d: string) => void;
  onOpen: (b: Booking) => void;
  onNew: (preset: Partial<Booking>) => void;
  notify: (m: string) => void;
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

export default function Dashboard({ data, today, selDate, setSelDate, onOpen, onNew, notify }: Props) {
  const s = data.hotel!.settings;
  const { bookings } = data;
  const L = useMemo(() => lookups(s), [s]);
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  const table = useMemo(() => stockTable(s, bookings, dates), [s, bookings, dates]);
  const totals = useMemo(() => typeTotals(s), [s]);
  const over = firstOverbooking(s, table, dates);
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
          <a className="btn red" href="#/settings">
            설정으로 가기
          </a>
        </div>
      </main>
    );

  const toggleArrived = (b: Booking) =>
    data.patchBooking(b.id, { arrived: !b.arrived }).catch(() => notify("입실 표시를 저장하지 못했어요"));
  const assign = (b: Booking, roomId: string) =>
    data
      .patchBooking(b.id, { roomId })
      .then(() => {
        setAssigning(null);
        notify(`${b.guestName} 님 → ${L.rooms.get(roomId)?.no}호`);
      })
      .catch(() => notify("방을 정하지 못했어요"));

  const stockCell = (typeId: string, d: string) => {
    const r = table.get(typeId)?.get(d) ?? 0;
    const lv = stockLevel(r, totals.get(typeId) ?? 0, s.lowThreshold);
    return (
      <button key={d} className={`sc lv-${lv} ${d === selDate ? "selc" : ""}`} onClick={() => setSelDate(d)}>
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
        <span className={`no ${k}`}>{r.no}</span>
        <TypeBadge t={t} />
      </div>
    );
    const duTags = du.map((d) => (
      <span key={d.id} className="du">
        대실 {d.startTime}~{d.endTime}
      </span>
    ));
    if (!b)
      return (
        <div
          key={r.id}
          role="button"
          tabIndex={0}
          className="cell em"
          onClick={() => onNew({ checkIn: selDate, roomId: r.id, typeId: r.typeId ?? undefined })}
        >
          {head}
          <div className="emt">빈 방</div>
          {duTags.length ? <div className="dus">{duTags}</div> : null}
        </div>
      );
    const nth = Math.round((Date.parse(selDate) - Date.parse(b.checkIn)) / 864e5) + 1;
    const cancelled = !isActive(b);
    const sold = b.typeId !== r.typeId ? L.types.get(b.typeId) : null;
    return (
      <div key={r.id} role="button" tabIndex={0} className={`cell bk ${cancelled ? "cx" : ""}`} onClick={() => onOpen(b)}>
        {head}
        <div className="nm">
          <PlatBadge p={L.plats.get(b.platformId)} />
          <span>{b.guestName}</span>
        </div>
        <div className="r3 rp">
          <span className="pr">{won(b.price)}</span>
          {cancelled ? <span className="cxt">{STATUS[b.status]}</span> : sold ? <span className="up">판매 {sold.code}</span> : null}
        </div>
        <div className="r3">
          <span>{b.nights === 1 ? "1박" : `${b.nights}박 중 ${nth}번째`}</span>
          {cancelled ? null : (
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

  const floors = s.floors.filter((f) => f.rooms.length && (floorTab === "all" || floorTab === f.id));
  const activeDayuse = board.dayuse.filter(isActive).length;

  return (
    <main className="page board-page">
      <div className="main">
        <div className="hl">
          <div>
            <div className="when">{nowLabel()} · 앞으로 14일</div>
            <h1>
              {over ? (
                <>
                  <b>
                    {dayLabel(over.date)} {over.type.name} {over.over}실 초과
                  </b>
                  <span className="hl-tail"> — 메인 플랫폼에서 마감해 주세요</span>
                </>
              ) : (
                "오버부킹 없어요"
              )}
            </h1>
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
              <i className="lv-over">−1</i>초과 = 오버부킹
            </span>
          </div>
        </div>

        <div className="stock-wrap">
          <div className="stock" style={{ ["--days" as string]: DAYS }}>
            <div className="srow">
              <div className="th lab">남은 객실</div>
              {dates.map((d) => (
                <button key={d} className={`th ${d === selDate ? "sel" : ""}`} onClick={() => setSelDate(d)}>
                  <b>{md(d)}</b>
                  {d === today ? "오늘" : weekday(d)}
                </button>
              ))}
            </div>
            {s.types.map((t) => (
              <div className="srow" key={t.id}>
                <div className="tn">
                  <TypeBadge t={t} />
                  <span className="tname">{t.name}</span>
                  <small>{totals.get(t.id) ?? 0}실</small>
                </div>
                {dates.map((d) => stockCell(t.id, d))}
              </div>
            ))}
            <div className="srow total">
              <div className="tn"><span className="tl-l">전체 남은 방</span><span className="tl-s">전체</span></div>
              {dates.map((d) => (
                <button key={d} className={`sc ${d === selDate ? "selc" : ""}`} onClick={() => setSelDate(d)}>
                  {s.types.reduce((n, t) => n + Math.max(0, table.get(t.id)?.get(d) ?? 0), 0)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bdh">
          <h2>
            {dayLabel(selDate)} 밤 · 방 배치 <span>칸을 누르면 고치고, ◯는 한 번 눌러 입실 표시해요</span>
          </h2>
          <div className="dnav">
            <span className="cnt-m">
              숙박 {board.nightCount}/{roomCount}
            </span>
            <button className="ar" aria-label="전날" onClick={() => setSelDate(addDays(selDate, -1))}>
              <ChevronLeft size={16} />
            </button>
            <button className="btn sm" onClick={() => setSelDate(today)}>
              오늘
            </button>
            <button className="ar" aria-label="다음날" onClick={() => setSelDate(addDays(selDate, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="fchips">
          <button className={floorTab === "all" ? "on" : ""} onClick={() => setFloorTab("all")}>
            전체
          </button>
          {s.floors
            .filter((f) => f.rooms.length)
            .map((f) => (
              <button key={f.id} className={floorTab === f.id ? "on" : ""} onClick={() => setFloorTab(f.id)}>
                {f.name}
              </button>
            ))}
          <button className={floorTab === "dayuse" ? "on" : ""} onClick={() => setFloorTab("dayuse")}>
            대실 {activeDayuse}
          </button>
        </div>
        {floorTab !== "dayuse"
          ? floors.map((f) => (
              <div className="floor" key={f.id}>
                <div className="fl">
                  <span className="fdot" style={f.color ? { background: f.color } : undefined} />
                  {f.name}
                </div>
                <div className="rooms">{f.rooms.map((r) => roomCell(r, f.color))}</div>
              </div>
            ))
          : null}
      </div>

      <aside className={`side ${floorTab === "dayuse" ? "show-m" : ""}`}>
        <h3>
          {dayLabel(selDate)} 대실 <small>{activeDayuse}건 · 남은 객실 계산에는 안 들어가요</small>
        </h3>
        <div className="lst">
          {board.dayuse.length ? (
            board.dayuse.map((d) => (
              <div key={d.id} role="button" tabIndex={0} className={`it ${isActive(d) ? "" : "cx"}`} onClick={() => onOpen(d)}>
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
                    {d.roomId ? `${L.rooms.get(d.roomId)?.no ?? "?"}호` : "방 미정"} · {L.types.get(d.typeId)?.name ?? "?"} ·{" "}
                    {won(d.price)}원
                  </span>
                </div>
                {isActive(d) ? (
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
          <button className="add" onClick={() => onNew({ kind: "dayuse", checkIn: selDate })}>
            + 대실 기록
          </button>
        </div>

        <h3>
          방을 아직 안 정한 숙박 <small>{board.unassigned.filter(isActive).length}건</small>
        </h3>
        <div className="lst">
          {board.unassigned.length ? (
            board.unassigned.map((b) => {
              const open = assigning === b.id;
              const free = open ? freeRooms(s, bookings, b) : null;
              const t = L.types.get(b.typeId);
              const options = free
                ? s.floors
                    .flatMap((f) => f.rooms)
                    .filter((r) => free.has(r.id))
                    .sort((a, c) => Number(a.typeId !== b.typeId) - Number(c.typeId !== b.typeId))
                : [];
              return (
                <div key={b.id} className={`it col ${isActive(b) ? "" : "cx"}`}>
                  <div className="itr">
                    <div className="md" role="button" tabIndex={0} onClick={() => onOpen(b)}>
                      <b>
                        <TypeBadge t={t} />
                        <PlatBadge p={L.plats.get(b.platformId)} />
                        <span className="gn">{b.guestName}</span>
                        {isActive(b) ? null : <span className="cxt">{STATUS[b.status]}</span>}
                      </b>
                      <span>
                        {b.nights}박 · {won(b.price)}원{b.checkIn !== selDate ? ` · ${md(b.checkIn)} 입실` : ""}
                      </span>
                    </div>
                    {isActive(b) ? (
                      <button className="btn line sm" onClick={() => setAssigning(open ? null : b.id)}>
                        {open ? "닫기" : "방 정하기"}
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="rpick">
                      {options.length ? (
                        options.slice(0, 24).map((r) => (
                          <button key={r.id} className={`rchip ${r.typeId !== b.typeId ? "other" : ""}`} onClick={() => void assign(b, r.id)}>
                            {r.no}
                            {r.typeId !== b.typeId ? <i>{L.types.get(r.typeId ?? "")?.code}</i> : null}
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
            <div className="it muted">모두 방이 정해졌어요</div>
          )}
        </div>

        <div className="sum">
          <div>
            <span>{dayLabel(selDate)} 밤 숙박</span>
            <b>
              {board.nightCount}실 / {roomCount}실
            </b>
          </div>
          <div>
            <span>이날 입실 기록 합계</span>
            <b>{won(dayTotal)}원</b>
          </div>
        </div>
      </aside>
    </main>
  );
}

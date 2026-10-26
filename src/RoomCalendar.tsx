// 룸 타임라인: 방마다 한 줄, 날짜마다 한 칸. 숙박은 막대, 대실은 그날 칸의 작은 점.
// 칸을 하나하나 그리지 않고 줄마다 배경 격자 + 막대만 절대 위치로 그려요 (60실 × 92일도 가볍게).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BedDouble, CircleDot, Search, UserRoundX, X } from "lucide-react";
import { type Booking, type HotelSettings, addDays, dayLabel, isActive, isEarlyOut, isMoved, legsOf, md, orderedFloors, typeLabel, usedLabel, weekday, won } from "../shared/ledger";
import { type Bar, calendarLayout } from "../shared/calendar";
import { clampHours, inTimeOf, outTimeOf, turnoverWarnings } from "../shared/extratime";
import type { StayTimes } from "../shared/tiers";
import { paint, platformAbbr } from "../shared/platform";
import { pastelColor } from "../shared/floorColor";
import { parseGuestQuery, textMatchesGuest, type GuestSearchGroup } from "../shared/guestSearch";
import { Chip, ChipGroup } from "./primitives";
import { lookups } from "./ui";

type L = ReturnType<typeof lookups>;
const STATUS: Record<string, string> = { cancelled: "취소", noshow: "노쇼" };

/** 기간 내 행 글랜스 — 전체 | 점유만 | 빈 방만 | 충돌만 | 미배정만 */
type RowGlance = "all" | "occupied" | "empty" | "conflict" | "unassigned";

interface Props {
  s: HotelSettings;
  L: L;
  bookings: Booking[];
  dates: string[];
  today: string;
  scopeId: string | null;
  multi: boolean;
  readOnly: boolean;
  groups?: Map<string, GuestSearchGroup>;
  onOpen: (b: Booking) => void;
  onNew: (p: Partial<Booking>) => void;
}

function tip(b: Booking, L: L, readOnly: boolean): string {
  const p = L.plats.get(b.platformId)?.name ?? "";
  const st = isActive(b) ? (b.arrived ? " · 입실 완료" : "") : ` · ${STATUS[b.status] ?? ""}`;
  if (b.kind === "dayuse")
    return `대실 ${b.startTime ?? ""}~${b.endTime ?? ""} · ${b.guestName || "이름 없음"} · ${p}${readOnly ? "" : ` · ${won(b.price)}원`}${st}`;
  const mv = isMoved(b) ? ` · 객실 이동 ${legsOf(b).map((l) => `${L.roomLabel(l.roomId) ?? "?"} ${l.nights}박`).join(" → ")}` : "";
  const eo = isActive(b) && isEarlyOut(b) ? ` · ${md(b.earlyOut!)} 중도퇴실 (${usedLabel(b)})${!readOnly && b.refund ? ` · 환불 ${won(b.refund)}원` : ""}` : "";
  return `${b.guestName || "이름 없음"} · ${p} · ${b.nights}박 · ${md(b.checkIn)}~${md(addDays(b.checkIn, b.nights ?? 0))}${readOnly ? "" : ` · ${won(b.price)}원`}${mv}${st}${eo}`;
}

function bookingMatchesGuest(b: Booking, queryRaw: string, groups?: Map<string, GuestSearchGroup>): boolean {
  const q = parseGuestQuery(queryRaw);
  if (!q) return false;
  const g = b.groupId && groups ? groups.get(b.groupId) : undefined;
  return textMatchesGuest(q, b.guestName, b.guestPhone, b.groupName, g?.payerName);
}

const BarEl = memo(function BarEl({
  bar,
  cw,
  L,
  readOnly,
  onOpen,
  typeCode,
  times,
  warn,
  searchHit,
  searchDim,
}: {
  bar: Bar;
  cw: number;
  L: L;
  readOnly: boolean;
  onOpen: (b: Booking) => void;
  typeCode?: string;
  times: StayTimes;
  warn?: string;
  searchHit?: boolean;
  searchDim?: boolean;
}) {
  const { b, span } = bar;
  const legsN = legsOf(b).length;
  const eIn = isActive(b) && bar.leg.idx === 0 && !span.clipL && clampHours(b.earlyIn) ? inTimeOf({ stayTimes: times }, b) : null;
  const lOut = isActive(b) && bar.leg.idx === legsN - 1 && !span.clipR && !isEarlyOut(b) && clampHours(b.lateOut) ? outTimeOf({ stayTimes: times }, b) : null;
  const cx = !isActive(b);
  const p = L.plats.get(b.platformId);
  const px = span.len * cw;
  const arr = isActive(b) && b.arrived && !bar.freed;
  const c = paint(p);
  return (
    <div
      className={`cbar ${cx ? "cx" : ""} ${bar.prev !== undefined ? "mvi" : ""} ${bar.next !== undefined ? "mvo" : ""} ${arr ? "ok" : ""} ${bar.conflict ? "cf" : ""} ${bar.freed ? "eo" : ""} ${bar.endsEarly ? "eoe" : ""} ${span.clipL ? "cl" : ""} ${span.clipR ? "cr" : ""} ${readOnly ? "ro" : ""} ${searchHit ? "gs-hit" : ""} ${searchDim ? "gs-dim" : ""}`}
      style={{
        left: span.start * cw + (span.clipL ? 0 : 2),
        width: span.len * cw - (span.clipL ? 0 : 2) - (span.clipR ? 0 : 3),
        ["--pb" as string]: c.b,
        ["--pt" as string]: c.t,
      }}
      title={`${tip(b, L, readOnly)}${eIn ? ` · 빠른 입실 ${eIn}` : ""}${lOut ? ` · 늦은 퇴실 ${lOut}` : ""}${warn ? ` · ⚠ ${warn}` : ""}`}
      {...(readOnly ? {} : { role: "button", tabIndex: 0 })}
      onClick={readOnly ? undefined : (e) => (e.stopPropagation(), onOpen(b))}
      onKeyDown={readOnly ? undefined : (e) => e.key === "Enter" && onOpen(b)}
    >
      {bar.freed ? (
        <span className="cb-eo">{px >= 70 ? "중도 퇴실 · 빈 방" : "빈 방"}</span>
      ) : (
        <>
          {typeCode && px >= 80 ? <span className="cb-t">{typeCode}</span> : null}
          {bar.prev !== undefined ? (
            <span className="cb-mv" title={`${L.roomLabel(bar.prev) ?? "?"}호에서 옮겨 왔어요`}>
              {L.rooms.get(bar.prev ?? "")?.no ?? "?"}→
            </span>
          ) : null}
          {b.groupId ? (
            <span className="grptag" title={`단체 ${b.groupName ?? ""}`}>
              단체
            </span>
          ) : null}
          {warn ? <span className="ttag warn cb-w">!</span> : null}
          {eIn && px >= 76 ? <span className="ttag">{px >= 130 ? `빠른 ${eIn}` : eIn}</span> : null}
          <span className="cb-n">{b.guestName || "이름 없음"}</span>
          {lOut && px >= 76 ? <span className={`ttag ${eIn && px < 150 ? "hide" : ""}`}>{px >= 130 ? `늦은 ${lOut}` : lOut}</span> : null}
          {bar.next !== undefined ? (
            <span className="cb-mv nx" title={`다음 날 ${L.roomLabel(bar.next) ?? "?"}호로 옮겨요`}>
              →{L.rooms.get(bar.next ?? "")?.no ?? "?"}
            </span>
          ) : null}
          {px >= 96 ? <span className="cb-p">{platformAbbr(p)}</span> : null}
        </>
      )}
    </div>
  );
});

function Marks({
  m,
  cw,
  L,
  readOnly,
  onOpen,
  matchIds,
  searchOn,
}: {
  m?: Map<number, Booking[]>;
  cw: number;
  L: L;
  readOnly: boolean;
  onOpen: (b: Booking) => void;
  matchIds?: Set<string>;
  searchOn?: boolean;
}) {
  if (!m) return null;
  return (
    <>
      {[...m].map(([i, list]) => (
        <span key={i} className="cmarks" style={{ left: i * cw + cw - 4 }}>
          {list.slice(0, 3).map((d) => {
            const hit = !!searchOn && !!matchIds?.has(d.id);
            const dim = !!searchOn && !hit;
            return (
              <i
                key={d.id}
                className={`cdot ${isActive(d) ? (d.arrived ? "ok" : "") : "cx"} ${hit ? "gs-hit" : ""} ${dim ? "gs-dim" : ""}`}
                style={isActive(d) ? ((c) => ({ ["--pt" as string]: c.d, ["--pb" as string]: c.b }))(paint(L.plats.get(d.platformId))) : undefined}
                title={tip(d, L, readOnly)}
                onClick={readOnly ? undefined : (e) => (e.stopPropagation(), onOpen(d))}
              />
            );
          })}
        </span>
      ))}
    </>
  );
}

const GLANCE: { id: RowGlance; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "occupied", label: "점유만" },
  { id: "empty", label: "빈 방만" },
  { id: "conflict", label: "충돌만" },
  { id: "unassigned", label: "미배정만" },
];

export default function RoomCalendar({ s, L, bookings, dates, today, scopeId, multi, readOnly, groups, onOpen, onNew }: Props) {
  const from = dates[0];
  const to = dates[dates.length - 1];
  const lay = useMemo(() => calendarLayout(s, bookings, from, to, scopeId), [s, bookings, from, to, scopeId]);
  const warns = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of turnoverWarnings(s, bookings)) m.set(w.id, m.has(w.id) ? `${m.get(w.id)} · ${w.text}` : w.text);
    return m;
  }, [s, bookings]);

  const [typeIds, setTypeIds] = useState<Set<string>>(() => new Set());
  const [glance, setGlance] = useState<RowGlance>("all");
  const [guestLive, setGuestLive] = useState("");
  const [guestQ, setGuestQ] = useState("");
  const [guestComposing, setGuestComposing] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);
  const guestRef = useRef<HTMLInputElement>(null);
  const unRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (guestComposing) return;
    const t = window.setTimeout(() => setGuestQ(guestLive), 150);
    return () => window.clearTimeout(t);
  }, [guestLive, guestComposing]);

  const clearGuest = () => {
    setGuestLive("");
    setGuestQ("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!guestLive && !guestQ) return;
      e.preventDefault();
      clearGuest();
      guestRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guestLive, guestQ]);

  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const phone = w < 600;
  const longest = useMemo(() => {
    let m = 0;
    for (const r of L.rooms.values()) m = Math.max(m, [...r.no].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 1.0 : /[0-9]/.test(ch) ? 0.62 : 0.6), 0));
    return m;
  }, [L]);
  const lw = phone ? Math.min(96, Math.max(46, Math.ceil(longest * 14.5 + 18))) : Math.min(132, Math.max(64, Math.ceil(longest * 17 + 30)));
  const cw = Math.max(phone ? 40 : 44, Math.floor((w - lw) / dates.length));
  const wide = lw + cw * dates.length > w + 1;

  const ti = dates.indexOf(today);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.scrollLeft = wide && ti > 0 ? Math.max(0, (ti - 3) * cw) : 0;
  }, [from, to, wide, ti, cw]);

  const hov = useRef<HTMLDivElement>(null);
  const idxAt = (e: React.MouseEvent<HTMLElement>) => Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / cw);
  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    const h = hov.current;
    if (!h) return;
    if (e.target !== e.currentTarget) return void (h.style.display = "none");
    const i = idxAt(e);
    const row = e.currentTarget;
    h.style.display = "block";
    h.style.left = `${lw + i * cw}px`;
    h.style.top = `${row.offsetTop + (row.offsetParent as HTMLElement).offsetTop}px`;
    h.style.height = `${row.offsetHeight}px`;
  };
  const leave = () => hov.current && (hov.current.style.display = "none");

  const floors = orderedFloors(s).filter((f) => f.rooms.length && (!scopeId || f.buildingId === scopeId));
  const groupsBd = (multi && !scopeId ? s.buildings : [null]).map((bd) => ({ bd, floors: bd ? floors.filter((f) => f.buildingId === bd.id) : floors })).filter((g) => g.floors.length);
  const width = lw + cw * dates.length;
  const vars = { width, ["--cw" as string]: `${cw}px`, ["--lw" as string]: `${lw}px` };

  const roomOcc = useMemo(() => {
    const m = new Map<string, { occupied: boolean; conflict: boolean; bookingIds: Set<string> }>();
    for (const [rid, bars] of lay.rooms) {
      const ids = new Set<string>();
      let occupied = false;
      let conflict = false;
      for (const x of bars) {
        ids.add(x.b.id);
        if (isActive(x.b) && !x.freed) occupied = true;
        if (x.conflict) conflict = true;
      }
      const du = lay.dayuse.get(rid);
      if (du) {
        for (const list of du.values()) {
          for (const d of list) {
            ids.add(d.id);
            if (isActive(d)) occupied = true;
          }
        }
      }
      m.set(rid, { occupied, conflict, bookingIds: ids });
    }
    return m;
  }, [lay]);

  const unassignedN = useMemo(() => {
    const ids = new Set<string>();
    for (const lane of lay.lanes) for (const x of lane) if (isActive(x.b) && !x.freed) ids.add(x.b.id);
    for (const list of lay.lanesDayuse.values()) for (const d of list) if (isActive(d)) ids.add(d.id);
    return ids.size;
  }, [lay]);

  const searchOn = !!parseGuestQuery(guestQ);
  const matchIds = useMemo(() => {
    const ids = new Set<string>();
    if (!searchOn) return ids;
    const add = (b: Booking) => {
      if (bookingMatchesGuest(b, guestQ, groups)) ids.add(b.id);
    };
    for (const bars of lay.rooms.values()) for (const x of bars) add(x.b);
    for (const lane of lay.lanes) for (const x of lane) add(x.b);
    for (const m of [...lay.dayuse.values(), lay.lanesDayuse]) for (const list of m.values()) list.forEach(add);
    // 단체: 일원 매칭 → 같은 groupId 전부
    if (ids.size) {
      const gids = new Set<string>();
      const scan = (b: Booking) => {
        if (ids.has(b.id) && b.groupId) gids.add(b.groupId);
      };
      for (const bars of lay.rooms.values()) for (const x of bars) scan(x.b);
      for (const lane of lay.lanes) for (const x of lane) scan(x.b);
      if (gids.size) {
        for (const bars of lay.rooms.values()) for (const x of bars) if (x.b.groupId && gids.has(x.b.groupId)) ids.add(x.b.id);
        for (const lane of lay.lanes) for (const x of lane) if (x.b.groupId && gids.has(x.b.groupId)) ids.add(x.b.id);
      }
    }
    return ids;
  }, [lay, guestQ, groups, searchOn]);

  const matchRooms = useMemo(() => {
    const rooms = new Set<string>();
    if (!searchOn) return rooms;
    for (const [rid, info] of roomOcc) {
      for (const id of info.bookingIds) if (matchIds.has(id)) rooms.add(rid);
    }
    return rooms;
  }, [roomOcc, matchIds, searchOn]);

  const guestChips = useMemo(() => {
    if (!searchOn) return [];
    const out: { key: string; bookingId: string; roomId: string | null; labelName: string; labelRoom: string }[] = [];
    const seen = new Set<string>();
    const push = (b: Booking, roomId: string | null) => {
      if (!matchIds.has(b.id)) return;
      const key = `${b.id}:${roomId ?? "ua"}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        bookingId: b.id,
        roomId,
        labelName: b.guestName?.trim() || "이름 없음",
        labelRoom: roomId ? L.roomLabel(roomId) ?? L.rooms.get(roomId)?.no ?? roomId : "미배정",
      });
    };
    for (const [rid, bars] of lay.rooms) for (const x of bars) push(x.b, rid);
    for (const lane of lay.lanes) for (const x of lane) push(x.b, null);
    for (const [rid, m] of lay.dayuse) for (const list of m.values()) for (const d of list) push(d, rid);
    for (const list of lay.lanesDayuse.values()) for (const d of list) push(d, null);
    return out;
  }, [lay, matchIds, searchOn, L]);

  const gsScrollKey = useRef("");
  useEffect(() => {
    if (!searchOn || !guestChips.length) return;
    const first = guestChips[0];
    const key = `${guestQ}:${first.key}`;
    if (gsScrollKey.current === key) return;
    gsScrollKey.current = key;
    requestAnimationFrame(() => {
      if (first.roomId) {
        document.getElementById(`cal-room-${first.roomId}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } else {
        unRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
    });
  }, [searchOn, guestChips, guestQ]);

  useEffect(() => {
    if (glance !== "unassigned") return;
    requestAnimationFrame(() => unRef.current?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" }));
  }, [glance]);

  const typeFilterOn = typeIds.size > 0;
  const showRoom = (r: { id: string; typeId?: string | null }) => {
    if (glance === "unassigned") return false;
    if (typeFilterOn && !(r.typeId && typeIds.has(r.typeId))) return false;
    const info = roomOcc.get(r.id) ?? { occupied: false, conflict: false, bookingIds: new Set<string>() };
    if (glance === "occupied" && !info.occupied) return false;
    if (glance === "empty" && info.occupied) return false;
    if (glance === "conflict" && !info.conflict) return false;
    if (searchOn && glance === "all" && typeFilterOn === false) {
      // search dims in place — keep all rows visible
    }
    return true;
  };

  const showUnassigned = !scopeId && (lay.lanes.length || lay.lanesDayuse.size) && glance !== "occupied" && glance !== "empty" && glance !== "conflict" && (glance === "unassigned" || glance === "all" || (searchOn && guestChips.some((c) => !c.roomId)));

  const shown = new Set<string>();
  const addB = (b: Booking) => isActive(b) && shown.add(b.platformId);
  for (const bars of lay.rooms.values()) for (const x of bars) addB(x.b);
  for (const lane of lay.lanes) for (const x of lane) addB(x.b);
  for (const m of [...lay.dayuse.values(), lay.lanesDayuse]) for (const list of m.values()) list.forEach(addB);
  const legend = s.platforms.filter((p) => shown.has(p.id));
  const anyFreed = [...lay.rooms.values(), ...lay.lanes].some((bars) => bars.some((x) => x.freed));

  const toggleType = (id: string) => {
    setTypeIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const barSearch = (b: Booking) => ({
    searchHit: searchOn && matchIds.has(b.id),
    searchDim: searchOn && !matchIds.has(b.id),
  });

  const rowDim = (roomId: string) => searchOn && !matchRooms.has(roomId);

  const renderUnassigned = () =>
    showUnassigned ? (
      <section className="cal-un cal-un-top" ref={unRef}>
        <div className="cal-g">
          <span className="cal-gn">
            방 미배정
            {unassignedN ? <span className="cal-un-badge">{unassignedN}</span> : null}
          </span>
          <small>{readOnly ? "" : "누르면 예약을 열어 방을 정할 수 있어요"}</small>
        </div>
        {(lay.lanes.length ? lay.lanes : [[]]).map((lane, i) => (
          <div className={`cal-r ${searchOn && !lane.some((x) => matchIds.has(x.b.id)) ? "gs-dim" : ""}`} key={i}>
            <div className="cal-l rm un">
              {i === 0 ? <b>미배정</b> : null}
              {lay.lanes.length > 1 ? <small>{i + 1}줄</small> : null}
            </div>
            <div className="cal-t ro">
              {lane.map((bar) => (
                <BarEl
                  key={`${bar.b.id}:${bar.leg.idx}`}
                  bar={bar}
                  cw={cw}
                  L={L}
                  readOnly={readOnly}
                  onOpen={onOpen}
                  typeCode={typeLabel(L.types.get(bar.b.typeId ?? "")) || undefined}
                  times={s.stayTimes}
                  warn={warns.get(bar.b.id)}
                  {...barSearch(bar.b)}
                />
              ))}
              {i === 0 ? <Marks m={lay.lanesDayuse} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} matchIds={matchIds} searchOn={searchOn} /> : null}
            </div>
          </div>
        ))}
      </section>
    ) : null;

  return (
    <>
      <div className="cal-filters" role="toolbar" aria-label="룸 타임라인 필터">
        {s.types.length ? (
          <ChipGroup scroll className="cal-filter-scroll" aria-label="객실 타입">
            {s.types.map((t) => (
              <Chip key={t.id} sm active={typeIds.has(t.id)} onClick={() => toggleType(t.id)}>
                {typeLabel(t)}
              </Chip>
            ))}
            {typeFilterOn ? (
              <Chip sm onClick={() => setTypeIds(new Set())}>
                타입 해제
              </Chip>
            ) : null}
          </ChipGroup>
        ) : null}
        <ChipGroup scroll className="cal-filter-scroll" aria-label="점유 글랜스" role="radiogroup">
          {GLANCE.map((g) => (
            <Chip key={g.id} sm active={glance === g.id} tone={g.id === "conflict" ? "danger" : g.id === "unassigned" ? "warn" : undefined} onClick={() => setGlance(g.id)} aria-pressed={glance === g.id}>
              {g.label}
              {g.id === "unassigned" && unassignedN ? ` ${unassignedN}` : ""}
              {g.id === "conflict" && lay.conflicts ? ` ${lay.conflicts}` : ""}
            </Chip>
          ))}
        </ChipGroup>
        <div className="guest-search-bar cal-guest-search" role="search">
          <label className="search ls guest-search">
            <Search size={16} strokeWidth={2.2} aria-hidden />
            <input
              ref={guestRef}
              value={guestLive}
              placeholder="손님 이름·연락처"
              aria-label="손님 이름·연락처 검색"
              enterKeyHint="search"
              onChange={(e) => setGuestLive(e.target.value)}
              onCompositionStart={() => setGuestComposing(true)}
              onCompositionEnd={(e) => {
                setGuestComposing(false);
                setGuestLive(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  clearGuest();
                }
              }}
            />
            {guestLive ? (
              <button type="button" className="guest-search-x" aria-label="검색 지우기" onClick={clearGuest}>
                <X size={14} strokeWidth={2.4} aria-hidden />
              </button>
            ) : null}
          </label>
          {searchOn && guestChips.length === 0 ? <span className="guest-search-none">없음</span> : null}
          {guestChips.length ? (
            <div className="guest-search-chips" role="list" aria-label="검색 결과">
              {guestChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="listitem"
                  className="chip sm"
                  title={`${c.labelName} · ${c.labelRoom}`}
                  onClick={() => {
                    requestAnimationFrame(() => {
                      if (c.roomId) document.getElementById(`cal-room-${c.roomId}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
                      else unRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
                    });
                  }}
                >
                  {c.labelName} · {c.labelRoom}
                  {c.roomId ? "호" : ""}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="cal-legend" aria-label="범례">
        <span title="숙박">
          <i className="lg-bar" />
          숙박
        </span>
        <span title="입실 완료">
          <i className="lg-bar ok" />
          입실
        </span>
        <span title="대실">
          <CircleDot size={12} strokeWidth={2.4} aria-hidden />
          대실
        </span>
        <span title="충돌">
          <AlertTriangle size={12} strokeWidth={2.4} aria-hidden />
          충돌
        </span>
        <span title="방 미배정">
          <BedDouble size={12} strokeWidth={2.4} aria-hidden />
          미배정
        </span>
        {anyFreed ? (
          <span title="중도 퇴실로 비운 밤">
            <UserRoundX size={12} strokeWidth={2.4} aria-hidden />
            중도퇴실
          </span>
        ) : null}
        <span title="취소·노쇼">
          <i className="lg-bar cx" />
          취소
        </span>
        {legend.length ? (
          <button type="button" className="cal-plat-tog" aria-expanded={platOpen} onClick={() => setPlatOpen((v) => !v)}>
            플랫폼 {platOpen ? "▾" : "▸"}
          </button>
        ) : null}
      </div>
      {platOpen && legend.length ? (
        <div className="cal-pl" aria-label="플랫폼 색">
          {legend.map((p) => {
            const c = paint(p);
            return (
              <span key={p.id} title={p.name}>
                <i style={{ background: c.d }} />
                {p.name}
              </span>
            );
          })}
          <span className="cal-pl-ok">
            <i />
            진한 테두리 = 입실 완료
          </span>
        </div>
      ) : null}

      {lay.conflicts ? (
        <div className="cal-cf" role="status">
          같은 방에 밤이 겹치는 숙박 {lay.conflicts}건 — 빨간 테두리를 눌러 방을 옮겨 주세요
        </div>
      ) : null}

      <div ref={wrap} className={`cal-wrap ${wide ? "wide" : ""}`} onMouseLeave={leave}>
        <div className="cal" style={vars}>
          <div className="cal-cols" aria-hidden>
            {dates.map((d, i) =>
              d === today || ["토", "일"].includes(weekday(d)) ? (
                <i key={d} className={d === today ? "td" : "we"} style={{ left: lw + i * cw, width: cw }} />
              ) : null,
            )}
          </div>
          <div className="cal-h">
            <div className="cal-l">객실</div>
            {dates.map((d) => (
              <div key={d} className={`cal-d ${d === today ? "td" : ""} ${["토", "일"].includes(weekday(d)) ? "we" : ""}`} style={{ width: cw }} title={dayLabel(d)}>
                <b>{d.endsWith("-01") || d === from ? md(d) : Number(d.slice(8))}</b>
                <span>{d === today ? "오늘" : weekday(d)}</span>
              </div>
            ))}
          </div>
          <div ref={hov} className="cal-hov" style={{ width: cw }} />
          {renderUnassigned()}
          {groupsBd.map((g) => {
            const visibleFloors = g.floors
              .map((f) => ({ ...f, rooms: f.rooms.filter(showRoom) }))
              .filter((f) => f.rooms.length);
            if (!visibleFloors.length) return null;
            return (
              <section key={g.bd?.id ?? "one"}>
                {g.bd ? (
                  <div className="cal-g">
                    <span className="cal-gn">{L.buildings.get(g.bd.id)?.name}</span>
                  </div>
                ) : null}
                {visibleFloors.map((f) =>
                  f.rooms.map((r) => (
                    <div className={`cal-r ${rowDim(r.id) ? "gs-dim" : ""}`} key={r.id} id={`cal-room-${r.id}`}>
                      <div className="cal-l rm" title={`${f.name} ${r.no}${typeLabel(L.types.get(r.typeId ?? "")) ? ` · ${typeLabel(L.types.get(r.typeId ?? ""))}` : ""}`}>
                        <i className="cal-fc" style={{ background: pastelColor(r.color ?? f.color) ?? "var(--line)" }} />
                        <b>{r.no}</b>
                      </div>
                      <div
                        className={`cal-t ${readOnly ? "ro" : ""}`}
                        onMouseMove={readOnly ? undefined : move}
                        onClick={
                          readOnly
                            ? undefined
                            : (e) => {
                                if (e.target !== e.currentTarget) return;
                                const d = dates[idxAt(e)];
                                if (d) onNew({ kind: "stay", checkIn: d, roomId: r.id, typeId: r.typeId ?? undefined });
                              }
                        }
                      >
                        {(lay.rooms.get(r.id) ?? []).map((bar) => (
                          <BarEl key={`${bar.b.id}:${bar.leg.idx}`} bar={bar} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} times={s.stayTimes} warn={warns.get(bar.b.id)} {...barSearch(bar.b)} />
                        ))}
                        <Marks m={lay.dayuse.get(r.id)} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} matchIds={matchIds} searchOn={searchOn} />
                      </div>
                    </div>
                  )),
                )}
              </section>
            );
          })}
        </div>
      </div>
      <p className="stock-hint">
        {readOnly
          ? "보기 전용 · 막대는 숙박(퇴실일 칸은 비어요) · 점은 대실 · 색은 플랫폼 · 진한 테두리는 입실 완료"
          : "막대를 누르면 예약을 고치고, 빈 칸을 누르면 그 방·그날로 새 예약을 적어요 · 점은 대실 · 색은 플랫폼 · 진한 테두리는 입실 완료"}
      </p>
    </>
  );
}

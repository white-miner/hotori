// 객실 캘린더: 방마다 한 줄, 날짜마다 한 칸. 숙박은 막대, 대실은 그날 칸의 작은 점.
// 칸을 하나하나 그리지 않고 줄마다 배경 격자 + 막대만 절대 위치로 그려요 (60실 × 92일도 가볍게).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Booking, type HotelSettings, addDays, dayLabel, isActive, isEarlyOut, isMoved, legsOf, md, orderedFloors, typeLabel, usedLabel, weekday, won } from "../shared/ledger";
import { type Bar, calendarLayout } from "../shared/calendar";
import { paint } from "../shared/platform";
import { pastelColor } from "../shared/floorColor";
import { lookups } from "./ui";

type L = ReturnType<typeof lookups>;
const STATUS: Record<string, string> = { cancelled: "취소", noshow: "노쇼" };

interface Props {
  s: HotelSettings;
  L: L;
  bookings: Booking[];
  dates: string[];
  today: string;
  scopeId: string | null;
  multi: boolean;
  readOnly: boolean;
  onOpen: (b: Booking) => void;
  onNew: (p: Partial<Booking>) => void;
}

function tip(b: Booking, L: L, readOnly: boolean): string {
  const p = L.plats.get(b.platformId)?.name ?? "";
  const st = isActive(b) ? (b.arrived ? " · 입실 완료" : "") : ` · ${STATUS[b.status] ?? ""}`;
  if (b.kind === "dayuse")
    return `대실 ${b.startTime ?? ""}~${b.endTime ?? ""} · ${b.guestName || "이름 없음"} · ${p}${readOnly ? "" : ` · ${won(b.price)}원`}${st}`;
  const mv = isMoved(b) ? ` · 객실 이동 ${legsOf(b).map((l) => `${L.roomLabel(l.roomId) ?? "?"} ${l.nights}박`).join(" → ")}` : "";
  const eo = isActive(b) && isEarlyOut(b) ? ` · ${md(b.earlyOut!)} 중도 퇴실 (${usedLabel(b)})${!readOnly && b.refund ? ` · 환불 ${won(b.refund)}원` : ""}` : "";
  return `${b.guestName || "이름 없음"} · ${p} · ${b.nights}박 · ${md(b.checkIn)}~${md(addDays(b.checkIn, b.nights ?? 0))}${readOnly ? "" : ` · ${won(b.price)}원`}${mv}${st}${eo}`;
}

const BarEl = memo(function BarEl({ bar, cw, L, readOnly, onOpen, typeCode }: { bar: Bar; cw: number; L: L; readOnly: boolean; onOpen: (b: Booking) => void; typeCode?: string }) {
  const { b, span } = bar;
  const cx = !isActive(b);
  const p = L.plats.get(b.platformId);
  const px = span.len * cw;
  // 바탕은 늘 플랫폼 색을 옅게, 입실 완료면 같은 색 진한 테두리 (꽉 찬 색은 안 써요)
  const arr = isActive(b) && b.arrived && !bar.freed;
  const c = paint(p);
  return (
    <div
      className={`cbar ${cx ? "cx" : ""} ${bar.prev !== undefined ? "mvi" : ""} ${bar.next !== undefined ? "mvo" : ""} ${arr ? "ok" : ""} ${bar.conflict ? "cf" : ""} ${bar.freed ? "eo" : ""} ${bar.endsEarly ? "eoe" : ""} ${span.clipL ? "cl" : ""} ${span.clipR ? "cr" : ""} ${readOnly ? "ro" : ""}`}
      style={{
        left: span.start * cw + (span.clipL ? 0 : 2),
        width: span.len * cw - (span.clipL ? 0 : 2) - (span.clipR ? 0 : 3),
        ["--pb" as string]: c.b,
        ["--pt" as string]: c.t,
      }}
      title={tip(b, L, readOnly)}
      {...(readOnly ? {} : { role: "button", tabIndex: 0 })}
      onClick={readOnly ? undefined : (e) => (e.stopPropagation(), onOpen(b))}
      onKeyDown={readOnly ? undefined : (e) => e.key === "Enter" && onOpen(b)}
    >
      {bar.freed ? (
        <span className="cb-eo">{px >= 70 ? "중도 퇴실 · 빈 방" : "빈 방"}</span>
      ) : (
        <>
      {typeCode && px >= 80 ? <span className="cb-t">{typeCode}</span> : null}
      {bar.prev !== undefined ? <span className="cb-mv" title={`${L.roomLabel(bar.prev) ?? "?"}호에서 옮겨 왔어요`}>{L.rooms.get(bar.prev ?? "")?.no ?? "?"}→</span> : null}
      {b.groupId ? <span className="grptag" title={`단체 ${b.groupName ?? ""}`}>단체</span> : null}
      <span className="cb-n">{b.guestName || "이름 없음"}</span>
      {bar.next !== undefined ? <span className="cb-mv nx" title={`다음 날 ${L.roomLabel(bar.next) ?? "?"}호로 옮겨요`}>→{L.rooms.get(bar.next ?? "")?.no ?? "?"}</span> : null}
      {px >= 96 ? <span className="cb-p">{p?.abbr ?? "?"}</span> : null}
        </>
      )}
    </div>
  );
});

function Marks({ m, cw, L, readOnly, onOpen }: { m?: Map<number, Booking[]>; cw: number; L: L; readOnly: boolean; onOpen: (b: Booking) => void }) {
  if (!m) return null;
  return (
    <>
      {[...m].map(([i, list]) => (
        <span key={i} className="cmarks" style={{ left: i * cw + cw - 4 }}>
          {list.slice(0, 3).map((d) => (
            <i
              key={d.id}
              className={`cdot ${isActive(d) ? (d.arrived ? "ok" : "") : "cx"}`}
              style={isActive(d) ? ((c) => ({ ["--pt" as string]: c.d, ["--pb" as string]: c.b }))(paint(L.plats.get(d.platformId))) : undefined}
              title={tip(d, L, readOnly)}
              onClick={readOnly ? undefined : (e) => (e.stopPropagation(), onOpen(d))}
            />
          ))}
        </span>
      ))}
    </>
  );
}

export default function RoomCalendar({ s, L, bookings, dates, today, scopeId, multi, readOnly, onOpen, onNew }: Props) {
  const from = dates[0];
  const to = dates[dates.length - 1];
  const lay = useMemo(() => calendarLayout(s, bookings, from, to, scopeId), [s, bookings, from, to, scopeId]);

  // 칸 너비: 화면에 다 들어가면 늘리고, 넘치면 최소 너비로 옆으로 밀어요
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
  const lw = phone ? 58 : 108;
  const cw = Math.max(phone ? 40 : 44, Math.floor((w - lw) / dates.length));
  const wide = lw + cw * dates.length > w + 1;

  // 오늘이 들어 있으면 오늘 칸이 보이게 (앞 사흘 함께)
  const ti = dates.indexOf(today);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.scrollLeft = wide && ti > 0 ? Math.max(0, (ti - 3) * cw) : 0;
  }, [from, to, wide, ti, cw]);

  // 빈 칸에 마우스를 올리면 그 칸만 살짝 (React 다시 그리기 없이)
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
  const groups = (multi && !scopeId ? s.buildings : [null]).map((bd) => ({ bd, floors: bd ? floors.filter((f) => f.buildingId === bd.id) : floors })).filter((g) => g.floors.length);
  const width = lw + cw * dates.length;
  const vars = { width, ["--cw" as string]: `${cw}px`, ["--lw" as string]: `${lw}px` };

  // 지금 보이는 막대·점의 플랫폼만 (취소·노쇼는 회색이라 빼요)
  const shown = new Set<string>();
  const addB = (b: Booking) => isActive(b) && shown.add(b.platformId);
  for (const bars of lay.rooms.values()) for (const x of bars) addB(x.b);
  for (const lane of lay.lanes) for (const x of lane) addB(x.b);
  for (const m of [...lay.dayuse.values(), lay.lanesDayuse]) for (const list of m.values()) list.forEach(addB);
  const legend = s.platforms.filter((p) => shown.has(p.id));
  const anyFreed = [...lay.rooms.values(), ...lay.lanes].some((bars) => bars.some((x) => x.freed));

  return (
    <>
      {legend.length ? (
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
          {anyFreed ? (
            <span className="cal-pl-eo">
              <i />
              흐린 점선 = 중도 퇴실로 비운 밤
            </span>
          ) : null}
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
          {groups.map((g) => (
            <section key={g.bd?.id ?? "one"}>
              {g.bd ? (
                <div className="cal-g">
                  <span className="cal-gn">{L.buildings.get(g.bd.id)?.name}</span>
                </div>
              ) : null}
              {g.floors.map((f) =>
                f.rooms.map((r) => (
                  <div className="cal-r" key={r.id}>
                    <div className="cal-l rm" title={`${f.name} ${r.no}`}>
                      <i className="cal-fc" style={{ background: pastelColor(r.color ?? f.color) ?? "var(--line)" }} />
                      <b>{r.no}</b>
                      <small>{typeLabel(L.types.get(r.typeId ?? ""))}</small>
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
                        <BarEl key={`${bar.b.id}:${bar.leg.idx}`} bar={bar} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} />
                      ))}
                      <Marks m={lay.dayuse.get(r.id)} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} />
                    </div>
                  </div>
                )),
              )}
            </section>
          ))}
          {!scopeId && (lay.lanes.length || lay.lanesDayuse.size) ? (
            <section className="cal-un">
              <div className="cal-g">
                <span className="cal-gn">방 미배정</span>
                <small>{readOnly ? "" : "누르면 예약을 열어 방을 정할 수 있어요"}</small>
              </div>
              {(lay.lanes.length ? lay.lanes : [[]]).map((lane, i) => (
                <div className="cal-r" key={i}>
                  <div className="cal-l rm un">
                    {i === 0 ? <b>미배정</b> : null}
                    {lay.lanes.length > 1 ? <small>{i + 1}줄</small> : null}
                  </div>
                  <div className="cal-t ro">
                    {lane.map((bar) => (
                      <BarEl key={`${bar.b.id}:${bar.leg.idx}`} bar={bar} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} typeCode={typeLabel(L.types.get(bar.b.typeId ?? "")) || undefined} />
                    ))}
                    {i === 0 ? <Marks m={lay.lanesDayuse} cw={cw} L={L} readOnly={readOnly} onOpen={onOpen} /> : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}
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

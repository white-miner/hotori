import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LogIn,
  Moon,
  Search,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import type { Reservation, Room } from "../../shared/types";
import {
  addDays,
  channelName,
  type Ctx,
  dayEvents,
  type DayEvent,
  fmtLeft,
  floorsOf,
  hm,
  hourOf,
  isHourly,
  kindOf,
  kstMs,
  longDate,
  type RoomView,
  stayNights,
  weekday,
} from "../lib";
import type { Layout } from "./BuildingView";
import { canCheckInNow } from "./BuildingView";

type BT =
  "stay" | "short" | "past" | "rsv" | "rsvs" | "cln" | "clnN" | "clnW" | "chk";
interface Blk {
  s: number;
  e: number;
  t: BT;
  label?: string;
  ext?: string;
  left?: string;
  alert?: boolean;
  res?: Reservation;
}
const SDOT: Record<string, string> = {
  use: "var(--ai)",
  rsv: "transparent",
  vac: "var(--ink4)",
  cln: "var(--moegi)",
  chk: "var(--nezu)",
};
function blocksFor(ctx: Ctx, room: Room, v: RoomView): Blk[] {
  const { s, now, bd } = ctx;
  const base = kstMs(bd, "00:00");
  const H = (ms: number) => (ms - base) / 3600000;
  const o = s.settings;
  const out: Blk[] = [];
  const cleanH = o.cleaningMinutes / 60;
  for (const r of s.reservations) {
    if (r.status === "cancelled" || !r.roomIds.includes(room.id)) continue;
    const ch = channelName(s, r.channelId);
    if (isHourly(r)) {
      const st = Date.parse(r.startAt!);
      let en = Date.parse(r.endAt!);
      if (r.status === "checked_out" && r.checkedOutAt)
        en = Date.parse(r.checkedOutAt);
      if (r.status === "checked_in" && en < now) en = now;
      const left = (Date.parse(r.endAt!) - now) / 60000;
      out.push({
        s: H(st),
        e: H(en),
        t:
          r.status === "checked_out"
            ? "past"
            : r.status === "checked_in"
              ? "short"
              : "rsvs",
        label:
          r.status === "checked_out"
            ? `${r.guestName.replace(" (예시)", "")} · 대실 끝`
            : r.guestName.replace(" (예시)", ""),
        ext:
          r.status === "confirmed"
            ? `${hm(st)} 도착 · 대실 ${r.hours}시간 · ${ch}`
            : `대실 ${r.hours}시간`,
        left:
          r.status === "checked_in"
            ? left >= 0
              ? `${fmtLeftShortH(left)} 남음`
              : `${fmtLeft(-left)} 지남`
            : undefined,
        alert: r.status === "checked_in" && left <= 15,
        res: r,
      });
      if (r.status !== "checked_out")
        out.push({ s: H(en), e: H(en) + cleanH, t: "cln" });
    } else {
      const st = kstMs(r.checkIn, o.checkInTime);
      let en = kstMs(r.checkOut, o.checkOutTime);
      if (r.status === "checked_out" && r.checkedOutAt)
        en = Date.parse(r.checkedOutAt);
      if (r.status === "checked_in" && en < now) en = now;
      const n = stayNights(r);
      const k = Math.max(
        1,
        Math.round((Date.parse(bd) - Date.parse(r.checkIn)) / 86400000) + 1,
      );
      const outText =
        r.checkOut === addDays(bd, 1) || r.checkOut === addDays(s.today, 1)
          ? `내일 ${o.checkOutTime} 퇴실`
          : r.checkOut <= s.today
            ? `오늘 ${o.checkOutTime} 퇴실`
            : `${Number(r.checkOut.slice(8))}일(${weekday(r.checkOut)}) ${o.checkOutTime} 퇴실`;
      out.push({
        s: H(st),
        e: H(en),
        t:
          r.status === "checked_out"
            ? "past"
            : r.status === "checked_in"
              ? "stay"
              : "rsv",
        label:
          r.status === "checked_out"
            ? `${r.guestName.replace(" (예시)", "")} · 퇴실 ${hm(en)}`
            : r.guestName.replace(" (예시)", ""),
        ext:
          r.status === "confirmed"
            ? `${hm(st)} 도착 · ${n}박 · ${ch}`
            : `${n >= 2 ? `연박 ${Math.min(k, n)}일째` : kindOf(r)} · ${outText}`,
        alert: r.status === "checked_in" && en <= now && r.checkOut <= s.today,
        res: r,
      });
    }
  }
  const since = room.cleaningSince ? Date.parse(room.cleaningSince) : now;
  if (room.facility === "normal" && room.cleaning === "dirty")
    out.push({
      s: H(since),
      e: H(Math.max(now, since + o.cleaningMinutes * 60000)),
      t: "clnW",
      label: "대기",
    });
  if (room.facility === "normal" && room.cleaning === "cleaning")
    out.push({
      s: H(since),
      e: H(Math.max(since + o.cleaningMinutes * 60000, now + 5 * 60000)),
      t: "clnN",
      label: "청소 중",
    });
  if (room.facility !== "normal") {
    const issue = v.issues[0];
    const st = issue ? Date.parse(issue.createdAt) : now;
    out.push({
      s: H(Math.max(st, kstMs(bd, "06:00"))),
      e: 30,
      t: "chk",
      label:
        room.facility === "blocked"
          ? `판매 중지${issue ? " · " + issue.title : ""}`
          : `점검${issue ? " · " + issue.title : ""}`,
    });
  }
  return out.filter((b) => b.e > 6 && b.s < 30 && b.e > b.s);
}
const fmtLeftShortH = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

function Icon({ t }: { t: BT }) {
  if (t === "short") return <Timer size={12} strokeWidth={2.4} />;
  if (t === "stay") return <Moon size={12} strokeWidth={2.4} />;
  if (t === "rsv" || t === "rsvs") return <LogIn size={12} strokeWidth={2.4} />;
  if (t === "chk") return <Wrench size={12} strokeWidth={2.4} />;
  return null;
}

export function Clock({
  ctx,
  width = 180,
  compact = false,
}: {
  ctx: Ctx;
  width?: number;
  compact?: boolean;
}) {
  const t = hm(ctx.now);
  const pct = Math.min(
    100,
    Math.max(0, ((ctx.now - kstMs(ctx.bd, "06:00")) / 86400000) * 100),
  );
  return (
    <div className="clock">
      <div className="big num" aria-label={`지금 ${t}`}>
        {t.slice(0, 2)}
        <i>:</i>
        {t.slice(3)}
      </div>
      {!compact && (
        <div className="meta">
          {longDate(ctx.bd)}
          <br />
          영업일 {String(ctx.s.businessDayCutoffHour).padStart(2, "0")}:00 →
          내일 {String(ctx.s.businessDayCutoffHour).padStart(2, "0")}:00
          <div className="dayp" style={{ width }}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function TimelineView({
  ctx,
  views,
  layout,
  onOpenRoom,
  onSlot,
  onQuick,
  onOpenEvent,
  onEventAction,
  busy,
}: {
  ctx: Ctx;
  views: Map<string, RoomView>;
  layout: Layout;
  onOpenRoom: (roomId: string, reservation?: Reservation) => void;
  onSlot: (roomId: string, startMs: number) => void;
  onQuick: (kind: "hourly" | "nightly") => void;
  onOpenEvent: (e: DayEvent) => void;
  onEventAction: (e: DayEvent) => void;
  busy: boolean;
}) {
  const { s, now, bd } = ctx;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const nowH = hourOf(now, bd);
  const defaultWin = nowH < 15 ? 0 : nowH < 21 ? 1 : 2;
  const [win, setWin] = useState(defaultWin);
  const [vacantOnly, setVacantOnly] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [hover, setHover] = useState<{ roomId: string; h: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [layout]);
  useEffect(() => setHover(null), [win]);
  const events = dayEvents(ctx);
  const vacant = [...views.values()].filter((v) => v.status === "vac");
  const upcoming = events.filter((e) => !e.done && e.at >= now);
  const nextHour = upcoming.filter((e) => e.at <= now + 3600000);
  const nextChips = (nextHour.length ? nextHour : upcoming).slice(
    0,
    layout === "tab" ? 4 : 3,
  );
  const chipText = (e: DayEvent) =>
    `${e.room?.number || "미배정"} ${
      e.kind === "arrive"
        ? `${e.reservation?.guestName.replace(" (예시)", "")} 도착`
        : e.kind === "leave"
          ? e.reservation && isHourly(e.reservation)
            ? "대실 끝"
            : "퇴실"
          : e.kind === "cleanEnd"
            ? "청소 끝"
            : "청소 대기"
    }`;
  const quickButtons = (
    <div className="qa">
      <button
        type="button"
        className="btn coral"
        onClick={() => onQuick("hourly")}
      >
        <Timer size={16} strokeWidth={2.4} />
        대실 받기
      </button>
      <button type="button" className="btn" onClick={() => onQuick("nightly")}>
        <Moon size={16} strokeWidth={2.2} />
        {layout === "pc" ? "숙박 체크인" : "숙박"}
      </button>
      <button
        type="button"
        className={`btn ghost ${vacantOnly ? "on" : ""}`}
        aria-pressed={vacantOnly}
        onClick={() => setVacantOnly(!vacantOnly)}
        title="빈 방만 강조"
      >
        {layout === "pc" && <Search size={16} />}빈 방 {vacant.length}
      </button>
    </div>
  );
  if (layout === "mob") {
    const past = events.filter((e) => e.done);
    const open = events.filter((e) => !e.done);
    const before = open.filter((e) => e.at < now);
    const after = open.filter((e) => e.at >= now);
    const vi = (e: DayEvent) => {
      const action = eventAction(ctx, e);
      return (
        <div
          key={e.key}
          className={`vi ${e.hot ? "hot" : ""} ${e.done ? "done" : ""} ${e.at < now && !e.done ? "late" : ""}`}
        >
          <div className="tm num">{hm(e.at)}</div>
          <div className="ax">
            <i />
          </div>
          <div className="ct">
            <button
              type="button"
              className={`rb num ${e.box}`}
              onClick={() => onOpenEvent(e)}
            >
              {e.room?.number || "배정"}
            </button>
            <button type="button" className="tx" onClick={() => onOpenEvent(e)}>
              <b>{e.title}</b>
              <span>{e.sub}</span>
              {e.progress !== undefined && (
                <span className="mbar">
                  <i style={{ width: `${e.progress * 100}%` }} />
                </span>
              )}
            </button>
            {action && (
              <button
                type="button"
                className={`btn sm ${action.kind}`}
                disabled={busy}
                onClick={() => onEventAction(e)}
              >
                {action.label}
              </button>
            )}
          </div>
        </div>
      );
    };
    return (
      <div className="b-mob">
        <div className="mob-clock">
          <Clock ctx={ctx} compact />
          <div className="mob-day">
            {weekday(bd)}요일 · 영업일{" "}
            {Math.round(
              Math.min(
                100,
                Math.max(0, ((now - kstMs(bd, "06:00")) / 86400000) * 100),
              ),
            )}
            % 지남
            <div className="dayp">
              <i
                style={{
                  width: `${Math.min(100, Math.max(0, ((now - kstMs(bd, "06:00")) / 86400000) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div className="mob-qa">{quickButtons}</div>
        <div className="vl">
          {past.length > 0 && (
            <button
              type="button"
              className="pastrow"
              aria-expanded={showPast}
              onClick={() => setShowPast(!showPast)}
            >
              <ChevronDown
                size={14}
                strokeWidth={2.4}
                className={showPast ? "flip" : ""}
              />
              지난 일 {past.length}건 · 체크인{" "}
              {past.filter((e) => e.kind === "arrive").length} · 퇴실{" "}
              {past.filter((e) => e.kind === "leave").length}
            </button>
          )}
          {showPast && past.map(vi)}
          {before.map(vi)}
          <div className="nowsep">
            <b className="num">지금 {hm(now)}</b>
          </div>
          {after.map(vi)}
          {!after.length && (
            <p className="quiet center">
              남은 일정이 없어요. 대실 받기로 빈 방을 바로 팔 수 있어요.
            </p>
          )}
        </div>
      </div>
    );
  }
  const windows = [
    [6, 18],
    [12, 24],
    [18, 30],
  ];
  const [ws, we] = layout === "tab" ? windows[win] : [6, 30];
  const labelW = layout === "tab" ? 118 : 136;
  const pxh = Math.max(20, (width - labelW) / (we - ws));
  const W = (we - ws) * pxh;
  const x = (h: number) => (Math.min(Math.max(h, ws), we) - ws) * pxh;
  const rowH = layout === "tab" ? 43 : 33;
  const axis: React.ReactNode[] = [];
  const step = pxh < 40 ? 2 : 1;
  for (let h = ws; h < we; h += step) {
    const hh = h % 24;
    axis.push(
      <div
        key={h}
        className={`hr num ${hh % 6 === 0 ? "d" : ""}`}
        style={{ left: labelW + x(h) }}
      >
        {hh === 0
          ? "자정"
          : String(hh).padStart(2, "0") + (hh % 6 === 0 ? ":00" : "")}
      </div>,
    );
  }
  const grid: React.ReactNode[] = [];
  for (let h = ws; h <= we; h++)
    grid.push(
      <div
        key={h}
        className={`grid ${h % 6 === 0 ? "d" : ""}`}
        style={{ left: x(h) }}
      />,
    );
  const groups = floorsOf(s);
  const baseHours = s.settings.baseHours;
  const slotMs = (h: number) => {
    let ms = kstMs(bd, "00:00") + h * 3600000;
    ms = Math.ceil(ms / 600000) * 600000;
    return Math.max(ms, now);
  };
  const rows = groups.flatMap((g) =>
    g.floors.map((f) => {
      const rv = f.rooms.map((r) => views.get(r.id)!).filter(Boolean);
      return (
        <div
          key={f.key}
          className="fgroup"
          style={
            f.color
              ? ({ ["--fc" as string]: f.color } as React.CSSProperties)
              : undefined
          }
        >
          <div className={`fh ${f.color ? "colored" : ""}`}>
            {groups.length > 1 ? `${g.building} ` : ""}
            {f.floor}층{" "}
            <span>
              {rv.filter((v) => v.status === "use").length}/{rv.length} 사용중
            </span>
          </div>
          {rv.map((v) => {
            const blocks = blocksFor(ctx, v.room, v);
            const hv = hover?.roomId === v.room.id ? hover.h : null;
            const ghostS = hv !== null ? hourOf(slotMs(hv), bd) : 0;
            const ghostFree =
              hv !== null &&
              v.room.facility === "normal" &&
              !blocks.some(
                (b) =>
                  b.t !== "past" && b.s < ghostS + baseHours && ghostS < b.e,
              );
            const dim = vacantOnly && v.status !== "vac";
            return (
              <div
                key={v.room.id}
                className={`row ${dim ? "dim-row" : ""} ${vacantOnly && v.status === "vac" ? "hi-row" : ""}`}
                style={{ height: rowH }}
              >
                <button
                  type="button"
                  className="rl"
                  style={{ width: labelW }}
                  onClick={() => onOpenRoom(v.room.id)}
                  aria-label={`${v.room.number}호 ${v.typeName} 열기`}
                >
                  {v.room.color && (
                    <i
                      className="rmark"
                      style={{ background: v.room.color }}
                      title={v.room.label || "특수객실"}
                    />
                  )}
                  <b className="num">{v.room.number}</b>
                  <span>{v.room.label || v.typeName}</span>
                  <i
                    className="sd"
                    style={{
                      background: SDOT[v.status],
                      border:
                        v.status === "rsv"
                          ? "1.5px dashed var(--shu)"
                          : undefined,
                    }}
                  />
                </button>
                <div
                  className="track"
                  style={{ width: W }}
                  onMouseMove={(e) => {
                    if (e.target !== e.currentTarget) return setHover(null);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const h = ws + (e.clientX - rect.left) / pxh;
                    setHover({ roomId: v.room.id, h });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    if (
                      e.target !== e.currentTarget &&
                      !(e.target as HTMLElement).classList.contains("ghost")
                    )
                      return;
                    if (v.room.facility !== "normal")
                      return onOpenRoom(v.room.id);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const h = ws + (e.clientX - rect.left) / pxh;
                    onSlot(v.room.id, slotMs(h));
                  }}
                >
                  {blocks.map((b, i) => {
                    const L = x(b.s),
                      Wd = x(b.e) - x(b.s);
                    if (Wd <= 0) return null;
                    const cl = b.s < ws ? "cl" : "";
                    const cr = b.e > we ? "cr" : "";
                    const isCln =
                      b.t === "cln" || b.t === "clnN" || b.t === "clnW";
                    const lab = b.label || "";
                    const showExt =
                      b.ext &&
                      Wd >
                        lab.length * 13 +
                          b.ext.length * 7 +
                          40 +
                          (b.left ? 70 : 0);
                    return (
                      <button
                        type="button"
                        key={i}
                        className={`blk ${b.t} ${cl} ${cr} ${b.alert ? "alert" : ""}`}
                        style={{
                          left: L,
                          width: Wd,
                          top: (rowH - 26) / 2,
                          height: 26,
                          ["--hp" as string]: `${pxh}px`,
                        }}
                        title={[lab, b.ext, b.left].filter(Boolean).join(" · ")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRoom(v.room.id, b.res);
                        }}
                      >
                        {isCln ? (
                          Wd >= 62 && lab ? (
                            <>
                              <Sparkles size={12} strokeWidth={2.4} />
                              {lab}
                            </>
                          ) : Wd >= 18 ? (
                            <Sparkles size={12} strokeWidth={2.4} />
                          ) : null
                        ) : Wd < 60 ? null : (
                          <>
                            <Icon t={b.t} />
                            <span className="bn">{lab}</span>
                            {showExt && <span className="st">{b.ext}</span>}
                            {b.left && Wd > 150 && (
                              <span className="left">{b.left}</span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                  {ghostFree && (
                    <div
                      className="blk ghost"
                      style={{
                        left: x(ghostS),
                        width: Math.max(0, x(ghostS + baseHours) - x(ghostS)),
                        top: (rowH - 26) / 2,
                        height: 26,
                      }}
                    >
                      ＋ {hm(slotMs(hv!))}부터 대실 {baseHours}시간 넣기
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }),
  );
  const nowX = labelW + x(nowH);
  const nowVisible = nowH >= ws && nowH <= we;
  return (
    <div className={`b-body ${layout}`}>
      <div className="nowbar">
        <Clock ctx={ctx} width={layout === "tab" ? 150 : 180} />
        {layout === "pc" && (
          <div className="next">
            <div className="lb">
              다음
              <br />
              1시간
            </div>
            {nextChips.length ? (
              nextChips.map((e) => (
                <button
                  type="button"
                  key={e.key}
                  className={`nx ${e.hot ? "hot" : ""}`}
                  onClick={() => onOpenEvent(e)}
                >
                  <b className="num">{hm(e.at)}</b>
                  <span>{chipText(e)}</span>
                </button>
              ))
            ) : (
              <span className="quiet">한가해요. 예정된 일이 없어요.</span>
            )}
          </div>
        )}
        {quickButtons}
      </div>
      {layout === "tab" && (
        <div className="tab-win">
          <div className="seg2" role="tablist" aria-label="시간 구간">
            {["06–18시", "12–24시", "18–06시"].map((l, i) => (
              <button
                type="button"
                role="tab"
                aria-selected={win === i}
                key={l}
                className={win === i ? "on" : ""}
                onClick={() => setWin(i)}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="quiet">구간을 바꾸면 하루 전체를 볼 수 있어요</span>
        </div>
      )}
      <div className="tl-wrap" ref={wrapRef}>
        <div className="tl" style={{ width: labelW + W }}>
          <div className="axis">{axis}</div>
          <div className="tl-rows">
            <div className="tl-bg" style={{ left: labelW, width: W }}>
              {grid}
              <div className="past-wash" style={{ left: 0, width: x(nowH) }} />
            </div>
            {rows}
          </div>
          {nowVisible && (
            <>
              <div className="nowt num" style={{ left: nowX }}>
                지금 {hm(now)}
              </div>
              <div className="nowl" style={{ left: nowX - 1 }} />
            </>
          )}
        </div>
      </div>
      <div className="tl-foot">
        <div className="legend">
          <span>
            <i className="g stay" />
            숙박·연박
          </span>
          <span>
            <i className="g short" />
            대실
          </span>
          <span>
            <i className="g rsv" />
            도착 예정
          </span>
          <span>
            <i className="g cln" />
            청소
          </span>
          <span>
            <i className="g chk" />
            점검
          </span>
          <span>
            <i className="g past" />
            지난 일
          </span>
        </div>
        <span>빈 칸을 누르면 그 시각에 바로 대실을 넣어요</span>
      </div>
      {layout === "tab" && nextChips.length > 0 && (
        <div className="tab-next">
          {nextChips.map((e) => (
            <button
              type="button"
              key={e.key}
              className={`nx ${e.hot ? "hot" : ""}`}
              onClick={() => onOpenEvent(e)}
            >
              <b className="num">{hm(e.at)}</b>
              <span>{chipText(e)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 목록에서 바로 누를 수 있는 버튼 */
export function eventAction(
  ctx: Ctx,
  e: DayEvent,
): { label: string; kind: string } | null {
  if (e.done) return null;
  if (e.kind === "cleanWait") return { label: "시작", kind: "outline-teal" };
  if (e.kind === "cleanEnd") return { label: "끝났어요", kind: "teal" };
  if (e.kind === "leave" && e.reservation) {
    const r = e.reservation;
    if (isHourly(r) || r.checkOut <= ctx.s.today)
      return { label: "퇴실", kind: e.hot ? "coral" : "" };
    return null;
  }
  if (e.kind === "arrive" && e.reservation) {
    const r = e.reservation;
    if (!r.roomIds.length) return { label: "배정", kind: "" };
    const room = ctx.s.rooms.find((x) => x.id === r.roomIds[0]);
    if (
      room &&
      room.cleaning === "clean" &&
      room.facility === "normal" &&
      canCheckInNow(ctx, r)
    )
      return { label: "체크인", kind: "" };
  }
  return null;
}

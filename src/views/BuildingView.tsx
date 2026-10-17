import { DoorOpen, LogIn, LogOut, MapPin, Moon, Timer } from "lucide-react";
import type { Reservation } from "../../shared/types";
import { Legend } from "../components/ui";
import {
  addDays,
  ampm,
  arrivalAt,
  channelName,
  dayDiff,
  type CommandFn,
  type Ctx,
  dayEvents,
  departureAt,
  fmtLeft,
  fmtLeftShort,
  floorsOf,
  hm,
  isHourly,
  longDate,
  type RoomView,
  stayNights,
  weekday,
  wonSign,
  type DayEvent,
} from "../lib";

export type Layout = "pc" | "tab" | "mob";

function outLine(ctx: Ctx, r: Reservation) {
  const { s } = ctx;
  const d = r.checkOut;
  const t = s.settings.checkOutTime;
  if (d < s.today) return `${t} 퇴실 지남`;
  if (d === s.today) return `오늘 ${t} 퇴실`;
  if (d === addDays(s.today, 1)) return `내일 ${t} 퇴실`;
  return `${Number(d.slice(8))}일(${weekday(d)}) ${t} 퇴실`;
}
function outShort(ctx: Ctx, r: Reservation) {
  const { s } = ctx;
  const d = r.checkOut;
  const h = Number(s.settings.checkOutTime.slice(0, 2));
  if (d <= s.today) return `오늘 ${h}시`;
  if (d === addDays(s.today, 1)) return `내일 ${h}시`;
  return `${Number(d.slice(8))}일 ${h}시`;
}
function stayDay(ctx: Ctx, r: Reservation) {
  const n = stayNights(r);
  const k = Math.min(n, Math.max(1, dayDiff(r.checkIn, ctx.bd) + 1));
  return n >= 2
    ? `${n}박 중 ${k}일째`
    : `${hm(r.checkedInAt || arrivalAt(ctx.s, r))} 입실`;
}
export function canCheckInNow(ctx: Ctx, r: Reservation) {
  const { s, now } = ctx;
  if (r.status !== "confirmed" || r.roomIds.length !== r.quantity) return false;
  if (isHourly(r))
    return (
      Date.parse(r.startAt!) - now <= 2 * 3600000 && Date.parse(r.endAt!) > now
    );
  return (
    (r.checkIn <= s.today && r.checkOut > s.today) ||
    (!!s.lateArrivalDate &&
      r.checkIn <= s.lateArrivalDate &&
      r.checkOut > s.lateArrivalDate)
  );
}

function Chip({ v }: { v: RoomView }) {
  if (v.status === "use")
    return v.kind === "대실" ? (
      <span className="chip kd">
        <Timer size={11} strokeWidth={2.4} />
        대실
      </span>
    ) : (
      <span className="chip k">
        <Moon size={11} strokeWidth={2.4} />
        {v.kind}
      </span>
    );
  return (
    <span
      className={`chip ${{ rsv: "r", vac: "v", cln: "c", chk: "x" }[v.status]}`}
    >
      {
        {
          rsv: "예약",
          vac: "빈방",
          cln: "청소",
          chk: v.room.facility === "blocked" ? "판매 중지" : "점검",
        }[v.status]
      }
    </span>
  );
}

export function RoomCell({
  ctx,
  v,
  layout,
  selected,
  busy,
  onOpen,
  quick,
}: {
  ctx: Ctx;
  v: RoomView;
  layout: Layout;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  quick: (
    v: RoomView,
    action: "checkin" | "checkout" | "cleanStart" | "cleanDone" | "open",
  ) => void;
}) {
  const { s, now } = ctx;
  const { room, stay, next, status } = v;
  const accent = room.color
    ? ({ ["--rcol" as string]: room.color } as React.CSSProperties)
    : undefined;
  const cls = `rc ${status} ${v.alert ? "alert" : ""} ${selected ? "sel" : ""} ${room.color ? "tinted" : ""} ${layout === "mob" ? "m" : ""}`;
  const btn = (
    label: string,
    action: Parameters<typeof quick>[1],
    kind = "",
  ) => (
    <button
      type="button"
      className={`btn sm ${kind}`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        quick(v, action);
      }}
    >
      {label}
    </button>
  );
  const cleanSince = room.cleaningSince ? Date.parse(room.cleaningSince) : now;
  const cleanEnd = cleanSince + s.settings.cleaningMinutes * 60000;
  const progress =
    stay && isHourly(stay) && v.totalMin
      ? Math.min(100, Math.max(0, (1 - (v.leftMin || 0) / v.totalMin) * 100))
      : 0;
  const aria = `${room.number}호 ${v.typeName} ${
    {
      use: `${v.kind} 사용중`,
      rsv: "예약",
      vac: "빈방",
      cln: "청소",
      chk: "점검",
    }[status]
  }${stay ? ` ${stay.guestName}` : next && status === "rsv" ? ` ${next.guestName}` : ""}${room.label ? ` 특수객실 ${room.label}` : ""}`;
  if (layout === "mob") {
    let st = "",
      gn = "",
      mi = "",
      col = "var(--ink)";
    if (status === "use" && stay) {
      st = v.kind!;
      gn = stay.guestName.replace(" (예시)", "");
      mi = isHourly(stay)
        ? `${fmtLeftShort(v.leftMin || 0)} 남음`
        : outShort(ctx, stay);
      col = isHourly(stay)
        ? v.alert
          ? "var(--shu-d)"
          : "var(--ai)"
        : v.alert
          ? "var(--shu-d)"
          : "var(--ink)";
    } else if (status === "rsv" && next) {
      st = "예약";
      gn = next.guestName.replace(" (예시)", "");
      mi = `${hm(arrivalAt(s, next))} 도착`;
      col = "var(--shu-d)";
    } else if (status === "vac") {
      st = "빈방";
      mi = "판매 가능";
      col = "var(--ink2)";
    } else if (status === "cln") {
      st = "청소";
      gn = room.cleaning === "cleaning" ? "진행 중" : "대기";
      mi =
        room.cleaning === "cleaning"
          ? `${hm(cleanEnd)} 끝`
          : room.cleaningSince
            ? `${fmtLeft((now - cleanSince) / 60000)}째`
            : "청소 필요";
      col = "var(--moegi-d)";
    } else {
      st = room.facility === "blocked" ? "판매 중지" : "점검";
      gn = v.issues[0]?.title || "";
      mi = facilityShort(room.facility);
      col = "var(--nezu)";
    }
    return (
      <button
        type="button"
        className={cls}
        style={accent}
        onClick={onOpen}
        aria-label={aria}
      >
        {status === "use" && (
          <span className={`kd ${v.kind === "대실" ? "short" : ""}`}>
            {v.kind === "대실" ? (
              <Timer size={10} strokeWidth={2.6} />
            ) : (
              <Moon size={10} strokeWidth={2.6} />
            )}
          </span>
        )}
        <span className="no num">{room.number}</span>
        <span className={`st st-${status}`}>{st}</span>
        <span className="gn">{gn || "\u00a0"}</span>
        <span className="mi num" style={{ color: col }}>
          {mi}
        </span>
        {status === "use" && stay && isHourly(stay) && (
          <span className="bar">
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </button>
    );
  }
  let gu: React.ReactNode = null,
    ft: React.ReactNode = null;
  if (status === "use" && stay) {
    gu = (
      <div className="gu">
        {stay.guestName} 님<small>{channelName(s, stay.channelId)}</small>
      </div>
    );
    if (isHourly(stay))
      ft = (
        <div className="ftw">
          <div className="ft center">
            <div className="big num">
              {(v.leftMin || 0) >= 0
                ? `${fmtLeft(v.leftMin || 0)} 남음`
                : `${fmtLeft(-(v.leftMin || 0))} 지남`}
            </div>
            {v.alert ? (
              btn("퇴실 처리", "checkout", "coral")
            ) : (
              <div className="sb">{hm(stay.endAt!)} 퇴실</div>
            )}
          </div>
          <div className="bar">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      );
    else
      ft = (
        <div className="ft">
          <div>
            <div className={`ln ${v.alert ? "warm" : ""}`}>
              {outLine(ctx, stay)}
            </div>
            <div className="sb">{stayDay(ctx, stay)}</div>
          </div>
          {v.canCheckout &&
            btn("퇴실 처리", "checkout", v.alert ? "coral" : "")}
        </div>
      );
  } else if (status === "rsv" && next) {
    gu = (
      <div className="gu">
        {next.guestName} 님<small>{channelName(s, next.channelId)}</small>
      </div>
    );
    ft = (
      <div className="ft">
        <div>
          <div className="ln warm">
            {hm(arrivalAt(s, next))} 도착<span className="opt"> 예정</span>
          </div>
          <div className="sb">
            {isHourly(next)
              ? `대실 · ${next.hours}시간`
              : `숙박 · ${stayNights(next)}박`}
          </div>
        </div>
        {canCheckInNow(ctx, next) && btn("체크인", "checkin")}
      </div>
    );
  } else if (status === "vac") {
    const later = next;
    gu = <div className="gu muted">비어 있어요</div>;
    ft = (
      <div className="ft">
        <div>
          <div className="ln">판매 가능</div>
          <div className="sb">
            {later
              ? `${hm(arrivalAt(s, later))} ${isHourly(later) ? "대실" : "숙박"} 예약`
              : "다음 예약 없음"}
          </div>
        </div>
        {btn("체크인", "open")}
      </div>
    );
  } else if (status === "cln") {
    const wait = room.cleaning === "dirty";
    gu = (
      <div className="gu semi">{wait ? "담당 배정 전" : "청소하고 있어요"}</div>
    );
    ft = (
      <div className="ft">
        <div>
          <div className="ln">{wait ? "기다리는 중" : "청소 중"}</div>
          <div className="sb">
            {wait
              ? `${room.cleaningSince ? fmtLeft((now - cleanSince) / 60000) + "째" : "청소 필요"}${next ? ` · ${hm(arrivalAt(s, next))} 도착` : ""}`
              : `${hm(cleanEnd)}쯤 끝나요`}
          </div>
        </div>
        {wait
          ? btn("시작", "cleanStart", "outline-teal")
          : btn("끝났어요", "cleanDone", "teal")}
      </div>
    );
  } else {
    gu = (
      <div className="gu semi">
        {v.issues[0]?.title || facilityShort(room.facility)}
      </div>
    );
    ft = (
      <div className="ft">
        <div>
          <div className="ln">
            {room.facility === "blocked" ? "판매 중지" : "점검 중"}
          </div>
          <div className="sb">
            {v.issues.length
              ? `인수인계 ${v.issues.length}건`
              : "객실 상태에서 판매 재개"}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={cls}
      style={accent}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.key === "Enter" || e.key === " ")
        ) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={aria}
    >
      <div className="h">
        <div className="hl-min">
          <div className="no num">{room.number}</div>
          <div className="ty">
            {v.typeName}
            {room.label && <span className="rtag">{room.label}</span>}
          </div>
        </div>
        <Chip v={v} />
      </div>
      {gu}
      {ft}
    </div>
  );
}
const facilityShort = (f: string) =>
  f === "blocked" ? "판매 중지" : f === "inspection" ? "점검 중" : "정상";

export function headline(ctx: Ctx, views: RoomView[]) {
  const used = views.filter((v) => v.status === "use");
  const soon = used
    .map((v) => ({
      v,
      at: v.stay ? departureAt(ctx.s, v.stay) : Infinity,
      today: v.stay && (isHourly(v.stay) || v.stay.checkOut <= ctx.s.today),
    }))
    .filter((x) => x.today)
    .sort((a, b) => a.at - b.at)[0];
  return { total: views.length, used: used.length, soon: soon?.v.room.number };
}

export function BuildingView({
  ctx,
  views,
  layout,
  selectedRoomId,
  busy,
  onOpenRoom,
  onOpenEvent,
  quick,
  side,
}: {
  ctx: Ctx;
  views: Map<string, RoomView>;
  layout: Layout;
  selectedRoomId?: string;
  busy: boolean;
  onOpenRoom: (roomId: string) => void;
  onOpenEvent: (e: DayEvent) => void;
  quick: (
    v: RoomView,
    action: "checkin" | "checkout" | "cleanStart" | "cleanDone" | "open",
  ) => void;
  side?: React.ReactNode;
  command: CommandFn;
}) {
  const { s, now } = ctx;
  const all = [...views.values()];
  const h = headline(ctx, all);
  const groups = floorsOf(s);
  const maxPerRow = layout === "mob" ? 4 : layout === "tab" ? 5 : 6;
  const events = dayEvents(ctx);
  const arrivals = events.filter((e) => e.kind === "arrive");
  const departures = events.filter((e) => e.kind === "leave");
  const cleaningLeft = s.rooms.filter((r) => r.cleaning !== "clean").length;
  const headlineNode = (
    <div className="hl">
      {h.total === 0 ? (
        <>아직 등록된 객실이 없어요. 설정에서 첫 객실을 등록해 주세요.</>
      ) : h.used === 0 ? (
        <>
          {h.total}실이 <u>모두 비어 있어요</u>.
        </>
      ) : (
        <>
          {h.total}실 중{" "}
          <u>
            {layout === "mob"
              ? `${h.used}실 사용중`
              : `${h.used}실에 손님이 계셔요`}
          </u>
          {layout === "mob" ? "," : "."}
          {layout === "mob" && <br />}
          {h.soon ? (
            <>
              {" "}
              곧 비는 방은 <em>{h.soon}호</em>예요.
            </>
          ) : (
            <> 오늘 나가는 손님은 없어요.</>
          )}
        </>
      )}
    </div>
  );
  const mv = (e: DayEvent) => (
    <button
      type="button"
      key={e.key}
      className={`mv ${e.hot && !e.done ? "hot" : ""} ${e.done ? "done" : ""}`}
      onClick={() => onOpenEvent(e)}
    >
      <span className="t num">{hm(e.at)}</span>
      <span className={`r num ${e.room ? "" : "none"}`}>
        {e.room?.number || "배정"}
      </span>
      <span className="w">
        <b>{e.reservation?.guestName} 님</b>
        <span>{e.sub}</span>
      </span>
      {e.hot && !e.done && <span className="tag">곧</span>}
    </button>
  );
  const building = (
    <div className={`bld ${layout}`}>
      {groups.map((g, gi) => (
        <div className="bld-one" key={g.building}>
          <div className="roof">
            {layout !== "mob" && <div className="ant" />}
            <div className="par" />
            <div className="sign">
              <i />
              {groups.length > 1 ? `HOTORI · ${g.building}` : "HOTORI 호토리"}
            </div>
            {layout !== "mob" && <div className="tank" />}
            <div className="slab" />
          </div>
          {g.floors.map((f, fi) => {
            const rooms = f.rooms.map((r) => views.get(r.id)!).filter(Boolean);
            const used = rooms.filter((v) => v.status === "use").length;
            const wrap = rooms.length > maxPerRow;
            const half = Math.ceil(rooms.length / 2);
            const fc = f.color
              ? ({ ["--fc" as string]: f.color } as React.CSSProperties)
              : undefined;
            const cell = (v: RoomView) => (
              <RoomCell
                key={v.room.id}
                ctx={ctx}
                v={v}
                layout={layout}
                selected={selectedRoomId === v.room.id}
                busy={busy}
                onOpen={() => onOpenRoom(v.room.id)}
                quick={quick}
              />
            );
            return (
              <div
                className={`floor ${f.color ? "colored" : ""}`}
                key={f.key}
                style={fc}
              >
                <div className="flabel">
                  <b className="num">
                    {f.floor < 0 ? `B${-f.floor}` : f.floor}
                    <small>F</small>
                  </b>
                  <span>
                    {used}/{rooms.length} 사용중
                  </span>
                </div>
                <div
                  className={`fbody ${wrap ? "wrap" : ""}`}
                  style={{
                    ["--per" as string]: Math.min(maxPerRow, rooms.length),
                  }}
                >
                  {wrap || rooms.length < 4 ? (
                    rooms.map(cell)
                  ) : (
                    <>
                      {rooms.slice(0, half).map(cell)}
                      <div className="ev" aria-hidden="true">
                        {gi === 0 && fi === 0 && layout !== "mob"
                          ? "엘리베이터"
                          : ""}
                      </div>
                      {rooms.slice(half).map(cell)}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {gi === groups.length - 1 && (
            <div className="lobby">
              <DoorOpen size={layout === "mob" ? 14 : 16} />
              1F 로비 · 프런트{layout === "mob" ? "" : " · 주차장 입구"}
              <span className="pill here">
                <MapPin size={12} strokeWidth={2.4} />
                지금 계신 곳
              </span>
            </div>
          )}
          <div className="ground" />
        </div>
      ))}
    </div>
  );
  const sideColumn = side ?? (
    <aside className="side" aria-label="오늘 들고남">
      <div className="s-t">
        <h3>오늘 들고남</h3>
        <span>
          들어와요 {arrivals.filter((e) => !e.done).length} · 나가요{" "}
          {departures.filter((e) => !e.done).length}
        </span>
      </div>
      <div className="wave" />
      <div className="side-scroll">
        <div className="grp">
          <h4>
            <LogIn size={13} strokeWidth={2.4} />
            <b>들어와요</b>
          </h4>
          {arrivals.length ? (
            arrivals.map(mv)
          ) : (
            <p className="quiet">오늘 도착 예정이 없어요.</p>
          )}
        </div>
        <div className="grp">
          <h4>
            <LogOut size={13} strokeWidth={2.4} />
            <b>나가요</b>
          </h4>
          {departures.length ? (
            departures.map(mv)
          ) : (
            <p className="quiet">오늘 퇴실 예정이 없어요.</p>
          )}
        </div>
      </div>
      <div className="sfoot">
        <div>
          <span>오늘 판매{s.property.demo ? " (예시)" : ""}</span>
          <b className="num">{wonSign(s.dashboard.revenue)}</b>
        </div>
        <div>
          <span>대실 · 숙박</span>
          <b>
            {s.dashboard.hourlyCount}건 · {s.dashboard.soldRooms}실
          </b>
        </div>
        <div>
          <span>청소 남은 방</span>
          <b>{cleaningLeft}실</b>
        </div>
      </div>
    </aside>
  );
  const upcoming = events
    .filter(
      (e) =>
        !e.done &&
        (e.kind === "arrive" || e.kind === "leave") &&
        e.at >= now - 3600000,
    )
    .slice(0, 6);
  return (
    <div className={`a-body ${layout}`}>
      <div className="a-main">
        <div className="headline">
          <div>
            <div className="hl-date">
              {longDate(kstDateOf(now))} ·{" "}
              <span className="num">{ampm(now)}</span>
            </div>
            {headlineNode}
          </div>
          {layout === "pc" && !side && <Legend />}
        </div>
        {layout !== "pc" && <Legend compact={layout === "mob"} />}
        {building}
        {layout === "tab" && (
          <div className="tab-moves">
            <div className="grp">
              <h4>
                <LogIn size={13} strokeWidth={2.4} />
                <b>들어와요 {arrivals.filter((e) => !e.done).length}</b>
              </h4>
              {arrivals.filter((e) => !e.done).map(mv)}
            </div>
            <div className="grp">
              <h4>
                <LogOut size={13} strokeWidth={2.4} />
                <b>나가요 {departures.filter((e) => !e.done).length}</b>
                {departures.some((e) => e.done) &&
                  ` · 끝난 ${departures.filter((e) => e.done).length}건 숨김`}
              </h4>
              {departures.filter((e) => !e.done).map(mv)}
            </div>
          </div>
        )}
        {layout === "mob" && upcoming.length > 0 && (
          <div className="mvc-row">
            <span className="lb">다음</span>
            {upcoming.map((e) => (
              <button
                type="button"
                key={e.key}
                className={`mvc ${e.hot ? "hot" : ""}`}
                onClick={() => onOpenEvent(e)}
              >
                <b className="num">{hm(e.at)}</b>
                <span>
                  {e.room?.number || "미배정"}{" "}
                  {e.kind === "arrive" ? "도착" : "퇴실"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {layout === "pc" && sideColumn}
    </div>
  );
}
const kstDateOf = (ms: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));

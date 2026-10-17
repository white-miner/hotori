import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
} from "lucide-react";
import type { AppState, Report, Reservation } from "../../shared/types";
import { StatusPill } from "../components/ReservationForm";
import { Empty } from "../components/ui";
import {
  addDays,
  api,
  channelName,
  hm,
  isHourly,
  isISODate,
  kindOf,
  longDate,
  money,
  roomNumbers,
  shortDate,
  stayNights,
  won,
} from "../lib";

type Filter = "arrivals" | "departures" | "staying" | "hourly" | "all";
export function ReservationsView({
  s,
  date,
  onDate,
  refreshing,
  onOpen,
  onNew,
}: {
  s: AppState;
  date: string;
  onDate: (d: string) => void;
  refreshing: boolean;
  onOpen: (r: Reservation) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const d = s.dashboard;
  const list = s.reservations
    .filter((r) => {
      if (filter === "all") return true;
      if (r.status === "cancelled") return false;
      if (filter === "hourly") return isHourly(r) && r.checkIn === date;
      if (filter === "arrivals") return r.checkIn === date;
      if (filter === "departures")
        return (
          r.checkOut === date ||
          (date === s.today &&
            r.status === "checked_in" &&
            !isHourly(r) &&
            r.checkOut < s.today)
        );
      return (
        r.status === "checked_in" ||
        (r.checkIn <= date && r.checkOut > date && r.status !== "checked_out")
      );
    })
    .filter((r) =>
      `${r.guestName} ${r.phone} ${r.id} ${roomNumbers(s, r)}`
        .toLocaleLowerCase()
        .includes(q.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        b.checkIn.localeCompare(a.checkIn) ||
        (a.startAt || "").localeCompare(b.startAt || ""),
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>예약</h1>
          <p>
            {longDate(date)} 숙박 <b>{d.soldRooms}</b>/{d.totalRooms}실 판매 ·
            가동률 {d.occupancy}% · 대실 {d.hourlyCount}건 · 방 배정 전{" "}
            {d.unassigned}실
          </p>
        </div>
        <button type="button" className="btn coral big" onClick={onNew}>
          <Plus size={17} />새 숙박 예약
        </button>
      </div>
      <div className="toolbar">
        <div className="datebox">
          <button
            type="button"
            className="icb sm"
            aria-label="이전 날짜"
            disabled={date <= s.limits.historyStart || refreshing}
            onClick={() => onDate(addDays(date, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            aria-label="운영 기준일"
            type="date"
            value={date}
            min={s.limits.historyStart}
            max={addDays(s.limits.futureEnd, -1)}
            onChange={(e) => e.target.value && onDate(e.target.value)}
          />
          <button
            type="button"
            className="icb sm"
            aria-label="다음 날짜"
            disabled={date >= addDays(s.limits.futureEnd, -1) || refreshing}
            onClick={() => onDate(addDays(date, 1))}
          >
            <ChevronRight size={16} />
          </button>
          {date !== s.today && (
            <button
              type="button"
              className="text-button"
              onClick={() => onDate(s.today)}
            >
              오늘
            </button>
          )}
        </div>
        <div className="seg2" role="tablist" aria-label="예약 보기">
          {(
            [
              ["all", "전체"],
              ["arrivals", "도착"],
              ["departures", "퇴실"],
              ["staying", "투숙 중"],
              ["hourly", "대실"],
            ] as const
          ).map(([k, l]) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === k}
              key={k}
              className={filter === k ? "on" : ""}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="searchbox inline">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="손님, 연락처, 방 번호"
            aria-label="예약 검색"
          />
        </label>
      </div>
      <div className="inv-line" aria-label="타입별 남은 방">
        {d.inventory.map((t) => {
          const name = s.roomTypes.find((x) => x.id === t.typeId)?.name;
          const pct = t.total
            ? Math.round((t.sold / Math.max(1, t.total - t.blocked)) * 100)
            : 0;
          return (
            <div key={t.typeId} className="inv">
              <span>{name}</span>
              <b className="num">남은 {t.available}</b>
              <span className="inv-bar">
                <i style={{ width: `${Math.min(100, pct)}%` }} />
              </span>
              <small>
                {t.sold}/{t.total - t.blocked}실
                {t.blocked ? ` · 판매 중지 ${t.blocked}` : ""}
              </small>
            </div>
          );
        })}
      </div>
      <div className="table">
        <div className="tr th">
          <span>손님</span>
          <span>일정</span>
          <span>방</span>
          <span>채널</span>
          <span className="right">금액</span>
          <span>상태</span>
        </div>
        {list.length ? (
          list.map((r) => (
            <button
              type="button"
              className="tr"
              key={r.id}
              onClick={() => onOpen(r)}
            >
              <span className="who">
                <b>{r.guestName}</b>
                <small>{r.phone || r.id.slice(0, 8)}</small>
              </span>
              <span>
                <span className={`kind ${isHourly(r) ? "h" : "n"}`}>
                  {kindOf(r)}
                </span>{" "}
                {isHourly(r) ? (
                  <span className="num">
                    {shortDate(r.checkIn)} {hm(r.startAt!)}–{hm(r.endAt!)}
                  </span>
                ) : (
                  <span className="num">
                    {shortDate(r.checkIn)} → {shortDate(r.checkOut)} ·{" "}
                    {stayNights(r)}박
                    {r.quantity > 1 ? ` · ${r.quantity}실` : ""}
                  </span>
                )}
              </span>
              <span className="num">
                {roomNumbers(s, r) || <em className="warm">배정 전</em>}
              </span>
              <span>{channelName(s, r.channelId)}</span>
              <span className="right num">{won(r.totalAmount)}</span>
              <span>
                <StatusPill status={r.status} />
              </span>
            </button>
          ))
        ) : (
          <Empty
            title="해당하는 예약이 없어요"
            text="날짜나 보기를 바꾸거나 새 예약을 등록해 주세요."
          />
        )}
      </div>
      <p className="helper">
        현재 플랜 조회 범위: {s.limits.historyStart} ~{" "}
        {addDays(s.limits.futureEnd, -1)}
      </p>
    </div>
  );
}

export function GuestsView({
  s,
  now,
  onOpen,
}: {
  s: AppState;
  now: number;
  onOpen: (r: Reservation) => void;
}) {
  const [q, setQ] = useState("");
  const groups = new Map<string, Reservation[]>();
  for (const r of s.reservations) {
    if (r.status === "cancelled") continue;
    const key = `${r.guestName.trim()}|${r.phone.trim()}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const rows = [...groups.entries()]
    .map(([key, list]) => {
      const sorted = list
        .slice()
        .sort((a, b) => b.checkIn.localeCompare(a.checkIn));
      const inHouse = list.find((r) => r.status === "checked_in");
      const upcoming = list.find((r) => r.status === "confirmed");
      return {
        key,
        name: sorted[0].guestName,
        phone: sorted[0].phone,
        list: sorted,
        inHouse,
        upcoming,
        total: list.reduce((n, r) => n + r.totalAmount, 0),
      };
    })
    .filter((g) =>
      `${g.name} ${g.phone} ${g.list.map((r) => roomNumbers(s, r)).join(" ")}`
        .toLocaleLowerCase()
        .includes(q.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!b.inHouse) - Number(!!a.inHouse) ||
        Number(!!b.upcoming) - Number(!!a.upcoming) ||
        b.list[0].checkIn.localeCompare(a.list[0].checkIn),
    );
  const here = rows.filter((g) => g.inHouse).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>손님</h1>
          <p>
            지금 <b>{here}팀</b>이 묵고 계셔요 · 조회 기간 안 손님 {rows.length}
            팀
          </p>
        </div>
        <label className="searchbox inline">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름, 연락처, 방 번호"
            aria-label="손님 검색"
          />
        </label>
      </div>
      <div className="table guests">
        <div className="tr th">
          <span>손님</span>
          <span>지금</span>
          <span>최근 이용</span>
          <span className="right">이용 횟수</span>
          <span className="right">이용 금액</span>
        </div>
        {rows.length ? (
          rows.map((g) => {
            const r = g.inHouse || g.upcoming || g.list[0];
            return (
              <button
                type="button"
                className="tr"
                key={g.key}
                onClick={() => onOpen(r)}
              >
                <span className="who">
                  <b>{g.name}</b>
                  <small>{g.phone || "연락처 없음"}</small>
                </span>
                <span>
                  {g.inHouse ? (
                    <span className="pill-s blue">
                      {roomNumbers(s, g.inHouse)}호 {kindOf(g.inHouse)}
                      {isHourly(g.inHouse)
                        ? ` · ${Math.max(0, Math.round((Date.parse(g.inHouse.endAt!) - now) / 60000))}분 남음`
                        : ""}
                    </span>
                  ) : g.upcoming ? (
                    <span className="pill-s amber">
                      {shortDate(g.upcoming.checkIn)}{" "}
                      {isHourly(g.upcoming) ? hm(g.upcoming.startAt!) : ""} 예정
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
                <span className="num">
                  {shortDate(g.list[0].checkIn)} · {kindOf(g.list[0])} ·{" "}
                  {channelName(s, g.list[0].channelId)}
                </span>
                <span className="right num">{g.list.length}번</span>
                <span className="right num">{won(g.total)}</span>
              </button>
            );
          })
        ) : (
          <Empty title="찾는 손님이 없어요" />
        )}
      </div>
      <p className="helper">
        손님은 이름과 연락처가 같으면 한 팀으로 묶어요. 실제 손님 정보는 아직
        데모에 입력하지 마세요.
      </p>
    </div>
  );
}

export function SettleView({
  s,
  goSettings,
}: {
  s: AppState;
  goSettings: () => void;
}) {
  const [start, setStart] = useState(s.businessDate || s.today);
  const [end, setEnd] = useState(s.businessDate || s.today);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  async function load(e?: FormEvent) {
    e?.preventDefault();
    if (!isISODate(start) || !isISODate(end) || end < start) {
      setErr("시작일과 종료일을 올바르게 선택해 주세요.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      setReport(await api<Report>(`/api/reports?start=${start}&end=${end}`));
    } catch (x) {
      setReport(null);
      setErr((x as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const hourlyPct =
    report && report.revenue
      ? Math.round((report.hourlyRevenue / report.revenue) * 100)
      : 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>정산</h1>
          <p>
            숙박은 묵은 날짜, 대실은 영업일(06시 기준)로 모아요. 정산액은 채널
            수수료를 뺀 예상 금액이에요.
          </p>
        </div>
      </div>
      <form className="toolbar" onSubmit={load}>
        <label className="flabel2 inline">
          시작일
          <input
            type="date"
            required
            value={start}
            min={s.limits.historyStart}
            max={addDays(s.limits.futureEnd, -1)}
            onChange={(e) => (
              setStart(e.target.value),
              s.plan === "free" && setEnd(e.target.value)
            )}
          />
        </label>
        <span className="muted">—</span>
        <label className="flabel2 inline">
          종료일
          <input
            type="date"
            required
            value={end}
            min={start || s.limits.historyStart}
            max={addDays(s.limits.futureEnd, -1)}
            disabled={s.plan === "free"}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button className="btn solid" disabled={loading}>
          {loading ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Search size={16} />
          )}
          조회
        </button>
        {s.plan === "free" && (
          <button type="button" className="text-button" onClick={goSettings}>
            <LockKeyhole size={13} /> 기간 조회는 프로에서
          </button>
        )}
      </form>
      {err && (
        <div className="form-error" role="alert">
          {err}
        </div>
      )}
      {report && (
        <>
          <section className="settle-sum">
            <p className="settle-line">
              {report.start === report.end
                ? longDate(report.start)
                : `${shortDate(report.start)} ~ ${shortDate(report.end)}`}{" "}
              판매 <b className="num">{won(report.revenue)}</b>
              <span>
                · 수수료 {won(report.fee)} · 예상 정산{" "}
                <b className="num">{won(report.netRevenue)}</b>
              </span>
            </p>
            <div
              className="split"
              aria-label={`대실 ${hourlyPct}%, 숙박 ${100 - hourlyPct}%`}
            >
              <i
                className="sp-n"
                style={{ flex: Math.max(0.0001, report.nightlyRevenue) }}
              />
              <i
                className="sp-h"
                style={{ flex: Math.max(0.0001, report.hourlyRevenue) }}
              />
            </div>
            <div className="split-legend">
              <span>
                <i className="g stay" />
                숙박 <b className="num">{won(report.nightlyRevenue)}</b> ·{" "}
                {report.sold}실·박
              </span>
              <span>
                <i className="g short" />
                대실 <b className="num">{won(report.hourlyRevenue)}</b> ·{" "}
                {report.hourlyCount}건
              </span>
            </div>
          </section>
          <div className="settle-grid">
            <div className="table">
              <div className="tr th settle">
                <span>날짜</span>
                <span className="right">숙박</span>
                <span className="right">대실</span>
                <span className="right">수수료</span>
                <span className="right">예상 정산</span>
              </div>
              {report.days.map((d) => (
                <div className="tr settle" key={d.date}>
                  <span className="num">{d.date}</span>
                  <span className="right num">
                    {money(d.nightlyRevenue)}
                    <small> · {d.sold}실</small>
                  </span>
                  <span className="right num">
                    {money(d.hourlyRevenue)}
                    <small> · {d.hourlyCount}건</small>
                  </span>
                  <span className="right num">{money(d.fee)}</span>
                  <b className="right num">{money(d.netRevenue)}</b>
                </div>
              ))}
            </div>
            <div className="table">
              <div className="tr th chn">
                <span>채널</span>
                <span className="right">판매</span>
              </div>
              {report.channels.map((c) => (
                <div className="tr chn" key={c.channelId}>
                  <span>{channelName(s, c.channelId)}</span>
                  <span className="right num">{won(c.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

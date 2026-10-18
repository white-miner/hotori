// 주차 현황: 그날 밤 묵는 손님 + 그날 대실의 차량 (번호 · 방 · 손님). 공유 화면에는 차량번호가 없어요.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { type Booking, addDays, dayLabel } from "../shared/ledger";
import { ARRIVAL_LABEL, type ParkFilter, filterParking, parkingRows, parkingTotals } from "../shared/parking";
import { PlatBadge, type lookups } from "./ui";

type L = ReturnType<typeof lookups>;
const FILTERS: { id: ParkFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "car", label: "차량" },
  { id: "walk", label: "도보" },
  { id: "unset", label: "안 적음" },
];

export default function ParkingView({ bookings, L, date, today, setDate, readOnly, onOpen }: { bookings: Booking[]; L: L; date: string; today: string; setDate: (d: string) => void; readOnly: boolean; onOpen: (b: Booking) => void }) {
  const [f, setF] = useState<ParkFilter>("car");
  const [q, setQ] = useState("");
  const roomNo = (id: string | null) => (id ? (L.roomLabel(id) ?? "?") : "미배정");
  const rows = useMemo(() => parkingRows(bookings, date), [bookings, date]);
  const tot = parkingTotals(rows);
  const shown = filterParking(rows, f, q, roomNo).sort((a, b) => (a.arrival === b.arrival ? 0 : a.arrival === "car" ? -1 : b.arrival === "car" ? 1 : a.arrival === "walk" ? -1 : 1) || roomNo(a.roomId).localeCompare(roomNo(b.roomId), "ko", { numeric: true }));
  const counts: Record<ParkFilter, number> = { all: rows.length, car: tot.carRooms, walk: tot.walk, unset: tot.unset };
  return (
    <section className="park">
      <div className="hl">
        <div>
          <div className="hl-t">
            <h1>주차 현황</h1>
          </div>
          <div className="when">
            {dayLabel(date)}
            {date === today ? " · 오늘" : ""} 밤 묵는 손님 · 그날 대실
          </div>
        </div>
        <div className="park-nav">
          <button className="ar" aria-label="전날" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft size={18} />
          </button>
          <b>{dayLabel(date)}</b>
          <button className="ar" aria-label="다음날" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight size={18} />
          </button>
          {date !== today ? (
            <button className="chip sm" onClick={() => setDate(today)}>
              오늘
            </button>
          ) : null}
        </div>
      </div>
      <div className="park-sum">
        <span>
          차량 <b className="num">{tot.cars}</b>대 <span className="muted">· {tot.carRooms}실</span>
        </span>
        <span>
          도보 <b className="num">{tot.walk}</b>실
        </span>
        <span className="muted">안 적음 {tot.unset}실</span>
      </div>
      <div className="park-f">
        <div className="seg sm">
          {FILTERS.map((x) => (
            <button key={x.id} className={f === x.id ? "on" : ""} onClick={() => setF(x.id)}>
              {x.label} <span className="muted">{counts[x.id]}</span>
            </button>
          ))}
        </div>
        <label className="inp sm park-q">
          <Search size={14} />
          <input value={q} placeholder={readOnly ? "방 · 이름" : "차량번호 · 방 · 이름"} aria-label="주차 찾기" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="park-list">
        <div className="prow-h">
          {readOnly ? null : <span>차량번호</span>}
          <span>방</span>
          <span>손님</span>
          <span className="r">대수</span>
        </div>
        {shown.length ? (
          shown.map((r) => (
            <div key={r.b.id} className={`prow-i ${r.arrival ?? "unset"} ${readOnly ? "ro" : ""}`} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0} onClick={() => onOpen(r.b)} onKeyDown={(e) => e.key === "Enter" && onOpen(r.b)}>
              {readOnly ? null : (
                <span className="pl">
                  {r.arrival === "car" ? (r.plates.length ? r.plates.map((p) => <b key={p}>{p}</b>) : <span className="muted">번호 안 적음</span>) : <span className="muted">{r.arrival ? ARRIVAL_LABEL[r.arrival] : "—"}</span>}
                </span>
              )}
              <span className="rm num">{roomNo(r.roomId)}</span>
              <span className="gn">
                <PlatBadge p={L.plats.get(r.b.platformId)} /> {r.b.guestName}
                {r.when === "in" ? <small className="muted"> · 오늘 입실</small> : r.when === "dayuse" ? <small className="muted"> · 대실 {r.b.startTime}~{r.b.endTime}</small> : null}
              </span>
              <span className="r num">{r.arrival === "car" ? `${r.cars}대` : r.arrival === "walk" ? "도보" : "—"}</span>
            </div>
          ))
        ) : (
          <div className="park-empty muted">{q ? "찾는 차량이 없어요" : f === "car" ? "이날 차량으로 오는 손님이 없어요" : "해당하는 손님이 없어요"}</div>
        )}
      </div>
    </section>
  );
}

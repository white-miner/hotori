import { addDays, dayLabel, stockTable, type Booking, type HotelSettings, typeLabel, usableTypes, won } from "../shared/ledger";
import { buildGroupDailyPlan, type GroupDailyPlan } from "../shared/groupDailyPlan";
import { GROUP_ROOMS_MAX } from "../shared/group";

export default function GroupDailyPlanFields(p: { s: HotelSettings; bookings: Booking[]; checkIn: string; nights: number; plan: GroupDailyPlan; onChange: (plan: GroupDailyPlan) => void; disabled?: boolean }) {
  const types = usableTypes(p.s.types).filter((t) => typeLabel(t));
  const dates = Array.from({ length: p.nights }, (_, i) => addDays(p.checkIn, i));
  const stock = stockTable(p.s, p.bookings, dates);
  const result = buildGroupDailyPlan(p.s, p.checkIn, p.nights, p.plan);
  const patch = (id: string, date: string, key: "rooms" | "rate", raw: string) => {
    const value = raw === "" ? null : Number(raw);
    const cell = p.plan[id]?.[date] ?? { rooms: null, rate: null };
    p.onChange({ ...p.plan, [id]: { ...p.plan[id], [date]: { ...cell, [key]: value } } });
  };
  return <div className="group-daily-plan" aria-label="날짜별 객실·요금">
    <p>날짜마다 실제 숙박할 실 수와 객실당 요금을 입력해 주세요. 실 수가 줄어드는 날은 해당 객실의 예정 퇴실일로 저장돼요.</p>
    <div className="chips" aria-label="일정에 넣을 객실 타입">{types.map((t) => <button type="button" className={`chip ${p.plan[t.id] ? "on" : ""}`} key={t.id} disabled={p.disabled} aria-pressed={!!p.plan[t.id]} onClick={() => { const next = { ...p.plan }; if (next[t.id]) delete next[t.id]; else next[t.id] = {}; p.onChange(next); }}>{typeLabel(t)}</button>)}</div>
    {types.filter((t) => p.plan[t.id]).map((t) => <section className="group-daily-type" key={t.id}>
      <h3>{typeLabel(t)}</h3>
      <div className="group-daily-scroll"><table><thead><tr><th>숙박일</th><th>실 수</th><th>객실당 요금</th><th>소계</th></tr></thead><tbody>{dates.map((date) => {
        const cell = p.plan[t.id]?.[date], rooms = cell?.rooms ?? 0, rate = cell?.rate;
        const left = (stock.get(t.id)?.get(date) ?? 0) - rooms;
        return <tr key={date}><th>{dayLabel(date)}<small className={left < 0 ? "tred" : "muted"}>저장 후 잔여 {left}실</small></th>
          <td><input className="inp num" type="number" min={0} max={GROUP_ROOMS_MAX} inputMode="numeric" placeholder="0" disabled={p.disabled} aria-label={`${typeLabel(t)} ${date} 실 수`} value={cell?.rooms ?? ""} onChange={(e) => patch(t.id, date, "rooms", e.target.value)} /></td>
          <td><input className="inp num" type="number" min={0} max={100000000} inputMode="numeric" placeholder="원" disabled={p.disabled} aria-label={`${typeLabel(t)} ${date} 객실당 요금`} value={rate ?? ""} onChange={(e) => patch(t.id, date, "rate", e.target.value)} /></td>
          <td>{rooms && rate != null ? `${won(rooms * rate)}원` : "—"}</td></tr>;
      })}</tbody></table></div>
    </section>)}
    {result.days.length > 0 ? <div className="group-daily-summary" aria-label="날짜별 예약 합계">{result.days.map((d) => <div key={d.date}><b>{dayLabel(d.date)}</b><span>{d.rooms}실 · {won(d.total)}원</span><small>새 입실 {d.arrivals}실 · 예정 퇴실 {d.departures}실</small></div>)}{result.members.length > 0 ? <div><b>{dayLabel(addDays(p.checkIn, p.nights))}</b><span>예정 퇴실 {result.days.at(-1)!.rooms}실</span><small>일정 종료 · 이날 숙박 요금 없음</small></div> : null}<strong>총 {result.members.length}개 예약 · {result.roomNights}객실박 · {won(result.total)}원</strong></div> : null}
    {result.error && Object.keys(p.plan).length > 0 ? <p role="status">{result.error}</p> : null}
    <p className="muted sm">같은 타입의 기존 객실부터 연박으로 이어지고, 늘어난 실 수는 새 입실로 기록돼요. 호실은 저장 후 배정하며 객실별 요금도 따로 수정할 수 있어요. 예정 퇴실일에 자동 퇴실 처리되지는 않아요.</p>
  </div>;
}

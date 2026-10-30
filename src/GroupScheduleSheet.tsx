import { useMemo, useRef, useState } from "react";
import { addDays, dayLabel, daysBetween, fitSegments, roomOnNight, STAY_NIGHTS_MAX, stockTable, type Booking, won } from "../shared/ledger";
import { balanceLabel, groupLedger } from "../shared/groupLedger";
import { extrasTotal, occupiedNightDates } from "../shared/nightrates";
import { scheduleClashes, scheduleDirty, scheduleEdit, scheduleLock, schedulePlan, validDate, type ScheduleChange, type ScheduleEdit } from "../shared/groupSchedule";
import type { HotelData } from "./data";
import { lookups } from "./ui";
import { askConfirm } from "./ConfirmDialog";

export default function GroupScheduleSheet({ data, groupId, today, onClose, onSaved }: {
  data: HotelData; groupId: string; today: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const s = data.hotel!.settings, L = lookups(s);
  const membersNow = data.bookings.filter(b => b.groupId === groupId);
  const [base, setBase] = useState(() => membersNow);
  const [edits, setEdits] = useState<Record<string, ScheduleEdit>>({});
  const firstDate = base.filter(b => !scheduleLock(b)).map(b => b.checkIn).sort()[0] ?? today;
  const [anchor, setAnchor] = useState(firstDate);
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const dates = occupiedNightDates(anchor, 7);
  const name = base[0]?.groupName || "단체";
  const info = data.groups.get(groupId);
  const rows = base.map(b => { const edit = edits[b.id] ?? scheduleEdit(b); const plan = schedulePlan(b, edit); return { b, edit, plan, dirty: scheduleDirty(b, edit), reason: scheduleLock(b) }; });
  const changes: ScheduleChange[] = rows.filter(r => r.plan.patch).map(r => ({ before: r.b, patch: r.plan.patch! }));
  const pending = rows.filter(r => r.dirty);
  const invalid = pending.find(r => r.plan.error);
  const byId = new Map(changes.map(c => [c.before.id, c.patch]));
  // 결제는 최신 수납 기록을 사용하며 수정 대상의 일정/요금만 미리 덮어 본다.
  const preview = membersNow.map(b => {
    const row = rows.find(r => r.b.id === b.id);
    if (!row?.dirty || row.reason || !validDate(row.edit.out)) return b;
    const n = daysBetween(b.checkIn, row.edit.out);
    if (n < 1 || n > STAY_NIGHTS_MAX) return b;
    return { ...b, ...byId.get(b.id), nights: n, segments: fitSegments(b.segments, b.roomId, n) };
  });
  const opts = { extras: (info?.extras ?? []).reduce((n, x) => n + x.amount, 0) };
  const lump = (info?.payments ?? []).reduce((n, p) => n + p.amount, 0);
  const beforeLedger = groupLedger(membersNow, lump, today, opts), afterLedger = groupLedger(preview, lump, today, opts);
  const allNext = data.bookings.map(b => preview.find(p => p.id === b.id) ?? b);
  const stock = useMemo(() => stockTable(s, allNext, dates), [s, allNext, anchor]);
  const clashes = scheduleClashes(data.bookings, changes);
  const label = (b: Booking) => b.roomId ? `${L.roomLabel(b.roomId) ?? "?"}호` : `${L.types.get(b.typeId)?.name ?? "객실"} · 미배정 ${base.indexOf(b) + 1}`;
  const patch = (b: Booking, p: Partial<ScheduleEdit>) => { setError(null); setEdits(old => ({ ...old, [b.id]: { ...(old[b.id] ?? scheduleEdit(b)), ...p } })); };
  const changeOut = (b: Booking, out: string) => patch(b, { out, openEnded: false });
  const close = async () => {
    if (lock.current) return;
    if (pending.length && !await askConfirm({ title: "수정 내용을 닫을까요?", body: "아직 저장하지 않은 일정·요금은 반영되지 않습니다.", confirmLabel: "저장하지 않고 닫기" })) return;
    onClose();
  };
  const reload = async () => {
    if (!await askConfirm({ title: "최신 일정 불러오기", body: "미저장 수정은 지우고 현재 예약을 불러옵니다.", confirmLabel: "불러오기" })) return;
    await data.refresh();
    // refresh가 반영된 다음 렌더의 최신 데이터로 다시 시작할 수 있도록 창을 닫는다.
    onClose(); onSaved("최신 예약을 불러왔습니다. 일정·요금 수정을 다시 열어 주세요.");
  };
  const save = async () => {
    if (lock.current || !pending.length) return;
    if (invalid) { setError(`${label(invalid.b)} · ${invalid.plan.error}`); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const changedDates = [...new Set(changes.flatMap(c => occupiedNightDates(c.before.checkIn, c.patch.nights ?? 0)))];
      const allStock = stockTable(s, allNext, changedDates);
      const over = [...new Set(changes.flatMap(c => occupiedNightDates(c.before.checkIn, c.patch.nights ?? 0).filter(d => (allStock.get(c.before.typeId)?.get(d) ?? 0) < 0)))];
      const ok = await askConfirm({ title: `${changes.length}객실 일정·요금 저장`, body: [
        `청구 ${won(beforeLedger.due)}원 → ${won(afterLedger.due)}원. 결제 ${won(beforeLedger.paid)}원은 그대로입니다.`,
        `변경 후 ${balanceLabel(afterLedger)}. 배정 호실·예약번호·수납 내역을 유지하며 실제 퇴실 처리하지 않습니다.`,
        clashes.length ? `연장한 밤에 다른 예약과 객실 겹침 ${clashes.length}건이 있습니다.` : "",
        over.length ? `타입 재고 초과 날짜 ${over.map(dayLabel).join(", ")}. 기존 예약을 확인해 주세요.` : "",
      ].filter(Boolean).join("\n"), confirmLabel: "일정·요금 저장" });
      if (!ok) return;
      const result = await data.saveGroupSchedule(groupId, changes);
      if (result.saved.length) {
        const done = new Map(result.saved.map(b => [b.id, b]));
        setBase(bs => bs.map(b => done.get(b.id) ?? b));
        setEdits(es => Object.fromEntries(Object.entries(es).filter(([id]) => !done.has(id))));
        for (const b of result.saved) {
          const was = changes.find(c => c.before.id === b.id)!.before;
          void data.logChange({ kind: "stay", groupId, bookingId: b.id, summary: `단체 일정·요금 수정 · ${label(was)} · 퇴실 ${addDays(was.checkIn, was.nights ?? 1)} → ${addDays(b.checkIn, b.nights ?? 1)} · ${won(was.price)}원 → ${won(b.price)}원` });
        }
      }
      if (result.error) setError(`${result.saved.length}/${changes.length}객실 저장 확인. ${result.error} 저장된 객실은 다시 쓰지 않습니다.`);
      else { onSaved(`${name} · ${result.saved.length}객실 일정·요금 수정 완료`); onClose(); }
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다. 최신 정보를 확인해 주세요."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="dim gs-dim" onMouseDown={e => e.target === e.currentTarget && void close()}>
    <section className="modal gs-modal" role="dialog" aria-modal="true" aria-label="단체 일정·요금 수정" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); void close(); } }}>
      <div className="mh"><div><h2>단체 일정·요금 수정</h2><span className="muted">{name} · {base.length}개 예약</span></div><button type="button" className="x" aria-label="닫기" autoFocus disabled={busy} onClick={() => void close()}>닫기</button></div>
      <div className="gs-body">
        <p className="gs-help">퇴실할 객실의 날짜를 바꾸거나 ±1박으로 연장하세요. 표의 ‘이날 퇴실’은 그날 밤부터 제외합니다. 새로 늘어난 박의 요금은 직접 입력합니다.</p>
        <div className="gs-money" aria-label="일정 수정 전후 금액"><span>청구 <b>{won(beforeLedger.due)} → {invalid ? "요금 입력 중" : `${won(afterLedger.due)}원`}</b></span><span>기존 결제 <b>{won(afterLedger.paid)}원 유지</b></span><strong>{invalid ? "요금 입력 완료 후 잔액 계산" : balanceLabel(afterLedger)}</strong></div>
        <div className="gs-tools"><label>객실 타입 <select aria-label="일정 객실 타입" value={typeFilter} disabled={busy} onChange={e => setTypeFilter(e.target.value)}><option value="">전체</option>{s.types.filter(t => base.some(b => b.typeId === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><div><button type="button" className="btn line" onClick={() => setAnchor(addDays(anchor, -7))}>이전 7일</button><label>표 시작일 <input type="date" aria-label="표 시작일" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} /></label><button type="button" className="btn line" onClick={() => setAnchor(addDays(anchor, 7))}>다음 7일</button></div></div>
        <div className="gs-scroll"><table className="gs-table"><caption>객실별 퇴실일과 날짜별 숙박 요금 (원)</caption><thead><tr><th scope="col">객실 · 예정 퇴실</th>{dates.map(d => <th key={d} scope="col">{dayLabel(d)}</th>)}<th scope="col">객실 총액</th></tr></thead><tbody>
          {rows.filter(r => !typeFilter || r.b.typeId === typeFilter).map(({ b, edit, plan, reason, dirty }) => {
            const roomName = label(b), initial = scheduleEdit(b), complete = Object.values(initial.rates).every(v => v != null);
            const rowBooking = { ...b, ...plan.patch };
            return <tr key={b.id} className={dirty ? "gs-changed" : ""}><th scope="row"><b>{roomName}</b><small>{b.guestName} · 입실 {dayLabel(b.checkIn)}</small>{reason ? <small className="gs-locked">{reason}</small> : <><div className="gs-end"><input type="date" aria-label={`${roomName} 퇴실일`} min={addDays(b.checkIn, 1)} max={addDays(b.checkIn, STAY_NIGHTS_MAX)} value={edit.out} disabled={busy} onChange={e => changeOut(b, e.target.value)} /><button type="button" aria-label={`${roomName} 1박 줄이기`} disabled={busy || !validDate(edit.out) || daysBetween(b.checkIn, edit.out) <= 1} onClick={() => changeOut(b, addDays(edit.out, -1))}>−</button><button type="button" aria-label={`${roomName} 1박 늘리기`} disabled={busy || !validDate(edit.out) || daysBetween(b.checkIn, edit.out) >= STAY_NIGHTS_MAX} onClick={() => changeOut(b, addDays(edit.out, 1))}>＋</button></div>{b.openEnded ? <label className="gs-open"><input type="checkbox" aria-label={`${roomName} 퇴실 미정`} checked={edit.openEnded} disabled={busy} onChange={e => patch(b, { openEnded: e.target.checked, ...(e.target.checked ? { out: initial.out } : {}) })} />퇴실 미정</label> : null}<button type="button" className="gs-reset" disabled={busy || !dirty} onClick={() => setEdits(es => { const next = { ...es }; delete next[b.id]; return next; })}>이 객실 되돌리기</button></>}{b.segments?.length ? <small>객실 이동 구간 유지 · 연장은 마지막 호실</small> : null}</th>
              {dates.map(d => { const occupied = d >= b.checkIn && d < edit.out; const rid = roomOnNight(rowBooking, d); return <td key={d} title={rid ? `${dayLabel(d)} · ${L.roomLabel(rid) ?? "?"}호` : dayLabel(d)}>{occupied ? <><input type="number" aria-label={`${roomName} ${d} 요금`} min="0" max="100000000" step="1000" placeholder="요금 입력" value={edit.rates[d] ?? ""} disabled={busy || !!reason} onChange={e => patch(b, { rates: { ...edit.rates, [d]: e.target.value === "" ? null : Number(e.target.value) } })} />{!reason && d > b.checkIn ? <button type="button" className="gs-cell-action" disabled={busy} onClick={() => changeOut(b, d)}>이날 퇴실</button> : null}</> : d >= edit.out && !reason && daysBetween(b.checkIn, d) < STAY_NIGHTS_MAX ? <button type="button" className="gs-cell-action" disabled={busy} onClick={() => changeOut(b, addDays(d, 1))}>＋ 숙박</button> : <span className="muted">—</span>}</td>; })}
              <td className="gs-total"><b>{won(plan.patch?.price ?? b.price)}원</b>{dirty ? <small>기존 {won(b.price)}원</small> : null}{extrasTotal(b.nightRates) ? <small>추가 항목 포함</small> : null}{!complete && !reason ? <label><input type="checkbox" aria-label={`${roomName} 박별 합계로 총액 변경 동의`} checked={edit.replaceTotal} disabled={busy} onChange={e => patch(b, { replaceTotal: e.target.checked })} />박별 미등록 · 입력한 합계로 총액 변경</label> : null}{plan.error ? <small className="ferr">{plan.error}</small> : null}</td>
            </tr>;
          })}
        </tbody></table></div>
        <section className="gs-daily" aria-label="수정 후 날짜별 객실 수·요금"><h3>날짜별 숙박 객실·요금</h3><p className="muted">위 객실별 일정과 약정 요금의 합입니다. 추가 항목·환불은 위 청구 합계에서 반영합니다. 예약은 삭제하거나 새로 만들지 않습니다.</p><div className="gs-scroll"><table><thead><tr><th>객실 타입</th>{dates.map(d => <th key={d}>{dayLabel(d)}</th>)}</tr></thead><tbody>{s.types.filter(t => preview.some(b => b.typeId === t.id) && (!typeFilter || t.id === typeFilter)).map(t => <tr key={t.id}><th>{t.name}</th>{dates.map(d => {
          const occupied = preview.filter(b => b.typeId === t.id && b.status === "active" && b.kind === "stay" && b.stayMode !== "long_stay" && d >= b.checkIn && d < (b.earlyOut || addDays(b.checkIn, b.nights ?? 0)));
          const amounts = occupied.map(b => { const row = rows.find(r => r.b.id === b.id); return row ? row.edit.rates[d] : b.nightRates?.nights?.[d]; });
          const missing = amounts.filter(v => v == null).length;
          return <td key={d}><b>{occupied.length}실</b><span>{missing ? `약정 미등록 ${missing}실` : `${won(amounts.reduce<number>((n, v) => n + (v ?? 0), 0))}원`}</span><small>호텔 잔여 {stock.get(t.id)?.get(d) ?? 0}실</small></td>;
        })}</tr>)}</tbody></table></div></section>
        {clashes.length ? <div className="ferr" role="status">연장 일정의 객실 겹침 {clashes.length}건 · {clashes.slice(0, 4).map(c => `${L.roomLabel(c.roomId)}호 ${dayLabel(c.date)}`).join(", ")}</div> : null}
        <p className="muted">박별 요금이 없는 기존 예약은 총액을 나누지 않습니다. 수정할 객실의 모든 박 요금을 입력하고 총액 변경을 선택하세요. 결제 취소·환불과 실제 체크아웃은 기존 업무에서 별도로 처리합니다.</p>
        {error ? <div className="ferr" role="alert">{error} <button type="button" className="btn line" disabled={busy} onClick={() => void reload()}>최신 일정 다시 불러오기</button></div> : null}
      </div>
      <div className="mf gs-foot"><span aria-live="polite">{pending.length}객실 수정 · {invalid ? "입력 확인 필요" : balanceLabel(afterLedger)}</span><button type="button" className="btn line" disabled={busy} onClick={() => void close()}>닫기</button><button type="button" className="btn red" disabled={busy || !pending.length} onClick={() => void save()}>{busy ? "저장 확인 중…" : `${pending.length}객실 변경 저장`}</button></div>
    </section>
  </div>;
}

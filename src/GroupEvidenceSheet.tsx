import { dayLabel, won } from "../shared/ledger";
import { atLabel, changesFor } from "../shared/changes";
import { groupLedger, balanceLabel } from "../shared/groupLedger";
import { groupEvidenceText } from "../shared/groupEvidence";
import { isPeriodPayable } from "../shared/periodPay";
import { hasFullNightMatrix, occupiedNightDates } from "../shared/nightrates";
import { PAYMENT_METHOD_LABEL } from "../shared/payment";
import type { HotelData } from "./data";
import { lookups } from "./ui";
import { useRef, useState } from "react";
import { detailedStatus } from "../shared/detailedRoomCard";
import { groupLeadBooking } from "../shared/group";
import type { Booking } from "../shared/ledger";

export default function GroupEvidenceSheet({ data, today, groupId, readOnly, onClose, onEditSchedule, onEditPayments, onHighlight, onPay, onAddRooms, onRoom }: {
  data: HotelData; today: string; groupId: string; readOnly?: boolean; onClose: () => void; onEditSchedule: () => void; onEditPayments: () => void;
  onHighlight?: () => void; onPay?: () => void; onAddRooms?: () => void; onRoom?: (b: Booking) => void;
}) {
  const members = data.bookings.filter(b => b.groupId === groupId), info = data.groups.get(groupId), L = lookups(data.hotel!.settings);
  const ledger = groupLedger(members, (info?.payments ?? []).reduce((n, p) => n + p.amount, 0), today, { extras: (info?.extras ?? []).reduce((n, x) => n + x.amount, 0) });
  const roomLabel = (id: string) => { const b = members.find(x => x.id === id); return b?.roomId ? `${L.roomLabel(b.roomId) ?? "?"}호` : `${L.types.get(b?.typeId ?? "")?.name ?? "객실"} · 미배정`; };
  const title = groupEvidenceText(ledger, roomLabel);
  const payments = [...members.filter(isPeriodPayable).flatMap(b => (b.payments ?? []).map(p => ({ ...p, scope: roomLabel(b.id) }))), ...(info?.payments ?? []).map(p => ({ ...p, scope: "단체 수납" }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const changes = changesFor(data.changes, { groupId, bookingIds: members.map(b => b.id) }).filter(c => c.kind !== "note").slice(0, 12);
  const lead = groupLeadBooking(members.filter(b => b.status === "active" && b.kind === "stay"), { preferredId: info?.leadBookingId, today });
  const [busy, setBusy] = useState(false), saving = useRef(false), [error, setError] = useState<string | null>(null);
  const setLead = async (id: string | null) => {
    if (saving.current || readOnly) return;
    saving.current = true; setBusy(true); setError(null);
    try { await data.setGroupLead(groupId, id); void data.logChange({ kind: "room", groupId, bookingId: id, summary: id ? `대표객실 지정 · ${roomLabel(id)}` : "대표객실 자동 지정으로 변경" }); }
    catch { setError("대표객실을 변경하지 못했습니다. 다시 확인해 주세요."); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="dim ge-dim" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}><section className="modal ge-modal" role="dialog" aria-modal="true" aria-label="단체 청구·수납 근거" onKeyDown={e => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); } }}>
    <div className="mh"><div><h2>단체·대표객실 관리</h2><span>{members[0]?.groupName || "단체"} · 대표 {lead ? roomLabel(lead.id) : "없음"}</span></div><button type="button" className="x" aria-label="닫기" autoFocus disabled={busy} onClick={onClose}>닫기</button></div>
    <div className="ge-body">
      <div className="ge-section-head"><h3>연결 객실 {members.length}개</h3><div>{onHighlight ? <button type="button" className="btn line" disabled={busy} onClick={onHighlight}>현황에서 강조</button> : null}{onAddRooms && !readOnly ? <button type="button" className="btn line" disabled={busy} onClick={onAddRooms}>객실 추가</button> : null}</div></div>
      <p className="muted">대표 지정은 관리 표시만 바꿉니다. 각 객실의 예약·요금·결제는 독립적으로 유지됩니다.</p>
      {error ? <p className="ferr" role="alert">{error}</p> : null}
      <div className="ge-members" aria-label="연결 객실 상태·박별 요금">{members.map(b => <article className="ge-member" key={b.id}><h4>{roomLabel(b.id)} {lead?.id === b.id ? "♛ 대표" : ""}</h4><small>{L.types.get(b.typeId)?.name} · {detailedStatus(b, today, { stayTimes: data.hotel!.settings.stayTimes }).label}</small><p>{b.guestName} · {b.nights ?? 0}박 · 객실 총액 {won(b.price)}원</p><details><summary title="저장된 박별 약정과 객실 수납 기록">박별 약정·수납 확인</summary><table><tbody>{occupiedDates(b).map(d => <tr key={d}><th>{dayLabel(d)}</th><td>{b.nightRates?.nights?.[d] != null ? `${won(b.nightRates.nights[d]!)}원` : "약정 미등록"}</td></tr>)}</tbody></table><p>이 객실에 기록한 수납 {won((b.payments ?? []).reduce((n, p) => n + p.amount, 0))}원</p><small>단체 수납은 이 방이나 각 박에 임의 배분하지 않습니다.</small></details>{!readOnly && b.status === "active" && b.kind === "stay" && lead?.id !== b.id ? <button type="button" className="btn line" disabled={busy} onClick={() => void setLead(b.id)}>대표로 지정</button> : null}{lead?.id === b.id && info?.leadBookingId && !readOnly ? <button type="button" className="btn line" disabled={busy} onClick={() => void setLead(null)}>대표 자동 지정</button> : null}{onRoom ? <button type="button" className="btn line" disabled={busy} onClick={() => onRoom(b)}>객실 업무</button> : null}</article>)}</div>
      <h3>청구·수납 근거</h3>
      {onPay && !readOnly ? <button type="button" className="btn dark" disabled={busy} onClick={onPay}>결제 등록</button> : null}
      <div className="ge-balance" title={title}><strong>{balanceLabel(ledger)}</strong><p>{ledger.prepaid > 0 ? `받은 돈 ${won(ledger.paid)}원에서 전체 청구 ${won(ledger.due)}원을 빼면 ${won(ledger.prepaid)}원이 더 남습니다.` : ledger.owed > 0 ? `현재 청구 ${won(ledger.dueSoFar)}원에서 받은 돈 ${won(ledger.paid)}원을 빼면 ${won(ledger.owed)}원을 더 받아야 합니다.` : "현재 청구와 수납 내역으로 계산한 잔액입니다."}</p><p>청구나 수납의 원인이 잘못 입력됐는지는 아래 근거와 변경 기록을 확인해 주세요. 환불은 자동 처리되지 않습니다.</p></div>
      <div className="ge-section-head"><h3>청구 {won(ledger.due)}원</h3>{!readOnly ? <button type="button" className="btn line" onClick={onEditSchedule}>일정·요금 수정</button> : null}</div>
      <p>객실 {won(ledger.roomCharges)}원 + 단체 추가 항목 {won(ledger.extras)}원</p>
      {ledger.rooms.map(r => { const b = members.find(x => x.id === r.bookingId)!; const matrix = hasFullNightMatrix(b.checkIn, b.nights ?? 0, b.nightRates); return <details className="ge-room" key={r.bookingId} open><summary title={`${roomLabel(b.id)} · ${r.nights}박 · 청구 ${won(r.subtotal)}원`}>{roomLabel(b.id)} · {dayLabel(r.checkIn)}~{dayLabel(r.checkOut)}{r.openEnded ? " · 퇴실 미정" : ""}<b>{won(r.subtotal)}원</b></summary><p className="muted">{matrix ? "저장된 날짜별 요금에서 추가 항목·총액 차액·환불을 반영한 박별 청구입니다." : "박별 약정 요금이 없어 기존 장부는 총액을 기간별로 나눠 표시합니다. 약정 단가가 아니므로 일정·요금 수정에서 직접 입력해 주세요."}</p><table><thead><tr><th>숙박일</th><th>저장된 박 요금</th><th>장부 청구 반영액</th></tr></thead><tbody>{r.rows.map(row => <tr key={row.date}><th>{dayLabel(row.date)}</th><td title="예약에 직접 저장된 약정 요금">{b.nightRates?.nights?.[row.date] != null ? `${won(b.nightRates.nights[row.date]!)}원` : "미등록"}</td><td title="객실 총액·추가 항목·환불을 반영해 합계를 맞춘 장부 금액">{won(row.amount)}원</td></tr>)}</tbody></table><p>예약 총액 {won(b.price)}원{b.refund ? ` − 환불 반영 ${won(b.refund)}원` : ""} · 청구 {won(r.subtotal)}원</p>{r.extraLines.map((x, i) => <p key={i} title="객실 총액에 이미 포함된 추가 항목">포함: {x.name} {won(x.amount)}원{x.perNight ? ` (박당 ${won(x.perNight)}원)` : ""}</p>)}</details>; })}
      {(info?.extras ?? []).map((x, i) => <p key={i} title="단체 청구에 별도로 더한 항목">단체 추가: {x.name} · {won(x.amount)}원</p>)}
      {ledger.upcoming > 0 ? <p title="퇴실 미정 객실의 미래 방 보호 밤">현재 청구 {won(ledger.dueSoFar)}원 · 이후 예정 {won(ledger.upcoming)}원 (현재 미수금 제외)</p> : null}
      <div className="ge-section-head"><h3>결제 {won(ledger.paid)}원</h3>{!readOnly ? <button type="button" className="btn line" onClick={onEditPayments}>결제 기록 정정</button> : null}</div>
      <p>객실별 수납 {won(ledger.paid - ledger.lump)}원 + 단체 수납 {won(ledger.lump)}원 · 객실별로 임의 배분하지 않습니다.</p>
      <ul className="ge-pays">{payments.map(p => <li key={p.id} title={`${p.scope} · ${p.bizDate} · ${PAYMENT_METHOD_LABEL[p.method]} · ${won(p.amount)}원${p.note ? ` · ${p.note}` : ""}`}><span>{dayLabel(p.bizDate)} · {p.scope}<small>{PAYMENT_METHOD_LABEL[p.method]}{p.note ? ` · ${p.note}` : ""}</small></span><b>{won(p.amount)}원</b></li>)}</ul>{!payments.length ? <p>수납 기록이 없습니다.</p> : null}
      {members.some(b => !isPeriodPayable(b)) ? <p className="muted">취소·노쇼·대실·장기 원장 예약은 이 단체 숙박 계산 대상에서 제외됩니다. 해당 기록은 예약 상세·장기 원장에서 확인해 주세요.</p> : null}
      <h3>최근 변경 기록</h3>{changes.length ? <ul className="ge-changes">{changes.map(c => <li key={c.id}><small>{atLabel(c.at)}</small> {c.summary}</li>)}</ul> : <p>관련 변경 기록이 없습니다. 현재 금액의 계산 근거만 확인할 수 있습니다.</p>}
    </div><div className="mf"><button type="button" className="btn line" onClick={onClose}>현황으로 닫기</button>{!readOnly ? <><button type="button" className="btn line" onClick={onEditPayments}>결제 기록 정정</button><button type="button" className="btn dark" onClick={onEditSchedule}>일정·요금 수정</button></> : null}</div>
  </section></div>;
}

const occupiedDates = (b: Booking) => b.kind === "stay" ? occupiedNightDates(b.checkIn, b.nights ?? 0) : [];

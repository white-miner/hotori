import { dayLabel, stayEnd, type Booking } from "../shared/ledger";
import { roomNumberColor } from "../shared/detailedRoomCard";
import type { assignmentRoom } from "../shared/roomWork";

export default function AssignmentRoomCard({ roomId, roomNo, roomType, color, booking, option, busy, onAssign }: {
  roomId: string; roomNo: string; roomType: string; color: string; booking: Booking;
  option: ReturnType<typeof assignmentRoom>; busy: boolean; onAssign: () => void;
}) {
  return <div id={`now-room-${roomId}`} data-room-id={roomId} className={`cell detail-card room-assignment ${option.eligible ? "assign-ok" : "assign-off"}`} aria-label={`${roomNo}호 ${option.eligible ? "배정 가능" : "배정 불가"}`}>
    <div className="detail-head"><div className="detail-identity"><strong className="detail-number" style={{ background: roomNumberColor(color), color: "#fff" }}>{roomNo}</strong><span className={`detail-status ${option.eligible ? "available" : "neutral"}`}>{option.eligible ? "배정 가능" : "배정 불가"}</span></div><div className="detail-meta">{roomType}</div></div>
    <div className="assignment-empty"><b>{option.eligible ? "배정할 수 있어요" : "이 기간은 선택 불가"}</b><p>{dayLabel(booking.checkIn)} 입실<br />{dayLabel(stayEnd(booking))} 퇴실 · {booking.nights}박</p><span>{option.reason}</span>{option.eligible && option.differentType ? <small>예약과 객실 타입이 달라 승인 후 배정합니다.</small> : null}</div>
    <div className="detail-actions assignment-action"><button type="button" disabled={busy || !option.eligible} onClick={onAssign}>{busy ? "배정 중…" : "이 객실에 배정"}</button></div>
  </div>;
}

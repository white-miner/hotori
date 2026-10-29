import type { ReactNode } from "react";
import { Crown, Link2, MessageCircle } from "lucide-react";
import { type Booking, type HotelSettings, type Platform, won } from "../shared/ledger";
import { type RoomCardModel } from "../shared/roomCard";
import { cardDateTime, detailedTimes, type CardStatus } from "../shared/detailedRoomCard";
import { textOn } from "../shared/platform";
import { spacedPay } from "./RoomCardFacts";
import { payState } from "../shared/payment";

export interface CardGroup {
  id: string; label: string; name: string; color: string;
  index: number; count: number; lead: boolean; leadRoom: string;
}

export default function NowRoomCard({ roomNo, roomType, color, booking: b, platform, settings, model, status, group, showGroup,
  onDetail, onQuick, onStatus, onGroup, onPeriod, periodPopup, onMemo, memoCount, memoText, notes, readOnly, busy,
}: {
  roomNo: string; roomType: string; color: string; booking: Booking | null; platform?: Platform;
  settings: HotelSettings; model: RoomCardModel | null; status: CardStatus; group?: CardGroup | null; showGroup: boolean;
  onDetail: () => void; onQuick: () => void; onStatus?: () => void; onGroup?: () => void; onPeriod?: () => void;
  periodPopup?: ReactNode; onMemo: () => void; memoCount: number; memoText?: string; notes?: ReactNode;
  readOnly?: boolean; busy?: boolean;
}) {
  const active = b?.status === "active";
  const times = b ? detailedTimes(b, settings) : null;
  const snap = b ? payState(b, platform) : null;
  const groupPaid = model?.groupCtx ? [...(model.groupCtx.info?.payments ?? []), ...model.groupCtx.members.flatMap((m) => m.payments ?? [])].reduce((n, p) => n + p.amount, 0) : 0;
  const payment = !active ? "—" : b.priceUnset ? "금액 미정" : group && model && !model.longStay
    ? model.tone === "paid" ? "결제 완료" : groupPaid > 0 ? "일부 결제" : "미결제"
    : !snap?.tracked ? "플랫폼 결제" : snap.full || snap.left <= 0 ? "결제 완료" : snap.paid > 0 ? "일부 결제" : "미결제";
  const guest = active ? group?.lead ? `${group.name} · 대표` : b.guestName || group?.name || "이름 미입력" : b ? b.guestName : "예약 없음";
  const row = (key: string, name: string, value: ReactNode, title?: string) => <div className={`detail-row detail-${key}`} key={key}><dt>{name}</dt><dd title={title}>{value}</dd></div>;
  return <>
    <div className="detail-head">
      <div className="detail-identity">
        <strong className="detail-number" style={{ background: color, color: textOn(color) }}>{roomNo}</strong>
        {onStatus ? <button type="button" className={`detail-status ${status.tone}`} onClick={(e) => { e.stopPropagation(); onStatus(); }}>{status.label}</button>
          : <span className={`detail-status ${status.tone}`}>{status.label}</span>}
      </div>
      <div className="detail-type">{roomType || "타입 미지정"}</div>
    </div>
    {showGroup && group ? <button type="button" className={`detail-group ${group.color}`} title={`${group.name} · 단체 ID ${group.id}`} aria-label={`${group.label} ${group.name} 단체 선택`} onClick={(e) => { e.stopPropagation(); onGroup?.(); }}>
      <span className="detail-group-top"><b>{group.label}</b><span>{group.lead ? <><Crown size={15} aria-hidden /> 대표</> : "연결 객실"}</span><strong>{String(group.index).padStart(2, "0")}/{String(group.count).padStart(2, "0")}</strong></span>
      <span className="detail-group-name">{group.name}</span>
      <span className="detail-group-link"><Link2 size={14} aria-hidden />{group.lead ? `${group.count}실 연결` : `대표 ${group.leadRoom}`}</span>
    </button> : <div className="detail-group-space" />}
    <dl className="detail-facts">
      {row("guest", "예약자", <strong>{guest}</strong>)}
      {row("platform", "예약 경로", b ? platform?.name || "경로 미지정" : "—")}
      {row("in", "입실", times ? cardDateTime(times.inDate, times.inTime) : "—", times ? `${times.inDate} · ${times.basis}` : undefined)}
      {row("out", "퇴실", times ? cardDateTime(times.outDate, times.outTime) : "—", times ? `${times.outDate ?? "미정"} · ${times.basis}` : undefined)}
      {row("period", "이용", b ? onPeriod ? <button type="button" className="detail-period" onClick={(e) => { e.stopPropagation(); onPeriod(); }}>{b.kind === "dayuse" ? "대실" : `${model?.longStay ? "장기숙박" : "숙박"} · ${model?.progress || `${b.nights ?? 0}박`}`} ▾</button> : "대실" : "—")}
      {row("price", "객실 요금", readOnly ? "공유 비공개" : active ? b.priceUnset ? "금액 미정" : <><b>₩{won(b.price)}</b><small>예약 총액</small>{model?.rate.amount != null ? <small>₩{won(model.rate.amount)}/박{model.rate.varies ? " · 변동" : ""}</small> : b.kind === "stay" ? <small>박당 요금 미입력</small> : null}</> : "—")}
      {row("payment", "결제 상태", readOnly ? "공유 비공개" : <><span className={`detail-payment ${model?.tone ?? "neutral"}`}>{group && active ? `단체 ${payment}` : payment}</span>{model?.payText ? <small>{spacedPay(model.payText)}</small> : null}{model && model.due > 0 ? <small className="detail-due">{group ? "단체 " : ""}받을 돈 ₩{won(model.due)}</small> : null}</>)}
    </dl>
    {periodPopup}
    <div className="detail-notes">
      {status.note ? <span>{status.note}</span> : null}
      {b && b.status !== "active" ? <span className="detail-cancelled">{b.status === "cancelled" ? "취소" : "노쇼"} 예약 · 현재 판매가능</span> : null}
      {active && b.noClean ? <span>청소 제외</span> : null}
      {active && b.tentative ? <span>임시 배치</span> : null}
      {model?.company ? <span>{model.company}</span> : null}
      {notes}
      {!readOnly || memoCount > 0 ? <button type="button" className="detail-memo" onClick={(e) => { e.stopPropagation(); onMemo(); }} title={memoText} aria-label={`${roomNo} 특이사항${memoCount ? ` ${memoCount}건` : " 등록"}`}><MessageCircle size={15} aria-hidden /> {memoCount ? `특이사항 ${memoCount}건` : "특이사항"}</button> : null}
    </div>
    <div className="detail-actions">
      <button type="button" disabled={readOnly || busy} onClick={(e) => { e.stopPropagation(); onDetail(); }}>상세보기</button>
      <button type="button" disabled={readOnly || busy} onClick={(e) => { e.stopPropagation(); onQuick(); }}>빠른 업무</button>
    </div>
  </>;
}

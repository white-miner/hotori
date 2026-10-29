import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Crown, Link2, MessageCircle, X } from "lucide-react";
import { type Booking, type HotelSettings, type Platform, won } from "../shared/ledger";
import { type RoomCardModel } from "../shared/roomCard";
import { compactCardPeriodParts, detailedTimes, roomNumberColor, type CardStatus } from "../shared/detailedRoomCard";
import { spacedPay } from "./RoomCardFacts";
import { payState } from "../shared/payment";

export interface CardGroup {
  id: string; label: string; name: string; color: string;
  index: number; count: number; lead: boolean; leadRoom: string;
}
export interface NowRoomCardProps {
  roomNo: string; roomType: string; color: string; booking: Booking | null; platform?: Platform;
  settings: HotelSettings; model: RoomCardModel | null; status: CardStatus; group?: CardGroup | null; showGroup: boolean;
  onDetail: () => void; onQuick: () => void; onStatus?: () => void; onGroup?: () => void; onPeriod?: () => void;
  periodPopup?: ReactNode; onMemo: () => void; memoCount: number; memoText?: string; notes?: ReactNode;
  hasAlerts?: boolean; readOnly?: boolean; busy?: boolean;
}

function cardFacts(p: NowRoomCardProps) {
  const { booking: b, model, platform, group } = p;
  const active = b?.status === "active";
  const times = b ? detailedTimes(b, p.settings) : null;
  const snap = b ? payState(b, platform) : null;
  const groupPaid = model?.groupCtx ? [...(model.groupCtx.info?.payments ?? []), ...model.groupCtx.members.flatMap((m) => m.payments ?? [])].reduce((n, x) => n + x.amount, 0) : 0;
  const payment = !active ? "—" : b.priceUnset ? "금액 미정" : group && model && !model.longStay
    ? model.tone === "paid" ? "결제 완료" : groupPaid > 0 ? "일부 결제" : "미결제"
    : !snap?.tracked ? "플랫폼 결제" : snap.full || snap.left <= 0 ? "결제 완료" : snap.paid > 0 ? "일부 결제" : "미결제";
  const guest = active ? group?.lead ? `${group.name} · 대표` : b.guestName || group?.name || "이름 미입력" : b ? b.guestName : "예약 없음";
  return { active, times, payment, guest };
}

/** 4:5 요약. 변경 명령은 기존 예약 상세·사이드바·퇴실 흐름이 소유한다. */
export default function NowRoomCard(p: NowRoomCardProps) {
  const { roomNo, roomType, color, booking: b, platform, model, status, group, showGroup, onQuick, onStatus, onGroup, onMemo, memoCount, readOnly, busy } = p;
  const { active, times, guest, payment } = cardFacts(p);
  const [details, setDetails] = useState(false);
  const fullPeriod = times ? `입실 ${times.inDate} ${times.inTime ?? "미입력"} · 퇴실 ${times.outDate ?? "미정"} ${times.outTime ?? ""}` : "예약 없음";
  const shortPay = payment.replace("결제 완료", "완료").replace("일부 결제", "일부").replace("플랫폼 결제", "플랫폼").replace("금액 미정", "미정");
  const wideAmount = !!b && !b.priceUnset && won(b.price).length > 9;
  const period = b ? compactCardPeriodParts(b, p.settings) : null;
  const summaryGuest = active && group?.lead ? group.name : guest;
  return <>
    <div className="detail-head">
      <div className="detail-identity">
        <strong className="detail-number" style={{ background: roomNumberColor(color), color: "#FFFFFF" }}>{roomNo}</strong>
        {onStatus ? <button type="button" className={`detail-status ${status.tone}`} onClick={(e) => { e.stopPropagation(); onStatus(); }}>{status.label}</button>
          : <span className={`detail-status ${status.tone}`}>{status.label}</span>}
      </div>
      <div className="detail-meta"><span className="detail-type" title={`${roomType}${b ? ` · ${platform?.name || "경로 미지정"}` : ""}`}>{roomType || "타입 미지정"}</span>{b ? wideAmount && !readOnly ? <span className={`detail-payment ${model?.tone ?? "neutral"}`} aria-label={`${group ? "단체 " : ""}${payment}`}>{shortPay}</span> : <span className="detail-platform" title={`예약 경로 · ${platform?.name || "경로 미지정"}`}>{platform?.name || "경로 미지정"}</span> : null}{memoCount > 0 ? <button type="button" className="detail-memo" title={p.memoText} aria-label={`${roomNo} 특이사항 ${memoCount}건`} onClick={(e) => { e.stopPropagation(); onMemo(); }}><MessageCircle size={16} /><span>{memoCount}</span></button> : null}</div>
    </div>
    <div className="detail-summary">
      <div className="detail-guest-line"><strong className={`detail-guest-name${b ? "" : " is-empty"}`} title={guest}>{summaryGuest}</strong></div>
      {period ? <button type="button" className="detail-period" title={fullPeriod} aria-label={fullPeriod} onClick={(e) => { e.stopPropagation(); setDetails(true); }}><span className="detail-period-range">{period.range}</span>{period.duration ? <small>{period.duration}</small> : null}</button> : <span className="detail-empty">{status.label === "판매중지" ? "판매중지 · 상세 확인" : "새 예약을 받을 수 있어요"}</span>}
      {active && b ? <div className="detail-money" title={readOnly ? "공유 비공개" : `예약 총액 · ${payment}${group ? " (단체 결제 기준)" : ""}`}>
        <b aria-label={readOnly ? "금액 비공개" : `예약 총액 ${b.priceUnset ? "미정" : won(b.price) + "원"}`}>{readOnly ? "비공개" : b.priceUnset ? "금액 미정" : `₩${won(b.price)}`}</b>
        {!readOnly && !wideAmount ? <span className={`detail-payment ${model?.tone ?? "neutral"}`} aria-label={`${group ? "단체 " : ""}${payment}`}>{shortPay}</span> : null}
      </div> : b ? <span className="detail-cancelled">{b.status === "cancelled" ? "취소 예약" : "노쇼 예약"} · 상세 확인</span> : null}
      {showGroup && group ? <button type="button" className={`detail-group ${group.color}`} title={`${group.label} · ${group.name} · ${group.lead ? "대표객실" : `대표 ${group.leadRoom}`} · 단체 선택`} aria-label={`${group.label} ${group.name} ${group.lead ? "대표" : `대표 ${group.leadRoom} 연결`} 단체 선택`} onClick={(e) => { e.stopPropagation(); onGroup?.(); }}>
        <b>{group.label}</b>{group.lead ? <span className="detail-group-role"><Crown size={14} aria-hidden />대표</span> : <span className="detail-group-name"><Link2 size={14} aria-hidden /><span>{group.name}</span></span>}<strong>{String(group.index).padStart(2, "0")}/{String(group.count).padStart(2, "0")}</strong>
      </button> : null}
    </div>
    <div className="detail-actions">
      <button type="button" className={p.hasAlerts ? "has-alert" : undefined} title={p.hasAlerts ? "메모·예약 안내 확인" : undefined} onClick={(e) => { e.stopPropagation(); setDetails(true); }}>상세보기{p.hasAlerts ? <i aria-label="확인할 안내 있음" /> : null}</button>
      <button type="button" disabled={readOnly || busy} onClick={(e) => { e.stopPropagation(); onQuick(); }}>빠른 업무</button>
    </div>
    {p.periodPopup}
    {details ? createPortal(<RoomCardDetails {...p} onClose={() => setDetails(false)} />, document.body) : null}
  </>;
}

/** 요약에서 생략한 시간·요금 근거·결제·연결·업무 안내를 모두 제공한다. */
export function RoomCardDetails(p: NowRoomCardProps & { onClose: () => void }) {
  const { roomNo, roomType, booking: b, platform, model, status, group, onClose, onDetail, onQuick, onMemo, readOnly, busy } = p;
  const { active, times, guest, payment } = cardFacts(p);
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeHandler.current(); }
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  const row = (key: string, name: string, value: ReactNode) => <div className={`detail-row detail-${key}`} key={key}><dt>{name}</dt><dd>{value}</dd></div>;
  const act = (fn: () => void) => { onClose(); fn(); };
  return <div className="dim room-details-dim" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal room-details" role="dialog" aria-modal="true" aria-label={`${roomNo} 객실 상세`} ref={dialog}>
      <div className="mh"><h2><strong className="detail-number" style={{ background: roomNumberColor(p.color), color: "#FFFFFF" }}>{roomNo}</strong> 객실 상세</h2><button type="button" className="x" ref={close} onClick={onClose} aria-label="닫기"><X size={18} /></button></div>
      <div className="room-details-body">
        <div className="room-details-heading"><strong>{roomType || "타입 미지정"}</strong><span className={`detail-status ${status.tone}`}>{status.label}</span></div>
        {group ? <div className={`room-details-group ${group.color}`}><b>{group.label} · {group.name}</b><span>{group.lead ? <><Crown size={16} /> 대표객실</> : <><Link2 size={16} /> 대표 {group.leadRoom} 연결</>} · {String(group.index).padStart(2, "0")}/{String(group.count).padStart(2, "0")}</span><button type="button" className="btn sm line" onClick={() => act(() => p.onGroup?.())}>연결 객실 보기</button></div> : null}
        <dl className="detail-facts">
          {row("guest", "예약자", <strong>{guest}</strong>)}
          {row("platform", "예약 경로", b ? platform?.name || "경로 미지정" : "—")}
          {row("in", "입실", times ? `${times.inDate} ${times.inTime ?? "시간 미입력"}` : "—")}
          {row("out", "퇴실", times ? times.outDate ? `${times.outDate} ${times.outTime ?? "시간 미입력"}` : "퇴실 미정" : "—")}
          {row("period", "이용", b ? b.kind === "dayuse" ? "대실" : `${model?.longStay ? "장기숙박" : "숙박"} · ${model?.progress || `${b.nights ?? 0}박`}` : "—")}
          {row("price", "객실 요금", readOnly ? "공유 비공개" : active && b ? b.priceUnset ? "금액 미정" : <><b>₩{won(b.price)}</b><small>예약 총액</small>{model?.rate.amount != null ? <small>₩{won(model.rate.amount)}/박{model.rate.varies ? " · 변동" : ""}</small> : b.kind === "stay" ? <small>박당 요금 미입력</small> : null}</> : "—")}
          {row("payment", "결제 상태", readOnly ? "공유 비공개" : <><span className={`detail-payment ${model?.tone ?? "neutral"}`}>{group && active ? `단체 ${payment}` : payment}</span>{model?.payText ? <small>{spacedPay(model.payText)}</small> : null}{model && model.due > 0 ? <small className="detail-due">{group ? "단체 " : ""}받을 돈 ₩{won(model.due)}</small> : null}</>)}
        </dl>
        {b?.kind === "stay" && p.onPeriod ? <button type="button" className="btn line" onClick={() => act(() => p.onPeriod?.())}>점유 밤 달력 보기</button> : null}
        {times ? <p className="room-details-time-note">{times.basis}</p> : null}
        <div className="detail-notes">
          {status.note ? <span>{status.note}</span> : null}
          {b && !active ? <span>{b.status === "cancelled" ? "취소" : "노쇼"} 예약 · 현재 판매가능</span> : null}
          {active && b?.noClean ? <span>청소 제외</span> : null}{active && b?.tentative ? <span>임시 배치</span> : null}
          {model?.company ? <span>회사 · {model.company}</span> : null}
          {!readOnly && b?.memo ? <p className="room-details-booking-memo">예약 메모 · {b.memo}</p> : null}
          {p.notes}
          {!readOnly && p.memoText ? <p className="room-details-booking-memo">객실 특이사항 · {p.memoText}</p> : null}
          <button type="button" className="btn line" disabled={readOnly} onClick={() => act(onMemo)}><MessageCircle size={16} />특이사항 {p.memoCount ? `${p.memoCount}건 보기` : "보기·등록"}</button>
        </div>
      </div>
      <div className="mf"><button type="button" className="btn line" disabled={readOnly || busy} onClick={() => act(onQuick)}>빠른 업무</button>{b ? <button type="button" className="btn dark" disabled={readOnly || busy} onClick={() => act(onDetail)}>예약 상세·수정</button> : null}</div>
    </div>
  </div>;
}

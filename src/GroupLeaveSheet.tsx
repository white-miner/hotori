import { useMemo, useState } from "react";
import { saveFailMessage } from "../shared/errors";
import { addDays, dayLabel, daysBetween, md, stayEnd, won, type Booking } from "../shared/ledger";
import { repriceForNights } from "../shared/extend";
import { fitSegments } from "../shared/ledger";

/** 조기 퇴실 처리 — 객실이 단체에서 먼저 나가요. 이용한 박까지만 남기고 이후 요금은 빠져요. 이미 낸 금액은 단체 선수금으로 남아요. */
export default function GroupLeaveSheet({
  today,
  booking,
  roomLabel,
  typeRate,
  onConfirm,
  onClose,
}: {
  today: string;
  booking: Booking;
  roomLabel: string;
  typeRate?: number | null;
  onConfirm: (leaveDate: string, nights: number, price: number, segments: Booking["segments"]) => Promise<void>;
  onClose: () => void;
}) {
  const end = stayEnd(booking);
  const minDate = addDays(booking.checkIn, 1);
  const defDate = today > booking.checkIn && today < end ? today : end > minDate ? addDays(end, -1) : end;
  const [date, setDate] = useState(defDate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const used = daysBetween(booking.checkIn, date);
  const valid = used >= 1 && date < end;
  const re = useMemo(() => (valid ? repriceForNights(booking, used, typeRate) : null), [booking, used, typeRate, valid]);
  const paid = (booking.payments ?? []).reduce((n, p) => n + p.amount, 0);
  const diff = re ? paid - re.price : 0;
  const chips = [today, addDays(today, 1)].filter((d, i, a) => d >= minDate && d < end && a.indexOf(d) === i);

  const go = async () => {
    if (!re || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(date, used, re.price, booking.segments ? fitSegments(booking.segments, booking.roomId, used) : undefined);
    } catch (e) {
      setErr(saveFailMessage(e, "조기 퇴실 처리하지 못했어요"));
      setBusy(false);
    }
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gpp-modal" role="dialog" aria-label="조기 퇴실 처리" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>조기 퇴실 처리</h2>
          <span className="muted sm gpp-gname">{roomLabel}</span>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>닫기</button>
        </div>
        <div className="mb">
          {end <= minDate ? (
            <p>1박 예약은 조기 퇴실이 아니라 예약 취소로 처리해 주세요.</p>
          ) : (
            <>
              <div className="gpp-hero">
                <span className="gpp-hl">{valid ? `${md(date)} 퇴실 · ${used}박 이용` : "퇴실일을 골라 주세요"}</span>
                <span className="muted sm">
                  원래 {md(booking.checkIn)}~{md(end)} · {booking.nights}박
                </span>
              </div>
              <div className="chips">
                {chips.map((d, i) => (
                  <button key={d} type="button" className={`chip${date === d ? " on" : ""}`} onClick={() => setDate(d)}>
                    {i === 0 && d === today ? "오늘" : "내일"} {dayLabel(d)} 퇴실
                  </button>
                ))}
                <label className="grc-date">
                  <span className="muted sm">퇴실일</span>
                  <input type="date" min={minDate} max={addDays(end, -1)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </label>
              </div>
              {re ? (
                <div className="payment-desk-glance gpp-glance">
                  <span>이용 금액 <b>{won(re.price)}</b></span>
                  <span>결제 내역 <b>{won(paid)}</b></span>
                  <span className={diff < 0 ? "left" : ""}>{diff < 0 ? "미수금" : "선수금"} <b>{won(Math.abs(diff))}</b></span>
                </div>
              ) : null}
              <p className="muted sm">이 객실만 먼저 나가요. 나머지 객실의 결제 등록 금액은 자동으로 다시 계산돼요. 낸 금액이 더 많으면 단체 선수금으로 남아요(현금 환불은 별도 처리).</p>
            </>
          )}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts gpp-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onClose}>닫기</button>
          {end > minDate ? (
            <button type="button" className="btn dark gpp-go" disabled={busy || !valid} onClick={() => void go()}>
              {busy ? "저장 중…" : valid ? `${md(date)} 조기 퇴실 처리` : "퇴실일을 골라 주세요"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

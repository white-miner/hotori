import { useEffect, useMemo, useState } from "react";
import { type Booking, type HotelSettings, won } from "../shared/ledger";
import { outTimeOf } from "../shared/extratime";
import {
  ADD_TIME_HOUR_CHIPS,
  ADD_TIME_METHOD_LABEL,
  ADD_TIME_METHODS,
  LATE_OUT_CTA,
  LATE_OUT_TITLE,
  type AddTimeInput,
  type AddTimeMethod,
  addTimeAmount,
  planAddTime,
} from "../shared/addTime";
import { Chip, ChipGroup, PriceInp } from "./primitives";

/**
 * 「현황」늦은 퇴실 (구 「시간 추가」) — Entry 우회.
 * +N시간 · 시간당 요금 · 합계 · 카드/이체/현금/서비스/후불.
 * AddTime planner 재사용 · selection-first.
 */
export default function AddTimeModal({
  s,
  today,
  booking,
  roomLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  s: HotelSettings;
  today: string;
  booking: Booking;
  roomLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: AddTimeInput) => void;
}) {
  const [hours, setHours] = useState(1);
  const [rate, setRate] = useState(String(s.extraHourFee || 0));
  /** 숙박 늦은퇴실 마킹 기본 = 서비스(0원). 카드 기본이면 extraHourFee(1만)이 잔금으로 남음 */
  const [method, setMethod] = useState<AddTimeMethod>(() => (booking.kind === "stay" ? "service" : "card"));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setHours(1);
    setRate(String(s.extraHourFee || 0));
    setMethod(booking.kind === "stay" ? "service" : "card");
    setErr(null);
  }, [booking.id, booking.kind, s.extraHourFee]);

  useEffect(() => {
    if (method === "service") setErr(null);
  }, [method]);

  const hourlyRate = method === "service" ? 0 : Number(rate || 0);
  const amount = addTimeAmount(hours, hourlyRate, method);
  const preview = useMemo(() => planAddTime(booking, { hours, hourlyRate, method, bizDate: today }), [booking, hours, hourlyRate, method, today]);

  const endHint = (() => {
    if ("err" in preview) return null;
    if (preview.kind === "stay") {
      const late = preview.surcharge.draft.lateOut ?? 0;
      return `퇴실 ${outTimeOf(s, { lateOut: late })}`;
    }
    return `종료 ${preview.endTime}`;
  })();

  const submit = () => {
    if (busy) return;
    const input: AddTimeInput = {
      hours,
      hourlyRate: method === "service" ? 0 : Number(rate || 0),
      method,
      bizDate: today,
    };
    const planned = planAddTime(booking, input);
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onConfirm(input);
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal add-time-modal"
        role="dialog"
        aria-label={LATE_OUT_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{LATE_OUT_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · {booking.guestName}
            {booking.kind === "dayuse" ? " · 대실" : " · 숙박"}
          </p>
          <div className="fld">
            <span className="muted sm">+N시간</span>
            <ChipGroup role="group" aria-label="추가 시간">
              {ADD_TIME_HOUR_CHIPS.map((h) => (
                <Chip
                  key={h}
                  sm
                  active={hours === h}
                  disabled={busy}
                  aria-pressed={hours === h}
                  onClick={() => {
                    setHours(h);
                    setErr(null);
                  }}
                >
                  +{h}시간
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <div className="paytake">
            <PriceInp sm>
              <span className="pl">시간당</span>
              <input
                className="num"
                inputMode="numeric"
                placeholder="0"
                aria-label="시간당 금액"
                disabled={busy || method === "service"}
                value={method === "service" ? "" : rate ? won(Number(rate)) : ""}
                onChange={(e) => {
                  if (method === "service") return;
                  setRate(e.target.value.replace(/\D/g, "").slice(0, 9));
                  setErr(null);
                }}
              />
            </PriceInp>
          </div>
          <p className="add-time-sum">
            추가 요금 <b>{won(amount)}원</b>
            {endHint ? <span className="muted sm"> · {endHint}</span> : null}
          </p>
          <ChipGroup role="group" aria-label="결제 방법">
            {ADD_TIME_METHODS.map((m) => (
              <Chip
                key={m}
                sm
                active={method === m}
                disabled={busy}
                aria-pressed={method === m}
                onClick={() => {
                  setMethod(m);
                  setErr(null);
                }}
              >
                {ADD_TIME_METHOD_LABEL[m]}
              </Chip>
            ))}
          </ChipGroup>
          {method === "service" ? <p className="muted sm">서비스 · 0원 (무료)</p> : null}
          {method === "deferred" ? <p className="muted sm">후불 · 잔금에 더해요</p> : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn dark" disabled={busy} onClick={submit} autoFocus>
            {busy ? "저장 중…" : LATE_OUT_CTA}
          </button>
        </div>
      </div>
    </div>
  );
}

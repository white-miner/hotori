import { useEffect, useMemo, useState } from "react";
import { type Booking, dayLabel, won } from "../shared/ledger";
import {
  EXTEND_COPY,
  EXTEND_PAY_LABEL,
  EXTEND_PAY_METHODS,
  type ExtendPayMethod,
  type OpsExtendInput,
  nightRate,
  planOpsExtend,
} from "../shared/extend";
import { Chip, ChipGroup, PriceInp } from "./primitives";

/**
 * 「현황」운영패널 1박 연장 — Entry/StaySale 우회.
 * +1박 · 오늘 요금 · 카드/이체/현금/서비스/후불 · selection-first (미니맵 금지).
 */
export default function ExtendNightModal({
  today,
  booking,
  roomLabel,
  typeRate,
  busy,
  onCancel,
  onConfirm,
}: {
  today: string;
  booking: Booking;
  roomLabel: string;
  typeRate?: number | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: OpsExtendInput) => void;
}) {
  const defaultRate = nightRate(booking, typeRate);
  const [rate, setRate] = useState(String(defaultRate));
  const [method, setMethod] = useState<ExtendPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRate(String(nightRate(booking, typeRate)));
    setMethod("card");
    setErr(null);
  }, [booking.id, booking.price, booking.nights, typeRate]);

  useEffect(() => {
    if (method === "service") setErr(null);
  }, [method]);

  const input: OpsExtendInput = useMemo(
    () => ({
      rate: method === "service" ? 0 : Number(rate || 0),
      method,
      bizDate: today,
    }),
    [rate, method, today],
  );

  const preview = useMemo(() => planOpsExtend(booking, input), [booking, input]);

  const submit = () => {
    if (busy) return;
    const planned = planOpsExtend(booking, input);
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onConfirm(input);
  };

  const summary =
    !("err" in preview)
      ? `${(booking.nights ?? 0) + 1}박 · ${dayLabel(preview.draft.checkOut)} 퇴실 · 판매가 ${won(preview.draft.price)}원`
      : null;

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal add-time-modal"
        role="dialog"
        aria-label={EXTEND_COPY}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{EXTEND_COPY}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · {booking.guestName} · 숙박
          </p>
          <p className="muted sm">다음 숙박일 +1 · 늦은 퇴실(당일 시간)과 달라요</p>
          <div className="paytake">
            <PriceInp sm>
              <span className="pl">오늘 요금</span>
              <input
                className="num"
                inputMode="numeric"
                placeholder="0"
                aria-label="오늘 요금"
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
          {summary ? (
            <p className="add-time-sum">
              {summary}
            </p>
          ) : null}
          <ChipGroup role="group" aria-label="결제 방법">
            {EXTEND_PAY_METHODS.map((m) => (
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
                {EXTEND_PAY_LABEL[m]}
              </Chip>
            ))}
          </ChipGroup>
          {method === "service" ? <p className="muted sm">서비스 · 0원 (무료 연장)</p> : null}
          {method === "deferred" ? <p className="muted sm">후불 · 잔금에 더해요</p> : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn dark" disabled={busy} onClick={submit} autoFocus>
            {busy ? "저장 중…" : EXTEND_COPY}
          </button>
        </div>
      </div>
    </div>
  );
}

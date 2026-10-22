import { useEffect, useState } from "react";
import { won } from "../shared/ledger";
import {
  EARLY_IN_PAY_LABEL,
  EARLY_IN_PAY_METHODS,
  EARLY_IN_PAY_TITLE,
  type EarlyInPayMethod,
  type EarlyInPayPlan,
  effectiveEarlyInAmount,
  planEarlyInPay,
} from "../shared/earlyInPay";
import { Chip, ChipGroup, PriceInp } from "./primitives";

/**
 * 「현황」빠른 입실 → 추가금 결제 팝업.
 * 카드/현금/이체/서비스 · 서비스=0원 · 확정 시에만 입실(+수납).
 */
export default function EarlyInPayModal({
  guestName,
  roomLabel,
  today,
  busy,
  onCancel,
  onConfirm,
}: {
  guestName: string;
  roomLabel: string;
  today: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (plan: EarlyInPayPlan, method: EarlyInPayMethod) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<EarlyInPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (method === "service") setAmount("");
  }, [method]);

  const submit = () => {
    if (busy) return;
    const raw = method === "service" ? 0 : Number(amount || 0);
    const planned = planEarlyInPay({ amount: raw, method, bizDate: today });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onConfirm(planned, method);
  };

  const displayAmount = method === "service" ? "" : amount ? won(Number(amount)) : "";

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal early-in-pay-modal"
        role="dialog"
        aria-label={EARLY_IN_PAY_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{EARLY_IN_PAY_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabel}</b> · {guestName}
          </p>
          <div className="paytake">
            <PriceInp sm>
              <span className="pl">금액</span>
              <input
                className="num"
                inputMode="numeric"
                placeholder="0"
                aria-label="추가금 금액"
                disabled={busy || method === "service"}
                value={displayAmount}
                onChange={(e) => {
                  if (method === "service") return;
                  setAmount(e.target.value.replace(/\D/g, "").slice(0, 9));
                  setErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </PriceInp>
            <ChipGroup role="group" aria-label="결제 방법">
              {EARLY_IN_PAY_METHODS.map((m) => (
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
                  {EARLY_IN_PAY_LABEL[m]}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          {method === "service" ? (
            <p className="muted sm">서비스 · {won(effectiveEarlyInAmount(Number(amount || 0), "service"))}원 (무료)</p>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn dark" disabled={busy} onClick={submit} autoFocus>
            {busy ? "처리 중…" : "입실 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

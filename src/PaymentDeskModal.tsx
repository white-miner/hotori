import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { type Booking, type HotelSettings, won } from "../shared/ledger";
import type { GroupInfo } from "../shared/settle";
import {
  PAYMENT_DESK_CTA,
  PAYMENT_DESK_METHOD_LABEL,
  PAYMENT_DESK_METHODS,
  PAYMENT_DESK_SURCHARGE_REASONS,
  PAYMENT_DESK_TITLE,
  SURCHARGE_REASON_LABEL,
  type DeskPayLine,
  type PaymentDeskKind,
  type PaymentDeskPayPlan,
  clearResidualConfirmLine,
  deskPaymentLines,
  paymentDeskGlance,
  planClearResidualBalance,
  planPaymentDeskPay,
  planPaymentDeskSurcharge,
} from "../shared/paymentDesk";
import { type BookPayMethod, payLineMain } from "../shared/payment";
import { payLineSub, type SurchargeReason } from "../shared/addSurcharge";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import { lookups } from "./ui";

type Mode = "pay" | "surcharge" | "ledger";

type SurchargeInput = {
  reason: SurchargeReason;
  hours: number;
  amount: number;
  memo: string;
  collect: boolean;
  method: BookPayMethod;
  bizDate: string;
};

/**
 * 「현황」결제/납입 데스크 — Entry 우회.
 * 단실 Option A · 동일 groupId 복수는 합산 + addGroupPayment.
 * 할증(늦은 퇴실 등)은 사유 칩으로 흡수(단실만).
 * 내역: 결제 줄 삭제(confirm) · 단실 오잔금 → 판매가 조정(confirm).
 */
export default function PaymentDeskModal({
  s,
  today,
  members,
  groupInfo,
  roomLabels,
  busy,
  onCancel,
  onPay,
  onSurcharge,
  onDeletePayment,
  onDeleteGroupPayment,
  onClearResidual,
}: {
  s: HotelSettings;
  today: string;
  members: Booking[];
  groupInfo?: GroupInfo | null;
  roomLabels: string[];
  busy?: boolean;
  onCancel: () => void;
  onPay: (plan: PaymentDeskPayPlan) => void;
  onSurcharge?: (b: Booking, input: SurchargeInput) => void;
  onDeletePayment?: (bookingId: string, payId: string) => void;
  onDeleteGroupPayment?: (groupId: string, payId: string) => void;
  onClearResidual?: (b: Booking, newPrice: number) => void;
}) {
  const L = lookups(s);
  const first = members[0];
  const plat = first ? L.plats.get(first.platformId) : undefined;
  const glance = useMemo(() => paymentDeskGlance(members, plat, groupInfo), [members, plat, groupInfo]);
  const single = !glance.group && members.length === 1 ? members[0] : null;
  const canSurcharge = !!single && !!onSurcharge;
  const lines = useMemo(() => deskPaymentLines(members, groupInfo), [members, groupInfo]);
  const clearPlan = single && onClearResidual ? planClearResidualBalance(single, plat) : null;
  const clearOk = clearPlan && !("err" in clearPlan) ? clearPlan : null;
  const clearErr = clearPlan && "err" in clearPlan ? clearPlan.err : null;
  const canClear = !!clearOk;

  const [mode, setMode] = useState<Mode>("pay");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [kind, setKind] = useState<PaymentDeskKind>("balance");
  const [reason, setReason] = useState<SurchargeReason>("late_out");
  const [hours, setHours] = useState("1");
  const [memo, setMemo] = useState("");
  const [collect, setCollect] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (glance.left > 0) setAmount(String(glance.left));
    else setAmount("");
    setKind("balance");
    setMode("pay");
    setErr(null);
  }, [glance.left, first?.id, members.length]);

  const submitPay = () => {
    if (busy) return;
    const planned = planPaymentDeskPay(glance, {
      amount: Number(amount || 0),
      method,
      kind,
      bizDate: today,
    });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onPay(planned);
  };

  const submitSurcharge = () => {
    if (busy || !single || !onSurcharge) return;
    const input = {
      reason,
      hours: Number(hours || 0),
      amount: Number(amount || 0),
      memo,
      collect: collect && Number(amount || 0) > 0,
      method,
      bizDate: today,
    };
    const planned = planPaymentDeskSurcharge(single, input);
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onSurcharge(single, input);
  };

  const removeLine = (line: DeskPayLine) => {
    if (busy) return;
    if (!window.confirm("이 결제 줄을 지울까요? 잔금이 다시 늘어날 수 있어요.")) return;
    setErr(null);
    if (line.scope === "booking") onDeletePayment?.(line.bookingId, line.pay.id);
    else onDeleteGroupPayment?.(line.groupId, line.pay.id);
  };

  const clearResidual = () => {
    if (busy || !single || !onClearResidual || !clearOk) return;
    if (!window.confirm(clearResidualConfirmLine(clearOk.cleared, clearOk.newPrice))) return;
    setErr(null);
    onClearResidual(single, clearOk.newPrice);
  };

  const guestLabel = first?.groupName || first?.guestName || "손님";
  const roomHint = (bookingId: string) => {
    const i = members.findIndex((m) => m.id === bookingId);
    return i >= 0 ? roomLabels[i] : null;
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal payment-desk-modal"
        role="dialog"
        aria-label={PAYMENT_DESK_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{PAYMENT_DESK_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p>
            <b>{roomLabels.map((n) => `${n}호`).join(", ")}</b> · {guestLabel}
            {glance.group ? ` · ${glance.memberCount}실` : ""}
          </p>
          <div className="payment-desk-glance" aria-label="잔금">
            <span>
              받을 <b>{won(glance.due)}</b>
            </span>
            <span>
              받은 <b>{won(glance.paid)}</b>
            </span>
            <span className={glance.tracked && glance.left > 0 ? "left" : ""}>
              남은 <b>{glance.tracked ? won(glance.left) : "—"}</b>
            </span>
          </div>
          {!glance.tracked ? <p className="muted sm">플랫폼 선결제 · 잔금 추적 없음 (기록만 가능)</p> : null}
          {glance.priceUnset ? <p className="ferr">금액미정 예약이 있어요. 판매가 확정 후 받아 주세요.</p> : null}
          {clearOk ? (
            <button type="button" className="btn sm line payment-desk-clear" disabled={busy} onClick={clearResidual}>
              잔금 없애기 · {won(clearOk.cleared)}원 맞춤 (오청구·시간료)
            </button>
          ) : null}

          <ChipGroup role="group" aria-label="데스크 모드">
            <Chip sm active={mode === "pay"} disabled={busy} onClick={() => { setMode("pay"); setErr(null); }}>
              받기 · 선금
            </Chip>
            {canSurcharge ? (
              <Chip sm active={mode === "surcharge"} disabled={busy} onClick={() => { setMode("surcharge"); setErr(null); }}>
                할증
              </Chip>
            ) : null}
            <Chip sm active={mode === "ledger"} disabled={busy} onClick={() => { setMode("ledger"); setErr(null); }}>
              내역
            </Chip>
          </ChipGroup>

          {mode === "pay" ? (
            <>
              <div className="paytake">
                <PriceInp sm>
                  <span className="pl">금액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="수납 금액"
                    disabled={busy || glance.priceUnset}
                    value={amount ? won(Number(amount)) : ""}
                    onChange={(e) => {
                      setAmount(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setErr(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitPay();
                      }
                    }}
                  />
                </PriceInp>
                <ChipGroup role="group" aria-label="받기 종류">
                  <Chip sm active={kind === "balance"} disabled={busy} onClick={() => setKind("balance")}>
                    받기
                  </Chip>
                  <Chip sm active={kind === "deposit"} disabled={busy} onClick={() => setKind("deposit")}>
                    선금
                  </Chip>
                </ChipGroup>
                <ChipGroup role="group" aria-label="결제 방법">
                  {PAYMENT_DESK_METHODS.map((m) => (
                    <Chip key={m} sm active={method === m} disabled={busy} onClick={() => setMethod(m)}>
                      {PAYMENT_DESK_METHOD_LABEL[m]}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            </>
          ) : null}

          {mode === "surcharge" ? (
            <>
              <ChipGroup role="group" aria-label="할증 사유">
                {PAYMENT_DESK_SURCHARGE_REASONS.map((r) => (
                  <Chip key={r} sm active={reason === r} disabled={busy} onClick={() => setReason(r)}>
                    {SURCHARGE_REASON_LABEL[r]}
                  </Chip>
                ))}
              </ChipGroup>
              {reason === "late_out" || reason === "late_fee" ? (
                <label className="dayuse-sale-field">
                  <span className="muted sm">시간</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="할증 시간"
                    disabled={busy}
                    value={hours}
                    onChange={(e) => setHours(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  />
                </label>
              ) : null}
              {reason === "other" ? (
                <label className="dayuse-sale-field dayuse-sale-name">
                  <span className="muted sm">메모</span>
                  <input
                    type="text"
                    aria-label="기타 사유"
                    disabled={busy}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value.slice(0, 80))}
                  />
                </label>
              ) : null}
              <div className="paytake">
                <PriceInp sm>
                  <span className="pl">할증액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="할증 금액"
                    disabled={busy}
                    value={amount ? won(Number(amount)) : ""}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                  />
                </PriceInp>
                <ChipGroup role="group" aria-label="지금 받기">
                  <Chip sm active={collect} disabled={busy} onClick={() => setCollect(true)}>
                    지금 받기
                  </Chip>
                  <Chip sm active={!collect} disabled={busy} onClick={() => setCollect(false)}>
                    잔금으로
                  </Chip>
                </ChipGroup>
                {collect ? (
                  <ChipGroup role="group" aria-label="결제 방법">
                    {PAYMENT_DESK_METHODS.map((m) => (
                      <Chip key={m} sm active={method === m} disabled={busy} onClick={() => setMethod(m)}>
                        {PAYMENT_DESK_METHOD_LABEL[m]}
                      </Chip>
                    ))}
                  </ChipGroup>
                ) : null}
              </div>
            </>
          ) : null}

          {mode === "ledger" ? (
            <div className="payment-desk-ledger" aria-label="결제 내역">
              {lines.length ? (
                lines.map((line) => {
                  const hint =
                    line.scope === "group" ? "단체" : roomHint(line.bookingId) ? `${roomHint(line.bookingId)}호` : null;
                  return (
                    <div className="payrow" key={`${line.scope}-${line.pay.id}`} title={line.pay.note?.trim() || undefined}>
                      <b>{payLineMain(line.pay.method, line.pay.amount)}</b>
                      <span className="muted">
                        {hint ? `${hint} · ` : ""}
                        {payLineSub(line.pay.kind, line.pay.bizDate, line.pay.note)}
                      </span>
                      {(line.scope === "booking" ? onDeletePayment : onDeleteGroupPayment) ? (
                        <button
                          type="button"
                          className="ic"
                          aria-label="이 결제 지우기"
                          disabled={busy}
                          onClick={() => removeLine(line)}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="muted sm">결제 내역이 없어요.</p>
              )}
              {single && clearErr && glance.tracked && glance.left > 0 ? (
                <p className="muted sm">{clearErr}</p>
              ) : null}
              {glance.tracked && glance.left > 0 && !canClear && !single ? (
                <p className="muted sm">단체는 내역에서 줄을 지우거나, 단실로 「잔금 없애기」를 써 주세요.</p>
              ) : null}
            </div>
          ) : null}

          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          {mode === "ledger" ? (
            <button type="button" className="btn dark" disabled={busy} onClick={onCancel}>
              닫기
            </button>
          ) : (
            <button
              type="button"
              className="btn dark"
              disabled={busy || glance.priceUnset}
              onClick={mode === "pay" ? submitPay : submitSurcharge}
              autoFocus
            >
              {busy ? "처리 중…" : mode === "pay" ? PAYMENT_DESK_CTA : "할증 확정"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

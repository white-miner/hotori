import { useEffect, useMemo, useState } from "react";
import { Ban, Check } from "lucide-react";
import { type Booking, won } from "../shared/ledger";
import type { GroupInfo } from "../shared/settle";
import {
  CHECKOUT_CONFIRM_TITLE,
  CHECKOUT_LEAVE_BALANCE,
  CHECKOUT_PAY_THEN,
  CHECKOUT_SIMPLE_CONFIRM,
  checkoutBalanceGlance,
  checkoutNeedsBalanceUi,
  planCheckoutBalancePay,
} from "../shared/checkoutConfirm";
import {
  PAYMENT_DESK_METHOD_LABEL,
  PAYMENT_DESK_METHODS,
  type PaymentDeskPayPlan,
} from "../shared/paymentDesk";
import { type BookPayMethod } from "../shared/payment";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import { lookups } from "./ui";
import type { HotelSettings } from "../shared/ledger";

/**
 * 퇴실처리 확인 · 잔금 있으면 settle/PaymentDesk 글랜스 + 수단 +
 * 결제 후 퇴실 / 잔금 남기고 퇴실 / 취소. 잔금 0이면 단순 확인.
 */
export default function CheckoutConfirmModal({
  s,
  today,
  booking,
  members,
  groupInfo,
  roomLabel,
  datesLabel,
  busy,
  onCancel,
  onCheckoutOnly,
  onPayThenCheckout,
}: {
  s: HotelSettings;
  today: string;
  booking: Booking;
  members: Booking[];
  groupInfo?: GroupInfo | null;
  roomLabel: string;
  datesLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onCheckoutOnly: () => void;
  onPayThenCheckout: (plan: PaymentDeskPayPlan) => void;
}) {
  const L = lookups(s);
  const plat = L.plats.get(booking.platformId);
  const glance = useMemo(
    () => checkoutBalanceGlance(members, plat, groupInfo),
    [members, plat, groupInfo],
  );
  const needsPay = checkoutNeedsBalanceUi(glance);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (needsPay && glance.left > 0) setAmount(String(glance.left));
    else setAmount("");
    setErr(null);
  }, [needsPay, glance.left, booking.id]);

  const guest = booking.groupName || booking.guestName;
  const head = [roomLabel ? `${roomLabel}` : "", guest, datesLabel].filter(Boolean).join(" · ");

  const submitPayThen = () => {
    if (busy) return;
    const planned = planCheckoutBalancePay(glance, {
      amount: Number(amount || 0),
      method,
      bizDate: today,
    });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onPayThenCheckout(planned);
  };

  return (
    <div
      className="dim assign-type-dim confirm-dim"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div
        className="modal assign-type-modal checkout-confirm-modal"
        role="dialog"
        aria-label={CHECKOUT_CONFIRM_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{CHECKOUT_CONFIRM_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          {needsPay ? (
            <>
              <p>
                <b>{head}</b>
              </p>
              <p className="muted sm">잔금이 있어요. 수납 후 퇴실하거나, 미수금을 남기고 퇴실할 수 있어요.</p>
              <div className="payment-desk-glance" aria-label="잔금">
                <span>
                  청구 <b>{won(glance.due)}</b>
                </span>
                <span>
                  수납 <b>{won(glance.paid)}</b>
                </span>
                <span className="left">
                  잔액 <b>{won(glance.left)}</b>
                </span>
              </div>
              {glance.group ? <p className="muted sm">단체 · {glance.memberCount}실</p> : null}
              <div className="paytake">
                <PriceInp sm>
                  <span className="pl">금액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="수납 금액"
                    disabled={busy}
                    value={amount ? won(Number(amount)) : ""}
                    onChange={(e) => {
                      setAmount(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setErr(null);
                    }}
                  />
                </PriceInp>
                <ChipGroup role="group" aria-label="결제 방법">
                  {PAYMENT_DESK_METHODS.map((m) => (
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
                      {PAYMENT_DESK_METHOD_LABEL[m]}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
              {err ? <div className="ferr">{err}</div> : null}
            </>
          ) : (
            <>
              <p>퇴실처리할까요?</p>
              <p>{head}</p>
            </>
          )}
        </div>
        <div className={`mf assign-type-acts${needsPay ? " checkout-co-acts" : ""}`}>
          <button type="button" className="btn red" disabled={busy} onClick={onCancel}>
            <Ban size={15} strokeWidth={2.2} aria-hidden />
            취소
          </button>
          {needsPay ? (
            <>
              <button type="button" className="btn stop" disabled={busy} onClick={onCheckoutOnly}>
                {busy ? "처리 중…" : CHECKOUT_LEAVE_BALANCE}
              </button>
              <button type="button" className="btn green" disabled={busy} onClick={submitPayThen} autoFocus>
                <Check size={15} strokeWidth={2.2} aria-hidden />
                {busy ? "처리 중…" : CHECKOUT_PAY_THEN}
              </button>
            </>
          ) : (
            <button type="button" className="btn stop" disabled={busy} onClick={onCheckoutOnly} autoFocus>
              <Check size={15} strokeWidth={2.2} aria-hidden />
              {busy ? "처리 중…" : CHECKOUT_SIMPLE_CONFIRM}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

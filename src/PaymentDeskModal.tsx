import { useEffect, useMemo, useState } from "react";
import { type Booking, type HotelSettings, won } from "../shared/ledger";
import type { GroupInfo } from "../shared/settle";
import {
  PAYMENT_DESK_CTA,
  PAYMENT_DESK_METHOD_LABEL,
  PAYMENT_DESK_METHODS,
  PAYMENT_DESK_SURCHARGE_REASONS,
  PAYMENT_DESK_TITLE,
  SURCHARGE_REASON_LABEL,
  type PaymentDeskKind,
  type PaymentDeskPayPlan,
  paymentDeskGlance,
  planPaymentDeskPay,
  planPaymentDeskSurcharge,
} from "../shared/paymentDesk";
import type { BookPayMethod } from "../shared/payment";
import type { SurchargeReason } from "../shared/addSurcharge";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import { lookups } from "./ui";

type Mode = "pay" | "surcharge";

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
}) {
  const L = lookups(s);
  const first = members[0];
  const plat = first ? L.plats.get(first.platformId) : undefined;
  const glance = useMemo(() => paymentDeskGlance(members, plat, groupInfo), [members, plat, groupInfo]);
  const single = !glance.group && members.length === 1 ? members[0] : null;
  const canSurcharge = !!single && !!onSurcharge;

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

  const guestLabel = first?.groupName || first?.guestName || "손님";

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

          {canSurcharge ? (
            <ChipGroup role="group" aria-label="데스크 모드">
              <Chip sm active={mode === "pay"} disabled={busy} onClick={() => { setMode("pay"); setErr(null); }}>
                받기 · 선금
              </Chip>
              <Chip sm active={mode === "surcharge"} disabled={busy} onClick={() => { setMode("surcharge"); setErr(null); }}>
                할증
              </Chip>
            </ChipGroup>
          ) : null}

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
          ) : (
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
          )}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="btn dark"
            disabled={busy || glance.priceUnset}
            onClick={mode === "pay" ? submitPay : submitSurcharge}
            autoFocus
          >
            {busy ? "처리 중…" : mode === "pay" ? PAYMENT_DESK_CTA : "할증 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

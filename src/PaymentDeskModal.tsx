import ModalTabs, { ModalTabPanel } from "./ModalTabs";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { type Booking, type HotelSettings, md, won } from "../shared/ledger";
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
import {
  STAY_CREDIT_COPY,
  type StayCredit,
  matchOpenCredits,
  planApplyStayCredit,
} from "../shared/stayCredit";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import { askConfirm } from "./ConfirmDialog";
import { lookups } from "./ui";

type Mode = "pay" | "surcharge" | "ledger" | "credit";

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
 * 내역: 결제 내역 삭제(confirm) · 단실 오잔금 → 판매가 조정(confirm).
 */
export default function PaymentDeskModal({
  s,
  today,
  members,
  groupInfo,
  roomLabels,
  stayCredits,
  busy,
  onCancel,
  onPay,
  onApplyCredit,
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
  /** 호텔 보관 잔액 — 손님 매칭용 */
  stayCredits?: StayCredit[];
  busy?: boolean;
  onCancel: () => void;
  onPay: (plan: PaymentDeskPayPlan) => void;
  onApplyCredit?: (credit: StayCredit, bookingId: string, amount: number) => void;
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
  const matchedCredits = useMemo(
    () => (single && stayCredits ? matchOpenCredits(stayCredits, single.guestName, single.guestPhone) : []),
    [single, stayCredits],
  );
  const canCredit = !!single && !!onApplyCredit && matchedCredits.length > 0;
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
  const [creditId, setCreditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const scope = useId();
  const drafts = useRef<Partial<Record<Mode,string>>>({});
  const deskKey = members.map(b=>b.id).sort().join(":");
  useEffect(() => {
    setAmount(glance.left > 0 ? String(glance.left) : "");
    setKind("balance"); setMode("pay"); setCreditId(matchedCredits[0]?.id ?? null); setErr(null);
    drafts.current = {};
    // 재조회로 새 배열이 와도 선택한 업무와 입력값은 유지. 대상 예약이 바뀔 때만 초기화.
  }, [deskKey]);
  const changeMode = (next: Mode) => {
    if (busy || next === mode) return;
    drafts.current[mode] = amount;
    if (drafts.current[next] == null) {
      if (next === "pay") drafts.current[next] = glance.left > 0 ? String(glance.left) : "";
      else if (next === "surcharge") { drafts.current[next] = "0"; setCollect(false); }
      else if (next === "credit") {
        const c = matchedCredits[0];
        const cap = c ? Math.min(c.amountRemaining, glance.left > 0 ? glance.left : c.amountRemaining) : 0;
        drafts.current[next] = cap > 0 ? String(cap) : ""; setCreditId(c?.id ?? null);
      }
    }
    setAmount(drafts.current[next] ?? ""); setMode(next); setErr(null);
  };
  useEffect(() => {
    // 외부 재조회로 보관 잔액이 소진되거나 지원 업무가 사라져도 빈 화면에 남지 않는다.
    if ((mode === "credit" && !canCredit) || (mode === "surcharge" && !canSurcharge)) {
      drafts.current[mode] = amount;
      setAmount(drafts.current.pay ?? (glance.left > 0 ? String(glance.left) : ""));
      setMode("pay"); setErr(null);
    }
  }, [mode, canCredit, canSurcharge, amount, glance.left]);

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

  const submitCredit = () => {
    if (busy || !single || !onApplyCredit) return;
    const c = matchedCredits.find((x) => x.id === creditId) ?? matchedCredits[0];
    if (!c) {
      setErr("쓸 수 있는 보관 잔액이 없어요.");
      return;
    }
    const planned = planApplyStayCredit({
      credit: c,
      bookingId: single.id,
      amount: Number(amount || 0),
      bizDate: today,
      kind: "balance",
    });
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onApplyCredit(c, single.id, planned.amount);
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
    void (async () => {
      const ok = await askConfirm({
        title: "결제 내역 삭제",
        body: "이 결제 내역을 삭제할까요? 잔금이 다시 늘어날 수 있어요.",
        confirmLabel: "삭제",
        danger: true,
      });
      if (!ok) return;
      setErr(null);
      if (line.scope === "booking") onDeletePayment?.(line.bookingId, line.pay.id);
      else onDeleteGroupPayment?.(line.groupId, line.pay.id);
    })();
  };

  const clearResidual = () => {
    if (busy || !single || !onClearResidual || !clearOk) return;
    void (async () => {
      const ok = await askConfirm({
        title: "잔금 조정",
        body: clearResidualConfirmLine(clearOk.cleared, clearOk.newPrice),
        confirmLabel: "잔금 조정",
        danger: true,
      });
      if (!ok) return;
      setErr(null);
      onClearResidual(single, clearOk.newPrice);
    })();
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
        <ModalTabs scope={scope} label="데스크 모드" value={mode} onChange={changeMode} disabled={busy} tabs={[{id:"pay",label:"수납·선금"},...(canSurcharge ? [{id:"surcharge" as const,label:"할증"}] : []),...(canCredit ? [{id:"credit" as const,label:STAY_CREDIT_COPY.use}] : []),{id:"ledger",label:"결제 내역"}]} />
        <div className="mb modal-task-body">
          <p>
            <b>{roomLabels.map((n) => `${n}호`).join(", ")}</b> · {guestLabel}
            {glance.group ? ` · ${glance.memberCount}실` : ""}
          </p>
          <div className="payment-desk-glance" aria-label="잔금">
            <span>
              청구 <b>{won(glance.due)}</b>
            </span>
            <span>
              수납 <b>{won(glance.paid)}</b>
            </span>
            <span className={glance.tracked && glance.left > 0 ? "left" : ""}>
              잔액 <b>{glance.tracked ? won(glance.left) : "—"}</b>
            </span>
          </div>
          {!glance.tracked ? <p className="muted sm">플랫폼 선결제 · 잔금 추적 없음 (기록만 가능)</p> : null}
          {glance.priceUnset ? <p className="ferr">금액미정 예약이 있어요. 판매가 확정 후 수납해 주세요.</p> : null}
          {clearOk ? (
            <button type="button" className="btn sm line payment-desk-clear" disabled={busy} onClick={clearResidual}>
              잔금 조정 · {won(clearOk.cleared)}원 감액 (오청구·시간료)
            </button>
          ) : null}

          <ModalTabPanel scope={scope} id="pay" active={mode}>
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
                <ChipGroup role="group" aria-label="수납 종류">
                  <Chip sm active={kind === "balance"} disabled={busy} onClick={() => setKind("balance")}>
                    수납
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
          </ModalTabPanel>

          {canCredit ? (
            <ModalTabPanel scope={scope} id="credit" active={mode}>
              <p className="muted sm">
                매칭된 {STAY_CREDIT_COPY.balance} {matchedCredits.length}건 · 부분 사용 OK · 현금 환불과 별개
              </p>
              <ChipGroup role="group" aria-label={STAY_CREDIT_COPY.balance}>
                {matchedCredits.map((c) => (
                  <Chip
                    key={c.id}
                    sm
                    active={creditId === c.id}
                    disabled={busy}
                    onClick={() => {
                      setCreditId(c.id);
                      const cap = Math.min(c.amountRemaining, glance.left > 0 ? glance.left : c.amountRemaining);
                      setAmount(String(cap));
                      setErr(null);
                    }}
                  >
                    {won(c.amountRemaining)}원
                    {c.preferredRecheckinDate ? ` · ${md(c.preferredRecheckinDate)}` : ""}
                  </Chip>
                ))}
              </ChipGroup>
              <div className="paytake">
                <PriceInp sm>
                  <span className="pl">{STAY_CREDIT_COPY.use}</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={STAY_CREDIT_COPY.use}
                    disabled={busy}
                    value={amount ? won(Number(amount)) : ""}
                    onChange={(e) => {
                      setAmount(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setErr(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitCredit();
                      }
                    }}
                  />
                </PriceInp>
              </div>
            </ModalTabPanel>
          ) : null}

          {canSurcharge ? (
            <ModalTabPanel scope={scope} id="surcharge" active={mode}>
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
              <p className="muted sm">0원=면제(늦은 퇴실만 기록) · 청구하려면 금액 입력</p>
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
                <ChipGroup role="group" aria-label="즉시 수납">
                  <Chip sm active={collect} disabled={busy || Number(amount || 0) <= 0} onClick={() => setCollect(true)}>
                    즉시 수납
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
            </ModalTabPanel>
          ) : null}

          <ModalTabPanel scope={scope} id="ledger" active={mode}>
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
                          aria-label="이 결제 삭제"
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
                <p className="muted sm">단체는 내역에서 결제 내역을 삭제하거나, 단실로 「잔금 조정」를 써 주세요.</p>
              ) : null}
            </div>
          </ModalTabPanel>

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
              disabled={busy || (mode !== "credit" && glance.priceUnset)}
              onClick={mode === "pay" ? submitPay : mode === "credit" ? submitCredit : submitSurcharge}
              autoFocus
            >
              {busy
                ? "처리 중…"
                : mode === "pay"
                  ? PAYMENT_DESK_CTA
                  : mode === "credit"
                    ? STAY_CREDIT_COPY.use
                    : "할증 확정"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

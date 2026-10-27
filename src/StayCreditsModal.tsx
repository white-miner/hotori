import { useMemo, useState } from "react";
import { type StayCredit, STAY_CREDIT_COPY, listOpenCredits } from "../shared/stayCredit";
import { dayLabel, md, won } from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";

/**
 * 보관 잔액 목록 (MVP) — 장부/결제 데스크에서 열기.
 * 전화·이름 검색 · 무효 처리. CRM 아님.
 */
export default function StayCreditsModal({
  credits,
  busy,
  onCancel,
  onVoid,
}: {
  credits: StayCredit[];
  busy?: boolean;
  onCancel: () => void;
  onVoid?: (c: StayCredit) => void;
}) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const open = useMemo(() => listOpenCredits(credits), [credits]);
  const filtered = useMemo(() => {
    const base = showAll ? credits : open;
    const t = q.trim().toLowerCase().replace(/\s+/g, "");
    const digits = q.replace(/\D/g, "");
    if (!t && !digits) return base;
    return base.filter((c) => {
      const name = c.guestName.toLowerCase().replace(/\s+/g, "");
      const phone = (c.guestPhone ?? "").replace(/\D/g, "");
      if (t && name.includes(t)) return true;
      if (digits && phone.includes(digits)) return true;
      return false;
    });
  }, [credits, open, q, showAll]);

  const voidOne = (c: StayCredit) => {
    if (!onVoid || busy || c.status !== "open") return;
    void (async () => {
      const ok = await askConfirm({
        title: `${STAY_CREDIT_COPY.balance} 무효`,
        body: `${c.guestName} 님 보관 잔액 ${won(c.amountRemaining)}원을 무효로 할까요? 이미 사용한 금액은 그대로예요.`,
        confirmLabel: "무효",
        danger: true,
      });
      if (!ok) return;
      onVoid(c);
    })();
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal"
        role="dialog"
        aria-label={STAY_CREDIT_COPY.list}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{STAY_CREDIT_COPY.list}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p className="muted sm">
            조기 퇴실 「{STAY_CREDIT_COPY.keep}」으로 보관 처리한 금액 · 새 예약에서 「{STAY_CREDIT_COPY.use}」
          </p>
          <label className="dayuse-sale-field dayuse-sale-name">
            <span className="muted sm">이름·연락처</span>
            <input
              type="search"
              value={q}
              disabled={busy}
              placeholder="검색"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="chips" style={{ marginTop: 8 }}>
            <button type="button" className={`chip ${!showAll ? "on" : ""}`} disabled={busy} onClick={() => setShowAll(false)}>
              사용 가능 {open.length}
            </button>
            <button type="button" className={`chip ${showAll ? "on" : ""}`} disabled={busy} onClick={() => setShowAll(true)}>
              전체 {credits.length}
            </button>
          </div>
          <div className="payment-desk-ledger" style={{ marginTop: 12 }} aria-label={STAY_CREDIT_COPY.list}>
            {filtered.length ? (
              filtered.map((c) => (
                <div className="payrow" key={c.id}>
                  <b>
                    {c.guestName}
                    {c.guestPhone ? ` · ${c.guestPhone}` : ""}
                  </b>
                  <span className="muted">
                    {c.status === "open"
                      ? `잔액 ${won(c.amountRemaining)} / ${won(c.amountOriginal)}`
                      : c.status === "depleted"
                        ? `소진 ${won(c.amountOriginal)}`
                        : `무효 · 원래 ${won(c.amountOriginal)}`}
                    {c.preferredRecheckinDate
                      ? ` · ${STAY_CREDIT_COPY.preferredDate} ${md(c.preferredRecheckinDate)}`
                      : ""}
                    {c.note ? ` · ${c.note}` : ""}
                    {` · ${dayLabel(c.createdAt.slice(0, 10))}`}
                  </span>
                  {c.status === "open" && onVoid ? (
                    <button type="button" className="ic" aria-label="무효" disabled={busy} onClick={() => voidOne(c)}>
                      무효
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="muted sm">보관 잔액이 없어요.</p>
            )}
          </div>
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn dark" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

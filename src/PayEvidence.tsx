import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { md, won } from "../shared/ledger";
import { type GroupLedger, balanceLabel, paidThroughLabel } from "../shared/groupLedger";
import { type PayLine, paymentCopyText } from "../shared/recordTimeline";

/**
 * 결제 내역 — 언제 · 어떤 객실 · 어떤 수단 · 얼마 · 어느 기간 · 선수금/잔금/미수 수납 · 처리자.
 * 맨 위에 미수금(선수금)과 결제 완료 날짜. 최근 3건만 보이고, 전체는 「기록 정정」에서 고치며 볼 수 있어요.
 */
export default function PayEvidence({
  title,
  lines,
  ledger,
  showBalance,
  readOnly,
  onOpen,
}: {
  title: string;
  lines: PayLine[];
  ledger?: GroupLedger | null;
  /** 잔액·결제 완료 날짜도 이 카드에 (머리글이 따로 안 보여줄 때) */
  showBalance?: boolean;
  readOnly?: boolean;
  onOpen: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const recent = lines.slice(-3);
  const copy = async () => {
    const text = paymentCopyText(title, lines, ledger?.roomCount ? ledger : null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("복사해서 쓰세요", text);
    }
  };
  return (
    <section className="pev" aria-label="결제 내역">
      <div className="pev-h">
        <b>결제 내역</b>
        <span className="muted sm">{lines.length ? `${lines.length}건 · 합계 ${won(total)}원` : "아직 없어요"}</span>
      </div>
      {showBalance && ledger?.roomCount ? (
        <div className="pev-bal">
          <b>{balanceLabel(ledger)}</b>
          <span className="muted sm">{paidThroughLabel(ledger, md)}</span>
        </div>
      ) : null}
      {recent.length ? (
        <ul className="pev-list">
          {lines.length > recent.length ? <li className="muted sm pev-more">앞의 {lines.length - recent.length}건은 전체 보기에서</li> : null}
          {recent.map((l) => (
            <li key={l.id} className="pev-li">
              <span className="pev-main">
                <b>{md(l.bizDate)}</b> {l.method} {won(l.amount)}원
              </span>
              <span className="pev-sub muted">
                {l.scope} · {l.period} · {l.cls} · {l.by}
                {l.edited ? " · 정정됨" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pev-f">
        <button type="button" className="pev-btn" onClick={onOpen}>
          <ClipboardList size={14} aria-hidden /> {readOnly ? "전체 보기" : "전체 보기 · 기록 정정"}
        </button>
        <button type="button" className="pev-btn" onClick={() => void copy()}>
          {copied ? "복사했어요" : "복사"}
        </button>
      </div>
    </section>
  );
}

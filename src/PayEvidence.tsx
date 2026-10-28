import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { md, won } from "../shared/ledger";
import type { GroupLedger } from "../shared/groupLedger";
import { type PayLine, paymentCopyText } from "../shared/recordTimeline";

/**
 * 결제 내역 — 받은 돈을 한 줄씩: `10/25 · 카드 · 690,000원` (+ 메모 · 처리자).
 * 객실·박에 나누지 않아요. 예전에 객실·기간을 적어 둔 줄만 그 표시가 같이 보여요. 최근 5건만 보이고, 전체는 「기록 정정」에서 고쳐요.
 */
export default function PayEvidence({
  title,
  lines,
  ledger,
  readOnly,
  onOpen,
}: {
  title: string;
  lines: PayLine[];
  ledger?: GroupLedger | null;
  readOnly?: boolean;
  onOpen: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const recent = lines.slice(-5);
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
      {recent.length ? (
        <ul className="pev-list">
          {lines.length > recent.length ? <li className="muted sm pev-more">앞의 {lines.length - recent.length}건은 전체 보기에서</li> : null}
          {recent.map((l) => (
            <li key={l.id} className="pev-li">
              <span className="pev-main">
                <b>{md(l.bizDate)}</b> · {l.method} · <b>{won(l.amount)}원</b>
              </span>
              <span className="pev-sub muted">
                {[l.bookingId ? l.scope : "", l.period, l.note, l.by, l.edited ? "정정됨" : ""].filter(Boolean).join(" · ")}
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

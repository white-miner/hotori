import { CircleDollarSign, Plus } from "lucide-react";
import { md } from "../shared/ledger";
import { type GroupLedger, balanceLabel, groupTone, paidThroughLabel, unpaidTodayLabel, coverLabel } from "../shared/groupLedger";
import { receiptNextAction } from "../shared/receipt";
import type { PayLine } from "../shared/recordTimeline";
import PayEvidence from "./PayEvidence";

/**
 * 단체 머리글 — 지금 상태 한눈에 + 다음 행동 큰 버튼 하나.
 * 미수금/선수금/잔액 · 결제 완료 ~날짜 · 오늘 밤까지 미결제 박 수 · [결제 등록 · N박 금액]
 */
export default function GroupHead({
  ledger,
  today,
  name,
  readOnly,
  onPay,
  onJoin,
  record,
}: {
  ledger: GroupLedger;
  today: string;
  name?: string | null;
  readOnly?: boolean;
  onPay: () => void;
  onJoin?: () => void;
  /** 결제 내역 + 기록 정정 열기 */
  record?: { lines: PayLine[]; onOpen: () => void } | null;
}) {
  const tone = groupTone(ledger);
  const next = receiptNextAction(ledger, today);
  const unpaid = unpaidTodayLabel(ledger);
  const cover = coverLabel(ledger);
  return (
    <section className={`ghead ${tone}`} aria-label="단체 결제 현황">
      <div className="ghead-top">
        <b className="ghead-name">{name || "단체"}</b>
        <span className="muted sm">{ledger.liveCount}객실 이용 중</span>
      </div>
      <div className="ghead-bal">{balanceLabel(ledger)}</div>
      <div className="ghead-meta">
        <span>{paidThroughLabel(ledger, md)}</span>
        {unpaid ? <span className="ghead-warn">{unpaid}</span> : cover ? <span>{cover}</span> : null}
      </div>
      {!readOnly ? (
        <div className="ghead-acts">
          <button type="button" className="btn dark ghead-go" onClick={onPay}>
            <CircleDollarSign size={16} strokeWidth={2.2} aria-hidden /> {next.label}
          </button>
          {onJoin ? (
            <button type="button" className="btn line ghead-sub" onClick={onJoin}>
              <Plus size={14} aria-hidden /> 객실 추가
            </button>
          ) : null}
        </div>
      ) : null}
      {record ? <PayEvidence title={name || "단체"} lines={record.lines} ledger={ledger} readOnly={readOnly} onOpen={record.onOpen} /> : null}
    </section>
  );
}

import { CircleDollarSign, Plus } from "lucide-react";
import { type GroupLedger, balanceLabel, diffLine, groupTone } from "../shared/groupLedger";
import { receiptNextAction } from "../shared/receipt";
import type { PayLine } from "../shared/recordTimeline";
import GroupCharges from "./GroupCharges";
import PayEvidence from "./PayEvidence";

/**
 * 단체 머리글 — 청구(객실별 요금)와 결제(받은 돈)를 따로 보여 주고 차액만 크게.
 * 미수금 / 초과 수납 / 정산 완료 · [결제 등록 · 미수금] 큰 버튼 하나 · 객실별 요금표(+퇴실 미정) · 결제 내역
 */
export default function GroupHead({
  ledger,
  today,
  name,
  readOnly,
  roomLabel,
  onPay,
  onJoin,
  onSetEnd,
  onEditRoom,
  record,
}: {
  ledger: GroupLedger;
  today: string;
  name?: string | null;
  readOnly?: boolean;
  roomLabel: (bookingId: string) => string;
  onPay: () => void;
  onJoin?: () => void;
  onSetEnd?: (ids: string[], out: string | null) => Promise<void> | void;
  onEditRoom?: (bookingId: string) => void;
  /** 결제 내역 + 기록 정정 열기 */
  record?: { lines: PayLine[]; onOpen: () => void } | null;
}) {
  const tone = groupTone(ledger);
  const next = receiptNextAction(ledger);
  return (
    <section className={`ghead ${tone}`} aria-label="단체 결제 현황">
      <div className="ghead-top">
        <b className="ghead-name">{name || "단체"}</b>
        <span className="muted sm">{ledger.liveCount}객실 이용 중</span>
      </div>
      <div className="ghead-bal">{balanceLabel(ledger)}</div>
      <div className="ghead-meta">
        <span>{diffLine(ledger)}</span>
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
      <GroupCharges ledger={ledger} today={today} roomLabel={roomLabel} readOnly={readOnly} onSetEnd={onSetEnd} onEditRoom={onEditRoom} />
      {record ? <PayEvidence title={name || "단체"} lines={record.lines} ledger={ledger} readOnly={readOnly} onOpen={record.onOpen} /> : null}
    </section>
  );
}

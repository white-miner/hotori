import ModalTabs, { ModalTabPanel } from "./ModalTabs";
import { useEffect, useId, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { type Booking, md, won } from "../shared/ledger";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, type BookPayMethod, type Payment } from "../shared/payment";
import { balanceLabel, diffLine, groupLedger, groupTone } from "../shared/groupLedger";
import { RECEIPT_MEMO_MAX, type ReceiptPlan, receiptAfterLabel, receiptButtonLabel, receiptMemoHint, receiptPlan, receiptSuggest } from "../shared/receipt";
import { isPeriodPayable } from "../shared/periodPay";
import { payLineText, payLines } from "../shared/recordTimeline";
import { GROUP_BADGE_COLORS, type GroupBadgeColor } from "../shared/settle";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import GroupCharges from "./GroupCharges";

/**
 * 단체 「결제 등록」 — 결제일 · 수단 · 금액 · 메모. 이게 전부예요.
 * 금액은 열면 미수금(청구 − 결제)으로 채워져 있고 고칠 수 있어요. 결제는 객실·박에 나누지 않고 한 줄로 기록해요.
 * 위에는 청구(객실별 요금)와 지금까지의 결제 내역을 따로 보여 줘서 차액이 바로 보여요.
 */
export default function GroupReceiptSheet({
  today,
  members,
  groupName,
  groupLump,
  lumps = [],
  extras = 0,
  leadId,
  leadPinned,
  badgeColor,
  roomLabel,
  readOnly,
  onPay,
  onUndo,
  onSetLead,
  onPickColor,
  onJoin,
  onLeave,
  onClose,
  onEditSchedule,
}: {
  today: string;
  /** 단체 활성 숙박 예약(퇴실한 객실 포함) · 최신 데이터 */
  members: Booking[];
  groupName?: string | null;
  /** 단체로 받은 결제 합 */
  groupLump: number;
  /** 단체로 받은 결제 줄 */
  lumps?: Payment[];
  extras?: number;
  leadId: string | null;
  leadPinned: boolean;
  badgeColor?: GroupBadgeColor | null;
  roomLabel: (b: Booking) => string;
  readOnly?: boolean;
  onPay: (plan: ReceiptPlan) => Promise<Payment[]>;
  onUndo: (saved: Payment[]) => Promise<void>;
  onSetLead: (bookingId: string | null) => Promise<void>;
  onPickColor?: (c: GroupBadgeColor) => Promise<void> | void;
  onJoin?: () => void;
  onLeave?: (bookingId: string) => void;
  onClose: () => void;
  onEditSchedule?: () => void;
}) {
  const [tab, setTab] = useState("register"), scope = useId();
  const ledger = useMemo(() => groupLedger(members, groupLump, today, { extras }), [members, groupLump, today, extras]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [bizDate, setBizDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ saved: Payment[]; amount: number } | null>(null);

  const suggest = receiptSuggest(ledger);
  const amountNum = amountEdit != null ? Number(amountEdit || 0) : suggest;
  const plan = useMemo(() => receiptPlan(ledger, { amount: amountNum, method, bizDate, memo }), [ledger, amountNum, method, bizDate, memo]);
  const tone = groupTone(ledger);
  const lead = leadId ? byId.get(leadId) : undefined;
  const hint = receiptMemoHint(ledger);
  const lines = useMemo(
    () => payLines([...members.flatMap((m) => m.payments ?? []), ...lumps], { roomName: (id) => { const b = byId.get(id); return b ? roomLabel(b) : "객실"; } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, lumps, byId],
  );
  const payableCount = members.filter(isPeriodPayable).length;
  const canGo = !busy && !readOnly && plan.ok;

  const submit = async () => {
    if (busy || readOnly) return;
    if (!plan.ok) return setErr(plan.error ?? "금액을 입력해 주세요.");
    setBusy(true);
    setErr(null);
    try {
      const saved = await onPay(plan);
      setDone({ saved, amount: plan.amount });
      setAmountEdit(null);
      setMemo("");
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!done || busy) return;
    setBusy(true);
    try {
      await onUndo(done.saved);
      setDone(null);
    } catch (e) {
      setErr(e instanceof Error ? `취소하지 못했어요: ${e.message}` : "취소하지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gpp-modal grc-modal" role="dialog" aria-label="단체 결제 등록" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>결제 등록</h2>
          <span className="muted sm gpp-gname">{groupName || "단체"} · {payableCount}객실</span>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
        <ModalTabs scope={scope} label="단체 결제 업무" value={tab} onChange={setTab} disabled={busy} tabs={[{id:"register",label:"결제 등록"},{id:"charges",label:"청구 근거"},{id:"payments",label:"결제 내역"},...(!readOnly ? [{id:"manage",label:"객실 관리"}] : [])]} actions={onEditSchedule && !readOnly ? <button type="button" className="btn line" disabled={busy} onClick={onEditSchedule}>일정·요금 수정</button> : null} />
        <div className="mb modal-task-body">
          <div className={`grc-sum ${tone}`} aria-label="단체 결제 현황" aria-live="polite">
            <b className="grc-bal">{balanceLabel(ledger)}</b>
            <span>{diffLine(ledger)}</span>
          </div>
          <ModalTabPanel scope={scope} id="register" active={tab}>
          {done ? (
            <div className="gpp-done" role="status">
              <span className="gpp-done-ic"><Check size={22} /></span>
              <b>{won(done.amount)}원 결제 등록 완료</b>
              <span className="muted sm">결제 내역에 한 줄로 기록했어요 · 지금 {balanceLabel(ledger)}. 잘못 눌렀다면 바로 취소할 수 있어요.</span>
            </div>
          ) : (
            <>
              <PriceInp>
                <span className="pl">결제 금액</span>
                <input
                  className="num"
                  inputMode="numeric"
                  aria-label="결제 금액"
                  placeholder="0"
                  autoFocus
                  value={amountNum ? won(amountNum) : ""}
                  onChange={(e) => { setAmountEdit(e.target.value.replace(/\D/g, "").slice(0, 9)); setErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
                />
              </PriceInp>
              {amountEdit != null && suggest > 0 && amountNum !== suggest ? (
                <button type="button" className="grc-link block" onClick={() => setAmountEdit(null)}>
                  미수금 {won(suggest)}원으로 되돌리기
                </button>
              ) : null}
              <ChipGroup role="group" aria-label="결제 방법">
                {BOOK_PAY_METHODS.map((m) => (
                  <Chip key={m} active={method === m} disabled={busy} onClick={() => setMethod(m)}>
                    {BOOK_PAY_LABEL[m]}
                  </Chip>
                ))}
              </ChipGroup>
              <div className="grc-flds">
                <label className="grc-fld">
                  <span className="muted sm">결제일</span>
                  <input type="date" aria-label="결제일" min="2020-01-01" max="2099-12-31" value={bizDate} onChange={(e) => e.target.value && setBizDate(e.target.value)} />
                </label>
                <label className="grc-fld grow">
                  <span className="muted sm">메모 (선택)</span>
                  <input className="grc-memo" aria-label="메모(선택)" placeholder={hint ? `예: ${hint}` : "예: 현장 결제"} maxLength={RECEIPT_MEMO_MAX} value={memo} onChange={(e) => setMemo(e.target.value)} />
                </label>
              </div>
              {plan.ok ? <p className="muted sm grc-note">{receiptAfterLabel(plan.after, ledger.upcoming)}</p> : null}
            </>
          )}

          </ModalTabPanel>
          <ModalTabPanel scope={scope} id="charges" active={tab}>
          <GroupCharges ledger={ledger} today={today} roomLabel={(id) => { const b = byId.get(id); return b ? roomLabel(b) : "객실"; }} readOnly />

          </ModalTabPanel>
          <ModalTabPanel scope={scope} id="payments" active={tab}>
          <section className="grc-pays" aria-label="결제 내역">
            <div className="gch-h">
              <b>결제 내역</b>
              <span className="muted sm">{lines.length ? `${lines.length}건 · 합계 ${won(ledger.paid)}원` : "아직 없어요"}</span>
            </div>
            {lines.length ? (
              <ul className="pev-list">
                {lines.slice(-6).map((l) => (
                  <li key={l.id} className="pev-li">
                    <span className="pev-main">{payLineText(l)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          </ModalTabPanel>
          <ModalTabPanel scope={scope} id="manage" active={tab}>
          {!readOnly ? (
            <section className="gpp-more">
              <h3>대표객실·단체 색상{lead ? ` · ${roomLabel(lead)}${leadPinned ? "" : " (자동)"}` : ""}</h3>
              <div className="gpp-lead-pick">
                {onLeave ? (
                  <div className="grc-leave">
                    {ledger.rooms.filter((r) => r.live).map((r) => {
                      const b = byId.get(r.bookingId);
                      return b ? (
                        <button key={r.bookingId} type="button" className="grc-link" onClick={() => onLeave(r.bookingId)}>
                          {roomLabel(b)} 조기 퇴실 처리
                        </button>
                      ) : null;
                    })}
                  </div>
                ) : null}
                <p className="muted sm">대표객실은 칸의 「대표객실」 뱃지에 나와요. 지정하면 결제·퇴실이 있어도 바뀌지 않아요.</p>
                <ChipGroup role="group" aria-label="대표객실 객실">
                  {members.filter((m) => isPeriodPayable(m) || m.id === leadId).map((m) => (
                    <Chip key={m.id} sm active={m.id === leadId} disabled={busy} onClick={() => void onSetLead(m.id).catch((e) => setErr(e instanceof Error ? e.message : "대표객실을 바꾸지 못했어요"))}>
                      {roomLabel(m)}
                    </Chip>
                  ))}
                  {leadPinned ? (
                    <Chip sm disabled={busy} onClick={() => void onSetLead(null).catch(() => setErr("자동으로 되돌리지 못했어요"))}>
                      자동으로
                    </Chip>
                  ) : null}
                </ChipGroup>
                {onPickColor ? (
                  <span className="gpp-sw" role="group" aria-label="뱃지 색">
                    {GROUP_BADGE_COLORS.map((id) => (
                      <button key={id} type="button" className={`grp-swatch ${id}${badgeColor === id ? " on" : ""}`} aria-label={`뱃지 색 ${id}`} onClick={() => void onPickColor(id)} />
                    ))}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
          </ModalTabPanel>
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts gpp-acts">
          {tab !== "register" ? <><button type="button" className="btn line" disabled={busy} onClick={onClose}>닫기</button><button type="button" className="btn dark" disabled={busy} onClick={()=>setTab("register")}>결제 등록으로</button></> : done ? (
            <>
              <button type="button" className="btn line" disabled={busy} onClick={() => void undo()}>
                방금 결제 등록 취소
              </button>
              <button type="button" className="btn line" onClick={() => setDone(null)}>
                이어서 결제 등록
              </button>
              <button type="button" className="btn dark" autoFocus onClick={onClose}>
                닫기
              </button>
            </>
          ) : (
            <>
              {onJoin && !readOnly ? (
                <button type="button" className="btn line" disabled={busy} onClick={onJoin}>
                  <Plus size={14} /> 객실 추가
                </button>
              ) : null}
              <button type="button" className="btn dark gpp-go" disabled={!canGo} onClick={() => void submit()}>
                {busy ? "저장 중…" : receiptButtonLabel(plan.ok ? plan.amount : 0)}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

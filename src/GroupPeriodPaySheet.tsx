import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { type Booking, addDays, md, won } from "../shared/ledger";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, type BookPayMethod, type Payment, validatePayment } from "../shared/payment";
import {
  type PeriodPayLine,
  type StayCoverage,
  coverageSummary,
  groupFirstUnpaid,
  isPeriodPayable,
  periodHeadline,
  periodPayLines,
  planGroupPeriod,
  stayCoverage,
} from "../shared/periodPay";
import { GROUP_BADGE_COLORS, type GroupBadgeColor } from "../shared/settle";
import { Chip, ChipGroup, PriceInp, Stepper } from "./primitives";

const PRESETS = [1, 3, 7] as const;

/**
 * 단체 「기간 결제」— 다음 N박을 모든 객실 합쳐 한 번에 받는 빠른 시트.
 * 열면 이미 `3박 × 3객실 = 690,000원 · 카드`로 채워져 있고 Enter 한 번이면 끝나요.
 * 저장은 방마다 한 줄(박 단위 배정)이라 후불·미수·환불·퇴실 계산은 그대로예요.
 */
export default function GroupPeriodPaySheet({
  today,
  members,
  groupName,
  groupLump,
  leadId,
  leadPinned,
  badgeColor,
  roomLabel,
  readOnly,
  initialNights = 3,
  onPay,
  onUndo,
  onSetLead,
  onPickColor,
  onOpenDesk,
  onClose,
}: {
  today: string;
  /** 단체 활성 숙박 예약(퇴실한 방 포함) · 최신 데이터 */
  members: Booking[];
  groupName?: string | null;
  /** 예전 방식(단체 일괄)으로 수납한 금액 — 방별 박에는 배정되지 않아요 */
  groupLump: number;
  leadId: string | null;
  leadPinned: boolean;
  badgeColor?: GroupBadgeColor | null;
  roomLabel: (b: Booking) => string;
  readOnly?: boolean;
  initialNights?: number;
  onPay: (lines: PeriodPayLine[], method: BookPayMethod, headline: string) => Promise<Payment[]>;
  onUndo: (saved: Payment[]) => Promise<void>;
  onSetLead: (bookingId: string | null) => Promise<void>;
  onPickColor?: (c: GroupBadgeColor) => Promise<void> | void;
  onOpenDesk?: () => void;
  onClose: () => void;
}) {
  const payable = useMemo(() => members.filter(isPeriodPayable), [members]);
  const covs = useMemo(() => payable.map((b) => stayCoverage(b)), [payable]);
  const covOf = useMemo(() => new Map<string, StayCoverage>(covs.map((c) => [c.bookingId, c])), [covs]);
  const first = groupFirstUnpaid(covs);
  const catchUp = !!first && first < today;

  const [nights, setNights] = useState(initialNights);
  const [custom, setCustom] = useState(false);
  // 밀린 박(오늘 이전 미결제)이 있어도 기본은 「오늘부터」 — 퇴실한 방의 옛 미수가 3박 결제를 끌고 가지 않게
  const [fromToday, setFromToday] = useState(catchUp);
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [editTotal, setEditTotal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ saved: Payment[]; headline: string; method: BookPayMethod } | null>(null);

  const start = fromToday && catchUp ? today : null;
  const backlog = useMemo(
    () => covs.reduce((n, c) => n + c.nights.filter((x) => x.date < today).reduce((m, x) => m + Math.max(0, x.amount - x.covered), 0), 0),
    [covs, today],
  );
  const plan = useMemo(() => planGroupPeriod(covs, nights, start), [covs, nights, start]);
  const next = useMemo(
    () => (plan.end ? planGroupPeriod(covs, nights, addDays(plan.end, 1)) : planGroupPeriod([], 0)),
    [covs, nights, plan.end],
  );
  const total = editTotal != null ? Number(editTotal || 0) : plan.total;
  const lines = useMemo(() => periodPayLines(plan, editTotal != null ? total : null), [plan, editTotal, total]);
  const groupLeft = covs.reduce((n, c) => n + c.left, 0);
  const groupDue = covs.reduce((n, c) => n + c.due, 0);
  const groupPaid = covs.reduce((n, c) => n + c.paid, 0);
  const headline = periodHeadline(plan, total) + ` · ${BOOK_PAY_LABEL[method]}`;
  const lead = leadId ? members.find((m) => m.id === leadId) : undefined;

  const submit = async () => {
    if (busy || readOnly || !lines.length) return;
    const bad = validatePayment(total, method, today);
    if (bad) return setErr(bad);
    if (total > groupLeft) return setErr(`잔액(${won(groupLeft)}원)을 초과해 수납할 수 없어요.`);
    setBusy(true);
    setErr(null);
    try {
      const saved = await onPay(lines, method, headline);
      setDone({ saved, headline, method });
      setEditTotal(null);
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

  // 키보드: 1·3·7 = 기간 · Enter = 결제(버튼에 자동 포커스) · Esc = 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (done || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1" || e.key === "3" || e.key === "7") {
        setNights(Number(e.key));
        setCustom(false);
        setEditTotal(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, done]);

  const pickNights = (n: number) => {
    setNights(n);
    setEditTotal(null);
    setErr(null);
  };
  const peerRows = members.filter((m) => covOf.has(m.id));
  const nothing = !plan.start || plan.total <= 0;

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gpp-modal" role="dialog" aria-label="단체 기간 결제" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>기간 결제</h2>
          <span className="muted sm gpp-gname">{groupName || "단체"} · {payable.length}객실</span>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="mb">
          {done ? (
            <div className="gpp-done" role="status">
              <span className="gpp-done-ic"><Check size={22} /></span>
              <b>{done.headline} 결제 완료</b>
              <span className="muted sm">방마다 박 단위로 나눠 기록했어요. 잘못 눌렀다면 바로 취소할 수 있어요.</span>
            </div>
          ) : (
            <>
              <div className="gpp-hero" aria-live="polite">
                {nothing ? (
                  <b>결제할 박이 없어요 · 모두 결제 완료</b>
                ) : (
                  <>
                    <span className="gpp-hl">{periodHeadline(plan, total)}</span>
                    <span className="muted sm">
                      {md(plan.start!)}{plan.nights > 1 ? `~${md(plan.end!)}` : ""}
                      {editTotal != null && total !== plan.total ? ` · 계산값 ${won(plan.total)}원에서 직접 고침` : ""}
                    </span>
                  </>
                )}
              </div>

              {catchUp ? (
                <ChipGroup role="group" aria-label="시작일">
                  <Chip sm active={!fromToday} onClick={() => { setFromToday(false); setEditTotal(null); }}>
                    밀린 것부터 {md(first!)}~ ({won(backlog)}원 밀림)
                  </Chip>
                  <Chip sm active={fromToday} onClick={() => { setFromToday(true); setEditTotal(null); }}>
                    오늘 {md(today)}부터
                  </Chip>
                </ChipGroup>
              ) : null}

              <ChipGroup role="group" aria-label="기간">
                {PRESETS.map((n) => (
                  <Chip key={n} active={!custom && nights === n} disabled={busy} onClick={() => { setCustom(false); pickNights(n); }}>
                    {n}박
                  </Chip>
                ))}
                <Chip active={!custom && nights >= plan.maxNights && plan.maxNights > 0 && !PRESETS.includes(plan.maxNights as 1)} disabled={busy || plan.maxNights < 1} onClick={() => { setCustom(false); pickNights(plan.maxNights); }}>
                  잔여 {plan.maxNights}박 전부
                </Chip>
                <Chip active={custom} disabled={busy} onClick={() => setCustom(true)}>
                  직접
                </Chip>
              </ChipGroup>
              {custom ? (
                <Stepper value={Math.max(1, nights)} unit="박" min={1} max={Math.max(1, plan.maxNights)} onChange={pickNights} />
              ) : null}

              <ChipGroup role="group" aria-label="결제 방법">
                {BOOK_PAY_METHODS.map((m) => (
                  <Chip key={m} active={method === m} disabled={busy} onClick={() => setMethod(m)}>
                    {BOOK_PAY_LABEL[m]}
                  </Chip>
                ))}
              </ChipGroup>

              <ul className="gpp-rows" aria-label="객실별 이번 기간">
                {peerRows.map((b) => {
                  const row = plan.rows.find((r) => r.bookingId === b.id);
                  const cov = covOf.get(b.id)!;
                  const isLead = b.id === leadId;
                  return (
                    <li key={b.id} className={`gpp-row${row && row.amount > 0 ? "" : " idle"}`}>
                      <span className="gpp-no">
                        <b>{roomLabel(b)}</b>
                        {isLead ? <i className="gpp-lead">대장</i> : null}
                      </span>
                      <span className="gpp-amt">
                        {row && row.amount > 0 ? (
                          <>
                            <b>{won(row.amount)}</b>
                            <small>
                              {row.nights}박{row.perNight ? ` × ${won(row.perNight)}` : ""}
                            </small>
                          </>
                        ) : (
                          <small>이번 기간 없음</small>
                        )}
                      </span>
                      <span className="gpp-st muted sm">{coverageSummary(cov)}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="payment-desk-glance gpp-glance" aria-label="단체 합계">
                <span>수납 <b>{won(groupPaid)}</b></span>
                <span>청구 <b>{won(groupDue)}</b></span>
                <span className={groupLeft > 0 ? "left" : ""}>잔액 <b>{won(groupLeft)}</b></span>
                {next.total > 0 ? (
                  <span>
                    이 기간 다음 {next.nights}박({md(next.start!)}~) <b>{won(next.total)}</b>
                  </span>
                ) : null}
              </div>
              {groupLump > 0 ? (
                <p className="muted sm">예전 방식으로 단체에 일괄 수납한 {won(groupLump)}원은 방별 박에는 나뉘지 않고 합계에만 반영돼요.</p>
              ) : null}

              {editTotal != null ? (
                <PriceInp sm>
                  <span className="pl">수납 금액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    aria-label="수납 금액 직접 입력"
                    value={editTotal ? won(Number(editTotal)) : ""}
                    onChange={(e) => { setEditTotal(e.target.value.replace(/\D/g, "").slice(0, 9)); setErr(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
                    autoFocus
                  />
                </PriceInp>
              ) : null}

              {!readOnly ? (
                <details className="gpp-more">
                  <summary>대장 객실 · 뱃지 색{lead ? ` — 대장 ${roomLabel(lead)}${leadPinned ? "" : " (자동)"}` : ""}</summary>
                  <div className="gpp-lead-pick">
                    <p className="muted sm">대장은 칸의 「대장」 뱃지에 나와요. 지정하면 결제·퇴실이 있어도 바뀌지 않아요.</p>
                    <ChipGroup role="group" aria-label="대장 객실">
                      {members.filter((m) => isPeriodPayable(m) || m.id === leadId).map((m) => (
                        <Chip
                          key={m.id}
                          sm
                          active={m.id === leadId}
                          disabled={busy}
                          onClick={() => void onSetLead(m.id).catch((e) => setErr(e instanceof Error ? e.message : "대장을 바꾸지 못했어요"))}
                        >
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
                          <button
                            key={id}
                            type="button"
                            className={`grp-swatch ${id}${badgeColor === id ? " on" : ""}`}
                            aria-label={`뱃지 색 ${id}`}
                            onClick={() => void onPickColor(id)}
                          />
                        ))}
                      </span>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </>
          )}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts gpp-acts">
          {done ? (
            <>
              <button type="button" className="btn line" disabled={busy} onClick={() => void undo()}>
                방금 결제 취소
              </button>
              <button type="button" className="btn line" onClick={() => setDone(null)}>
                다음 기간 결제
              </button>
              <button type="button" className="btn dark" autoFocus onClick={onClose}>
                닫기
              </button>
            </>
          ) : (
            <>
              {onOpenDesk ? (
                <button type="button" className="btn line gpp-desk" disabled={busy} onClick={onOpenDesk}>
                  금액 직접 수납
                </button>
              ) : null}
              {!nothing && editTotal == null ? (
                <button type="button" className="btn line" disabled={busy} onClick={() => setEditTotal(String(plan.total))}>
                  금액 수정
                </button>
              ) : null}
              <button type="button" className="btn dark gpp-go" disabled={busy || readOnly || nothing || total <= 0} onClick={() => void submit()} autoFocus>
                {busy ? "저장 중…" : nothing ? "결제 완료" : `${BOOK_PAY_LABEL[method]}로 ${won(total)}원 결제`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { type Booking, md, won } from "../shared/ledger";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, type BookPayMethod, type Payment } from "../shared/payment";
import { balanceLabel, groupLedger, groupTone, paidThroughLabel, unpaidTodayLabel } from "../shared/groupLedger";
import {
  RECEIPT_NIGHTS_MAX,
  type ReceiptPeriod,
  type ReceiptPlan,
  receiptDefaultNights,
  receiptDefaultRooms,
  receiptDefaultStart,
  receiptHeadline,
  receiptPlan,
} from "../shared/receipt";
import { isPeriodPayable } from "../shared/periodPay";
import { GROUP_BADGE_COLORS, type GroupBadgeColor } from "../shared/settle";
import { Chip, ChipGroup, PriceInp, Stepper } from "./primitives";

type Mode = "nights" | "none" | "through";
const PRESETS = [1, 3, 7] as const;

/**
 * 단체 「결제 등록」 — 금액·기간·객실·결제 방법을 직원이 자유롭게 정해요.
 * 열면 이미 `3박 × 4객실 = 960,000원 · 카드`처럼 지금 객실 전부로 채워져 있어서 한 번에 등록할 수 있어요.
 *  · 기간은 없어도 돼요 (선수금으로 등록 → 맨 앞 미결제 박부터 자동 반영)
 *  · 금액은 언제든 고칠 수 있고, 제안과 달라도 막지 않고 안내만 해요
 *  · 객실 추가·조기 퇴실 처리가 있어도 입실일부터 자기 요금으로만 계산돼요
 */
export default function GroupReceiptSheet({
  today,
  members,
  groupName,
  groupLump,
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
}: {
  today: string;
  /** 단체 활성 숙박 예약(퇴실한 객실 포함) · 최신 데이터 */
  members: Booking[];
  groupName?: string | null;
  /** 객실에 나누지 않은 단체 몫 결제 합 */
  groupLump: number;
  extras?: number;
  leadId: string | null;
  leadPinned: boolean;
  badgeColor?: GroupBadgeColor | null;
  roomLabel: (b: Booking) => string;
  readOnly?: boolean;
  onPay: (plan: ReceiptPlan, method: BookPayMethod, memo: string, headline: string) => Promise<Payment[]>;
  onUndo: (saved: Payment[]) => Promise<void>;
  onSetLead: (bookingId: string | null) => Promise<void>;
  onPickColor?: (c: GroupBadgeColor) => Promise<void> | void;
  onJoin?: () => void;
  onLeave?: (bookingId: string) => void;
  onClose: () => void;
}) {
  const ledger = useMemo(() => groupLedger(members, groupLump, today, { extras }), [members, groupLump, today, extras]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [mode, setMode] = useState<Mode>("nights");
  const [nights, setNights] = useState(() => receiptDefaultNights(ledger));
  const [custom, setCustom] = useState(false);
  const [through, setThrough] = useState(today);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(receiptDefaultRooms(ledger)));
  const [startPick, setStartPick] = useState<string | null>(null);
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ saved: Payment[]; headline: string } | null>(null);

  const roomIds = useMemo(() => ledger.rooms.filter((r) => picked.has(r.bookingId)).map((r) => r.bookingId), [ledger, picked]);
  const autoStart = receiptDefaultStart(ledger, roomIds, today);
  const period: ReceiptPeriod = mode === "none" ? { kind: "none" } : mode === "nights" ? { kind: "nights", nights } : { kind: "through", date: through };
  const plan = useMemo(
    () => receiptPlan({ ledger, roomIds, period, start: startPick, amount: amountEdit != null ? Number(amountEdit || 0) : null }, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ledger, roomIds, mode, nights, through, startPick, amountEdit, today],
  );
  const headline = receiptHeadline(plan, period) + ` · ${BOOK_PAY_LABEL[method]}`;
  const tone = groupTone(ledger);
  const behind = !!ledger.firstUncovered && ledger.firstUncovered < today;
  const lead = leadId ? byId.get(leadId) : undefined;

  const reset = () => {
    setAmountEdit(null);
    setErr(null);
  };
  const togglePick = (id: string) => {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    reset();
  };

  const submit = async () => {
    if (busy || readOnly) return;
    if (!plan.ok) return setErr(plan.error ?? "금액을 적어 주세요.");
    if (plan.total > 100_000_000) return setErr("금액을 확인해 주세요 (1억 원까지).");
    setBusy(true);
    setErr(null);
    try {
      const saved = await onPay(plan, method, memo.trim(), headline);
      setDone({ saved, headline });
      setAmountEdit(null);
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
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (done || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1" || e.key === "3" || e.key === "7") {
        setMode("nights");
        setNights(Number(e.key));
        setCustom(false);
        setAmountEdit(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, done]);

  const pickNights = (n: number) => {
    setMode("nights");
    setNights(Math.max(1, Math.min(RECEIPT_NIGHTS_MAX, n)));
    reset();
  };
  const amountShown = amountEdit != null ? amountEdit : plan.suggested > 0 ? String(plan.suggested) : "";
  const rangeText = plan.start && plan.end ? `${md(plan.start)}${plan.nights > 1 ? `~${md(plan.end)}` : ""} · ${plan.nights}박` : "기간 없음 · 선수금으로 등록";
  const firstAll = ledger.rooms.reduce<string | null>((m, r) => (r.firstNight && (!m || r.firstNight < m) ? r.firstNight : m), null);
  const payableCount = members.filter(isPeriodPayable).length;
  const owedOf = (r: (typeof ledger.rooms)[number]) => r.nights.filter((n) => n.date <= today).reduce((a, n) => a + n.amount - n.covered, 0);
  const canGo = !busy && !readOnly && plan.ok && roomIds.length > 0;

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
        <div className="mb">
          {done ? (
            <div className="gpp-done" role="status">
              <span className="gpp-done-ic"><Check size={22} /></span>
              <b>{done.headline} 결제 등록 완료</b>
              <span className="muted sm">객실별로 나눠 결제 내역에 기록했어요. 잘못 눌렀다면 바로 취소할 수 있어요.</span>
            </div>
          ) : (
            <>
              <div className={`grc-sum ${tone}`} aria-label="단체 결제 현황">
                <b className="grc-bal">{balanceLabel(ledger)}</b>
                <span>{paidThroughLabel(ledger, md)}</span>
                {unpaidTodayLabel(ledger) ? <span className="grc-warn">{unpaidTodayLabel(ledger)}</span> : null}
              </div>

              <div className="gpp-hero" aria-live="polite">
                <span className="gpp-hl">{plan.ok ? receiptHeadline(plan, period) : "금액을 적어 주세요"}</span>
                <span className="muted sm">{rangeText}</span>
              </div>

              <ChipGroup role="group" aria-label="결제 기간">
                {PRESETS.map((n) => (
                  <Chip key={n} active={mode === "nights" && !custom && nights === n} disabled={busy} onClick={() => { setCustom(false); pickNights(n); }}>
                    {n}박
                  </Chip>
                ))}
                <Chip active={mode === "nights" && custom} disabled={busy} onClick={() => { setCustom(true); pickNights(nights); }}>
                  직접
                </Chip>
                <Chip active={mode === "through"} disabled={busy} onClick={() => { setMode("through"); reset(); }}>
                  ~날짜까지
                </Chip>
                <Chip active={mode === "none"} disabled={busy} onClick={() => { setMode("none"); setCustom(false); reset(); }}>
                  기간 없음
                </Chip>
              </ChipGroup>
              {mode === "nights" && custom ? <Stepper value={nights} unit="박" min={1} max={RECEIPT_NIGHTS_MAX} onChange={pickNights} /> : null}
              {mode === "through" ? (
                <label className="grc-date">
                  <span className="muted sm">마지막 박</span>
                  <input type="date" value={through} min={plan.start ?? autoStart} onChange={(e) => { setThrough(e.target.value || today); reset(); }} />
                </label>
              ) : null}
              {mode !== "none" ? (
                <ChipGroup role="group" aria-label="시작일">
                  <Chip sm active={startPick == null} onClick={() => { setStartPick(null); reset(); }}>
                    {behind ? `밀린 ${md(autoStart)}부터` : `${md(autoStart)}부터`}
                  </Chip>
                  {behind ? (
                    <Chip sm active={startPick === today} onClick={() => { setStartPick(today); reset(); }}>
                      오늘 {md(today)}부터
                    </Chip>
                  ) : null}
                </ChipGroup>
              ) : (
                <p className="muted sm">기간을 정하지 않으면 선수금으로 등록돼요. 맨 앞 미결제 박부터 자동으로 반영하고, 남으면 단체 선수금으로 둬요.</p>
              )}

              <ul className="gpp-rows grc-rows" aria-label="객실별 결제">
                {ledger.rooms.map((r) => {
                  const b = byId.get(r.bookingId)!;
                  const row = plan.rows.find((x) => x.bookingId === r.bookingId);
                  const on = picked.has(r.bookingId);
                  const joined = firstAll && r.firstNight && r.firstNight > firstAll;
                  return (
                    <li key={r.bookingId} className={`gpp-row grc-row${on ? "" : " idle"}`}>
                      <label className="gpp-no grc-pick">
                        <input type="checkbox" checked={on} disabled={busy} onChange={() => togglePick(r.bookingId)} aria-label={`${roomLabel(b)} 포함`} />
                        <b>{roomLabel(b)}</b>
                        {r.bookingId === leadId ? <i className="gpp-lead">대장</i> : null}
                        {joined ? <i className="grc-tag">{md(r.firstNight!)} 입실</i> : null}
                        {!r.live ? <i className="grc-tag end">이용 끝</i> : null}
                      </label>
                      <span className="gpp-amt">
                        {on && row && row.amount > 0 ? (
                          <>
                            <b>{won(row.amount)}</b>
                            <small>{row.nights}박{row.perNight && mode !== "none" ? ` × ${won(row.perNight)}` : ""}</small>
                          </>
                        ) : (
                          <small>{on ? "이번 결제 없음" : "제외"}</small>
                        )}
                      </span>
                      <span className="gpp-st muted sm">
                        {r.paidThrough ? `결제 완료 ~${md(r.paidThrough)}` : "결제 내역 없음"}
                        {owedOf(r) > 0 ? ` · 미수금 ${won(owedOf(r))}원` : ""}
                        {onLeave && r.live && !readOnly ? (
                          <button type="button" className="grc-link" onClick={() => onLeave(r.bookingId)}>조기 퇴실 처리</button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <PriceInp sm>
                <span className="pl">결제 금액</span>
                <input
                  className="num"
                  inputMode="numeric"
                  aria-label="결제 금액 직접 입력"
                  placeholder="0"
                  value={amountShown ? won(Number(amountShown)) : ""}
                  onChange={(e) => { setAmountEdit(e.target.value.replace(/\D/g, "").slice(0, 9)); setErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
                />
              </PriceInp>
              {amountEdit != null && plan.suggested > 0 && Number(amountEdit || 0) !== plan.suggested ? (
                <button type="button" className="grc-link block" onClick={() => setAmountEdit(null)}>
                  제안 금액 {won(plan.suggested)}원으로 되돌리기
                </button>
              ) : null}
              {plan.notes.map((n) => (
                <p key={n} className="muted sm grc-note">{n}</p>
              ))}

              <ChipGroup role="group" aria-label="결제 방법">
                {BOOK_PAY_METHODS.map((m) => (
                  <Chip key={m} active={method === m} disabled={busy} onClick={() => setMethod(m)}>
                    {BOOK_PAY_LABEL[m]}
                  </Chip>
                ))}
              </ChipGroup>
              <input className="grc-memo" aria-label="메모(선택)" placeholder="메모 (선택) — 예: 현장 결제" maxLength={30} value={memo} onChange={(e) => setMemo(e.target.value)} />

              {!readOnly ? (
                <details className="gpp-more">
                  <summary>대장 객실 · 뱃지 색{lead ? ` — 대장 ${roomLabel(lead)}${leadPinned ? "" : " (자동)"}` : ""}</summary>
                  <div className="gpp-lead-pick">
                    <p className="muted sm">대장은 칸의 「대장」 뱃지에 나와요. 지정하면 결제·퇴실이 있어도 바뀌지 않아요.</p>
                    <ChipGroup role="group" aria-label="대장 객실">
                      {members.filter((m) => isPeriodPayable(m) || m.id === leadId).map((m) => (
                        <Chip key={m.id} sm active={m.id === leadId} disabled={busy} onClick={() => void onSetLead(m.id).catch((e) => setErr(e instanceof Error ? e.message : "대장을 바꾸지 못했어요"))}>
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
                방금 결제 등록 취소
              </button>
              <button type="button" className="btn line" onClick={() => { setDone(null); setStartPick(null); }}>
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
              <button type="button" className="btn dark gpp-go" disabled={!canGo} onClick={() => void submit()} autoFocus>
                {busy ? "저장 중…" : plan.ok ? `${BOOK_PAY_LABEL[method]}로 ${won(plan.total)}원 결제 등록` : "금액을 적어 주세요"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

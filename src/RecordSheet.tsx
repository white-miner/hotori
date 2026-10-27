import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { saveFailMessage } from "../shared/errors";
import { type Booking, addDays, daysBetween, dayLabel, md, stayEnd, STAY_NIGHTS_MAX, won } from "../shared/ledger";
import { changesFor } from "../shared/changes";
import { balanceLabel, groupLedger, paidThroughLabel } from "../shared/groupLedger";
import { PAYMENT_METHOD_LABEL, PAY_MAX, type PayKind, type Payment, type PaymentEdit, type PaymentMethod } from "../shared/payment";
import { hasFullNightMatrix, nightRatesFromTotal, syncStayNightRates, type StayNightRates } from "../shared/nightrates";
import { tableTotal, tableRows } from "../shared/nightTable";
import {
  type TimelineRow,
  fixPaymentAddSummary,
  fixPaymentDeleteSummary,
  fixPaymentRestoreSummary,
  fixPaymentSummary,
  fixStaySummary,
  FIX_PREFIX,
  payClassOf,
  payLines,
  paymentCopyText,
  recordAdvisories,
  recordTimeline,
} from "../shared/recordTimeline";
import type { HotelData } from "./data";
import { Chip, ChipGroup, PriceInp, Stepper } from "./primitives";
import NightRatesTable from "./NightRatesTable";

const METHODS: PaymentMethod[] = ["card", "cash", "transfer", "credit"];
const GROUP = "__group__";

/**
 * 기록 정정 — 꼬인 기록을 고치는 한 곳.
 * 입실 → 객실 추가 → 결제 → 이동 → 퇴실을 날짜순으로 보여 주고, 줄을 누르면 그 자리에서 고쳐요.
 * 결제: 금액·수단·결제일·객실/단체·기간·메모 수정, 지난 결제 추가, 삭제(되돌리기). 객실: 입실일·퇴실일·박별 요금.
 * 고칠 때마다 변경 기록(booking_changes)에 「기록 정정 · …」으로 남아요. 아무것도 막지 않아요.
 */
export default function RecordSheet({
  data,
  today,
  members,
  groupId,
  name,
  readOnly,
  onClose,
  onSaved,
}: {
  data: HotelData;
  today: string;
  /** 단체 예약 전부 (개인이면 그 예약 하나) */
  members: Booking[];
  groupId: string | null;
  name: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: (msg: string) => void;
}) {
  const roomNo = (id: string | null | undefined) => {
    for (const f of data.hotel?.settings.floors ?? []) for (const r of f.rooms) if (r.id === id) return `${r.no}호`;
    return "미배정";
  };
  const live = members.filter((m) => m.status !== "cancelled" && m.kind === "stay");
  const bookingName = (bookingId: string) => roomNo(members.find((m) => m.id === bookingId)?.roomId);
  const info = groupId ? data.groups.get(groupId) : undefined;
  const groupPays = info?.payments ?? [];
  const allPays = useMemo(() => [...live.flatMap((m) => m.payments ?? []), ...groupPays], [live, groupPays]);
  const ledger = useMemo(
    () => groupLedger(members, groupPays.reduce((n, p) => n + p.amount, 0), today, { extras: (info?.extras ?? []).reduce((n, x) => n + x.amount, 0) }),
    [members, groupPays, today, info],
  );
  const lines = payLines(allPays, { roomName: bookingName, meId: data.meId });
  const scope = { groupId, bookingIds: members.map((m) => m.id) };
  const changes = useMemo(() => changesFor(data.changes, scope), [data.changes, groupId, members]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = recordTimeline({
    bookings: members,
    groupPayments: groupPays,
    payments: (id) => members.find((m) => m.id === id)?.payments ?? [],
    changes,
    roomName: roomNo,
    today,
    meId: data.meId,
  });
  const advisories = recordAdvisories({ bookings: members, groupPayments: groupPays, ledger: ledger.roomCount ? ledger : null, roomName: roomNo });

  const [open, setOpen] = useState<string | null>(null); // timeline key | "new"
  const [msg, setMsg] = useState<string | null>(null);
  const [undo, setUndo] = useState<Payment | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const logTo = (p: { kind: "money" | "stay" | "rate" | "room"; summary: string; bookingId?: string | null }) =>
    void data.logChange({ kind: p.kind, summary: p.summary, groupId, bookingId: groupId ? null : p.bookingId ?? members[0]?.id ?? null, effectiveOn: today });

  const doSave = async (payId: string | null, e: PaymentEdit) => {
    setErr(null);
    try {
      if (payId) {
        const before = allPays.find((p) => p.id === payId)!;
        await data.updatePayment(payId, e);
        logTo({ kind: "money", summary: fixPaymentSummary(before, e, bookingName), bookingId: e.bookingId ?? before.bookingId });
        setMsg("결제 기록을 고쳤어요");
      } else {
        const synthetic: Payment = { id: "", bookingId: e.bookingId ?? "", groupId: e.bookingId ? null : e.groupId, kind: e.kind, method: e.method, amount: e.amount, bizDate: e.bizDate, createdAt: "", note: e.note ?? null, nightDate: e.nightDate ?? null, periodNights: e.periodNights ?? null };
        await data.restorePayment(synthetic);
        logTo({ kind: "money", summary: fixPaymentAddSummary(synthetic, bookingName), bookingId: e.bookingId });
        setMsg("결제 기록을 추가했어요");
      }
      setOpen(null);
      onSaved?.("기록을 정정했어요");
    } catch (x) {
      setErr(saveFailMessage(x, "저장하지 못했어요"));
    }
  };
  const doDelete = async (p: Payment) => {
    setErr(null);
    try {
      if (p.bookingId) await data.deletePayment(p.bookingId, p.id);
      else if (p.groupId) await data.deleteGroupPayment(p.groupId, p.id);
      logTo({ kind: "money", summary: fixPaymentDeleteSummary(p, bookingName), bookingId: p.bookingId });
      setUndo(p);
      setMsg(null);
      setOpen(null);
    } catch (x) {
      setErr(saveFailMessage(x, "지우지 못했어요"));
    }
  };
  const doUndo = async () => {
    if (!undo) return;
    try {
      await data.restorePayment(undo);
      logTo({ kind: "money", summary: fixPaymentRestoreSummary(undo, bookingName), bookingId: undo.bookingId });
      setUndo(null);
      setMsg("지운 결제를 되돌렸어요");
    } catch (x) {
      setErr(saveFailMessage(x, "되돌리지 못했어요"));
    }
  };
  const copy = async () => {
    const text = paymentCopyText(name, lines, ledger.roomCount ? ledger : null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("복사해서 쓰세요", text);
    }
  };

  const payOf = (id: string | null) => (id ? allPays.find((p) => p.id === id) ?? null : null);
  const sideOf = (r: TimelineRow) => (r.bookingId ? members.find((m) => m.id === r.bookingId) ?? null : null);

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal assign-type-modal gpp-modal rec-modal" role="dialog" aria-label="기록 정정" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>{readOnly ? "결제 · 기록" : "기록 정정"}</h2>
          <span className="muted sm gpp-gname">{name}</span>
          <button type="button" className="x" aria-label="닫기" onClick={onClose}>닫기</button>
        </div>
        <div className="mb">
          <div className="rec-sum">
            <b>{ledger.roomCount ? balanceLabel(ledger) : `결제 ${won(lines.reduce((n, l) => n + l.amount, 0))}원`}</b>
            <span className="muted sm">
              결제 합계 {won(lines.reduce((n, l) => n + l.amount, 0))}원 · {ledger.roomCount ? paidThroughLabel(ledger, md) : `${lines.length}건`}
            </span>
          </div>

          {msg ? <div className="rec-ok" role="status">{msg}</div> : null}
          {undo ? (
            <div className="rec-undo" role="status">
              <span>삭제했어요 · {PAYMENT_METHOD_LABEL[undo.method]} {won(undo.amount)}원</span>
              <button type="button" className="btn line" onClick={() => void doUndo()}>되돌리기</button>
            </div>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}

          {readOnly ? null : open === "new" ? (
            <PayEditor key="new" payment={null} members={live} groupId={groupId} today={today} roomName={bookingName} onCancel={() => setOpen(null)} onSave={(e) => doSave(null, e)} />
          ) : (
            <button type="button" className="btn dark rec-add" onClick={() => setOpen("new")}>
              <Plus size={16} aria-hidden /> 빠진 결제 기록하기
            </button>
          )}

          {advisories.length ? (
            <ul className="rec-adv" aria-label="참고">
              {advisories.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}

          <ol className="rec-tl" aria-label="기록 순서">
            {rows.map((r) => {
              const p = payOf(r.paymentId);
              const b = sideOf(r);
              const editable = !readOnly && (!!p || (!!b && r.kind !== "fix" && r.kind !== "move"));
              const isOpen = open === r.key;
              return (
                <li key={r.key} className={`rec-row k-${r.kind}${r.future ? " fut" : ""}${isOpen ? " on" : ""}`}>
                  <button type="button" className="rec-hd" disabled={!editable} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)}>
                    <span className="rec-d">{md(r.date)}<small>{dayLabel(r.date).replace(/^\d+\/\d+\s*/, "")}</small></span>
                    <span className="rec-t">
                      <b>{r.title}</b>
                      {r.sub ? <small className="muted">{r.sub}</small> : null}
                    </span>
                    {r.future ? <span className="rec-tag">예정</span> : null}
                    {editable ? <span className="rec-edit">{isOpen ? "닫기" : "고치기"}</span> : null}
                  </button>
                  {isOpen && p ? (
                    <PayEditor payment={p} members={live} groupId={groupId} today={today} roomName={bookingName} onCancel={() => setOpen(null)} onSave={(e) => doSave(p.id, e)} onDelete={() => doDelete(p)} />
                  ) : null}
                  {isOpen && !p && b ? (
                    <StayEditor
                      key={b.id}
                      booking={b}
                      roomName={roomNo(b.roomId)}
                      onCancel={() => setOpen(null)}
                      onSave={async (patch, summary, kind) => {
                        setErr(null);
                        try {
                          await data.patchBooking(b.id, patch);
                          logTo({ kind, summary, bookingId: b.id });
                          setMsg(`${roomNo(b.roomId)} 기록을 고쳤어요`);
                          setOpen(null);
                          onSaved?.("기록을 정정했어요");
                        } catch (x) {
                          setErr(saveFailMessage(x, "저장하지 못했어요"));
                        }
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
            {!rows.length ? <li className="muted sm rec-empty">아직 기록이 없어요</li> : null}
          </ol>
        </div>
        <div className="mf assign-type-acts gpp-acts">
          <button type="button" className="btn line" onClick={() => void copy()}>{copied ? "복사했어요" : "결제 내역 복사"}</button>
          <button type="button" className="btn line" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 결제 줄 편집 ---------- */
function PayEditor({
  payment,
  members,
  groupId,
  today,
  roomName,
  onCancel,
  onSave,
  onDelete,
}: {
  payment: Payment | null;
  members: Booking[];
  groupId: string | null;
  today: string;
  roomName: (bookingId: string) => string;
  onCancel: () => void;
  onSave: (e: PaymentEdit) => Promise<void>;
  onDelete?: () => void;
}) {
  const first = members[0] ?? null;
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? "card");
  const [bizDate, setBizDate] = useState(payment?.bizDate ?? today);
  const [target, setTarget] = useState<string>(payment ? (payment.bookingId || GROUP) : groupId ? GROUP : first?.id ?? "");
  const [note, setNote] = useState(payment?.note ?? "");
  const [kind, setKind] = useState<PayKind>(payment?.kind ?? "balance");
  const [periodOn, setPeriodOn] = useState(!!payment?.nightDate);
  const tb = members.find((m) => m.id === target) ?? null;
  const [from, setFrom] = useState(payment?.nightDate ?? tb?.checkIn ?? today);
  const [nights, setNights] = useState(payment?.periodNights ?? tb?.nights ?? 1);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const amt = Math.round(Number(amount.replace(/\D/g, "")) || 0);
  const usesPeriod = periodOn && !!tb;
  const preview = payClassOf({ kind, bizDate, nightDate: usesPeriod ? from : null, periodNights: usesPeriod ? nights : null });
  const pick = (t: string) => {
    setTarget(t);
    const m = members.find((x) => x.id === t);
    if (m && periodOn) {
      setFrom(m.checkIn);
      setNights(m.nights ?? 1);
    }
    if (!m) setPeriodOn(false);
  };
  const submit = async () => {
    if (!amt || amt > PAY_MAX) return setLocalErr("금액을 입력해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return setLocalErr("결제일을 골라 주세요.");
    if (!tb && !groupId) return setLocalErr("어느 객실의 결제인지 골라 주세요.");
    if (usesPeriod && (nights < 1 || nights > STAY_NIGHTS_MAX)) return setLocalErr("대상 기간을 확인해 주세요.");
    setBusy(true);
    setLocalErr(null);
    try {
      await onSave({
        bookingId: tb ? tb.id : null,
        groupId: tb ? null : groupId,
        kind,
        method,
        amount: amt,
        bizDate,
        note: note.trim() || null,
        nightDate: usesPeriod ? from : null,
        periodNights: usesPeriod ? nights : null,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rec-ed" role="group" aria-label={payment ? "결제 고치기" : "결제 추가"}>
      <div className="rec-ed-h">{payment ? "결제 고치기" : "빠진 결제 기록하기"}</div>
      <PriceInp>
        <span className="pl">금액</span>
        <input className="num" inputMode="numeric" aria-label="결제 금액" value={amt ? won(amt) : ""} placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))} />
      </PriceInp>
      <ChipGroup role="group" aria-label="결제 수단">
        {METHODS.map((m) => (
          <Chip key={m} active={method === m} onClick={() => setMethod(m)}>{PAYMENT_METHOD_LABEL[m]}</Chip>
        ))}
      </ChipGroup>
      <label className="rec-fld">
        <span>결제일</span>
        <input type="date" min="2020-01-01" max="2099-12-31" value={bizDate} onChange={(e) => e.target.value && setBizDate(e.target.value)} aria-label="결제일" />
      </label>
      <div className="rec-fld col">
        <span>어느 객실</span>
        <div className="gjn-rooms" role="group" aria-label="결제 대상">
          {groupId ? (
            <button type="button" className={`chip sm${target === GROUP ? " on" : ""}`} aria-pressed={target === GROUP} onClick={() => pick(GROUP)}>단체 몫 (앞 박부터)</button>
          ) : null}
          {members.map((m) => (
            <button key={m.id} type="button" className={`chip sm${target === m.id ? " on" : ""}`} aria-pressed={target === m.id} onClick={() => pick(m.id)}>
              {roomName(m.id)}
            </button>
          ))}
        </div>
      </div>
      {tb ? (
        <div className="rec-fld col">
          <label className="gjn-arr">
            <input type="checkbox" checked={periodOn} onChange={(e) => {
              setPeriodOn(e.target.checked);
              if (e.target.checked && !payment?.nightDate) {
                setFrom(tb.checkIn);
                setNights(tb.nights ?? 1);
              }
            }} /> 대상 기간 지정 ({md(tb.checkIn)}~{md(stayEnd(tb))} 중)
          </label>
          {periodOn ? (
            <div className="rec-per">
              <input type="date" value={from} min={tb.checkIn} max={addDays(stayEnd(tb), -1)} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="대상 첫 박" />
              <Stepper value={nights} unit="박" min={1} max={STAY_NIGHTS_MAX} onChange={(n) => setNights(Math.max(1, Math.min(STAY_NIGHTS_MAX, n)))} />
            </div>
          ) : (
            <small className="muted">기간을 안 정하면 앞 박부터 채워요</small>
          )}
        </div>
      ) : null}
      <label className="rec-fld col">
        <span>메모</span>
        <input className="inp" maxLength={80} value={note} placeholder="예: 502호 추가분" onChange={(e) => setNote(e.target.value)} aria-label="메모" />
      </label>
      <details className="rec-more">
        <summary>더 보기 · 구분 {preview}</summary>
        <ChipGroup role="group" aria-label="선금 잔금">
          <Chip active={kind === "deposit"} onClick={() => setKind("deposit")}>선금</Chip>
          <Chip active={kind === "balance"} onClick={() => setKind("balance")}>잔금</Chip>
        </ChipGroup>
        <small className="muted">구분: {preview} (결제일과 대상 기간을 견줘 자동으로 정해져요)</small>
      </details>
      {localErr ? <div className="ferr">{localErr}</div> : null}
      <div className="rec-acts">
        {onDelete ? <button type="button" className="btn line danger" disabled={busy} onClick={onDelete}>삭제</button> : null}
        <button type="button" className="btn line" disabled={busy} onClick={onCancel}>취소</button>
        <button type="button" className="btn dark" disabled={busy} onClick={() => void submit()}>{busy ? "저장 중…" : payment ? "저장" : "기록 추가"}</button>
      </div>
    </div>
  );
}

/* ---------- 객실 입실·퇴실·박별 요금 편집 ---------- */
function StayEditor({
  booking: b,
  roomName,
  onCancel,
  onSave,
}: {
  booking: Booking;
  roomName: string;
  onCancel: () => void;
  onSave: (patch: Partial<Pick<Booking, "checkIn" | "nights" | "price" | "nightRates">>, summary: string, kind: "stay" | "rate") => Promise<void>;
}) {
  const bn = b.nights ?? 1;
  const moved = !!b.segments?.length;
  const [checkIn, setCheckIn] = useState(b.checkIn);
  const [out, setOut] = useState(addDays(b.checkIn, bn));
  const nights = Math.max(1, Math.min(STAY_NIGHTS_MAX, daysBetween(checkIn, out)));
  const [rates, setRates] = useState<StayNightRates | null>(() => (hasFullNightMatrix(b.checkIn, bn, b.nightRates) ? b.nightRates! : nightRatesFromTotal(b.checkIn, bn, b.price)));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const fallback = Math.round(b.price / bn);
  const synced = syncStayNightRates(checkIn, nights, rates, { typeRate: fallback });
  const total = tableTotal(tableRows(checkIn, nights, synced, fallback));
  const datesChanged = checkIn !== b.checkIn || nights !== bn;
  const priceChanged = total !== b.price;
  const submit = async () => {
    setBusy(true);
    try {
      const patch: Partial<Pick<Booking, "checkIn" | "nights" | "price" | "nightRates">> = { price: total, nightRates: synced };
      if (datesChanged) {
        patch.checkIn = checkIn;
        patch.nights = nights;
      }
      await onSave(patch, fixStaySummary(roomName, { checkIn: b.checkIn, nights: bn, price: b.price }, { checkIn, nights, price: total }), datesChanged ? "stay" : "rate");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rec-ed" role="group" aria-label="객실 기간·요금 고치기">
      <div className="rec-ed-h">{roomName} · 입실·퇴실·요금 고치기</div>
      {moved ? <small className="muted">객실 이동이 있는 예약이라 날짜는 여기서 못 바꿔요 · 요금만 고칠 수 있어요</small> : null}
      <div className="rec-per">
        <label className="rec-fld">
          <span>입실일</span>
          <input type="date" disabled={moved || b.openEnded} min="2020-01-01" max="2099-12-31" value={checkIn} aria-label="입실일" onChange={(e) => {
            if (!e.target.value) return;
            const n = nights;
            setCheckIn(e.target.value);
            setOut(addDays(e.target.value, n));
            setDirty(true);
          }} />
        </label>
        <label className="rec-fld">
          <span>퇴실일</span>
          <input type="date" disabled={moved || b.openEnded} min={addDays(checkIn, 1)} max={addDays(checkIn, STAY_NIGHTS_MAX)} value={out} aria-label="퇴실일" onChange={(e) => { if (e.target.value) { setOut(e.target.value); setDirty(true); } }} />
        </label>
      </div>
      <small className="muted">{b.openEnded ? "∞ 미정 · 날짜는 퇴실일을 정할 때 고쳐요" : `${nights}박`}</small>
      <NightRatesTable checkIn={checkIn} nights={nights} rates={synced} fallback={fallback} defaultOpen onChange={(r) => { setRates(r); setDirty(true); }} />
      <div className="rec-acts">
        <button type="button" className="btn line" disabled={busy} onClick={onCancel}>취소</button>
        <button type="button" className="btn dark" disabled={busy || (!dirty && !datesChanged && !priceChanged)} onClick={() => void submit()}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

export { FIX_PREFIX };

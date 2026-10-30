import ModalTabs, { ModalTabPanel } from "./ModalTabs";
import { useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { saveFailMessage } from "../shared/errors";
import { type Booking, type HotelSettings, addDays, daysBetween, dayLabel, md, STAY_NIGHTS_MAX, won } from "../shared/ledger";
import { stayAddons } from "../shared/extend";
import { changesFor } from "../shared/changes";
import { balanceLabel, diffLine, groupLedger } from "../shared/groupLedger";
import { PAYMENT_METHOD_LABEL, PAY_MAX, type Payment, type PaymentEdit, type PaymentMethod } from "../shared/payment";
import { extrasTotal, hasFullNightMatrix, occupiedNightDates, priceFromNightMatrix, type StayNightRates } from "../shared/nightrates";
import { enteredNightMap, nightEditPlan, nightShiftAmbiguous, shiftEnteredNights } from "../shared/nightTable";
import { resolveNightRate } from "../shared/salesCalendar";
import { type NightShiftMode, shiftDays } from "../shared/nightShift";
import { type ExtraDraft, draftsFromExtras, resolveExtras } from "../shared/groupRates";
import {
  type TimelineRow,
  fixPaymentAddSummary,
  fixPaymentDeleteSummary,
  fixPaymentRestoreSummary,
  fixPaymentSummary,
  fixStaySummary,
  FIX_PREFIX,
  payLines,
  paymentCopyText,
  periodText,
  recordAdvisories,
  recordTimeline,
} from "../shared/recordTimeline";
import type { HotelData } from "./data";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import NightRatesEntry from "./NightRatesEntry";
import RoomExtrasEditor from "./RoomExtrasEditor";

const METHODS: PaymentMethod[] = ["card", "cash", "transfer", "credit"];

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
  focusKey,
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
  /** 열자마자 펼칠 줄 (예: `in-예약id` = 그 객실의 입실·퇴실·박별 요금) */
  focusKey?: string | null;
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

  const [tab, setTab] = useState(focusKey?.startsWith("in-") ? "stay" : "payments"), scopeId = useId();
  const [open, setOpen] = useState<string | null>(focusKey ?? null); // timeline key | "new"
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

  const renderRow = (r: TimelineRow) => {
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
                      settings={data.hotel?.settings ?? null}
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
            };
  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal assign-type-modal gpp-modal rec-modal" role="dialog" aria-label="기록 정정" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>{readOnly ? "결제 · 기록" : "기록 정정"}</h2>
          <span className="muted sm gpp-gname">{name}</span>
          <button type="button" className="x" aria-label="닫기" onClick={onClose}>닫기</button>
        </div>
        <ModalTabs scope={scopeId} label="기록 정정 업무" value={tab} onChange={setTab} tabs={[{id:"payments",label:"결제 내역·정정"},{id:"stay",label:"객실 일정·요금"},{id:"history",label:"변경 이력"}]} />
        <div className="mb modal-task-body">
          <div className="rec-sum">
            <b>{ledger.roomCount ? balanceLabel(ledger) : `결제 ${won(lines.reduce((n, l) => n + l.amount, 0))}원`}</b>
            <span className="muted sm">
              {ledger.roomCount ? diffLine(ledger) : `${lines.length}건`}
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

          {advisories.length ? (
            <ul className="rec-adv" aria-label="참고">
              {advisories.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}

          {(["payments", "stay", "history"] as const).map(id => {
            const filtered = rows.filter(r => id === "payments" ? r.kind === "pay" : id === "stay" ? ["checkin","join","checkout"].includes(r.kind) : ["move","fix"].includes(r.kind));
            return <ModalTabPanel key={id} scope={scopeId} id={id} active={tab}>
              <p className="rec-task-help">{id === "payments" ? "수납 금액·수단·날짜를 확인하거나 해당 결제 줄에서 정정합니다." : id === "stay" ? "객실별 입퇴실 일정과 박별 약정 요금을 선택해 수정합니다." : "객실 이동과 기록 정정 이력입니다. 결제·요금 수정은 각 탭에서 시작하세요."}</p>
              {id === "payments" ? <>
          {readOnly ? null : open === "new" ? (
            <PayEditor key="new" payment={null} members={live} groupId={groupId} today={today} roomName={bookingName} onCancel={() => setOpen(null)} onSave={(e) => doSave(null, e)} />
          ) : (
            <button type="button" className="btn dark rec-add" onClick={() => setOpen("new")}>
              <Plus size={16} aria-hidden /> 빠진 결제 기록하기
            </button>
          )}

              </> : null}
          <ol className="rec-tl" aria-label="기록 순서">
            {filtered.map(renderRow)}
            {!filtered.length ? <li className="muted sm rec-empty">아직 기록이 없어요</li> : null}
          </ol>
            </ModalTabPanel>;
          })}
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
  // 새 결제 = 단체(혼자 예약이면 그 예약)로 받은 한 줄. 객실·박에 나누지 않아요.
  // 예전에 객실·기간을 적어 둔 줄은 그대로 두고, 원하면 「단체 결제로 바꾸기」로 표시만 떼요.
  const [asGroup, setAsGroup] = useState<boolean>(payment ? !payment.bookingId : !!groupId);
  const [note, setNote] = useState(payment?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const amt = Math.round(Number(amount.replace(/\D/g, "")) || 0);
  const roomTag = payment?.bookingId ? members.find((m) => m.id === payment.bookingId) ?? null : null;
  const submit = async () => {
    if (!amt || amt > PAY_MAX) return setLocalErr("금액을 입력해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) return setLocalErr("결제일을 골라 주세요.");
    const toGroup = asGroup && !!groupId;
    const bookingId = toGroup ? null : payment?.bookingId || first?.id || null;
    if (!bookingId && !toGroup) return setLocalErr("저장할 곳을 찾지 못했어요.");
    const keepPeriod = !toGroup && !!payment?.bookingId && payment.bookingId === bookingId;
    setBusy(true);
    setLocalErr(null);
    try {
      await onSave({
        bookingId,
        groupId: toGroup ? groupId : null,
        kind: payment?.kind ?? "balance",
        method,
        amount: amt,
        bizDate,
        note: note.trim() || null,
        nightDate: keepPeriod ? payment?.nightDate ?? null : null,
        periodNights: keepPeriod ? payment?.periodNights ?? null : null,
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
      <label className="rec-fld col">
        <span>메모 (선택)</span>
        <input className="inp" maxLength={80} value={note} placeholder="예: 10/25~10/27 3박" onChange={(e) => setNote(e.target.value)} aria-label="메모" />
      </label>
      {roomTag && groupId ? (
        <div className="rec-fld col">
          <small className="muted">
            이 줄은 {roomName(roomTag.id)}{payment?.nightDate ? ` · ${periodText(payment)}` : ""}에 적어 둔 결제예요. 합계에는 그대로 들어가요.
          </small>
          <label className="gjn-arr">
            <input type="checkbox" checked={asGroup} onChange={(e) => setAsGroup(e.target.checked)} /> 단체 결제로 바꾸기 (객실·기간 표시 없애기)
          </label>
        </div>
      ) : null}
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
  settings,
  onCancel,
  onSave,
}: {
  booking: Booking;
  roomName: string;
  settings?: HotelSettings | null;
  onCancel: () => void;
  onSave: (patch: Partial<Pick<Booking, "checkIn" | "nights" | "price" | "nightRates">>, summary: string, kind: "stay" | "rate") => Promise<void>;
}) {
  const bn = b.nights ?? 1;
  const moved = !!b.segments?.length;
  const [checkIn, setCheckIn] = useState(b.checkIn);
  const [out, setOut] = useState(addDays(b.checkIn, bn));
  const nights = Math.max(1, Math.min(STAY_NIGHTS_MAX, daysBetween(checkIn, out)));
  // 적어 둔 박만 (요금표가 없으면 비어 있어요 — 총액을 나눠 채우지 않아요)
  const [vals, setVals] = useState<Record<string, number>>(() => enteredNightMap(b.checkIn, bn, b.nightRates?.nights));
  const [extras, setExtras] = useState<ExtraDraft[]>(() => draftsFromExtras(b.nightRates?.extras));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // 입실일을 바꿔서 적어 둔 박이 갈리는 경우 — 어떻게 할지 물어봐요 (고르기 전엔 저장 못 해요)
  const [pend, setPend] = useState<{ ci: string; n: number; vals: Record<string, number>; choice: NightShiftMode | null } | null>(null);
  const addons0 = stayAddons(b);
  const oldExtras = extrasTotal(b.nightRates);
  // 원래 박별 합 = 예약 금액이었던 예약은 박을 고치면 금액도 따라가요 (기본 ON) · 그 밖은 판매가 유지 (기본 OFF)
  const consistent0 = hasFullNightMatrix(b.checkIn, bn, b.nightRates) && priceFromNightMatrix(b.nightRates, addons0) === b.price;
  const [useSum, setUseSum] = useState(consistent0);
  const suggestions = useMemo(() => {
    const out2: Record<string, number> = {};
    if (!settings) return out2;
    for (const d of occupiedNightDates(checkIn, nights)) {
      const r = resolveNightRate(settings, b.typeId, d);
      if (r.amount > 0) out2[d] = r.amount;
    }
    return out2;
  }, [settings, b.typeId, checkIn, nights]);
  const resolvedExtras = resolveExtras(extras, nights);
  const xTotal = extrasTotal({ extras: resolvedExtras });
  const entered = enteredNightMap(checkIn, nights, vals);
  const plan = nightEditPlan({ entered, nightCount: nights, oldPrice: b.price, oldExtras, newExtras: xTotal, addons: addons0, useSum });
  const datesChanged = checkIn !== b.checkIn || nights !== bn;
  const priceChanged = plan.price !== b.price;
  const submit = async () => {
    setBusy(true);
    try {
      const first = Object.values(entered)[0];
      const nr: StayNightRates | null =
        Object.keys(entered).length || resolvedExtras.length
          ? { flat: first ?? null, weekday: null, weekend: null, nights: Object.keys(entered).length ? entered : null, ...(resolvedExtras.length ? { extras: resolvedExtras } : {}) }
          : null;
      const patch: Partial<Pick<Booking, "checkIn" | "nights" | "price" | "nightRates">> = { price: plan.price, nightRates: nr };
      if (datesChanged) {
        patch.checkIn = checkIn;
        patch.nights = nights;
      }
      const roomOnly0 = b.price - oldExtras - addons0;
      const roomNew = plan.price - xTotal - addons0;
      await onSave(patch, fixStaySummary(roomName, { checkIn: b.checkIn, nights: bn, price: roomOnly0, extras: oldExtras }, { checkIn, nights, price: roomNew, extras: xTotal }), datesChanged ? "stay" : "rate");
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
            const next = e.target.value;
            const snap = pend ?? { ci: checkIn, n, vals: entered, choice: null };
            setCheckIn(next);
            setOut(addDays(next, n));
            setDirty(true);
            if (next === snap.ci) {
              setVals(snap.vals);
              setPend(null);
              return;
            }
            setVals(shiftEnteredNights(snap.vals, snap.ci, snap.n, next, n, "move"));
            setPend(nightShiftAmbiguous(snap.vals, snap.ci, snap.n, next, n) ? { ci: snap.ci, n: snap.n, vals: snap.vals, choice: null } : null);
          }} />
        </label>
        <label className="rec-fld">
          <span>퇴실일</span>
          <input type="date" disabled={moved || b.openEnded} min={addDays(checkIn, 1)} max={addDays(checkIn, STAY_NIGHTS_MAX)} value={out} aria-label="퇴실일" onChange={(e) => { if (e.target.value) { setOut(e.target.value); setDirty(true); } }} />
        </label>
      </div>
      <small className="muted">{b.openEnded ? "∞ 미정 · 날짜는 퇴실일을 정할 때 고쳐요" : `${nights}박`}</small>
      {pend ? (
        <div className="rec-shift" role="group" aria-label="입실일이 바뀌었어요">
          <b>입실일이 {shiftDays(pend.ci, checkIn)}일 {shiftDays(pend.ci, checkIn) > 0 ? "뒤로" : "앞으로"} 바뀌었어요</b>
          <span className="muted sm">적어 둔 박별 요금을 어떻게 할까요? (고르지 않으면 저장할 수 없어요)</span>
          <div className="rec-shift-opts">
            {([
              ["move", "요금을 박 따라 옮기기", "1박째 요금은 새 1박째로, 2박째는 새 2박째로"],
              ["keep", "날짜에 그대로 두기", "같은 날짜는 그 요금 그대로, 새 날짜는 비워 둬요"],
            ] as [NightShiftMode, string, string][]).map(([mode, title, hint]) => (
              <button
                key={mode}
                type="button"
                className={`rec-shift-opt${pend.choice === mode ? " on" : ""}`}
                aria-pressed={pend.choice === mode}
                onClick={() => {
                  setVals(shiftEnteredNights(pend.vals, pend.ci, pend.n, checkIn, nights, mode));
                  setPend({ ...pend, choice: mode });
                }}
              >
                <b>{title}</b>
                <small>{hint}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <NightRatesEntry checkIn={checkIn} nights={nights} values={vals} suggestions={suggestions} onChange={(m) => { setVals(m); setDirty(true); setPend(null); }} />
      <div className="rec-fld col">
        <span>추가 항목 (인원 추가 · 추가 이불 · 계약 조건 …)</span>
        <RoomExtrasEditor label={roomName} extras={extras} onChange={(x) => { setExtras(x); setDirty(true); }} />
      </div>
      <small className="muted" role="status">
        {plan.count ? `적은 박 ${plan.count}/${nights} · 박별 합계 ${won(plan.sum)}원` : "박별 요금을 아직 안 적었어요"}
        {xTotal ? ` + 추가 항목 ${won(xTotal)}원` : ""} · 예약 금액 {won(plan.keepPrice)}원
        {plan.diff != null && plan.diff !== 0 ? ` · 차액 ${plan.diff > 0 ? "+" : "−"}${won(Math.abs(plan.diff))}원 (박별 합계 − 예약 금액)` : ""}
      </small>
      {plan.diff != null && plan.diff !== 0 ? (
        <label className="rec-usesum">
          <input type="checkbox" checked={useSum} onChange={(e) => { setUseSum(e.target.checked); setDirty(true); }} />
          <span>예약 금액도 박별 합계로 바꾸기 <small className="muted">({won(plan.keepPrice)}원 → {won(plan.sumTotal)}원 · 끄면 예약 금액은 그대로)</small></span>
        </label>
      ) : null}
      <div className="rec-acts">
        <button type="button" className="btn line" disabled={busy} onClick={onCancel}>취소</button>
        <button type="button" className="btn dark" disabled={busy || (!!pend && !pend.choice) || (!dirty && !datesChanged && !priceChanged)} onClick={() => void submit()}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

export { FIX_PREFIX };

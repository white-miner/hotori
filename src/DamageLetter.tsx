/**
 * 손해내역서 미리보기·발급·인쇄 (P1.2b) — stay-bound · ≠ 청구서
 */
import { useMemo, useState } from "react";
import { FileDown, Plus, Printer, Trash2, X } from "lucide-react";
import {
  type DamageDoc,
  type DamageDraft,
  type DamageLine,
  DAMAGE_COPY,
  damageTotal,
  draftFromBooking,
  emptyDamageLine,
  validateDamageDraft,
} from "../shared/damageDoc";
import {
  type Booking,
  dayLabel,
  hotelBizDisplayName,
  hotelBizHasAny,
  roomLabel,
  typeLabel,
  won,
  type HotelSettings,
} from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  /** Stay-bound create */
  booking?: Booking | null;
  /** Hub reprint */
  issuedDoc?: DamageDoc | null;
  busy?: boolean;
  onIssue: (draft: DamageDraft) => Promise<DamageDoc>;
  onDelete?: (doc: DamageDoc) => Promise<void>;
  onClose: () => void;
  notify: (m: string) => void;
}

function runPrint(title: string) {
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add("print-damage");
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-damage");
    document.title = prevTitle;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  window.setTimeout(done, 1500);
}

function draftFromDoc(doc: DamageDoc): DamageDraft {
  const snap = doc.snapshot;
  return {
    guestName: snap?.guestName ?? doc.guestName,
    guestPhone: snap?.guestPhone ?? doc.guestPhone,
    roomNo: snap?.roomNo ?? doc.roomNo,
    typeLabel: snap?.typeLabel ?? doc.typeLabel,
    notes: snap?.notes ?? doc.notes,
    lines: snap?.lines?.length ? snap.lines : doc.lines.length ? doc.lines : [emptyDamageLine()],
    bookingId: snap?.bookingId ?? doc.bookingId,
  };
}

export default function DamageLetter({
  hotelName,
  s,
  today,
  booking,
  issuedDoc,
  busy,
  onIssue,
  onDelete,
  onClose,
  notify,
}: Props) {
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);

  const initial = useMemo((): DamageDraft => {
    if (issuedDoc) return draftFromDoc(issuedDoc);
    if (booking) {
      const room = roomLabel(s, booking.roomId);
      const type = typeLabel(s.types.find((t) => t.id === booking.typeId));
      return draftFromBooking({
        guestName: booking.guestName || "",
        guestPhone: booking.guestPhone || "",
        roomNo: room || "미배정",
        typeLabel: type || "",
        bookingId: booking.id,
      });
    }
    return {
      guestName: "",
      guestPhone: "",
      roomNo: "",
      typeLabel: "",
      notes: "",
      lines: [emptyDamageLine()],
      bookingId: null,
    };
  }, [issuedDoc, booking, s]);

  const [draft, setDraft] = useState<DamageDraft>(initial);
  const [doc, setDoc] = useState<DamageDoc | null>(issuedDoc ?? null);
  const [err, setErr] = useState<string | null>(null);
  const locked = doc?.status === "issued" && !!doc.snapshot;

  const view = locked && doc?.snapshot
    ? {
        guestName: doc.snapshot.guestName,
        guestPhone: doc.snapshot.guestPhone,
        roomNo: doc.snapshot.roomNo,
        typeLabel: doc.snapshot.typeLabel,
        notes: doc.snapshot.notes,
        lines: doc.snapshot.lines,
        total: doc.snapshot.total,
      }
    : {
        guestName: draft.guestName,
        guestPhone: draft.guestPhone,
        roomNo: draft.roomNo,
        typeLabel: draft.typeLabel,
        notes: draft.notes,
        lines: draft.lines,
        total: damageTotal(draft.lines),
      };

  const fileTitle = `${trade}_${DAMAGE_COPY.title}_${view.guestName || view.roomNo || "손해"}`;

  const setLine = (id: string, patch: Partial<DamageLine>) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  };

  const issue = async () => {
    const v = validateDamageDraft(draft);
    if (v) return setErr(v);
    const ok = await askConfirm({
      title: DAMAGE_COPY.confirmIssueTitle,
      body: DAMAGE_COPY.confirmIssueBody,
      confirmLabel: DAMAGE_COPY.issue,
      cancelLabel: DAMAGE_COPY.close,
    });
    if (!ok) return;
    setErr(null);
    try {
      const saved = await onIssue(draft);
      setDoc(saved);
      notify(DAMAGE_COPY.issueOk);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "발급 실패");
    }
  };

  const remove = async () => {
    if (!doc || !onDelete) return;
    const ok = await askConfirm({
      title: DAMAGE_COPY.confirmDeleteTitle,
      body: DAMAGE_COPY.confirmDeleteBody,
      confirmLabel: DAMAGE_COPY.delete,
      cancelLabel: DAMAGE_COPY.close,
      danger: true,
    });
    if (!ok) return;
    try {
      await onDelete(doc);
      notify("삭제했어요.");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  return (
    <div className="dim damage-dim" role="presentation" onClick={onClose}>
      <div
        className="modal damage-letter"
        role="dialog"
        aria-labelledby="damage-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh noprint">
          <h2 id="damage-title">{DAMAGE_COPY.title}</h2>
          {locked ? <span className="tag">{DAMAGE_COPY.issued}</span> : null}
          <button type="button" className="x" onClick={onClose} aria-label={DAMAGE_COPY.close}>
            <X size={18} />
          </button>
        </div>

        {!locked ? (
          <div className="damage-form noprint">
            <div className="iss-form">
              <label>
                {DAMAGE_COPY.guest}
                <input
                  className="inp"
                  value={draft.guestName}
                  onChange={(e) => setDraft((d) => ({ ...d, guestName: e.target.value }))}
                />
              </label>
              <label>
                {DAMAGE_COPY.phone}
                <input
                  className="inp"
                  value={draft.guestPhone}
                  onChange={(e) => setDraft((d) => ({ ...d, guestPhone: e.target.value }))}
                />
              </label>
              <label>
                {DAMAGE_COPY.room}
                <input
                  className="inp"
                  value={draft.roomNo}
                  onChange={(e) => setDraft((d) => ({ ...d, roomNo: e.target.value }))}
                />
              </label>
              <label>
                타입
                <input
                  className="inp"
                  value={draft.typeLabel}
                  onChange={(e) => setDraft((d) => ({ ...d, typeLabel: e.target.value }))}
                />
              </label>
              <label className="wide">
                {DAMAGE_COPY.notes}
                <input
                  className="inp"
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </label>
            </div>

            <div className="quote-lines">
              <div className="quote-lines-h">
                <strong>{DAMAGE_COPY.lines}</strong>
                <button
                  type="button"
                  className="btn line sm"
                  onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyDamageLine()] }))}
                >
                  <Plus size={14} /> {DAMAGE_COPY.addLine}
                </button>
              </div>
              {draft.lines.map((l) => (
                <div className="damage-line" key={l.id}>
                  <input
                    className="inp"
                    placeholder={DAMAGE_COPY.item}
                    value={l.item}
                    onChange={(e) => setLine(l.id, { item: e.target.value })}
                  />
                  <input
                    className="inp"
                    placeholder={DAMAGE_COPY.description}
                    value={l.description}
                    onChange={(e) => setLine(l.id, { description: e.target.value })}
                  />
                  <input
                    className="inp price"
                    inputMode="numeric"
                    aria-label={DAMAGE_COPY.amount}
                    value={l.amount || ""}
                    onChange={(e) => setLine(l.id, { amount: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  />
                  <button
                    type="button"
                    className="btn line sm"
                    aria-label={DAMAGE_COPY.delete}
                    disabled={draft.lines.length <= 1}
                    onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="quote-line-hint muted sm">
                {DAMAGE_COPY.item} · {DAMAGE_COPY.description} · {DAMAGE_COPY.amount}
              </div>
            </div>
            <p className="muted sm">{DAMAGE_COPY.notInvoice}</p>
          </div>
        ) : null}

        <div className="damage-print">
          <header className="sc-head">
            <div className="sc-hotel">
              <div className="sc-trade">{trade}</div>
              {biz.businessNumber ? <div>사업자번호 {biz.businessNumber}</div> : null}
              {biz.address ? <div>{biz.address}</div> : null}
              {biz.phone || biz.representative ? (
                <div>
                  {biz.phone ? `전화 ${biz.phone}` : null}
                  {biz.phone && biz.representative ? " · " : null}
                  {biz.representative ? `대표 ${biz.representative}` : null}
                </div>
              ) : null}
            </div>
            <h1 className="sc-title">{DAMAGE_COPY.title}</h1>
          </header>

          <dl className="sc-body">
            <div>
              <dt>{DAMAGE_COPY.guest}</dt>
              <dd>
                {view.guestName || "—"}
                {view.guestPhone ? ` · ${view.guestPhone}` : null}
              </dd>
            </div>
            <div>
              <dt>{DAMAGE_COPY.room}</dt>
              <dd>
                {view.roomNo ? `${view.roomNo}호` : "—"}
                {view.typeLabel ? ` · ${view.typeLabel}` : null}
              </dd>
            </div>
          </dl>

          <table className="quote-tbl dmg-tbl">
            <thead>
              <tr>
                <th>{DAMAGE_COPY.item}</th>
                <th>{DAMAGE_COPY.description}</th>
                <th>{DAMAGE_COPY.amount}</th>
              </tr>
            </thead>
            <tbody>
              {view.lines
                .filter((l) => l.item.trim() || l.description.trim() || l.amount > 0)
                .map((l) => (
                  <tr key={l.id}>
                    <td>{l.item || "—"}</td>
                    <td>{l.description || "—"}</td>
                    <td>{won(l.amount)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>{DAMAGE_COPY.total}</th>
                <th>{won(view.total)}</th>
              </tr>
            </tfoot>
          </table>

          {view.notes ? <p className="quote-notes">{DAMAGE_COPY.notes}: {view.notes}</p> : null}

          <p className="sc-attest">{DAMAGE_COPY.attest}</p>
          <div className="sc-issue">
            {DAMAGE_COPY.issueDate} {dayLabel(today)}
          </div>
          <div className="sc-sign">
            <div className="sc-sign-trade">{trade}</div>
            <div className="sc-sign-rep">
              대표자 {biz.representative || "____________"}
              <span className="sc-seal">(인)</span>
            </div>
          </div>
        </div>

        <div className="mf noprint">
          {err ? <p className="warn sm">{err}</p> : null}
          <p className="fine">
            {locked
              ? DAMAGE_COPY.tip
              : hotelBizHasAny(biz)
                ? DAMAGE_COPY.tipLive
                : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}
          </p>
          <div className="keys acts">
            {!locked ? (
              <button type="button" className="btn sm" disabled={busy} onClick={() => void issue()}>
                {DAMAGE_COPY.issue}
              </button>
            ) : null}
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)}>
              <Printer size={14} /> {DAMAGE_COPY.print}
            </button>
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)} title={DAMAGE_COPY.pdfHint}>
              <FileDown size={14} /> {DAMAGE_COPY.pdf}
            </button>
            {locked && onDelete ? (
              <button type="button" className="btn line sm danger" onClick={() => void remove()}>
                <Trash2 size={14} /> {DAMAGE_COPY.delete}
              </button>
            ) : null}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {DAMAGE_COPY.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 견적서 작성·발급·인쇄 (P1.1)
 * 발급 시 Path A 미배정(타입홀드) 예약 생성 · 인쇄 기본=타입만 · 「객실번호 표시」옵트인
 */
import { useMemo, useState } from "react";
import { FileDown, Plus, Printer, Trash2, X } from "lucide-react";
import {
  type QuoteDoc,
  type QuoteDraft,
  type QuoteLine,
  QUOTE_COPY,
  emptyQuoteLine,
  freezeQuoteSnapshot,
  lineAmount,
  quoteLinePrintLabel,
  quotePrintStrings,
  quoteTotal,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import { quoteLineTypeOptions, validateQuoteForBookings } from "../shared/quoteBookings";
import {
  allRooms,
  dayLabel,
  hotelBizDisplayName,
  hotelBizHasAny,
  printDateLabel,
  typeLabel,
  won,
  type HotelSettings,
  type PrintLang,
} from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  initial?: QuoteDoc | null;
  busy?: boolean;
  onSaveDraft: (draft: QuoteDraft, id?: string) => Promise<QuoteDoc>;
  onIssue: (draft: QuoteDraft, id?: string) => Promise<QuoteDoc>;
  onDelete?: (doc: QuoteDoc) => Promise<void>;
  onClose: () => void;
  notify: (m: string) => void;
}

function runPrint(title: string) {
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add("print-quote");
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-quote");
    document.title = prevTitle;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  window.setTimeout(done, 1500);
}

function draftFromDoc(doc: QuoteDoc | null | undefined, today: string, defaultTypeId: string): QuoteDraft {
  if (!doc) {
    return {
      title: "",
      clientName: "",
      clientPhone: "",
      notes: "",
      checkIn: today,
      nights: 1,
      guestCount: 2,
      lines: [emptyQuoteLine(defaultTypeId)],
      showRoomNos: false,
    };
  }
  return {
    title: doc.title,
    clientName: doc.clientName,
    clientPhone: doc.clientPhone,
    notes: doc.notes,
    checkIn: doc.checkIn,
    nights: doc.nights,
    guestCount: doc.guestCount,
    lines: doc.lines.length ? doc.lines.map((l) => ({ ...l, roomIds: l.roomIds?.slice() ?? [] })) : [emptyQuoteLine(defaultTypeId)],
    showRoomNos: doc.showRoomNos,
  };
}

/** Parse "301, 302" → room ids for type (best-effort) */
function parseRoomNos(text: string, typeId: string, s: HotelSettings): string[] {
  const rooms = allRooms(s).filter((r) => r.typeId === typeId);
  const byNo = new Map(rooms.map((r) => [r.no.replace(/\s/g, ""), r.id]));
  const out: string[] = [];
  for (const part of text.split(/[,，\s]+/)) {
    const key = part.trim().replace(/호$/, "");
    if (!key) continue;
    const id = byNo.get(key);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function roomNosText(ids: string[] | undefined, s: HotelSettings): string {
  if (!ids?.length) return "";
  const map = new Map(allRooms(s).map((r) => [r.id, r.no]));
  return ids.map((id) => map.get(id)).filter(Boolean).join(", ");
}

export default function QuoteLetter({
  hotelName,
  s,
  today,
  initial,
  busy,
  onSaveDraft,
  onIssue,
  onDelete,
  onClose,
  notify,
}: Props) {
  const types = quoteLineTypeOptions(s);
  const defaultTypeId = types[0]?.id ?? "";
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const issued = initial?.status === "issued";
  const [doc, setDoc] = useState<QuoteDoc | null>(initial ?? null);
  const [draft, setDraft] = useState<QuoteDraft>(() => draftFromDoc(initial, today, defaultTypeId));
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<PrintLang>("ko");
  const t = quotePrintStrings(lang);
  const locked = issued || doc?.status === "issued";
  const showRoomNos = locked ? !!(doc?.snapshot?.showRoomNos ?? doc?.showRoomNos) : draft.showRoomNos;

  const body = useMemo(() => {
    if (doc?.status === "issued" && doc.snapshot) return doc.snapshot;
    return freezeQuoteSnapshot(draft, new Date().toISOString());
  }, [doc, draft]);
  const total = locked && doc?.snapshot ? doc.snapshot.total : quoteTotal(draft.lines);
  const fileTitle = `${trade}_${t.title}_${body.clientName || body.title || (lang === "en" ? "Quote" : "견적")}`;
  const roomNoOf = (id: string) => allRooms(s).find((r) => r.id === id)?.no;

  const setLine = (id: string, patch: Partial<QuoteLine>) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.typeId != null) {
          const t = s.types.find((x) => x.id === patch.typeId);
          if (t && !patch.label) next.label = typeLabel(t);
        }
        if (patch.rooms != null || patch.nights != null || patch.rate != null) {
          if (patch.amount == null) next.amount = lineAmount(next.rooms, next.nights, next.rate);
        }
        return next;
      }),
    }));
  };

  const save = async () => {
    const v = validateQuoteDraft(draft);
    if (v) return setErr(v);
    setErr(null);
    try {
      const saved = await onSaveDraft(draft, doc?.id);
      setDoc(saved);
      notify(QUOTE_COPY.saveOk);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    }
  };

  const issue = async () => {
    const v = validateQuoteDraft(draft) ?? validateQuoteForBookings(draft, s);
    if (v) return setErr(v);
    const ok = await askConfirm({
      title: QUOTE_COPY.confirmIssueTitle,
      body: QUOTE_COPY.confirmIssueBody,
      confirmLabel: QUOTE_COPY.issue,
      cancelLabel: QUOTE_COPY.close,
    });
    if (!ok) return;
    setErr(null);
    try {
      const saved = await onIssue(draft, doc?.id);
      setDoc(saved);
      notify(QUOTE_COPY.issueOk);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "발급 실패");
    }
  };

  const remove = async () => {
    if (!doc || !onDelete) return;
    const ok = await askConfirm({
      title: QUOTE_COPY.confirmDeleteTitle,
      body: QUOTE_COPY.confirmDeleteBody,
      confirmLabel: QUOTE_COPY.delete,
      cancelLabel: QUOTE_COPY.close,
      danger: true,
    });
    if (!ok) return;
    await onDelete(doc);
    notify(QUOTE_COPY.deleteOk);
    onClose();
  };

  return (
    <div className="dim quote-dim" role="presentation" onClick={onClose}>
      <div className="modal quote-letter" role="dialog" aria-labelledby="quote-title" onClick={(e) => e.stopPropagation()}>
        <div className="mh noprint">
          <h2 id="quote-title">{t.title}</h2>
          {doc?.status === "issued" ? <span className="tag">{QUOTE_COPY.issued}</span> : null}
          <div className="seg sm sc-lang" role="tablist" aria-label={t.langAria}>
            <button
              type="button"
              role="tab"
              aria-selected={lang === "ko"}
              className={lang === "ko" ? "on" : ""}
              onClick={() => setLang("ko")}
            >
              {t.langKo}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lang === "en"}
              className={lang === "en" ? "on" : ""}
              onClick={() => setLang("en")}
            >
              {t.langEn}
            </button>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        {!locked ? (
          <div className="quote-form noprint">
            <div className="iss-form">
              <label>
                {QUOTE_COPY.client}
                <input
                  className="inp"
                  value={draft.clientName}
                  onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value, title: d.title || e.target.value }))}
                />
              </label>
              <label>
                {QUOTE_COPY.clientPhone}
                <input className="inp" value={draft.clientPhone} onChange={(e) => setDraft((d) => ({ ...d, clientPhone: e.target.value }))} />
              </label>
              <label>
                {QUOTE_COPY.checkIn}
                <input
                  className="inp"
                  type="date"
                  value={draft.checkIn ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, checkIn: e.target.value || null }))}
                />
              </label>
              <label>
                {QUOTE_COPY.nights}
                <input
                  className="inp"
                  inputMode="numeric"
                  value={draft.nights || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, nights: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                />
              </label>
              <label>
                {QUOTE_COPY.guestCount}
                <input
                  className="inp"
                  inputMode="numeric"
                  value={draft.guestCount || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, guestCount: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                />
              </label>
              <label className="wide">
                {QUOTE_COPY.notes}
                <input className="inp" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
              </label>
            </div>

            <div className="quote-lines">
              <div className="quote-lines-h">
                <strong>{QUOTE_COPY.lines}</strong>
                <button
                  type="button"
                  className="btn line sm"
                  onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyQuoteLine(defaultTypeId)] }))}
                >
                  <Plus size={14} /> {QUOTE_COPY.addLine}
                </button>
              </div>
              {draft.lines.map((l) => (
                <div className="quote-line-block" key={l.id}>
                  <div className="chips wrap quote-type-chips" role="group" aria-label={QUOTE_COPY.type}>
                    {types.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`chip ${l.typeId === t.id ? "on" : ""}`}
                        onClick={() => setLine(l.id, { typeId: t.id, label: t.label })}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="quote-line">
                    <input
                      className="inp"
                      placeholder={QUOTE_COPY.label}
                      value={l.label}
                      onChange={(e) => setLine(l.id, { label: e.target.value })}
                    />
                    <input
                      className="inp"
                      inputMode="numeric"
                      aria-label={QUOTE_COPY.rooms}
                      value={l.rooms || ""}
                      onChange={(e) => setLine(l.id, { rooms: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    />
                    <input
                      className="inp"
                      inputMode="numeric"
                      aria-label={QUOTE_COPY.nights}
                      value={l.nights || ""}
                      onChange={(e) => setLine(l.id, { nights: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    />
                    <input
                      className="inp"
                      inputMode="numeric"
                      aria-label={QUOTE_COPY.pax}
                      value={l.pax || ""}
                      onChange={(e) => setLine(l.id, { pax: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    />
                    <input
                      className="inp price"
                      inputMode="numeric"
                      aria-label={QUOTE_COPY.rate}
                      value={l.rate || ""}
                      onChange={(e) => setLine(l.id, { rate: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    />
                    <input
                      className="inp price"
                      inputMode="numeric"
                      aria-label={QUOTE_COPY.amount}
                      value={l.amount || ""}
                      onChange={(e) => setLine(l.id, { amount: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    />
                    <button
                      type="button"
                      className="btn line sm"
                      aria-label={QUOTE_COPY.delete}
                      disabled={draft.lines.length <= 1}
                      onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label className="quote-room-opt">
                    <span className="muted sm">{QUOTE_COPY.roomNos} (선택)</span>
                    <input
                      className="inp sm"
                      placeholder="301, 302"
                      value={roomNosText(l.roomIds, s)}
                      onChange={(e) => setLine(l.id, { roomIds: parseRoomNos(e.target.value, l.typeId, s) })}
                    />
                  </label>
                </div>
              ))}
              <div className="quote-line-hint muted sm">
                {QUOTE_COPY.type} · {QUOTE_COPY.rooms} · {QUOTE_COPY.nights} · {QUOTE_COPY.pax} · {QUOTE_COPY.rate} · {QUOTE_COPY.amount}
              </div>
            </div>

            <label className="quote-show-rooms">
              <input
                type="checkbox"
                checked={draft.showRoomNos}
                onChange={(e) => setDraft((d) => ({ ...d, showRoomNos: e.target.checked }))}
              />
              <span>
                <strong>{QUOTE_COPY.showRoomNos}</strong>
                <span className="muted sm"> — {QUOTE_COPY.showRoomNosHint}</span>
              </span>
            </label>
          </div>
        ) : (
          <div className="quote-form noprint">
            <label className="quote-show-rooms">
              <input type="checkbox" checked={showRoomNos} disabled />
              <span>
                <strong>{QUOTE_COPY.showRoomNos}</strong>
                <span className="muted sm"> — 발급 시 설정이 고정돼요</span>
              </span>
            </label>
          </div>
        )}

        <div className={`quote-print${lang === "en" ? " en" : ""}`}>
          <header className="sc-head">
            <div className="sc-hotel">
              <div className="sc-trade">{trade}</div>
              {biz.businessNumber ? (
                <div>
                  {t.bizNumber} {biz.businessNumber}
                </div>
              ) : null}
              {biz.address ? <div>{biz.address}</div> : null}
              {biz.phone || biz.representative ? (
                <div>
                  {biz.phone ? `${t.phone} ${biz.phone}` : null}
                  {biz.phone && biz.representative ? " · " : null}
                  {biz.representative ? `${t.representativeShort} ${biz.representative}` : null}
                </div>
              ) : null}
            </div>
            <h1 className="sc-title">{t.title}</h1>
          </header>

          <dl className="sc-body">
            <div>
              <dt>{t.client}</dt>
              <dd>
                {body.clientName || "—"}
                {body.clientPhone ? ` · ${body.clientPhone}` : null}
              </dd>
            </div>
            {body.checkIn ? (
              <div>
                <dt>{t.checkIn}</dt>
                <dd>
                  {printDateLabel(lang, body.checkIn, dayLabel)}
                  {body.nights ? ` · ${t.nights(body.nights)}` : null}
                  {body.guestCount ? ` · ${t.guests(body.guestCount)}` : null}
                </dd>
              </div>
            ) : null}
          </dl>

          <table className="quote-tbl">
            <thead>
              <tr>
                <th>{t.label}</th>
                <th>{t.rooms}</th>
                <th>{t.nightsCol}</th>
                <th>{t.pax}</th>
                <th>{t.rate}</th>
                <th>{t.amount}</th>
              </tr>
            </thead>
            <tbody>
              {body.lines.map((l) => (
                <tr key={l.id}>
                  <td>{quoteLinePrintLabel(l, showRoomNos, roomNoOf, lang)}</td>
                  <td>{l.rooms}</td>
                  <td>{l.nights}</td>
                  <td>{l.pax}</td>
                  <td>{won(l.rate)}</td>
                  <td>{won(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={5}>{t.total}</th>
                <th>{won(total)}</th>
              </tr>
            </tfoot>
          </table>

          {body.notes ? <p className="quote-notes">{body.notes}</p> : null}
          <p className="sc-attest">{t.attest}</p>
          <div className="sc-issue">
            {t.issueDate} {printDateLabel(lang, today, dayLabel)}
          </div>
          <div className="sc-sign">
            <div className="sc-sign-trade">{trade}</div>
            <div className="sc-sign-rep">
              {t.representative} {biz.representative || "____________"}
              <span className="sc-seal">{t.seal}</span>
            </div>
          </div>
        </div>

        <div className="mf noprint">
          {err ? <p className="warn sm">{err}</p> : null}
          <p className="fine">{locked ? QUOTE_COPY.tip : hotelBizHasAny(biz) ? QUOTE_COPY.tip : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}</p>
          <div className="keys acts">
            {!locked ? (
              <>
                <button type="button" className="btn line sm" disabled={busy} onClick={() => void save()}>
                  {QUOTE_COPY.draft}
                </button>
                <button type="button" className="btn sm" disabled={busy} onClick={() => void issue()}>
                  {QUOTE_COPY.issue}
                </button>
              </>
            ) : null}
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)}>
              <Printer size={14} /> {t.print}
            </button>
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)} title={t.pdfHint}>
              <FileDown size={14} /> {t.pdf}
            </button>
            {doc && onDelete ? (
              <button type="button" className="btn line sm danger" onClick={() => void remove()}>
                <Trash2 size={14} /> {QUOTE_COPY.delete}
              </button>
            ) : null}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

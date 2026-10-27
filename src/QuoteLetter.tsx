/**
 * 견적서 작성·발급·인쇄 (P1.1)
 * 발급 시 Path A 미배정(타입홀드) 예약 생성 · 인쇄 기본=타입만 · 「객실번호 표시」옵트인
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { FileDown, Plus, Printer, Trash2, X } from "lucide-react";
import {
  type QuoteDoc,
  type QuoteDraft,
  type QuoteLine,
  QUOTE_COPY,
  emptyQuoteLine,
  freezeQuoteSnapshot,
  quoteLinePrintLabel,
  quotePrintStrings,
  quoteTotal,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import { validateQuoteForBookings } from "../shared/quoteBookings";
import {
  formatIssuanceNightDate,
  quoteAmountFromNightCells,
  quoteLineNightCells,
  unitRateFromCells,
  type IssuanceNightCell,
} from "../shared/issuanceNightDetail";
import { chunkIssuanceLines } from "../shared/issuancePages";
import {
  allRooms,
  dayLabel,
  hotelBizDisplayName,
  hotelBizFieldLabels,
  hotelBizHasAny,
  hotelBizUpjongUptaeLine,
  printDateLabel,
  typeLabel,
  usableTypes,
  won,
  type HotelSettings,
  type PrintLang,
} from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";
import IssuancePager, { ISS_PAGER_EN, ISS_PAGER_KO } from "./IssuancePager";
import IssuanceStayItemEditor from "./IssuanceStayItemEditor";

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
  const types = usableTypes(s.types);
  const defaultTypeId = types[0]?.id ?? "";
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const issued = initial?.status === "issued";
  const [doc, setDoc] = useState<QuoteDoc | null>(initial ?? null);
  const [draft, setDraft] = useState<QuoteDraft>(() => draftFromDoc(initial, today, defaultTypeId));
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<PrintLang>("ko");
  const [page, setPage] = useState(0);
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

  /** page 0 = compose (or preview-only when locked); then preview line chunks */
  const lineChunks = useMemo(() => chunkIssuanceLines(body.lines, 5), [body.lines]);
  const composePages = locked ? 0 : 1;
  const pageCount = composePages + lineChunks.length;
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  const onCompose = !locked && page === 0;
  const previewChunkIdx = locked ? page : page - 1;
  const previewChunk = previewChunkIdx >= 0 ? lineChunks[previewChunkIdx] ?? [] : [];
  const isLastPreview = previewChunkIdx >= 0 && previewChunkIdx === lineChunks.length - 1;

  const patchLine = (id: string, patch: Partial<QuoteLine>) => {
    setDraft((d) => {
      const lines = d.lines.map((l) => {
        if (l.id !== id) return l;
        const next: QuoteLine = { ...l, ...patch };
        if (patch.typeId != null) {
          const ty = s.types.find((x) => x.id === patch.typeId);
          if (ty) next.label = typeLabel(ty);
        }
        if (patch.nightAmounts) {
          next.rate = unitRateFromCells(patch.nightAmounts, 0, next.nights);
          next.amount = quoteAmountFromNightCells(next.rooms, patch.nightAmounts);
        } else if (patch.rooms != null && next.nightAmounts?.length) {
          next.amount = quoteAmountFromNightCells(next.rooms, next.nightAmounts);
        }
        return next;
      });
      return {
        ...d,
        lines,
        nights: Math.max(1, ...lines.map((l) => l.nights || 0), d.nights || 1),
      };
    });
  };

  const setLineStay = (id: string, checkIn: string, nights: number, cells?: IssuanceNightCell[]) => {
    setDraft((d) => {
      const lines = d.lines.map((l) => {
        if (l.id !== id) return l;
        const nightAmounts =
          cells ??
          quoteLineNightCells({
            checkIn,
            nights,
            rate: l.rate,
            nightAmounts: l.nightAmounts,
            roomTotal: nights > 0 ? Math.round(l.amount / Math.max(1, l.rooms)) : 0,
          });
        return {
          ...l,
          nights,
          nightAmounts,
          rate: unitRateFromCells(nightAmounts, 0, nights),
          amount: quoteAmountFromNightCells(l.rooms, nightAmounts),
        };
      });
      return {
        ...d,
        lines,
        checkIn,
        nights: Math.max(1, ...lines.map((l) => l.nights || 0), nights),
      };
    });
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

        <div className="quote-slide noprint">
          {onCompose ? (
            <div className="quote-form">
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
                  {QUOTE_COPY.guestCount}
                  <input
                    className="inp"
                    inputMode="numeric"
                    value={draft.guestCount || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, guestCount: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                  />
                </label>
                <label className="iss-notes">
                  {QUOTE_COPY.notes}
                  <input className="inp iss-notes-inp" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
                </label>
              </div>
              <p className="muted sm">{QUOTE_COPY.tipNights}</p>

              <div className="quote-lines">
                <div className="quote-lines-h">
                  <strong>{QUOTE_COPY.lines}</strong>
                  <button
                    type="button"
                    className="btn line sm"
                    onClick={() => {
                      const base = emptyQuoteLine(defaultTypeId);
                      const ci = draft.checkIn || today;
                      const n = Math.max(1, draft.nights || 1);
                      setDraft((d) => ({
                        ...d,
                        lines: [
                          ...d.lines,
                          {
                            ...base,
                            nights: n,
                            nightAmounts: quoteLineNightCells({ checkIn: ci, nights: n, rate: 0 }),
                          },
                        ],
                        checkIn: ci,
                        nights: n,
                      }));
                    }}
                  >
                    <Plus size={14} /> {QUOTE_COPY.addLine}
                  </button>
                </div>
                {draft.lines.map((l) => {
                  const lineCi = draft.checkIn || today;
                  const cells = l.nightAmounts?.length
                    ? l.nightAmounts
                    : quoteLineNightCells({
                        checkIn: lineCi,
                        nights: l.nights || draft.nights || 1,
                        rate: l.rate,
                        roomTotal: l.rooms > 0 ? Math.round(l.amount / Math.max(1, l.rooms)) : l.rate * (l.nights || 1),
                      });
                  return (
                    <div className="quote-line-block" key={l.id}>
                      <IssuanceStayItemEditor
                        types={types}
                        typeId={l.typeId || defaultTypeId}
                        rooms={Math.max(1, l.rooms || 1)}
                        checkIn={lineCi}
                        nights={Math.max(1, l.nights || draft.nights || 1)}
                        nightAmounts={cells}
                        today={today}
                        canRemove={draft.lines.length > 1}
                        onTypeRooms={(typeId, rooms) => patchLine(l.id, { typeId, rooms })}
                        onStay={(checkIn, nights) => setLineStay(l.id, checkIn, nights)}
                        onNightAmounts={(nightAmounts) => {
                          const nn = nightAmounts.length || l.nights || 1;
                          const nextCi =
                            nightAmounts[0]?.date && !nightAmounts[0].date.startsWith("N")
                              ? nightAmounts[0].date
                              : draft.checkIn || today;
                          setLineStay(l.id, nextCi, nn, nightAmounts);
                        }}
                        onRemove={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}
                      />
                      <label className="iss-stay-pax">
                        <span className="muted sm">{QUOTE_COPY.pax}</span>
                        <input
                          className="inp sm"
                          inputMode="numeric"
                          aria-label={QUOTE_COPY.pax}
                          value={l.pax || ""}
                          onChange={(e) => patchLine(l.id, { pax: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                        />
                      </label>
                      {draft.showRoomNos ? (
                        <label className="quote-room-opt">
                          <span className="muted sm">{QUOTE_COPY.roomNos} (선택)</span>
                          <input
                            className="inp sm"
                            placeholder="301, 302"
                            value={roomNosText(l.roomIds, s)}
                            onChange={(e) => patchLine(l.id, { roomIds: parseRoomNos(e.target.value, l.typeId, s) })}
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
                <div className="quote-total-bar">
                  <strong>
                    {QUOTE_COPY.total} {won(total)}
                  </strong>
                </div>
              </div>

              <label className="quote-show-rooms">
                <input type="checkbox" checked={draft.showRoomNos} onChange={(e) => setDraft((d) => ({ ...d, showRoomNos: e.target.checked }))} />
                <span>
                  <strong>{QUOTE_COPY.showRoomNos}</strong>
                  <span className="muted sm"> — {QUOTE_COPY.showRoomNosHint}</span>
                </span>
              </label>
            </div>
          ) : (
            <div className={`quote-print-slide${lang === "en" ? " en" : ""}`}>
              {previewChunkIdx === 0 ? (
                <>
                  <header className="sc-head">
                    <div className="sc-hotel">
                      <div className="sc-trade">{trade}</div>
                      {biz.businessNumber ? (
                        <div>
                          {t.bizNumber} {biz.businessNumber}
                        </div>
                      ) : null}
                      {(() => {
                        const uu = hotelBizUpjongUptaeLine(biz, hotelBizFieldLabels(lang));
                        return uu ? <div>{uu}</div> : null;
                      })()}
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
                  {locked ? (
                    <label className="quote-show-rooms">
                      <input type="checkbox" checked={showRoomNos} disabled />
                      <span>
                        <strong>{QUOTE_COPY.showRoomNos}</strong>
                        <span className="muted sm"> — 발급 시 설정이 고정돼요</span>
                      </span>
                    </label>
                  ) : null}
                </>
              ) : (
                <div className="iss-slide-cont muted sm">
                  {t.title} · {previewChunkIdx + 1}/{lineChunks.length}
                </div>
              )}
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
                  {previewChunk.map((l) => (
                    <Fragment key={l.id}>
                      <tr>
                        <td>{quoteLinePrintLabel(l, showRoomNos, roomNoOf, lang)}</td>
                        <td>{l.rooms}</td>
                        <td>{l.nights}</td>
                        <td>{l.pax}</td>
                        <td>{won(l.rate)}</td>
                        <td>{won(l.amount)}</td>
                      </tr>
                      {l.nightAmounts && l.nightAmounts.length > 1 ? (
                        <tr className="inv-night-row">
                          <td colSpan={6}>
                            <ul className="inv-night-list">
                              {l.nightAmounts.map((c) => (
                                <li key={c.date}>
                                  <span>{formatIssuanceNightDate(c.date, lang)}</span>
                                  <strong>
                                    {won(c.amount)}
                                    {l.rooms > 1 ? ` × ${l.rooms}` : ""}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
                {isLastPreview ? (
                  <tfoot>
                    <tr>
                      <th colSpan={5}>{t.total}</th>
                      <th>{won(total)}</th>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
              {isLastPreview ? (
                <>
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
                </>
              ) : (
                <p className="muted sm iss-more-hint">다음 페이지에 이어져요</p>
              )}
            </div>
          )}
        </div>

        <div className={`quote-print iss-print-src${lang === "en" ? " en" : ""}`} aria-hidden>
          <header className="sc-head">
            <div className="sc-hotel">
              <div className="sc-trade">{trade}</div>
              {biz.businessNumber ? (
                <div>
                  {t.bizNumber} {biz.businessNumber}
                </div>
              ) : null}
              {(() => {
                const uu = hotelBizUpjongUptaeLine(biz, hotelBizFieldLabels(lang));
                return uu ? <div>{uu}</div> : null;
              })()}
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
                  <td>
                    {quoteLinePrintLabel(l, showRoomNos, roomNoOf, lang)}
                    {l.nightAmounts && l.nightAmounts.length > 1 ? (
                      <ul className="inv-night-list print-inline">
                        {l.nightAmounts.map((c) => (
                          <li key={c.date}>
                            {formatIssuanceNightDate(c.date, lang)} {won(c.amount)}
                            {l.rooms > 1 ? ` × ${l.rooms}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
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

        <div className="mf noprint quote-foot">
          <IssuancePager page={page} pageCount={pageCount} onChange={setPage} labels={lang === "en" ? ISS_PAGER_EN : ISS_PAGER_KO} />
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

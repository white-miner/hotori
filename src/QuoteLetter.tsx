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
  ensureQuoteLineNights,
  freezeQuoteSnapshot,
  lineAmount,
  quoteLinePrintLabel,
  quotePrintStrings,
  quoteTotal,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import { quoteLineTypeOptions, validateQuoteForBookings } from "../shared/quoteBookings";
import {
  formatIssuanceNightDate,
  patchIssuanceNightCell,
  quoteAmountFromNightCells,
  quoteLineNightCells,
  sumIssuanceNightCells,
  unitRateFromCells,
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
  won,
  type HotelSettings,
  type PrintLang,
} from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";
import IssuancePager, { ISS_PAGER_EN, ISS_PAGER_KO } from "./IssuancePager";

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
  const [page, setPage] = useState(0);
  const [openNights, setOpenNights] = useState<Record<string, boolean>>({});
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

  const setLine = (id: string, patch: Partial<QuoteLine>) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.typeId != null) {
          const ty = s.types.find((x) => x.id === patch.typeId);
          if (ty && !patch.label) next.label = typeLabel(ty);
        }
        if (patch.nightAmounts) {
          next.rate = unitRateFromCells(patch.nightAmounts, next.rate * Math.max(1, next.nights), next.nights);
          next.amount = quoteAmountFromNightCells(next.rooms, patch.nightAmounts);
          return next;
        }
        if (patch.rooms != null || patch.nights != null || patch.rate != null) {
          if (patch.amount == null) next.amount = lineAmount(next.rooms, next.nights, next.rate);
          if (patch.nights != null || patch.rate != null) {
            next.nightAmounts = quoteLineNightCells({
              checkIn: d.checkIn,
              nights: next.nights,
              rate: next.rate,
              roomTotal: next.nights > 0 ? Math.round(next.amount / Math.max(1, next.rooms)) : 0,
            });
          }
        }
        if (patch.amount != null && patch.nightAmounts == null && next.nights > 0) {
          next.nightAmounts = quoteLineNightCells({
            checkIn: d.checkIn,
            nights: next.nights,
            rate: next.rate,
            roomTotal: Math.round(next.amount / Math.max(1, next.rooms)),
          });
          next.rate = unitRateFromCells(next.nightAmounts, next.amount, next.nights * Math.max(1, next.rooms));
        }
        return next;
      }),
    }));
  };

  const expandNights = (line: QuoteLine) => {
    const ensured = ensureQuoteLineNights(line, draft.checkIn);
    setLine(line.id, { nightAmounts: ensured.nightAmounts, rate: ensured.rate, amount: ensured.amount });
    setOpenNights((p) => ({ ...p, [line.id]: true }));
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
                    onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyQuoteLine(defaultTypeId)] }))}
                  >
                    <Plus size={14} /> {QUOTE_COPY.addLine}
                  </button>
                </div>
                {draft.lines.map((l) => {
                  const cells = l.nightAmounts?.length
                    ? l.nightAmounts
                    : quoteLineNightCells({
                        checkIn: draft.checkIn,
                        nights: l.nights,
                        rate: l.rate,
                        roomTotal: l.rooms > 0 ? Math.round(l.amount / Math.max(1, l.rooms)) : l.rate * l.nights,
                      });
                  const showN = !!openNights[l.id];
                  return (
                    <div className="quote-line-block" key={l.id}>
                      <div className="chips wrap quote-type-chips" role="group" aria-label={QUOTE_COPY.type}>
                        {types.map((ty) => (
                          <button
                            key={ty.id}
                            type="button"
                            className={`chip ${l.typeId === ty.id ? "on" : ""}`}
                            onClick={() => setLine(l.id, { typeId: ty.id, label: ty.label })}
                          >
                            {ty.label}
                          </button>
                        ))}
                      </div>
                      <table className="quote-edit-tbl">
                        <thead>
                          <tr>
                            <th scope="col">{QUOTE_COPY.label}</th>
                            <th scope="col">{QUOTE_COPY.rooms}</th>
                            <th scope="col">{QUOTE_COPY.nights}</th>
                            <th scope="col">{QUOTE_COPY.pax}</th>
                            <th scope="col">{QUOTE_COPY.rate}</th>
                            <th scope="col">{QUOTE_COPY.amount}</th>
                            <th scope="col" className="quote-edit-act">
                              <span className="sr-only">{QUOTE_COPY.delete}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="quote-edit-inputs">
                            <td>
                              <input className="inp" placeholder="—" aria-label={QUOTE_COPY.label} value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} />
                            </td>
                            <td>
                              <input className="inp" inputMode="numeric" aria-label={QUOTE_COPY.rooms} value={l.rooms || ""} onChange={(e) => setLine(l.id, { rooms: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                            </td>
                            <td>
                              <input className="inp" inputMode="numeric" aria-label={QUOTE_COPY.nights} value={l.nights || ""} onChange={(e) => setLine(l.id, { nights: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                            </td>
                            <td>
                              <input className="inp" inputMode="numeric" aria-label={QUOTE_COPY.pax} value={l.pax || ""} onChange={(e) => setLine(l.id, { pax: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                            </td>
                            <td>
                              <input className="inp price" inputMode="numeric" aria-label={QUOTE_COPY.rate} value={l.rate || ""} onChange={(e) => setLine(l.id, { rate: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                            </td>
                            <td>
                              <input className="inp price" inputMode="numeric" aria-label={QUOTE_COPY.amount} value={l.amount || ""} onChange={(e) => setLine(l.id, { amount: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                            </td>
                            <td className="quote-edit-act">
                              <button type="button" className="btn line sm" aria-label={QUOTE_COPY.delete} disabled={draft.lines.length <= 1} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="quote-night-bar">
                        <button type="button" className="btn line sm" onClick={() => (showN ? setOpenNights((p) => ({ ...p, [l.id]: false })) : expandNights(l))}>
                          {QUOTE_COPY.nightDetail}
                        </button>
                        <label className="quote-room-opt">
                          <span className="muted sm">{QUOTE_COPY.roomNos} (선택)</span>
                          <input className="inp sm" placeholder="301, 302" value={roomNosText(l.roomIds, s)} onChange={(e) => setLine(l.id, { roomIds: parseRoomNos(e.target.value, l.typeId, s) })} />
                        </label>
                      </div>
                      {showN ? (
                        <ul className="inv-night-list">
                          {cells.map((c, i) => (
                            <li key={c.date}>
                              <span>{formatIssuanceNightDate(c.date, lang)}</span>
                              <input
                                className="inp price sm"
                                inputMode="numeric"
                                aria-label={`${QUOTE_COPY.nightDetail} ${c.date}`}
                                value={c.amount || ""}
                                onChange={(e) => {
                                  const val = Number(e.target.value.replace(/\D/g, "")) || 0;
                                  const date = c.date;
                                  // Same type + same date → set once, apply to matching lines
                                  setDraft((d) => {
                                    const peers =
                                      !!l.typeId && d.lines.filter((x) => x.typeId === l.typeId).length > 1;
                                    return {
                                      ...d,
                                      lines: d.lines.map((line) => {
                                        const match =
                                          line.id === l.id || (!!l.typeId && line.typeId === l.typeId);
                                        if (!match) return line;
                                        const lineCells =
                                          line.id === l.id
                                            ? cells
                                            : line.nightAmounts?.length
                                              ? line.nightAmounts
                                              : quoteLineNightCells({
                                                  checkIn: d.checkIn,
                                                  nights: line.nights,
                                                  rate: line.rate,
                                                  roomTotal:
                                                    line.rooms > 0
                                                      ? Math.round(line.amount / Math.max(1, line.rooms))
                                                      : line.rate * line.nights,
                                                });
                                        const idx = lineCells.findIndex((x) => x.date === date);
                                        if (idx < 0) return line;
                                        const roomTotal = Math.round(line.amount / Math.max(1, line.rooms));
                                        const next = peers
                                          ? lineCells.map((x, j) => (j === idx ? { ...x, amount: val } : { ...x }))
                                          : patchIssuanceNightCell(lineCells, idx, val, roomTotal);
                                        const perRoom = peers ? sumIssuanceNightCells(next) : roomTotal;
                                        return {
                                          ...line,
                                          nightAmounts: next,
                                          rate: unitRateFromCells(next, perRoom, line.nights),
                                          amount: quoteAmountFromNightCells(line.rooms, next),
                                        };
                                      }),
                                    };
                                  });
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
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

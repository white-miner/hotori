/**
 * 견적서 작성·발급·인쇄 (P1.1)
 * 발급 시 Path A 미배정(타입홀드) 예약 생성 · 인쇄 기본=타입만 · 「객실번호 표시」옵트인
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Printer, Trash2, X } from "lucide-react";
import {
  type QuoteDoc,
  type QuoteDraft,
  type QuoteLine,
  QUOTE_COPY,
  QUOTE_NOTES_MAX,
  emptyQuoteLine,
  freezeQuoteSnapshot,
  normalizeQuoteTaxMode,
  quotePriceSummary,
  quoteLinePrintLabel,
  quotePrintStrings,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import { validateQuoteForBookings } from "../shared/quoteBookings";
import { formatIssuanceNightDate } from "../shared/issuanceNightDetail";
import { quoteTemplateFromDraft, quoteTemplateLines, readQuoteTemplates, rebaseQuoteLine, type QuoteTemplate } from "../shared/quoteTemplates";
import { chunkIssuanceLines } from "../shared/issuancePages";
import {
  allRooms,
  addDays,
  buildingName,
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
import QuoteItemsEditor from "./QuoteItemsEditor";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  templateKey: string;
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

function draftFromDoc(doc: QuoteDoc | null | undefined, today: string, defaultTypeId: string, defaultLabel: string): QuoteDraft {
  if (!doc) {
    return {
      title: "",
      clientName: "",
      clientPhone: "",
      notes: "",
      checkIn: today,
      nights: 1,
      guestCount: 2,
      lines: [{ ...emptyQuoteLine(defaultTypeId), label: defaultLabel }],
      showRoomNos: true,
      validUntil: addDays(today, 7),
      taxMode: "included",
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
    validUntil: doc.validUntil ?? addDays(today, 7),
    taxMode: normalizeQuoteTaxMode(doc.taxMode),
  };
}

function withQuoteLines(draft: QuoteDraft, lines: QuoteLine[]): QuoteDraft {
  return {
    ...draft,
    lines,
    nights: Math.max(1, ...lines.map((line) => line.nights)),
    guestCount: lines.reduce((total, line) => total + line.pax * line.rooms, 0),
  };
}

export default function QuoteLetter({
  hotelName,
  s,
  today,
  templateKey,
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
  const [draft, setDraft] = useState<QuoteDraft>(() => draftFromDoc(initial, today, defaultTypeId, types[0] ? typeLabel(types[0]) : ""));
  const [templates, setTemplates] = useState<QuoteTemplate[]>(() => {
    try { return readQuoteTemplates(localStorage.getItem(templateKey)); } catch { return []; }
  });
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const clientInput = useRef<HTMLInputElement>(null);
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
  const amounts = quotePriceSummary(body.lines, body.taxMode);
  const total = locked && doc?.snapshot ? doc.snapshot.total : amounts.grandTotal;
  const fileTitle = `${trade}_${t.title}_${body.clientName || body.title || (lang === "en" ? "Quote" : "견적")}`;
  const placedRooms = allRooms(s);
  const roomNoOf = (id: string) => {
    const room = placedRooms.find((item) => item.id === id);
    if (!room) return undefined;
    return placedRooms.some((item) => item.id !== id && item.no === room.no)
      ? `${buildingName(s, room.buildingId)} ${room.no}` : room.no;
  };
  const lineName = (line: QuoteLine) => {
    const type = types.find((item) => item.id === line.typeId);
    const name = quoteLinePrintLabel({ ...line, label: line.label || (type ? typeLabel(type) : "") }, showRoomNos, roomNoOf, lang);
    return line.detail ? `${name} · ${line.detail}` : name;
  };
  const stayLabel = (line: QuoteLine) => {
    const start = line.checkIn ?? body.checkIn;
    return <>{line.nights}{start && line.nights > 0 && <small className="quote-stay-period">
      {formatIssuanceNightDate(start, lang)} → {formatIssuanceNightDate(addDays(start, line.nights), lang)}
    </small>}</>;
  };
  const taxLabel = lang === "ko"
    ? { included: "부가세 포함", excluded: "부가세 별도", exempt: "면세" }[amounts.taxMode]
    : { included: "VAT included", excluded: "VAT excluded", exempt: "VAT exempt" }[amounts.taxMode];
  const totalRows = () => <>
    <tr><th colSpan={5}>{lang === "ko" ? "공급가액" : "Subtotal"}</th><th>{won(body.supplyAmount ?? amounts.supplyAmount)}</th></tr>
    <tr><th colSpan={5}>{taxLabel}</th><th>{won(body.vatAmount ?? amounts.vatAmount)}</th></tr>
    <tr><th colSpan={5}>{t.total}</th><th>{won(total)}</th></tr>
  </>;
  const quoteNumber = doc?.id
    ? `Q-${(doc.createdAt || today).slice(0, 10).replaceAll("-", "")}-${doc.id.replaceAll("-", "").slice(0, 6).toUpperCase()}`
    : lang === "ko" ? "발급 후 부여" : "Assigned on issue";
  const printMetadata = <>
    <div><dt>{lang === "ko" ? "견적번호" : "Quote number"}</dt><dd>{quoteNumber}</dd></div>
    {body.validUntil && <div><dt>{lang === "ko" ? "유효기간" : "Valid until"}</dt><dd>{printDateLabel(lang, body.validUntil, dayLabel)}</dd></div>}
    <div><dt>{lang === "ko" ? "부가세 기준" : "Tax basis"}</dt><dd>{taxLabel}</dd></div>
  </>;

  const storeTemplates = (next: QuoteTemplate[]) => {
    try {
      localStorage.setItem(templateKey, JSON.stringify(next));
      setTemplates(next);
      return true;
    } catch {
      setErr("이 브라우저에 견적 템플릿을 저장할 수 없어요.");
      return false;
    }
  };
  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return setErr("템플릿 이름을 입력해 주세요.");
    const issueError = validateQuoteForBookings({ ...draft, lines: draft.lines.map((line) => ({ ...line, roomIds: [] })) }, s);
    if (issueError) return setErr(issueError);
    const previous = templates.find((item) => item.name === name);
    if (!previous && templates.length >= 20) return setErr("템플릿은 20개까지 저장할 수 있어요.");
    const next = { ...quoteTemplateFromDraft(name, draft), ...(previous && { id: previous.id }) };
    if (storeTemplates([next, ...templates.filter((item) => item.id !== next.id)])) {
      setActiveTemplate(next.id);
      setEditingTemplates(false);
      setErr(null);
      notify("견적 템플릿을 저장했어요.");
    }
  };
  const applyTemplate = async (template: QuoteTemplate) => {
    if (draft.lines.some((line) => line.amount > 0 || line.roomIds?.length) &&
      !(await askConfirm({ title: "템플릿을 적용할까요?", body: "현재 객실 내역과 부가세 설정을 템플릿 내용으로 바꿔요.",
        confirmLabel: "템플릿 적용", cancelLabel: "돌아가기" }))) return;
    setDraft((current) => {
      const start = current.checkIn ?? today;
      return withQuoteLines({ ...current, checkIn: start, taxMode: normalizeQuoteTaxMode(template.taxMode), showRoomNos: template.showRoomNos }, quoteTemplateLines(template, start));
    });
    setActiveTemplate(template.id);
    setTemplateName(template.name);
    setErr(null);
    clientInput.current?.focus();
  };

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
      body: `${draft.lines.reduce((sum, line) => sum + line.rooms, 0)}실 · ${draft.guestCount}명 · ${won(total)}원\n견적서를 발급하고 이 내역으로 예약을 만들어요.`,
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
  const templateNameField = <div className="quote-template-edit">
    <label>템플릿 이름<input className="inp" autoFocus value={templateName} maxLength={50} onChange={(e) => setTemplateName(e.target.value)} /></label>
    <button type="button" className="btn dark sm" onClick={saveTemplate}>
      {templates.some((template) => template.name === templateName.trim()) ? "템플릿 업데이트" : "템플릿 저장"}
    </button>
    {!locked && activeTemplate && templates.some((template) => template.id === activeTemplate) && <button type="button" className="btn line sm" onClick={async () => {
      if (!(await askConfirm({ title: "이 템플릿을 삭제할까요?", body: "저장한 템플릿 목록에서 제거해요.", confirmLabel: "삭제", cancelLabel: "취소", danger: true }))) return;
      if (storeTemplates(templates.filter((template) => template.id !== activeTemplate))) {
        setActiveTemplate(null);
        setTemplateName("");
      }
    }}>선택 템플릿 삭제</button>}
  </div>;

  return (
    <div className="dim quote-dim" role="presentation" onClick={onClose}>
      <div className="modal quote-letter quote-template-letter" role="dialog" aria-labelledby="quote-title" onClick={(e) => e.stopPropagation()}>
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
              <section className="quote-templates" aria-label="견적 템플릿">
                <div className="quote-items-head">
                  <strong>견적 템플릿</strong>
                  <button type="button" className="btn line sm" aria-expanded={editingTemplates} onClick={() => setEditingTemplates(!editingTemplates)}>현재 견적을 템플릿으로 저장</button>
                </div>
                {templates.length ? <div className="quote-template-list">
                  {templates.map((template) => <button type="button" key={template.id}
                    className={`btn sm ${template.id === activeTemplate ? "dark" : "line"}`}
                    onClick={() => void applyTemplate(template)}>{template.name}</button>)}
                </div> : <small>반복하는 객실 내역을 한 번 저장하면 다음 견적에서 바로 불러올 수 있어요.</small>}
                {editingTemplates && templateNameField}
              </section>
              <div className="iss-form">
                <label>
                  {QUOTE_COPY.client}
                  <input
                    className="inp"
                    ref={clientInput}
                    value={draft.clientName}
                    onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
                  />
                </label>
                <label>
                  기준 입실일 · 전체 일정 이동
                  <input className="inp" type="date" value={draft.checkIn ?? today} onChange={(e) => {
                    const next = e.target.value;
                    if (next) setDraft((d) => withQuoteLines({ ...d, checkIn: next },
                      d.lines.map((line) => rebaseQuoteLine(line, d.checkIn ?? today, next))));
                  }} />
                </label>
              </div>
              <details className="quote-extra-fields">
                <summary>견적 제목·연락처·유효기간·안내사항</summary>
                <div className="iss-form">
                  <label>견적 제목
                    <input className="inp" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                  </label>
                  <label>{QUOTE_COPY.clientPhone}
                    <input className="inp" value={draft.clientPhone} onChange={(e) => setDraft((d) => ({ ...d, clientPhone: e.target.value }))} />
                  </label>
                  <label>유효기간
                    <input className="inp" type="date" value={draft.validUntil ?? ""} onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value || null }))} />
                  </label>
                  <label>견적 조건·안내사항
                    <textarea className="inp" rows={3} maxLength={QUOTE_NOTES_MAX} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
                  </label>
                </div>
              </details>
              <QuoteItemsEditor settings={s} start={draft.checkIn ?? today} lines={draft.lines}
                onChange={(lines) => setDraft((d) => withQuoteLines(d, lines))} notify={notify} />
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
                  <p className="quote-doc-purpose">{body.title}</p>
                  <dl className="sc-body">
                    {printMetadata}
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
                        <td>{lineName(l)}</td>
                        <td>{l.rooms}</td>
                        <td>{stayLabel(l)}</td>
                        <td>{l.pax}</td>
                        <td>{l.nightAmounts?.some((cell) => cell.amount !== l.nightAmounts?.[0]?.amount) ? (lang === "ko" ? "날짜별" : "By date") : won(l.rate)}</td>
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
                  <tfoot>{totalRows()}</tfoot>
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
          <p className="quote-doc-purpose">{body.title}</p>
          <dl className="sc-body">
            {printMetadata}
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
                    {lineName(l)}
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
                  <td>{stayLabel(l)}</td>
                  <td>{l.pax}</td>
                  <td>{l.nightAmounts?.some((cell) => cell.amount !== l.nightAmounts?.[0]?.amount) ? (lang === "ko" ? "날짜별" : "By date") : won(l.rate)}</td>
                  <td>{won(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>{totalRows()}</tfoot>
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
          {locked && editingTemplates && templateNameField}
          {!locked && <div className="quote-fast-total">
            <label>부가세 <select value={normalizeQuoteTaxMode(draft.taxMode)} onChange={(e) => setDraft((d) => ({
              ...d, taxMode: normalizeQuoteTaxMode(e.target.value),
            }))}>
              <option value="included">포함</option><option value="excluded">별도</option><option value="exempt">면세</option>
            </select></label>
            <strong aria-live="polite">{draft.lines.reduce((sum, line) => sum + line.rooms, 0)}실 · {draft.guestCount}명 · 합계 {won(total)}원</strong>
          </div>}
          {!onCompose && <IssuancePager page={page} pageCount={pageCount} onChange={setPage} labels={lang === "en" ? ISS_PAGER_EN : ISS_PAGER_KO} />}
          {err ? <p className="warn sm">{err}</p> : null}
          <p className="fine">{locked ? QUOTE_COPY.tip : hotelBizHasAny(biz) ? QUOTE_COPY.tip : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}</p>
          <div className="keys acts">
            {!locked ? (
              <>
                <button type="button" className="btn line sm" onClick={() => setPage(onCompose ? 1 : 0)}>{onCompose ? "미리보기" : "작성으로 돌아가기"}</button>
                <button type="button" className="btn line sm" disabled={busy} onClick={() => void save()}>
                  {QUOTE_COPY.draft}
                </button>
                <button type="button" className="btn dark sm" disabled={busy} onClick={() => void issue()}>
                  {QUOTE_COPY.issue}
                </button>
              </>
            ) : <button type="button" className="btn line sm" aria-expanded={editingTemplates}
              onClick={() => setEditingTemplates(!editingTemplates)}>이 견적을 템플릿으로 저장</button>}
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

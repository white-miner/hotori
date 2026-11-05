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
  QUOTE_CONTACT_FIELDS,
  QUOTE_NOTES_MAX,
  type QuoteContacts,
  emptyQuoteLine,
  freezeQuoteSnapshot,
  normalizeQuoteTaxMode,
  quotePriceSummary,
  quotePrintStrings,
  validateQuoteDraft,
} from "../shared/quoteDoc";
import { validateQuoteForBookings } from "../shared/quoteBookings";
import { formatIssuanceNightDate } from "../shared/issuanceNightDetail";
import { quoteTemplateFromDraft, quoteTemplateLines, readQuoteTemplates, rebaseQuoteLine, type QuoteTemplate } from "../shared/quoteTemplates";
import { applyQuoteTypeRates } from "../shared/quoteRates";
import {
  allRooms,
  addDays,
  buildingName,
  dayLabel,
  hotelBizDisplayName,
  hotelBizHasAny,
  printDateLabel,
  typeLabel,
  usableTypes,
  won,
  type Booking,
  type HotelSettings,
  type PrintLang,
} from "../shared/ledger";
import { askConfirm } from "./ConfirmDialog";
import QuoteItemsEditor from "./QuoteItemsEditor";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  templateKey: string;
  initial?: QuoteDoc | null;
  bookings?: Booking[];
  busy?: boolean;
  onSaveDraft: (draft: QuoteDraft, id?: string) => Promise<QuoteDoc>;
  onIssue: (draft: QuoteDraft, id?: string) => Promise<QuoteDoc>;
  onDelete?: (doc: QuoteDoc) => Promise<void>;
  onOpenRateSettings?: () => void;
  onOpenDrafts?: () => void;
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
      lines: [{ ...emptyQuoteLine(defaultTypeId), label: defaultLabel, rateSource: "type" }],
      showRoomNos: true,
      validUntil: addDays(today, 7),
      taxMode: "included",
    };
  }
  return {
    title: doc.title,
    clientName: doc.clientName,
    clientPhone: doc.clientPhone,
    contacts: doc.contacts,
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
  bookings,
  busy,
  onSaveDraft,
  onIssue,
  onDelete,
  onOpenRateSettings,
  onOpenDrafts,
  onClose,
  notify,
}: Props) {
  const types = usableTypes(s.types);
  const defaultTypeId = types[0]?.id ?? "";
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const issued = initial?.status === "issued";
  const [doc, setDoc] = useState<QuoteDoc | null>(initial ?? null);
  const [draftState, setDraft] = useState<QuoteDraft>(() => draftFromDoc(initial, today, defaultTypeId, types[0] ? typeLabel(types[0]) : ""));
  const savedState = useRef(draftState);
  const editedItems = useRef(!!initial?.lines.length);
  const [templates, setTemplates] = useState<QuoteTemplate[]>(() => {
    try { return readQuoteTemplates(localStorage.getItem(templateKey)); } catch { return []; }
  });
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const clientInput = useRef<HTMLInputElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<PrintLang>("ko");
  const [previewOpen, setPreviewOpen] = useState(false);
  const t = quotePrintStrings(lang);
  const locked = issued || doc?.status === "issued";
  const draft = useMemo(() => locked ? draftState : {
    ...draftState,
    lines: draftState.lines.map((line) => applyQuoteTypeRates(line, draftState.checkIn ?? today, s)),
  }, [draftState, locked, s, today]);

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
    return line.label || (type ? typeLabel(type) : "—");
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
    <tr><th colSpan={6}>{lang === "ko" ? "공급가액" : "Subtotal"}</th><td>{won(body.supplyAmount ?? amounts.supplyAmount)}</td></tr>
    <tr><th colSpan={6}>{taxLabel}</th><td>{won(body.vatAmount ?? amounts.vatAmount)}</td></tr>
    <tr className="quote-final-total"><th colSpan={6}>{lang === "ko" ? "최종 합계" : "Total due"}</th><td>{won(total)}</td></tr>
  </>;
  const quoteNumber = doc?.id
    ? `Q-${(doc.createdAt || today).slice(0, 10).replaceAll("-", "")}-${doc.id.replaceAll("-", "").slice(0, 6).toUpperCase()}`
    : lang === "ko" ? "발급 후 부여" : "Assigned on issue";
  const ko = lang === "ko";
  const contacts = body.contacts ?? {};
  const supplierAddress = contacts.supplierAddress || biz.address;
  const documentField = (label: string, value?: string) => value ? <div><dt>{label}</dt><dd>{value}</dd></div> : null;
  const documentHeader = () => <>
    <header className="quote-doc-heading">
      <div><h1>{t.title}</h1><p>{body.title}</p></div>
      <dl>
        {documentField(ko ? "견적번호" : "Quote no.", quoteNumber)}
        {documentField(t.issueDate, printDateLabel(lang, (locked && body.issuedAt ? body.issuedAt.slice(0, 10) : today), dayLabel))}
        {documentField(ko ? "유효기간" : "Valid until", body.validUntil ? printDateLabel(lang, body.validUntil, dayLabel) : undefined)}
      </dl>
    </header>
    <div className="quote-doc-parties">
      <section>
        <h2>{ko ? "수신처" : "Prepared for"}</h2>
        <strong>{body.clientName || "—"}</strong>
        <dl>
          {documentField(ko ? "담당자" : "Contact", contacts.contact)}
          {documentField(t.phone, body.clientPhone)}
          {documentField(ko ? "이메일" : "Email", contacts.email)}
          {documentField(t.bizNumber, contacts.businessNumber)}
          {documentField(ko ? "주소" : "Address", contacts.address)}
          {documentField(ko ? "사업장 주소" : "Business address", contacts.businessAddress)}
        </dl>
      </section>
      <section>
        <h2>{ko ? "공급자" : "Supplier"}</h2>
        <strong>{trade}</strong>
        <dl>
          {documentField(t.bizNumber, biz.businessNumber)}
          {documentField(t.representativeShort, biz.representative)}
          {documentField(t.phone, biz.phone)}
          {documentField(ko ? "사업장 주소" : "Business address", supplierAddress)}
          {documentField(ko ? "업태·종목" : "Business activity", [biz.uptae, biz.upjong].filter(Boolean).join(" · "))}
        </dl>
      </section>
    </div>
    <div className="quote-doc-summary">
      <span>{ko ? "숙박 견적" : "Accommodation quote"} · {taxLabel}{body.guestCount ? ` · ${t.guests(body.guestCount)}` : ""}</span>
      <strong>{won(total)} {ko ? "원" : "KRW"}</strong>
    </div>
  </>;
  const documentTable = () => <table className="quote-tbl quote-doc-table">
    <thead><tr>
      <th scope="col">{ko ? "객실 타입" : "Room type"}</th>
      <th scope="col">{ko ? "객실 배정" : "Assignment"}</th>
      <th scope="col">{ko ? "숙박 기간" : "Stay period"}</th>
      <th scope="col">{t.rooms}</th>
      <th scope="col">{ko ? "실당 인원" : "Guests / room"}</th>
      <th scope="col">{t.rate}</th>
      <th scope="col">{t.amount}</th>
    </tr></thead>
    <tbody>{body.lines.map((line) => {
      const ids = [...new Set(line.roomIds ?? [])].slice(0, line.rooms);
      const assigned = ids.length;
      const roomNames = ids.flatMap((id) => {
        const name = (locked ? line.roomLabels?.[id] : undefined) || roomNoOf(id) || line.roomLabels?.[id];
        return name ? [{ id, name }] : [];
      });
      const varied = line.nightAmounts?.some((cell) => cell.amount !== line.nightAmounts?.[0]?.amount);
      return <Fragment key={line.id}>
        <tr className="quote-doc-item" data-quote-color={line.color}>
          <th scope="row">{lineName(line)}</th>
          <td>{assigned === 0 ? (ko ? "미배정" : "Room TBD") :
            assigned === line.rooms ? (ko ? "배정 완료" : "Assigned") : (ko ? "일부 배정" : "Partially assigned")}
            {assigned > 0 && <small>{ko ? `${assigned}/${line.rooms}실` : `${assigned}/${line.rooms} rooms`}</small>}
            {roomNames.length > 0 && <div className="quote-doc-room-list">
              {roomNames.map(({ id, name }) => <span key={id}>{name}</span>)}
            </div>}
            {assigned > roomNames.length && <small>{ko ? "일부 호실 번호 정보 없음" : "Some room numbers unavailable"}</small>}
          </td>
          <td>{stayLabel(line)}</td>
          <td>{line.rooms}</td>
          <td>{line.pax}</td>
          <td>{varied ? (ko ? "날짜별" : "By date") : won(line.rate)}</td>
          <td>{won(line.amount)}</td>
        </tr>
        {varied && <tr className="quote-doc-night-row" data-quote-color={line.color}><td colSpan={7}>
          <ul>{line.nightAmounts?.map((cell) => <li key={cell.date}>{formatIssuanceNightDate(cell.date, lang)} <b>{won(cell.amount)}</b></li>)}</ul>
        </td></tr>}
      </Fragment>;
    })}</tbody>
    <tfoot>{totalRows()}</tfoot>
  </table>;
  const documentFooter = () => <div className="quote-doc-footer">
    {(body.notes || body.lines.some((line) => line.detail)) && <section>
      <h2>{ko ? "견적서 첨부 메모" : "Attached notes"}</h2>
      {body.notes && <p>{body.notes}</p>}
      {body.lines.filter((line) => line.detail).map((line) => <p key={line.id}>{lineName(line)} · {line.detail}</p>)}
    </section>}
    <p>{t.attest}</p>
    <div>{trade} · {t.representativeShort} {biz.representative || "____________"} <span>{t.seal}</span></div>
  </div>;
  const updateContact = (name: keyof QuoteContacts, value: string) =>
    setDraft((current) => ({ ...current, contacts: { ...current.contacts, [name]: value } }));
  const draftForSave = (): QuoteDraft => ({
    ...draft,
    showRoomNos: true,
    contacts: { ...draft.contacts, supplierAddress: draft.contacts?.supplierAddress || biz.address },
    lines: draft.lines.map((line) => ({
      ...line,
      roomLabels: Object.fromEntries((line.roomIds ?? []).flatMap((id) => {
        const label = roomNoOf(id) ?? line.roomLabels?.[id];
        return label ? [[id, label]] : [];
      })),
    })),
  });

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
    if (editedItems.current &&
      !(await askConfirm({ title: "템플릿을 적용할까요?", body: "현재 객실 내역과 부가세 설정을 템플릿 내용으로 바꿔요.",
        confirmLabel: "템플릿 적용", cancelLabel: "돌아가기" }))) return;
    setDraft((current) => {
      const start = current.checkIn ?? today;
      return withQuoteLines({ ...current, checkIn: start, taxMode: normalizeQuoteTaxMode(template.taxMode), showRoomNos: template.showRoomNos }, quoteTemplateLines(template, start));
    });
    setActiveTemplate(template.id);
    editedItems.current = true;
    setTemplateName(template.name);
    setErr(null);
    clientInput.current?.focus();
  };

  const onCompose = !locked && !previewOpen;
  useEffect(() => {
    if (!onCompose && slide.current) slide.current.scrollTop = 0;
  }, [onCompose]);
  const requestClose = async () => {
    if (busy) return;
    if (!locked && draftState !== savedState.current && !(await askConfirm({
      title: "작성 중인 견적을 닫을까요?",
      body: "임시저장하지 않은 변경이 있어요.",
      confirmLabel: "저장하지 않고 닫기",
      cancelLabel: "계속 작성",
    }))) return;
    onClose();
  };

  const save = async () => {
    const v = validateQuoteDraft(draft);
    if (v) return setErr(v);
    setErr(null);
    try {
      const saved = await onSaveDraft(draftForSave(), doc?.id);
      setDoc(saved);
      savedState.current = draftState;
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
      const saved = await onIssue(draftForSave(), doc?.id);
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
    <div className="dim quote-dim" role="presentation">
      <div className="modal quote-letter quote-template-letter" role="dialog" aria-modal="true" aria-labelledby="quote-title">
        <div className="mh noprint">
          <h2 id="quote-title">{t.title}</h2>
          {doc?.status === "issued" ? <span className="tag">{QUOTE_COPY.issued}</span> : null}
          {!locked && onOpenRateSettings && <button type="button" className="btn dark sm quote-open-type-rates" onClick={onOpenRateSettings}>
            타입별 요금 설정
          </button>}
          {!locked && onOpenDrafts && <button type="button" className="btn line sm" onClick={async () => {
            if (draftState !== savedState.current && !(await askConfirm({
              title: "다른 임시저장 견적을 열까요?", body: "현재 견적에서 저장하지 않은 변경은 사라질 수 있어요.",
              confirmLabel: "임시저장 목록 열기", cancelLabel: "계속 작성",
            }))) return;
            onOpenDrafts();
          }}>임시저장 견적 열기</button>}
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
          <button type="button" className="x" onClick={() => void requestClose()} disabled={busy} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className="quote-slide noprint" ref={slide}>
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
              <div className="iss-form quote-core-fields">
                <label>
                  {QUOTE_COPY.client}
                  <input
                    className="inp"
                    ref={clientInput}
                    value={draft.clientName}
                    onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
                  />
                </label>
                <label>수신처 연락처
                  <input className="inp" type="tel" value={draft.clientPhone} onChange={(e) => setDraft((d) => ({ ...d, clientPhone: e.target.value }))} />
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
                <summary>수신처·사업자 정보</summary>
                <div className="iss-form">
                  {([
                    ["contact", "수신처 담당자"], ["email", "수신처 이메일"], ["address", "수신처 주소"],
                    ["businessNumber", "수신처 사업자등록번호"], ["businessAddress", "수신처 사업장 주소"], ["supplierAddress", "공급자 사업장 주소"],
                  ] as const).map(([name, label]) => <label key={name}>{label}
                    <input className="inp" maxLength={QUOTE_CONTACT_FIELDS[name]} value={draft.contacts?.[name] ?? ""}
                      placeholder={name === "supplierAddress" ? biz.address : undefined} onChange={(e) => updateContact(name, e.target.value)} />
                  </label>)}
                  <label>견적 제목
                    <input className="inp" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                  </label>
                  <label>유효기간
                    <input className="inp" type="date" value={draft.validUntil ?? ""} onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value || null }))} />
                  </label>
                </div>
              </details>
              <QuoteItemsEditor settings={s} bookings={bookings} start={draft.checkIn ?? today} lines={draft.lines}
                onChange={(lines) => {
                  editedItems.current = true;
                  setDraft((d) => withQuoteLines(d, lines));
                }} />
              <details className="quote-extra-fields quote-attached-note">
                <summary>견적서 첨부 메모{draft.notes.trim() ? " · 입력됨" : ""}</summary>
                <textarea className="inp" aria-label="견적서 첨부 메모" rows={3} maxLength={QUOTE_NOTES_MAX} value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
              </details>
            </div>
          ) : (
            <div className="quote-print-slide quote-document">
              {documentHeader()}
              {documentTable()}
              {documentFooter()}
            </div>
          )}
        </div>

        <div className="quote-print iss-print-src quote-document" aria-hidden>
          {documentHeader()}
          {documentTable()}
          {documentFooter()}
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
          {err ? <p className="warn sm">{err}</p> : null}
          <p className="fine">{locked ? QUOTE_COPY.tip : hotelBizHasAny(biz) ? QUOTE_COPY.tip : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}</p>
          <div className="keys acts">
            {!locked ? (
              <>
                <button type="button" className="btn line sm" onClick={() => setPreviewOpen(onCompose)}>{onCompose ? "미리보기" : "작성으로 돌아가기"}</button>
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
          <button type="button" className="btn" onClick={() => void requestClose()} disabled={busy}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

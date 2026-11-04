/**
 * 견적서 작성·발급·인쇄: 항목별 숙박일·타입·요금, 선택 호실, 세금, 유효기간을 기록해요.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Copy, FileDown, Plus, Printer, Trash2, X } from "lucide-react";
import {
  type QuoteDoc,
  type QuoteDraft,
  type QuoteLine,
  QUOTE_COPY,
  QUOTE_NOTES_MAX,
  emptyQuoteLine,
  freezeQuoteSnapshot,
  quoteLinePrintLabel,
  quotePriceSummary,
  quotePrintStrings,
  QUOTE_LINES_MAX,
  normalizeQuoteTaxMode,
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
import { resolveStayRates } from "../shared/salesCalendar";

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

function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function quoteNumber(id: string | undefined, createdAt: string | undefined, fallbackDate: string): string {
  if (!id) return "발급 후 부여";
  const day = (createdAt || fallbackDate).slice(0, 10).replaceAll("-", "");
  return `Q-${day}-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

function QuoteTaxRows({ summary, mode, lang }: { summary: ReturnType<typeof quotePriceSummary>; mode: "included" | "excluded" | "exempt"; lang: PrintLang }) {
  const ko = lang === "ko";
  return (
    <>
      <tr>
        <th colSpan={6}>{ko ? "공급가액" : "Subtotal"}</th>
        <td>{won(summary.supplyAmount)}</td>
      </tr>
      <tr>
        <th colSpan={6}>{mode === "exempt" ? (ko ? "부가세 (면세)" : "VAT (exempt)") : ko ? `부가세 (${mode === "included" ? "포함" : "별도"})` : `VAT (${mode})`}</th>
        <td>{won(summary.vatAmount)}</td>
      </tr>
      <tr>
        <th colSpan={6}>{ko ? "최종 견적 금액" : "Total due"}</th>
        <td>{won(summary.grandTotal)}</td>
      </tr>
    </>
  );
}

function draftFromDoc(doc: QuoteDoc | null | undefined, today: string, defaultTypeId: string): QuoteDraft {
  if (!doc) {
    return {
      title: "",
      clientName: "",
      clientPhone: "",
      notes: "",
      validUntil: plusDays(today, 7),
      taxMode: "included",
      checkIn: today,
      nights: 1,
      guestCount: 2,
      lines: [{ ...emptyQuoteLine(defaultTypeId), checkIn: today }],
      showRoomNos: true,
    };
  }
  return {
    title: doc.title,
    clientName: doc.clientName,
    clientPhone: doc.clientPhone,
    notes: doc.notes,
    validUntil: doc.validUntil || plusDays(today, 7),
    taxMode: normalizeQuoteTaxMode(doc.taxMode),
    checkIn: doc.checkIn,
    nights: doc.nights,
    guestCount: doc.guestCount,
    lines: doc.lines.length ? doc.lines.map((l) => ({ ...l, checkIn: l.checkIn || doc.checkIn, roomIds: l.roomIds?.slice() ?? [] })) : [{ ...emptyQuoteLine(defaultTypeId), checkIn: doc.checkIn || today }],
    showRoomNos: doc.showRoomNos,
  };
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
  const total = locked && doc?.snapshot ? doc.snapshot.total : quotePriceSummary(draft.lines, draft.taxMode).grandTotal;
  const priceSummary = quotePriceSummary(body.lines, body.taxMode);
  const taxMode = normalizeQuoteTaxMode(body.taxMode);
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
          if (patch.typeId !== l.typeId) next.roomIds = [];
        }
        if (patch.nightAmounts) {
          next.rate = unitRateFromCells(patch.nightAmounts, 0, next.nights);
          next.amount = quoteAmountFromNightCells(next.rooms, patch.nightAmounts);
        } else if (patch.rooms != null && next.nightAmounts?.length) {
          next.amount = quoteAmountFromNightCells(next.rooms, next.nightAmounts);
        }
        if (patch.rooms != null) next.roomIds = (next.roomIds ?? []).slice(0, Math.max(0, next.rooms));
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
        const dateCells = quoteLineNightCells({ checkIn, nights, rate: 0 });
        const oldAmounts = new Map((l.nightAmounts ?? []).map((cell) => [cell.date, cell.amount]));
        const nightAmounts = cells ?? dateCells.map((cell) => ({
          ...cell,
          amount: oldAmounts.get(cell.date) ?? Math.max(0, Math.round(l.rate) || 0),
        }));
        return {
          ...l,
          checkIn,
          nights,
          nightAmounts,
          rate: unitRateFromCells(nightAmounts, 0, nights),
          amount: quoteAmountFromNightCells(l.rooms, nightAmounts),
        };
      });
      return {
        ...d,
        lines,
        nights: Math.max(1, ...lines.map((l) => l.nights || 0), d.nights || 1),
      };
    });
  };

  const splitLineByRoom = (line: QuoteLine) => {
    if (draft.lines.length + Math.max(0, line.rooms - 1) > QUOTE_LINES_MAX) {
      setErr(`객실별 단가로 나누면 항목이 ${QUOTE_LINES_MAX}줄을 넘어요. 먼저 다른 항목을 정리해 주세요.`);
      return;
    }
    const cells = line.nightAmounts?.length
      ? line.nightAmounts
      : quoteLineNightCells({
          checkIn: line.checkIn || draft.checkIn || today,
          nights: line.nights || 1,
          rate: line.rate,
          roomTotal: line.rate * Math.max(1, line.nights),
        });
    const ids = line.roomIds ?? [];
    const separate = Array.from({ length: Math.max(1, line.rooms) }, (_, i) => ({
      ...line,
      id: i === 0 ? line.id : crypto.randomUUID(),
      rooms: 1,
      roomIds: ids[i] ? [ids[i]!] : [],
      nightAmounts: cells.map((cell) => ({ ...cell })),
      rate: unitRateFromCells(cells, 0, line.nights),
      amount: quoteAmountFromNightCells(1, cells),
    }));
    setDraft((d) => ({
      ...d,
      lines: d.lines.flatMap((row) => (row.id === line.id ? separate : [row])),
      showRoomNos: d.showRoomNos || ids.length > 0,
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
    if (draft.validUntil && draft.validUntil < today) return setErr("견적 유효기간이 지났어요. 유효기간을 다시 설정해 주세요.");
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
                  견적 제목·행사명
                  <input
                    className="inp"
                    value={draft.title}
                    maxLength={80}
                    placeholder="예: 11월 공연팀 숙박 견적"
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                </label>
                <label>
                  견적 받는 곳·담당자
                  <input
                    className="inp"
                    value={draft.clientName}
                    maxLength={60}
                    onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
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
                <label>
                  견적 유효기간
                  <input
                    className="inp"
                    type="date"
                    min={today}
                    value={draft.validUntil || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value || null }))}
                  />
                </label>
                <label>
                  부가세 기준
                  <select className="inp" value={normalizeQuoteTaxMode(draft.taxMode)} onChange={(e) => setDraft((d) => ({ ...d, taxMode: normalizeQuoteTaxMode(e.target.value) }))}>
                    <option value="included">부가세 포함</option>
                    <option value="excluded">부가세 별도 (10%)</option>
                    <option value="exempt">면세</option>
                  </select>
                </label>
                <label className="iss-notes">
                  견적 조건·안내사항
                  <textarea className="inp iss-notes-inp" rows={3} maxLength={QUOTE_NOTES_MAX} placeholder="부가세 포함/별도, 결제 조건, 포함 사항, 취소·변경 기준 등을 입력하세요" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
                </label>
              </div>
              <p className="muted sm">항목마다 입실일·객실 타입·객실 수·호실 배정·박별 단가와 합계를 관리해요. 날짜별 수량이 달라지면 항목을 나누고, 호실별 단가가 다르면 ‘객실별 단가로 나누기’를 사용하세요.</p>

              <div className="quote-lines">
                <div className="quote-lines-h">
                  <strong>{QUOTE_COPY.lines}</strong>
                  <button
                    type="button"
                    className="btn line sm"
                    onClick={() => {
                      const base = emptyQuoteLine(defaultTypeId);
                      const ci = draft.lines.at(-1)?.checkIn || draft.checkIn || today;
                      const n = Math.max(1, draft.lines.at(-1)?.nights || draft.nights || 1);
                      const newLine = { ...base, checkIn: ci, nights: n, nightAmounts: quoteLineNightCells({ checkIn: ci, nights: n, rate: 0 }) };
                      setDraft((d) => ({
                        ...d,
                        lines: [...d.lines, newLine],
                        checkIn: ci,
                        nights: n,
                      }));
                    }}
                  >
                    <Plus size={14} /> {QUOTE_COPY.addLine}
                  </button>
                </div>
                {draft.lines.map((l, lineIndex) => {
                  const lineCi = l.checkIn || draft.checkIn || today;
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
                      <div className="quote-line-head"><strong>객실 내역 {String(lineIndex + 1).padStart(2, "0")}</strong></div>
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
                              : lineCi;
                          setLineStay(l.id, nextCi, nn, nightAmounts);
                        }}
                        onRemove={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}
                      />
                      <div className="quote-line-period">
                        <label>
                          입실일
                          <input className="inp sm" type="date" value={lineCi} onChange={(e) => e.target.value && setLineStay(l.id, e.target.value, Math.max(1, l.nights || draft.nights || 1))} />
                        </label>
                        <label>
                          박수
                          <input className="inp sm" type="number" min={1} max={365} value={Math.max(1, l.nights || draft.nights || 1)} onChange={(e) => setLineStay(l.id, lineCi, Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="btn line sm quote-load-type-rates"
                        onClick={() => {
                          const rates = resolveStayRates(s, l.typeId || defaultTypeId, lineCi, Math.max(1, l.nights || draft.nights || 1));
                          if (!rates.some((rate) => rate.amount > 0)) {
                            notify("이 객실 타입과 기간에 설정된 요금이 없어요. 발급 화면의 ‘객실 타입별 요금 설정’에서 먼저 입력해 주세요.");
                            return;
                          }
                          setLineStay(l.id, lineCi, Math.max(1, l.nights || draft.nights || 1), rates.map(({ date, amount }) => ({ date, amount })));
                        }}
                      >
                        객실 타입 설정 요금 불러오기
                      </button>
                      <div className="quote-room-assign">
                        <details open={!!l.roomIds?.length}>
                          <summary>호실 배정 · {l.roomIds?.length ? `${l.roomIds.length}/${l.rooms}실 지정` : "미정"}</summary>
                          <div className="quote-room-assign-list" role="group" aria-label={`${typeLabel(types.find((t) => t.id === l.typeId)) || "객실 타입"} 호실 배정`}>
                            {allRooms(s).filter((room) => room.typeId === (l.typeId || defaultTypeId)).length ? (
                              allRooms(s).filter((room) => room.typeId === (l.typeId || defaultTypeId)).map((room) => {
                                const selected = (l.roomIds ?? []).includes(room.id);
                                const full = (l.roomIds?.length ?? 0) >= Math.max(1, l.rooms);
                                return (
                                  <label key={room.id}>
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={!selected && full}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...(l.roomIds ?? []), room.id]
                                          : (l.roomIds ?? []).filter((id) => id !== room.id);
                                        patchLine(l.id, { roomIds: next });
                                        if (next.length) setDraft((d) => ({ ...d, showRoomNos: true }));
                                      }}
                                    />
                                    <span>{room.no}호</span>
                                  </label>
                                );
                              })
                            ) : <span className="muted sm">이 타입에 등록된 호실이 없어 미정으로 견적을 작성해요.</span>}
                            {l.roomIds?.length ? <button type="button" className="btn line sm" onClick={() => patchLine(l.id, { roomIds: [] })}>배정 초기화</button> : null}
                          </div>
                        </details>
                      </div>
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
                      {l.rooms > 1 ? (
                        <button type="button" className="btn line sm quote-split-rooms" onClick={() => splitLineByRoom(l)}>
                          <Copy size={14} /> 객실별 단가로 나누기
                        </button>
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
                  <p className="quote-doc-purpose">{body.title || "숙박 견적"}</p>
                  <dl className="sc-body">
                    <div>
                      <dt>{t.client}</dt>
                      <dd>
                        {body.clientName || "—"}
                        {body.clientPhone ? ` · ${body.clientPhone}` : null}
                      </dd>
                    </div>
                    {body.guestCount ? <div><dt>총 인원</dt><dd>{t.guests(body.guestCount)}</dd></div> : null}
                    <div>
                      <dt>견적번호</dt>
                      <dd>{quoteNumber(doc?.id, doc?.createdAt, today)}</dd>
                    </div>
                    {body.validUntil ? (
                      <div>
                        <dt>유효기간</dt>
                        <dd>{printDateLabel(lang, body.validUntil, dayLabel)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>부가세 기준</dt>
                      <dd>{taxMode === "included" ? "부가세 포함" : taxMode === "excluded" ? "부가세 별도" : "면세"}</dd>
                    </div>
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
                    <th>{t.checkIn}</th>
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
                        <td>{l.checkIn || body.checkIn ? printDateLabel(lang, l.checkIn || body.checkIn!, dayLabel) : "—"}</td>
                        <td>{quoteLinePrintLabel(l, showRoomNos, roomNoOf, lang)}</td>
                        <td>{l.rooms}</td>
                        <td>{l.nights}</td>
                        <td>{l.pax}</td>
                        <td>{l.nights > 1 ? "날짜별" : won(l.rate)}</td>
                        <td>{won(l.amount)}</td>
                      </tr>
                      {l.nightAmounts && l.nightAmounts.length > 1 ? (
                        <tr className="inv-night-row">
                          <td colSpan={7}>
                            <ul className="inv-night-list">
                              {l.nightAmounts.map((c) => (
                                <li key={c.date}>
                                  <span>{formatIssuanceNightDate(c.date, lang)}</span>
                                  <strong>{won(c.amount)} × {l.rooms}실 = {won(c.amount * l.rooms)}</strong>
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
                    <QuoteTaxRows summary={priceSummary} mode={taxMode} lang={lang} />
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
          <p className="quote-doc-purpose">{body.title || "숙박 견적"}</p>
          <dl className="sc-body">
            <div>
              <dt>{t.client}</dt>
              <dd>
                {body.clientName || "—"}
                {body.clientPhone ? ` · ${body.clientPhone}` : null}
              </dd>
            </div>
            {body.guestCount ? <div><dt>총 인원</dt><dd>{t.guests(body.guestCount)}</dd></div> : null}
            <div>
              <dt>견적번호</dt>
              <dd>{quoteNumber(doc?.id, doc?.createdAt, today)}</dd>
            </div>
            {body.validUntil ? (
              <div>
                <dt>유효기간</dt>
                <dd>{printDateLabel(lang, body.validUntil, dayLabel)}</dd>
              </div>
            ) : null}
            <div>
              <dt>부가세 기준</dt>
              <dd>{taxMode === "included" ? "부가세 포함" : taxMode === "excluded" ? "부가세 별도" : "면세"}</dd>
            </div>
          </dl>
          <table className="quote-tbl">
            <thead>
              <tr>
                <th>{t.checkIn}</th>
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
                  <td>{l.checkIn || body.checkIn ? printDateLabel(lang, l.checkIn || body.checkIn!, dayLabel) : "—"}</td>
                  <td>
                    {quoteLinePrintLabel(l, showRoomNos, roomNoOf, lang)}
                    {l.nightAmounts && l.nightAmounts.length > 1 ? (
                      <ul className="inv-night-list print-inline">
                        {l.nightAmounts.map((c) => (
                          <li key={c.date}>
                            {formatIssuanceNightDate(c.date, lang)} {won(c.amount)} × {l.rooms} {lang === "en" ? "rooms" : "실"} = {won(c.amount * l.rooms)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td>{l.rooms}</td>
                  <td>{l.nights}</td>
                  <td>{l.pax}</td>
                  <td>{l.nights > 1 ? "날짜별" : won(l.rate)}</td>
                  <td>{won(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <QuoteTaxRows summary={priceSummary} mode={taxMode} lang={lang} />
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

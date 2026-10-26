/**
 * 청구서 미리보기·발급·인쇄 (P1.2a) — 실이용 settle 스냅샷
 */
import { useMemo, useState } from "react";
import { FileDown, Printer, X } from "lucide-react";
import {
  type InvoiceDoc,
  type InvoiceSnapshot,
  INVOICE_COPY,
  buildInvoiceSnapshot,
  defaultInvoicePayer,
  invoiceEligible,
  invoiceIsMidStay,
  invoicePayLabel,
  invoicePrintStrings,
  invoiceRoomDisplay,
  invoiceSurchargeLabel,
  validateInvoicePayer,
} from "../shared/invoiceDoc";
import {
  type Booking,
  dayLabel,
  hotelBizDisplayName,
  hotelBizFieldLabels,
  hotelBizHasAny,
  hotelBizUpjongUptaeLine,
  printDateLabel,
  won,
  type HotelSettings,
  type PrintLang,
} from "../shared/ledger";
import { type GroupInfo, emptyGroupInfo } from "../shared/settle";
import { buildQuoteCompare, type QuoteCompare } from "../shared/quoteVariance";
import { askConfirm } from "./ConfirmDialog";
import { lookups } from "./ui";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  members: Booking[];
  groupId?: string | null;
  groupInfo?: GroupInfo | null;
  /** 이미 발급된 기록 재인쇄 */
  issuedDoc?: InvoiceDoc | null;
  /** P1.3 linked quote (live) — frozen into snapshot on issue */
  linkedQuote?: { id: string; title: string; total: number } | null;
  busy?: boolean;
  onIssue: (args: {
    payerName: string;
    payerPhone: string;
    snapshot: InvoiceSnapshot;
    groupId: string | null;
    bookingIds: string[];
    isMidStay: boolean;
  }) => Promise<InvoiceDoc>;
  onClose: () => void;
  notify: (m: string) => void;
}

function runPrint(title: string) {
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add("print-invoice");
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-invoice");
    document.title = prevTitle;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  window.setTimeout(done, 1500);
}

export default function InvoiceLetter({
  hotelName,
  s,
  today,
  members,
  groupId,
  groupInfo,
  issuedDoc,
  linkedQuote,
  busy,
  onIssue,
  onClose,
  notify,
}: Props) {
  const L = lookups(s);
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const info = groupInfo ?? (groupId ? emptyGroupInfo(groupId) : null);
  const first = members[0];
  const plat = first ? L.plats.get(first.platformId) : undefined;
  const defaults = defaultInvoicePayer(members, info);
  const [payerName, setPayerName] = useState(issuedDoc?.snapshot?.payerName ?? issuedDoc?.payerName ?? defaults.payerName);
  const [payerPhone, setPayerPhone] = useState(issuedDoc?.snapshot?.payerPhone ?? issuedDoc?.payerPhone ?? defaults.payerPhone);
  const [doc, setDoc] = useState<InvoiceDoc | null>(issuedDoc ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<PrintLang>("ko");
  const t = invoicePrintStrings(lang);
  const locked = doc?.status === "issued" && !!doc.snapshot;

  const liveSnap = useMemo(() => {
    if (locked && doc?.snapshot) return doc.snapshot;
    const base = buildInvoiceSnapshot({
      s,
      members,
      info,
      plat,
      payerName,
      payerPhone,
      issueNumber: doc?.issueNumber ?? "····-···",
      issuedAt: new Date().toISOString(),
    });
    const quoteCompare: QuoteCompare | null = linkedQuote
      ? buildQuoteCompare({
          quoteId: linkedQuote.id,
          quoteTitle: linkedQuote.title,
          quoteTotal: linkedQuote.total,
          invoiceTotal: base.total,
        })
      : null;
    return { ...base, quoteCompare };
  }, [locked, doc, s, members, info, plat, payerName, payerPhone, linkedQuote]);

  const eligible = invoiceEligible(members);
  const mid = locked ? !!liveSnap.isMidStay : invoiceIsMidStay(members.filter((b) => b.status !== "cancelled"));
  const fileTitle = `${trade}_${t.title}_${liveSnap.issueNumber || payerName || (lang === "en" ? "Invoice" : "청구")}`;

  const issue = async () => {
    if (!eligible) return setErr(INVOICE_COPY.needNights);
    const v = validateInvoicePayer(payerName, payerPhone);
    if (v) return setErr(v);
    const ok = await askConfirm({
      title: INVOICE_COPY.confirmIssueTitle,
      body: INVOICE_COPY.confirmIssueBody,
      confirmLabel: INVOICE_COPY.issue,
      cancelLabel: INVOICE_COPY.close,
    });
    if (!ok) return;
    setErr(null);
    try {
      const snapBase = buildInvoiceSnapshot({
        s,
        members,
        info,
        plat,
        payerName,
        payerPhone,
        issueNumber: "pending",
        issuedAt: new Date().toISOString(),
      });
      const quoteCompare = linkedQuote
        ? buildQuoteCompare({
            quoteId: linkedQuote.id,
            quoteTitle: linkedQuote.title,
            quoteTotal: linkedQuote.total,
            invoiceTotal: snapBase.total,
          })
        : null;
      const saved = await onIssue({
        payerName,
        payerPhone,
        snapshot: { ...snapBase, quoteCompare },
        groupId: groupId ?? null,
        bookingIds: members.filter((b) => b.status !== "cancelled").map((b) => b.id),
        isMidStay: mid,
      });
      setDoc(saved);
      notify(INVOICE_COPY.issueOk);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "발급 실패");
    }
  };

  return (
    <div className="dim invoice-dim" role="presentation" onClick={onClose}>
      <div
        className="modal invoice-letter"
        role="dialog"
        aria-labelledby="invoice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh noprint">
          <h2 id="invoice-title">{t.title}</h2>
          {locked ? <span className="tag">{INVOICE_COPY.issued}</span> : null}
          {mid ? <span className="tag warn">{t.midWatermark}</span> : null}
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
          <div className="invoice-form noprint">
            <div className="iss-form">
              <label className="wide">
                {INVOICE_COPY.payer}
                <input className="inp" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
              </label>
              <label>
                {INVOICE_COPY.payerPhone}
                <input className="inp" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
              </label>
            </div>
            {!eligible ? <p className="warn sm">{INVOICE_COPY.needNights}</p> : null}
            <p className="muted sm">{INVOICE_COPY.notDamage}</p>
          </div>
        ) : null}

        <div className={`invoice-print${mid ? " mid" : ""}${lang === "en" ? " en" : ""}`}>
          {mid ? <div className="inv-watermark">{t.midWatermark}</div> : null}
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
            <div className="inv-title-block">
              <h1 className="sc-title">{t.title}</h1>
              {liveSnap.issueNumber && liveSnap.issueNumber !== "····-···" ? (
                <div className="inv-no">
                  {t.issueNo} {liveSnap.issueNumber}
                </div>
              ) : null}
            </div>
          </header>

          <dl className="sc-body">
            <div>
              <dt>{t.payer}</dt>
              <dd>
                {liveSnap.payerName || "—"}
                {liveSnap.payerPhone ? ` · ${liveSnap.payerPhone}` : null}
              </dd>
            </div>
            {liveSnap.groupName ? (
              <div>
                <dt>{t.group}</dt>
                <dd>{liveSnap.groupName}</dd>
              </div>
            ) : null}
          </dl>

          <table className="quote-tbl inv-tbl">
            <thead>
              <tr>
                <th>{t.room}</th>
                <th>{t.period}</th>
                <th>{t.amount}</th>
                <th>{t.paid}</th>
              </tr>
            </thead>
            <tbody>
              {liveSnap.rooms.map((r) => (
                <tr key={r.bookingId}>
                  <td>
                    {invoiceRoomDisplay(r.roomNo, lang, t.roomSuffix)}
                    {r.typeLabel ? ` · ${r.typeLabel}` : ""}
                    {r.guestName ? <div className="muted sm">{r.guestName}</div> : null}
                  </td>
                  <td>
                    {printDateLabel(lang, r.checkIn, dayLabel)} ~ {printDateLabel(lang, r.checkOut, dayLabel)} ·{" "}
                    {t.nights(r.nights)}
                  </td>
                  <td>{won(r.amount)}</td>
                  <td>{won(r.paid)}</td>
                </tr>
              ))}
              {liveSnap.surcharges.map((x, i) => (
                <tr key={`s-${i}`}>
                  <td colSpan={2}>{invoiceSurchargeLabel(x.label, lang)}</td>
                  <td>{won(x.amount)}</td>
                  <td />
                </tr>
              ))}
              {liveSnap.extras.map((x, i) => (
                <tr key={`e-${i}`}>
                  <td colSpan={2}>
                    {t.extras}: {x.name}
                  </td>
                  <td>{won(x.amount)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>{t.total}</th>
                <th>{won(liveSnap.total)}</th>
                <th />
              </tr>
              <tr>
                <th colSpan={2}>{t.paid}</th>
                <th>{won(liveSnap.paid)}</th>
                <th />
              </tr>
              {liveSnap.tracked && liveSnap.left > 0 ? (
                <tr>
                  <th colSpan={2}>{t.left}</th>
                  <th>{won(liveSnap.left)}</th>
                  <th />
                </tr>
              ) : null}
            </tfoot>
          </table>

          {liveSnap.quoteCompare ? (
            <div className="inv-quote-cmp">
              <div className="inv-pays-h">
                {t.quoteCompare}
                {liveSnap.quoteCompare.quoteTitle ? (
                  <span className="muted sm"> · {liveSnap.quoteCompare.quoteTitle}</span>
                ) : null}
              </div>
              <table className="quote-tbl inv-cmp-tbl">
                <tbody>
                  <tr>
                    <td>{t.quoteTotal}</td>
                    <td>{won(liveSnap.quoteCompare.quoteTotal)}</td>
                  </tr>
                  <tr>
                    <td>{t.invoiceTotal}</td>
                    <td>{won(liveSnap.quoteCompare.invoiceTotal)}</td>
                  </tr>
                  <tr>
                    <th>{t.quoteDiff}</th>
                    <th>
                      {liveSnap.quoteCompare.diff === 0
                        ? t.quoteSame
                        : `${liveSnap.quoteCompare.diff > 0 ? t.quoteOver : t.quoteUnder} ${won(Math.abs(liveSnap.quoteCompare.diff))}`}
                    </th>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          {liveSnap.payments.length ? (
            <div className="inv-pays">
              <div className="inv-pays-h">{t.payments}</div>
              <ul>
                {liveSnap.payments.map((p, i) => (
                  <li key={i}>
                    {printDateLabel(lang, p.bizDate, dayLabel)} · {invoicePayLabel(p.method, lang)} {won(p.amount)}
                    {p.note ? ` (${p.note})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {liveSnap.footnotes.length ? (
            <div className="inv-notes">
              <div className="inv-pays-h">{t.footnotes}</div>
              <ul>
                {liveSnap.footnotes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}

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
          <p className="fine">
            {locked ? INVOICE_COPY.tip : hotelBizHasAny(biz) ? INVOICE_COPY.tipLive : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}
          </p>
          <div className="keys acts">
            {!locked ? (
              <button type="button" className="btn sm" disabled={busy || !eligible} onClick={() => void issue()}>
                {INVOICE_COPY.issue}
              </button>
            ) : null}
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)}>
              <Printer size={14} /> {t.print}
            </button>
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)} title={t.pdfHint}>
              <FileDown size={14} /> {t.pdf}
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

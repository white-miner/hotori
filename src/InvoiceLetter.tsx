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
  validateInvoicePayer,
} from "../shared/invoiceDoc";
import {
  type Booking,
  dayLabel,
  hotelBizDisplayName,
  hotelBizHasAny,
  won,
  type HotelSettings,
} from "../shared/ledger";
import { type GroupInfo, emptyGroupInfo } from "../shared/settle";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "../shared/payment";
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

function payLabel(method: string): string {
  return PAYMENT_METHOD_LABEL[method as PaymentMethod] ?? method;
}

export default function InvoiceLetter({
  hotelName,
  s,
  today,
  members,
  groupId,
  groupInfo,
  issuedDoc,
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
  const locked = doc?.status === "issued" && !!doc.snapshot;

  const liveSnap = useMemo(() => {
    if (locked && doc?.snapshot) return doc.snapshot;
    return buildInvoiceSnapshot({
      s,
      members,
      info,
      plat,
      payerName,
      payerPhone,
      issueNumber: doc?.issueNumber ?? "····-···",
      issuedAt: new Date().toISOString(),
    });
  }, [locked, doc, s, members, info, plat, payerName, payerPhone]);

  const eligible = invoiceEligible(members);
  const mid = locked ? !!liveSnap.isMidStay : invoiceIsMidStay(members.filter((b) => b.status !== "cancelled"));
  const fileTitle = `${trade}_${INVOICE_COPY.title}_${liveSnap.issueNumber || payerName || "청구"}`;

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
      const saved = await onIssue({
        payerName,
        payerPhone,
        snapshot: snapBase,
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
          <h2 id="invoice-title">{INVOICE_COPY.title}</h2>
          {locked ? <span className="tag">{INVOICE_COPY.issued}</span> : null}
          {mid ? <span className="tag warn">{INVOICE_COPY.midWatermark}</span> : null}
          <button type="button" className="x" onClick={onClose} aria-label={INVOICE_COPY.close}>
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

        <div className={`invoice-print${mid ? " mid" : ""}`}>
          {mid ? <div className="inv-watermark">{INVOICE_COPY.midWatermark}</div> : null}
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
            <div className="inv-title-block">
              <h1 className="sc-title">{INVOICE_COPY.title}</h1>
              {liveSnap.issueNumber && liveSnap.issueNumber !== "····-···" ? (
                <div className="inv-no">
                  {INVOICE_COPY.issueNo} {liveSnap.issueNumber}
                </div>
              ) : null}
            </div>
          </header>

          <dl className="sc-body">
            <div>
              <dt>{INVOICE_COPY.payer}</dt>
              <dd>
                {liveSnap.payerName || "—"}
                {liveSnap.payerPhone ? ` · ${liveSnap.payerPhone}` : null}
              </dd>
            </div>
            {liveSnap.groupName ? (
              <div>
                <dt>단체</dt>
                <dd>{liveSnap.groupName}</dd>
              </div>
            ) : null}
          </dl>

          <table className="quote-tbl inv-tbl">
            <thead>
              <tr>
                <th>{INVOICE_COPY.room}</th>
                <th>{INVOICE_COPY.period}</th>
                <th>{INVOICE_COPY.amount}</th>
                <th>{INVOICE_COPY.paid}</th>
              </tr>
            </thead>
            <tbody>
              {liveSnap.rooms.map((r) => (
                <tr key={r.bookingId}>
                  <td>
                    {r.roomNo}호{r.typeLabel ? ` · ${r.typeLabel}` : ""}
                    {r.guestName ? <div className="muted sm">{r.guestName}</div> : null}
                  </td>
                  <td>
                    {dayLabel(r.checkIn)} ~ {dayLabel(r.checkOut)} · {r.nights}박
                  </td>
                  <td>{won(r.amount)}</td>
                  <td>{won(r.paid)}</td>
                </tr>
              ))}
              {liveSnap.surcharges.map((x, i) => (
                <tr key={`s-${i}`}>
                  <td colSpan={2}>{x.label}</td>
                  <td>{won(x.amount)}</td>
                  <td />
                </tr>
              ))}
              {liveSnap.extras.map((x, i) => (
                <tr key={`e-${i}`}>
                  <td colSpan={2}>
                    {INVOICE_COPY.extras}: {x.name}
                  </td>
                  <td>{won(x.amount)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>{INVOICE_COPY.total}</th>
                <th>{won(liveSnap.total)}</th>
                <th />
              </tr>
              <tr>
                <th colSpan={2}>{INVOICE_COPY.paid}</th>
                <th>{won(liveSnap.paid)}</th>
                <th />
              </tr>
              {liveSnap.tracked && liveSnap.left > 0 ? (
                <tr>
                  <th colSpan={2}>{INVOICE_COPY.left}</th>
                  <th>{won(liveSnap.left)}</th>
                  <th />
                </tr>
              ) : null}
            </tfoot>
          </table>

          {liveSnap.payments.length ? (
            <div className="inv-pays">
              <div className="inv-pays-h">{INVOICE_COPY.payments}</div>
              <ul>
                {liveSnap.payments.map((p, i) => (
                  <li key={i}>
                    {dayLabel(p.bizDate)} · {payLabel(p.method)} {won(p.amount)}
                    {p.note ? ` (${p.note})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {liveSnap.footnotes.length ? (
            <div className="inv-notes">
              <div className="inv-pays-h">{INVOICE_COPY.footnotes}</div>
              <ul>
                {liveSnap.footnotes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="sc-attest">{INVOICE_COPY.attest}</p>
          <div className="sc-issue">
            {INVOICE_COPY.issueDate} {dayLabel(today)}
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
            {locked ? INVOICE_COPY.tip : hotelBizHasAny(biz) ? INVOICE_COPY.tipLive : "설정에 사업자 정보를 넣으면 헤더에 같이 인쇄돼요."}
          </p>
          <div className="keys acts">
            {!locked ? (
              <button type="button" className="btn sm" disabled={busy || !eligible} onClick={() => void issue()}>
                {INVOICE_COPY.issue}
              </button>
            ) : null}
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)}>
              <Printer size={14} /> {INVOICE_COPY.print}
            </button>
            <button type="button" className="btn line sm" onClick={() => runPrint(fileTitle)} title={INVOICE_COPY.pdfHint}>
              <FileDown size={14} /> {INVOICE_COPY.pdf}
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {INVOICE_COPY.close}
          </button>
        </div>
      </div>
    </div>
  );
}

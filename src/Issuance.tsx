/**
 * App 「발급」 — 서류함 hub (#/issuance)
 * P0 vault/배치도 + P1.1 견적 · P1.2a 청구 · P1.2b 손해 · 숙박확인서 → 장부
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardList,
  ExternalLink,
  FileDown,
  FileText,
  Landmark,
  LayoutGrid,
  Printer,
  Receipt,
  ScrollText,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import type { HotelData } from "./data";
import { useDamageIssues, useHotelDocuments, useInvoiceIssues, useQuoteIssues } from "./data";
import type { ToastOpt } from "./App";
import { askConfirm } from "./ConfirmDialog";
import FloorPlanPrint from "./FloorPlanPrint";
import QuoteLetter from "./QuoteLetter";
import InvoiceLetter from "./InvoiceLetter";
import DamageLetter from "./DamageLetter";
import {
  HOTEL_DOC_HUB_KINDS,
  HOTEL_DOC_KIND_LABEL,
  HOTEL_DOC_KINDS,
  ISSUANCE_COPY,
  hotelDocDisplayTitle,
  hotelDocFailMessage,
  hotelDocHubCopy,
  hotelDocPageTitle,
  hotelDocUploadOkMessage,
  isHotelDocKind,
  validateHotelDocFile,
  type HotelDocKind,
  type HotelDocument,
  hotelDocExpiryBadge,
} from "../shared/hotelDocuments";
import { QUOTE_COPY, type QuoteDoc } from "../shared/quoteDoc";
import { planQuoteTypeHoldBookings } from "../shared/quoteBookings";
import { INVOICE_COPY, type InvoiceDoc } from "../shared/invoiceDoc";
import { DAMAGE_COPY, type DamageDoc } from "../shared/damageDoc";
import { STAY_CONFIRM_COPY, businessDate, dayLabel } from "../shared/ledger";
import { ensureHotelBizReady } from "./hotelBizGate";

type Panel = "home" | "vault" | "floor" | "quote" | "invoice" | "damage";

function panelFromHash(): Panel {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "issuance") return "home";
  if (parts[1] === "vault") return "vault";
  if (parts[1] === "floor") return "floor";
  if (parts[1] === "quote") return "quote";
  if (parts[1] === "invoice") return "invoice";
  if (parts[1] === "damage") return "damage";
  return "home";
}

function kindFromHash(): HotelDocKind | null {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "issuance" || parts[1] !== "vault") return null;
  return isHotelDocKind(parts[2]) ? parts[2] : null;
}

function vaultIcon(kind: HotelDocKind) {
  if (kind === "bank_book") return <Landmark size={22} strokeWidth={2} aria-hidden />;
  if (kind === "business_license") return <BadgeCheck size={22} strokeWidth={2} aria-hidden />;
  if (kind === "operating_report") return <ScrollText size={22} strokeWidth={2} aria-hidden />;
  return <Shield size={22} strokeWidth={2} aria-hidden />;
}

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  notify: (m: string, opt?: ToastOpt) => void;
  onGoLedger: () => void;
}

export default function Issuance({ data, hotelId, today, notify, onGoLedger }: Props) {
  const docs = useHotelDocuments(hotelId);
  const quotes = useQuoteIssues(hotelId);
  const invoices = useInvoiceIssues(hotelId);
  const damages = useDamageIssues(hotelId);
  const [panel, setPanel] = useState<Panel>(panelFromHash);
  const [vaultKind, setVaultKind] = useState<HotelDocKind | null>(kindFromHash);
  const [floorOpen, setFloorOpen] = useState(() => panelFromHash() === "floor");
  const [quoteOpen, setQuoteOpen] = useState<QuoteDoc | "new" | null>(null);
  const [invoiceView, setInvoiceView] = useState<InvoiceDoc | null>(null);
  const [damageView, setDamageView] = useState<DamageDoc | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const hotel = data.hotel!;
  const s = hotel.settings;

  const requireBiz = () => ensureHotelBizReady(s.hotelBiz, hotel.name);

  const openQuote = async (doc: QuoteDoc | "new" = "new") => {
    if (!(await requireBiz())) return;
    setQuoteOpen(doc);
  };
  const openInvoiceView = async (doc: InvoiceDoc) => {
    if (!(await requireBiz())) return;
    setInvoiceView(doc);
  };
  const openDamageView = async (doc: DamageDoc) => {
    if (!(await requireBiz())) return;
    setDamageView(doc);
  };
  const goLedgerPrint = async () => {
    if (!(await requireBiz())) return;
    onGoLedger();
  };

  useEffect(() => {
    const on = () => {
      const p = panelFromHash();
      setPanel(p);
      setVaultKind(kindFromHash());
      if (p === "floor") setFloorOpen(true);
      if (p === "quote") void openQuote("new");
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hash sync only
  }, []);

  useEffect(() => {
    if (panelFromHash() === "quote") void openQuote("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount deep-link once
  }, []);

  const goPanel = (p: Panel, kind?: HotelDocKind | null) => {
    void (async () => {
      if (p === "quote" && !(await requireBiz())) return;
      let hash = "#/issuance";
      if (p === "vault") hash = kind ? `#/issuance/vault/${kind}` : "#/issuance/vault";
      else if (p === "floor") hash = "#/issuance/floor";
      else if (p === "quote") hash = "#/issuance/quote";
      else if (p === "invoice") hash = "#/issuance/invoice";
      else if (p === "damage") hash = "#/issuance/damage";
      if (location.hash !== hash) location.hash = hash;
      setPanel(p);
      if (p === "vault") setVaultKind(kind ?? null);
      if (p === "floor") setFloorOpen(true);
      if (p === "quote") setQuoteOpen((cur) => cur ?? "new");
    })();
  };

  type RecentItem =
    | { kind: "vault"; id: string; title: string; tag: string; at: string }
    | { kind: "quote"; id: string; title: string; tag: string; at: string; doc: QuoteDoc }
    | { kind: "invoice"; id: string; title: string; tag: string; at: string; doc: InvoiceDoc }
    | { kind: "damage"; id: string; title: string; tag: string; at: string; doc: DamageDoc };

  const recent = useMemo(() => {
    const items: RecentItem[] = [];
    for (const d of docs.list ?? []) {
      items.push({
        kind: "vault",
        id: d.id,
        title: hotelDocDisplayTitle(d.title),
        tag: HOTEL_DOC_KIND_LABEL[d.kind],
        at: d.createdAt,
      });
    }
    for (const q of quotes.list ?? []) {
      items.push({
        kind: "quote",
        id: q.id,
        title: q.clientName || q.title || QUOTE_COPY.title,
        tag: q.status === "issued" ? QUOTE_COPY.issued : QUOTE_COPY.draft,
        at: q.updatedAt,
        doc: q,
      });
    }
    for (const inv of invoices.list ?? []) {
      items.push({
        kind: "invoice",
        id: inv.id,
        title: inv.issueNumber ? `${inv.issueNumber} · ${inv.payerName || INVOICE_COPY.title}` : inv.payerName || INVOICE_COPY.title,
        tag: inv.isMidStay ? INVOICE_COPY.midWatermark : INVOICE_COPY.issued,
        at: inv.issuedAt || inv.createdAt,
        doc: inv,
      });
    }
    for (const dmg of damages.list ?? []) {
      items.push({
        kind: "damage",
        id: dmg.id,
        title: dmg.guestName || dmg.roomNo || DAMAGE_COPY.title,
        tag: DAMAGE_COPY.issued,
        at: dmg.issuedAt || dmg.createdAt,
        doc: dmg,
      });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return items.slice(0, 12);
  }, [docs.list, quotes.list, invoices.list, damages.list]);

  return (
    <main className="page issuance">
      <div className="page-head">
        <h1>
          {ISSUANCE_COPY.viewLabel} <span className="h1-sub">{ISSUANCE_COPY.viewSub}</span>
        </h1>
      </div>

      <section className="iss-types" aria-labelledby="iss-types-h">
        <h2 id="iss-types-h" className="iss-sec-h">
          {ISSUANCE_COPY.typesHeading}
        </h2>
        <div className="iss-grid">
          <button type="button" className="iss-card" onClick={() => void goLedgerPrint()}>
            <FileText size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{STAY_CONFIRM_COPY}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.stayConfirmHint}</span>
            <span className="iss-card-cta">
              {ISSUANCE_COPY.stayConfirmCta} <ExternalLink size={12} aria-hidden />
            </span>
          </button>
          <button type="button" className="iss-card" onClick={() => void goPanel("quote")}>
            <ClipboardList size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.quote}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.quoteHint}</span>
            <span className="iss-card-cta">{ISSUANCE_COPY.quoteCta}</span>
          </button>
          <button
            type="button"
            className="iss-card"
            onClick={() => {
              void (async () => {
                if (!(await requireBiz())) return;
                goPanel("invoice");
                onGoLedger();
              })();
            }}
          >
            <Receipt size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.invoice}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.invoiceHint}</span>
            <span className="iss-card-cta">
              {ISSUANCE_COPY.invoiceCta} <ExternalLink size={12} aria-hidden />
            </span>
          </button>
          <button
            type="button"
            className="iss-card"
            onClick={() => {
              void (async () => {
                if (!(await requireBiz())) return;
                goPanel("damage");
                onGoLedger();
              })();
            }}
          >
            <AlertTriangle size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.damage}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.damageHint}</span>
            <span className="iss-card-cta">
              {ISSUANCE_COPY.damageCta} <ExternalLink size={12} aria-hidden />
            </span>
          </button>
          <button type="button" className="iss-card" onClick={() => goPanel("floor")}>
            <LayoutGrid size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.floorPlan}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.floorPlanHint}</span>
            <span className="iss-card-cta">{ISSUANCE_COPY.floorPlanCta}</span>
          </button>
          {HOTEL_DOC_HUB_KINDS.map((k) => {
            const copy = hotelDocHubCopy(k);
            return (
              <button key={k} type="button" className="iss-card" onClick={() => goPanel("vault", k)}>
                {vaultIcon(k)}
                <span className="iss-card-t">{copy.title}</span>
                <span className="iss-card-s">{copy.hint}</span>
                <span className="iss-card-cta">{ISSUANCE_COPY.vaultCta}</span>
              </button>
            );
          })}
        </div>
      </section>

      {panel === "vault" ? (
        <VaultSection
          docs={docs}
          today={today}
          notify={notify}
          filterKind={vaultKind}
          onFilterKind={(k) => goPanel("vault", k)}
          onBack={() => goPanel("home")}
        />
      ) : panel === "invoice" ? (
        <section className="iss-recent" aria-labelledby="iss-inv-h">
          <div className="iss-sec-row">
            <h2 id="iss-inv-h" className="iss-sec-h">
              {INVOICE_COPY.title} · {ISSUANCE_COPY.invoicePick}
            </h2>
            <button type="button" className="btn line sm" onClick={() => goPanel("home")}>
              목록
            </button>
          </div>
          <p className="muted sm" style={{ marginBottom: 10 }}>
            {ISSUANCE_COPY.invoiceHint} — {INVOICE_COPY.notDamage}
          </p>
          {invoices.error ? <p className="warn sm">{invoices.error}</p> : null}
          {!invoices.list ? (
            <p className="muted sm">불러오는 중…</p>
          ) : invoices.list.length === 0 ? (
            <p className="muted sm">{INVOICE_COPY.recentEmpty}</p>
          ) : (
            <ul className="iss-list">
              {invoices.list.map((d) => (
                <li key={d.id}>
                  <button type="button" className="iss-list-link" onClick={() => void openInvoiceView(d)}>
                    <span className="iss-list-t">
                      {d.issueNumber ? `${d.issueNumber} · ` : ""}
                      {d.payerName || INVOICE_COPY.title}
                    </span>
                    <span className="tag">{d.isMidStay ? INVOICE_COPY.midWatermark : INVOICE_COPY.issued}</span>
                    {d.snapshot?.quoteCompare ? <span className="tag">{INVOICE_COPY.quoteCompare}</span> : null}
                    <span className="muted sm">{dayLabel((d.issuedAt || d.createdAt).slice(0, 10))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="iss-sec-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => void goLedgerPrint()}>
              {ISSUANCE_COPY.invoiceCta} <ExternalLink size={12} aria-hidden />
            </button>
          </div>
        </section>
      ) : panel === "damage" ? (
        <section className="iss-recent" aria-labelledby="iss-dmg-h">
          <div className="iss-sec-row">
            <h2 id="iss-dmg-h" className="iss-sec-h">
              {DAMAGE_COPY.title} · {ISSUANCE_COPY.damagePick}
            </h2>
            <button type="button" className="btn line sm" onClick={() => goPanel("home")}>
              목록
            </button>
          </div>
          <p className="muted sm" style={{ marginBottom: 10 }}>
            {ISSUANCE_COPY.damageHint}
          </p>
          {damages.error ? <p className="warn sm">{damages.error}</p> : null}
          {!damages.list ? (
            <p className="muted sm">불러오는 중…</p>
          ) : damages.list.length === 0 ? (
            <p className="muted sm">{DAMAGE_COPY.recentEmpty}</p>
          ) : (
            <ul className="iss-list">
              {damages.list.map((d) => (
                <li key={d.id}>
                  <button type="button" className="iss-list-link" onClick={() => void openDamageView(d)}>
                    <span className="iss-list-t">
                      {d.guestName || DAMAGE_COPY.title}
                      {d.roomNo ? ` · ${d.roomNo}호` : ""}
                    </span>
                    <span className="tag">{DAMAGE_COPY.issued}</span>
                    <span className="muted sm">{dayLabel((d.issuedAt || d.createdAt).slice(0, 10))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="iss-sec-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => void goLedgerPrint()}>
              {ISSUANCE_COPY.damageCta} <ExternalLink size={12} aria-hidden />
            </button>
          </div>
        </section>
      ) : (
        <section className="iss-recent" aria-labelledby="iss-recent-h">
          <div className="iss-sec-row">
            <h2 id="iss-recent-h" className="iss-sec-h">
              {ISSUANCE_COPY.recentDocs}
            </h2>
            <button type="button" className="btn line sm" onClick={() => goPanel("vault")}>
              <Shield size={14} /> {ISSUANCE_COPY.vaultHeading}
            </button>
          </div>
          {docs.error || quotes.error || invoices.error || damages.error ? (
            <p className="warn sm">{docs.error || quotes.error || invoices.error || damages.error}</p>
          ) : null}
          {!docs.list || !quotes.list || !invoices.list || !damages.list ? (
            <p className="muted sm">불러오는 중…</p>
          ) : recent.length === 0 ? (
            <p className="muted sm">{ISSUANCE_COPY.emptyRecent}</p>
          ) : (
            <ul className="iss-list">
              {recent.map((d) => (
                <li key={`${d.kind}-${d.id}`}>
                  {d.kind === "quote" ? (
                    <button type="button" className="iss-list-link" onClick={() => void openQuote(d.doc)}>
                      <span className="iss-list-t">{d.title}</span>
                      <span className="tag">{QUOTE_COPY.title}</span>
                      <span className="tag">{d.tag}</span>
                      <span className="muted sm">{dayLabel(d.at.slice(0, 10))}</span>
                    </button>
                  ) : d.kind === "invoice" ? (
                    <button type="button" className="iss-list-link" onClick={() => void openInvoiceView(d.doc)}>
                      <span className="iss-list-t">{d.title}</span>
                      <span className="tag">{INVOICE_COPY.title}</span>
                      <span className="tag">{d.tag}</span>
                      <span className="muted sm">{dayLabel(d.at.slice(0, 10))}</span>
                    </button>
                  ) : d.kind === "damage" ? (
                    <button type="button" className="iss-list-link" onClick={() => void openDamageView(d.doc)}>
                      <span className="iss-list-t">{d.title}</span>
                      <span className="tag">{DAMAGE_COPY.title}</span>
                      <span className="tag">{d.tag}</span>
                      <span className="muted sm">{dayLabel(d.at.slice(0, 10))}</span>
                    </button>
                  ) : (
                    <>
                      <span className="iss-list-t">{d.title}</span>
                      <span className="tag">{d.tag}</span>
                      <span className="muted sm">{dayLabel(d.at.slice(0, 10))}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {floorOpen ? (
        <FloorPlanPrint
          hotelName={hotel.name}
          s={s}
          today={today || businessDate()}
          onClose={() => {
            setFloorOpen(false);
            if (panel === "floor") goPanel("home");
          }}
        />
      ) : null}

      {quoteOpen ? (
        <QuoteLetter
          hotelName={hotel.name}
          s={s}
          today={today || businessDate()}
          initial={quoteOpen === "new" ? null : quoteOpen}
          busy={quoteBusy}
          notify={(m) => notify(m)}
          onSaveDraft={async (draft, id) => {
            setQuoteBusy(true);
            try {
              return await quotes.saveDraft(draft, id);
            } finally {
              setQuoteBusy(false);
            }
          }}
          onIssue={async (draft, id) => {
            setQuoteBusy(true);
            try {
              const plan = planQuoteTypeHoldBookings({ draft, quoteId: id ?? "new", s });
              if (plan.kind === "skip") throw new Error(plan.reason);
              let groupId: string | null = null;
              let bookingIds: string[] = [];
              if (plan.kind === "single") {
                const saved = await data.saveBooking(plan.booking, true);
                bookingIds = [saved.id];
              } else {
                const savedList = await data.saveGroup(plan.drafts, plan.info);
                groupId = plan.groupId;
                bookingIds = savedList.map((b) => b.id);
              }
              return await quotes.issue(draft, id, { groupId, bookingIds });
            } finally {
              setQuoteBusy(false);
            }
          }}
          onDelete={async (doc) => {
            await quotes.remove(doc);
          }}
          onClose={() => {
            setQuoteOpen(null);
            if (panel === "quote") goPanel("home");
          }}
        />
      ) : null}

      {invoiceView?.snapshot ? (
        <InvoiceLetter
          hotelName={hotel.name}
          s={s}
          today={today || businessDate()}
          members={[]}
          issuedDoc={invoiceView}
          onIssue={async () => invoiceView}
          notify={(m) => notify(m)}
          onClose={() => setInvoiceView(null)}
        />
      ) : null}

      {damageView?.snapshot ? (
        <DamageLetter
          hotelName={hotel.name}
          s={s}
          today={today || businessDate()}
          issuedDoc={damageView}
          onIssue={async () => damageView}
          onDelete={async (doc) => {
            await damages.remove(doc);
          }}
          notify={(m) => notify(m)}
          onClose={() => setDamageView(null)}
        />
      ) : null}
    </main>
  );
}

function VaultSection({
  docs,
  today,
  notify,
  filterKind,
  onFilterKind,
  onBack,
}: {
  docs: ReturnType<typeof useHotelDocuments>;
  today: string;
  notify: (m: string, opt?: ToastOpt) => void;
  filterKind: HotelDocKind | null;
  onFilterKind: (kind: HotelDocKind | null) => void;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<HotelDocKind>(filterKind ?? "fire_insurance");
  const [title, setTitle] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewer, setViewer] = useState<{ doc: HotelDocument; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterKind) setKind(filterKind);
  }, [filterKind]);

  const openUpload = () => {
    setKind(filterKind ?? "fire_insurance");
    setUploadOpen(true);
  };

  const closeUpload = () => {
    if (busy) return;
    setUploadOpen(false);
  };

  const resetUploadForm = () => {
    setTitle("");
    setIssuedOn("");
    setNotes("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const filtered = useMemo(() => {
    const all = docs.list ?? [];
    if (!filterKind) return all;
    return all.filter((d) => d.kind === filterKind);
  }, [docs.list, filterKind]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next: File[] = [];
    let bad = false;
    for (const f of Array.from(list)) {
      const err = validateHotelDocFile(f);
      if (err) {
        bad = true;
        continue;
      }
      next.push(f);
    }
    if (bad && next.length === 0) {
      notify(ISSUANCE_COPY.fileTypeBad);
      return;
    }
    if (bad) notify(ISSUANCE_COPY.fileTypeBad);
    setFiles((cur) => [...cur, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (files.length === 0) {
      notify(ISSUANCE_COPY.fileTypeBad);
      return;
    }
    setBusy(true);
    const base = title.trim() || HOTEL_DOC_KIND_LABEL[kind];
    let uploaded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        await docs.upload(
          {
            kind,
            title: hotelDocPageTitle(base, i, files.length),
            issuedOn: issuedOn || null,
            expiresOn: null,
            notes: notes || null,
          },
          files[i],
        );
        uploaded += 1;
      }
      resetUploadForm();
      setUploadOpen(false);
      notify(hotelDocUploadOkMessage(uploaded));
    } catch (e) {
      const body =
        uploaded > 0
          ? `${hotelDocUploadOkMessage(uploaded)}\n${hotelDocFailMessage(e, ISSUANCE_COPY.uploadFail)}`
          : hotelDocFailMessage(e, ISSUANCE_COPY.uploadFail);
      await askConfirm({
        title: ISSUANCE_COPY.uploadFailTitle,
        body,
        confirmLabel: "확인",
        cancelLabel: "닫기",
      });
      if (uploaded > 0) {
        setFiles((cur) => cur.slice(uploaded));
      }
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (doc: HotelDocument) => {
    try {
      const url = await docs.signedUrl(doc, 300);
      setViewer({ doc, url });
    } catch (e) {
      await askConfirm({
        title: ISSUANCE_COPY.openFail,
        body: hotelDocFailMessage(e, ISSUANCE_COPY.openFail),
        confirmLabel: "확인",
        cancelLabel: "닫기",
      });
    }
  };

  const downloadDoc = async (doc: HotelDocument) => {
    try {
      const url = await docs.signedUrl(doc, 120);
      const a = document.createElement("a");
      a.href = url;
      a.download = hotelDocDisplayTitle(doc.title) || "document";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      await askConfirm({
        title: ISSUANCE_COPY.openFail,
        body: hotelDocFailMessage(e, ISSUANCE_COPY.openFail),
        confirmLabel: "확인",
        cancelLabel: "닫기",
      });
    }
  };

  const removeDoc = async (doc: HotelDocument) => {
    const ok = await askConfirm({
      title: ISSUANCE_COPY.confirmDeleteTitle,
      body: `${hotelDocDisplayTitle(doc.title)}\n${ISSUANCE_COPY.confirmDeleteBody}`,
      confirmLabel: ISSUANCE_COPY.delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await docs.remove(doc);
      if (viewer?.doc.id === doc.id) setViewer(null);
      notify(ISSUANCE_COPY.deleteOk);
    } catch (e) {
      await askConfirm({
        title: ISSUANCE_COPY.deleteFail,
        body: hotelDocFailMessage(e, ISSUANCE_COPY.deleteFail),
        confirmLabel: "확인",
        cancelLabel: "닫기",
      });
    }
  };

  const printViewer = () => {
    if (!viewer) return;
    const w = window.open(viewer.url, "_blank", "noopener,noreferrer");
    if (!w) {
      notify("팝업이 막혔어요. 열기로 본 뒤 인쇄해 주세요.");
      return;
    }
    const tryPrint = () => {
      try {
        w.focus();
        w.print();
      } catch {
        /* cross-origin signed URL may block; user can print from new tab */
      }
    };
    w.addEventListener("load", () => setTimeout(tryPrint, 400));
    setTimeout(tryPrint, 1200);
  };

  const viewerTitle = viewer ? hotelDocDisplayTitle(viewer.doc.title) : "";

  return (
    <section className="iss-vault" aria-labelledby="iss-vault-h">
      <div className="iss-sec-row">
        <h2 id="iss-vault-h" className="iss-sec-h">
          {ISSUANCE_COPY.vaultHeading}
        </h2>
        <div className="iss-sec-acts">
          <button type="button" className="btn dark sm" onClick={openUpload}>
            <Upload size={14} aria-hidden /> {ISSUANCE_COPY.upload}
          </button>
          <button type="button" className="btn line sm" onClick={onBack}>
            서류 종류
          </button>
        </div>
      </div>

      <div className="iss-kind-filters" role="tablist" aria-label={ISSUANCE_COPY.kind}>
        <button
          type="button"
          role="tab"
          className={`chip${filterKind === null ? " on" : ""}`}
          aria-selected={filterKind === null}
          onClick={() => onFilterKind(null)}
        >
          {ISSUANCE_COPY.filterAll}
        </button>
        {HOTEL_DOC_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            className={`chip${filterKind === k ? " on" : ""}`}
            aria-selected={filterKind === k}
            onClick={() => onFilterKind(k)}
          >
            {HOTEL_DOC_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {docs.error ? <p className="warn sm">{docs.error}</p> : null}
      {!docs.list ? (
        <p className="muted sm">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="muted sm">{filterKind ? ISSUANCE_COPY.emptyVaultKind : ISSUANCE_COPY.emptyVault}</p>
      ) : (
        <ul className="iss-vault-list">
          {filtered.map((d) => {
            const badge = hotelDocExpiryBadge(d.expiresOn, today);
            const listTitle = hotelDocDisplayTitle(d.title);
            return (
              <li key={d.id} className="iss-vault-row">
                <div className="iss-vault-main">
                  <strong>{listTitle}</strong>
                  <span className="chips">
                    <span className="tag">{HOTEL_DOC_KIND_LABEL[d.kind]}</span>
                    {badge === "expired" ? <span className="tag danger">{ISSUANCE_COPY.expired}</span> : null}
                    {badge === "soon" ? <span className="tag warn">{ISSUANCE_COPY.expireSoon}</span> : null}
                  </span>
                  <span className="muted sm">
                    {d.expiresOn ? `만료 ${dayLabel(d.expiresOn)}` : dayLabel(d.createdAt.slice(0, 10))}
                  </span>
                </div>
                <div className="iss-vault-acts">
                  <button type="button" className="btn line sm" onClick={() => void openDoc(d)} aria-label={ISSUANCE_COPY.open}>
                    {ISSUANCE_COPY.open}
                  </button>
                  <button type="button" className="btn line sm" onClick={() => void downloadDoc(d)} aria-label={ISSUANCE_COPY.pdf}>
                    <FileDown size={14} /> {ISSUANCE_COPY.pdf}
                  </button>
                  <button
                    type="button"
                    className="btn line sm danger"
                    onClick={() => void removeDoc(d)}
                    aria-label={ISSUANCE_COPY.delete}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uploadOpen ? (
        <div className="dim iss-upload-dim" role="presentation" onClick={closeUpload}>
          <div
            className="modal iss-upload-modal"
            role="dialog"
            aria-labelledby="iss-upload-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mh">
              <h2 id="iss-upload-title">
                <Upload size={18} aria-hidden /> {ISSUANCE_COPY.upload}
              </h2>
              <button type="button" className="x" onClick={closeUpload} aria-label="닫기" disabled={busy}>
                ×
              </button>
            </div>
            <div className="iss-form iss-upload-form">
              <label>
                <span>{ISSUANCE_COPY.kind}</span>
                <select className="inp sm" value={kind} onChange={(e) => setKind(e.target.value as HotelDocKind)}>
                  {HOTEL_DOC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {HOTEL_DOC_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{ISSUANCE_COPY.title}</span>
                <input
                  className="inp sm"
                  value={title}
                  maxLength={80}
                  placeholder={HOTEL_DOC_KIND_LABEL[kind]}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="wide">
                <span>
                  {ISSUANCE_COPY.file}
                  <span className="muted"> · {ISSUANCE_COPY.fileMultiHint}</span>
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
              {files.length > 0 ? (
                <ul className="iss-file-queue wide" aria-label={ISSUANCE_COPY.file}>
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${f.lastModified}-${i}`}>
                      <span className="iss-file-name">
                        {i + 1}. {f.name}
                      </span>
                      <button
                        type="button"
                        className="btn line sm"
                        disabled={busy}
                        onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                      >
                        {ISSUANCE_COPY.removeFile}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <label>
                <span>{ISSUANCE_COPY.issuedOn}</span>
                <input className="inp sm" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
              </label>
              <label className="iss-notes">
                <span>{ISSUANCE_COPY.notes}</span>
                <textarea
                  className="inp sm iss-notes-inp"
                  value={notes}
                  maxLength={280}
                  rows={2}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
            <div className="mf iss-upload-acts">
              <button type="button" className="btn line sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                {ISSUANCE_COPY.addMoreFiles}
              </button>
              <span className="sp" />
              <button type="button" className="btn line sm" disabled={busy} onClick={closeUpload}>
                닫기
              </button>
              <button type="button" className="btn dark sm" disabled={busy || files.length === 0} onClick={() => void submit()}>
                {busy ? "올리는 중…" : files.length > 1 ? `${ISSUANCE_COPY.upload} (${files.length})` : ISSUANCE_COPY.upload}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewer ? (
        <div className="dim iss-viewer-dim" role="presentation" onClick={() => setViewer(null)}>
          <div className="modal iss-viewer" role="dialog" aria-label={viewerTitle} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <h2>{viewerTitle}</h2>
              <button type="button" className="x" onClick={() => setViewer(null)} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="iss-viewer-body">
              {viewer.doc.mime === "application/pdf" ? (
                <iframe title={viewerTitle} src={viewer.url} />
              ) : (
                <img src={viewer.url} alt={viewerTitle} />
              )}
            </div>
            <div className="mf iss-viewer-foot">
              <div className="keys acts">
                <button type="button" className="btn line sm" onClick={printViewer}>
                  <Printer size={14} /> {ISSUANCE_COPY.print}
                </button>
                <a className="btn line sm" href={viewer.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> {ISSUANCE_COPY.open}
                </a>
              </div>
              <button type="button" className="btn" onClick={() => setViewer(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

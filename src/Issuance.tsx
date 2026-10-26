/**
 * App 「발급」 — 서류함 hub (#/issuance)
 * P0: type cards · 화재보험 vault · 객실 배치도 print · 숙박확인서 → 장부
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  ExternalLink,
  FileDown,
  FileText,
  FolderOpen,
  LayoutGrid,
  Printer,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import type { HotelData } from "./data";
import { useHotelDocuments } from "./data";
import type { ToastOpt } from "./App";
import { askConfirm } from "./ConfirmDialog";
import FloorPlanPrint from "./FloorPlanPrint";
import {
  HOTEL_DOC_KIND_LABEL,
  HOTEL_DOC_KINDS,
  ISSUANCE_COPY,
  type HotelDocKind,
  type HotelDocument,
  hotelDocExpiryBadge,
} from "../shared/hotelDocuments";
import { STAY_CONFIRM_COPY, businessDate, dayLabel } from "../shared/ledger";

type Panel = "home" | "vault" | "floor";

function panelFromHash(): Panel {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] !== "issuance") return "home";
  if (parts[1] === "vault") return "vault";
  if (parts[1] === "floor") return "floor";
  return "home";
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
  const [panel, setPanel] = useState<Panel>(panelFromHash);
  const [floorOpen, setFloorOpen] = useState(() => panelFromHash() === "floor");
  const hotel = data.hotel!;
  const s = hotel.settings;

  useEffect(() => {
    const on = () => {
      const p = panelFromHash();
      setPanel(p);
      if (p === "floor") setFloorOpen(true);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const goPanel = (p: Panel) => {
    const hash = p === "home" ? "#/issuance" : `#/issuance/${p}`;
    if (location.hash !== hash) location.hash = hash;
    setPanel(p);
    if (p === "floor") setFloorOpen(true);
  };

  const recent = useMemo(() => (docs.list ?? []).slice(0, 8), [docs.list]);

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
          <button type="button" className="iss-card" onClick={onGoLedger}>
            <FileText size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{STAY_CONFIRM_COPY}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.stayConfirmHint}</span>
            <span className="iss-card-cta">
              {ISSUANCE_COPY.stayConfirmCta} <ExternalLink size={12} aria-hidden />
            </span>
          </button>
          <button type="button" className="iss-card" onClick={() => goPanel("floor")}>
            <LayoutGrid size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.floorPlan}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.floorPlanHint}</span>
            <span className="iss-card-cta">{ISSUANCE_COPY.floorPlanCta}</span>
          </button>
          <button type="button" className="iss-card" onClick={() => goPanel("vault")}>
            <Shield size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.fireInsurance}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.fireInsuranceHint}</span>
            <span className="iss-card-cta">{ISSUANCE_COPY.vaultCta}</span>
          </button>
          <div className="iss-card soon" aria-disabled>
            <ClipboardList size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.quote}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.quoteSoon}</span>
          </div>
          <div className="iss-card soon" aria-disabled>
            <FolderOpen size={22} strokeWidth={2} aria-hidden />
            <span className="iss-card-t">{ISSUANCE_COPY.damage}</span>
            <span className="iss-card-s">{ISSUANCE_COPY.damageSoon}</span>
          </div>
        </div>
      </section>

      {panel === "vault" ? (
        <VaultSection docs={docs} today={today} notify={notify} onBack={() => goPanel("home")} />
      ) : (
        <section className="iss-recent" aria-labelledby="iss-recent-h">
          <div className="iss-sec-row">
            <h2 id="iss-recent-h" className="iss-sec-h">
              {ISSUANCE_COPY.recentHeading}
            </h2>
            <button type="button" className="btn line sm" onClick={() => goPanel("vault")}>
              <Shield size={14} /> {ISSUANCE_COPY.vaultHeading}
            </button>
          </div>
          {docs.error ? <p className="warn sm">{docs.error}</p> : null}
          {!docs.list ? (
            <p className="muted sm">불러오는 중…</p>
          ) : recent.length === 0 ? (
            <p className="muted sm">{ISSUANCE_COPY.emptyRecent}</p>
          ) : (
            <ul className="iss-list">
              {recent.map((d) => (
                <li key={d.id}>
                  <span className="iss-list-t">{d.title}</span>
                  <span className="tag">{HOTEL_DOC_KIND_LABEL[d.kind]}</span>
                  <span className="muted sm">{dayLabel(d.createdAt.slice(0, 10))}</span>
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
    </main>
  );
}

function VaultSection({
  docs,
  today,
  notify,
  onBack,
}: {
  docs: ReturnType<typeof useHotelDocuments>;
  today: string;
  notify: (m: string, opt?: ToastOpt) => void;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<HotelDocKind>("fire_insurance");
  const [title, setTitle] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ doc: HotelDocument; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) {
      notify(ISSUANCE_COPY.fileTypeBad);
      return;
    }
    setBusy(true);
    try {
      await docs.upload(
        {
          kind,
          title: title || HOTEL_DOC_KIND_LABEL[kind],
          issuedOn: issuedOn || null,
          expiresOn: expiresOn || null,
          notes: notes || null,
        },
        file,
      );
      setTitle("");
      setIssuedOn("");
      setExpiresOn("");
      setNotes("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      notify(ISSUANCE_COPY.uploadOk);
    } catch (e) {
      notify(e instanceof Error ? e.message : "업로드에 실패했어요", { ms: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (doc: HotelDocument) => {
    try {
      const url = await docs.signedUrl(doc, 300);
      setViewer({ doc, url });
    } catch (e) {
      notify(e instanceof Error ? `${ISSUANCE_COPY.openFail}: ${e.message}` : ISSUANCE_COPY.openFail, { ms: 6000 });
    }
  };

  const downloadDoc = async (doc: HotelDocument) => {
    try {
      const url = await docs.signedUrl(doc, 120);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.title || "document";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      notify(e instanceof Error ? e.message : ISSUANCE_COPY.openFail, { ms: 6000 });
    }
  };

  const removeDoc = async (doc: HotelDocument) => {
    const ok = await askConfirm({
      title: ISSUANCE_COPY.confirmDeleteTitle,
      body: `${doc.title}\n${ISSUANCE_COPY.confirmDeleteBody}`,
      confirmLabel: ISSUANCE_COPY.delete,
      danger: true,
    });
    if (!ok) return;
    try {
      await docs.remove(doc);
      if (viewer?.doc.id === doc.id) setViewer(null);
      notify(ISSUANCE_COPY.deleteOk);
    } catch (e) {
      notify(e instanceof Error ? e.message : "삭제에 실패했어요", { ms: 6000 });
    }
  };

  const printViewer = () => {
    if (!viewer) return;
    const w = window.open(viewer.url, "_blank", "noopener,noreferrer");
    if (!w) {
      notify("팝업이 막혔어요. 열기로 본 뒤 인쇄해 주세요.");
      return;
    }
    // PDF/image: browser print after load when possible
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

  return (
    <section className="iss-vault" aria-labelledby="iss-vault-h">
      <div className="iss-sec-row">
        <h2 id="iss-vault-h" className="iss-sec-h">
          {ISSUANCE_COPY.vaultHeading}
        </h2>
        <button type="button" className="btn line sm" onClick={onBack}>
          서류 종류
        </button>
      </div>

      <div className="iss-upload card">
        <h3>
          <Upload size={16} aria-hidden /> {ISSUANCE_COPY.upload}
        </h3>
        <div className="iss-form">
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
          <label>
            <span>{ISSUANCE_COPY.file}</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            <span>{ISSUANCE_COPY.issuedOn}</span>
            <input className="inp sm" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </label>
          <label>
            <span>{ISSUANCE_COPY.expiresOn}</span>
            <input className="inp sm" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <label className="wide">
            <span>{ISSUANCE_COPY.notes}</span>
            <input className="inp sm" value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button type="button" className="btn dark sm" disabled={busy || !file} onClick={() => void submit()}>
          {busy ? "올리는 중…" : ISSUANCE_COPY.upload}
        </button>
      </div>

      {docs.error ? <p className="warn sm">{docs.error}</p> : null}
      {!docs.list ? (
        <p className="muted sm">불러오는 중…</p>
      ) : docs.list.length === 0 ? (
        <p className="muted sm">{ISSUANCE_COPY.emptyVault}</p>
      ) : (
        <ul className="iss-vault-list">
          {docs.list.map((d) => {
            const badge = hotelDocExpiryBadge(d.expiresOn, today);
            return (
              <li key={d.id} className="iss-vault-row">
                <div className="iss-vault-main">
                  <strong>{d.title}</strong>
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

      {viewer ? (
        <div className="dim iss-viewer-dim" role="presentation" onClick={() => setViewer(null)}>
          <div className="modal iss-viewer" role="dialog" aria-label={viewer.doc.title} onClick={(e) => e.stopPropagation()}>
            <div className="mh">
              <h2>{viewer.doc.title}</h2>
              <button type="button" className="x" onClick={() => setViewer(null)} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="iss-viewer-body">
              {viewer.doc.mime === "application/pdf" ? (
                <iframe title={viewer.doc.title} src={viewer.url} />
              ) : (
                <img src={viewer.url} alt={viewer.doc.title} />
              )}
            </div>
            <div className="mf">
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

/** 호텔 증서 보관함 (화재보험·통장사본·사업자등록증 등). See docs/issuance-hub-scope-plan.md */

export const HOTEL_DOC_BUCKET = "hotel-documents" as const;
export const HOTEL_DOC_TITLE_MAX = 80;
export const HOTEL_DOC_NOTES_MAX = 280;
/** Soft cap ~20 MB (matches Storage bucket) */
export const HOTEL_DOC_MAX_BYTES = 20 * 1024 * 1024;

/** Owner FO vault kinds guests ask for + generic */
export const HOTEL_DOC_KINDS = [
  "fire_insurance",
  "bank_book",
  "business_license",
  "operating_report",
  "other",
] as const;
export type HotelDocKind = (typeof HOTEL_DOC_KINDS)[number];

/** Primary type cards on 「발급」 hub (excludes generic `other`) */
export const HOTEL_DOC_HUB_KINDS = [
  "fire_insurance",
  "bank_book",
  "business_license",
  "operating_report",
] as const;
export type HotelDocHubKind = (typeof HOTEL_DOC_HUB_KINDS)[number];

export const HOTEL_DOC_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type HotelDocMime = (typeof HOTEL_DOC_MIMES)[number];

export type HotelDocument = {
  id: string;
  hotelId: string;
  kind: HotelDocKind;
  title: string;
  storagePath: string;
  mime: HotelDocMime;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HotelDocumentDraft = {
  kind: HotelDocKind;
  title: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
};

/** UI copy keys (64-lang roadmap — KR values now) */
export const ISSUANCE_COPY = {
  viewLabel: "발급",
  viewSub: "서류함",
  typesHeading: "서류 종류",
  recentHeading: "최근 업로드",
  vaultHeading: "호텔 증서 보관함",
  stayConfirm: "숙박확인서",
  stayConfirmHint: "체류 증명 + 이용 금액 · 장부·현황·수정 창",
  stayConfirmCta: "장부로 이동",
  quote: "견적서",
  quoteHint: "예약 전 · 날짜·객실·인원 견적",
  quoteCta: "새 견적",
  quoteSoon: "준비 중",
  invoice: "청구서",
  invoiceHint: "실이용 정산 · 단체/예약에서 발급",
  invoiceCta: "장부·단체에서",
  invoicePick: "최근 청구 · 재인쇄",
  damage: "손해내역서",
  damageHint: "파손·클레임 · 숙박에서 발급 (청구서와 별도)",
  damageCta: "장부·숙박에서",
  damagePick: "최근 손해 · 재인쇄",
  damageSoon: "준비 중 · 청구서와 별도",
  floorPlan: "객실 배치도",
  floorPlanHint: "설정 배치를 A4로 인쇄",
  floorPlanCta: "인쇄 미리보기",
  fireInsurance: "화재보험증서",
  fireInsuranceHint: "업로드 · 열기 · 인쇄",
  bankBook: "통장사본",
  bankBookHint: "업로드 · 열기 · 인쇄",
  businessReg: "사업자등록증",
  businessRegHint: "업로드 · 열기 · 인쇄",
  operatingReport: "영업신고서",
  operatingReportHint: "업로드 · 열기 · 인쇄",
  vaultCta: "보관함 열기",
  filterAll: "전체",
  upload: "업로드",
  title: "제목",
  kind: "종류",
  file: "파일",
  issuedOn: "발급일 (선택)",
  expiresOn: "만료일 (선택)",
  notes: "메모",
  open: "열기",
  print: "인쇄",
  pdf: "PDF 저장",
  download: "내려받기",
  delete: "삭제",
  emptyVault:
    "아직 올린 증서가 없어요. 화재보험·통장사본·사업자등록증·영업신고서 PDF나 사진을 올려 두세요.",
  emptyVaultKind: "이 종류로 올린 파일이 없어요.",
  emptyRecent: "최근 발급·업로드가 없어요.",
  recentDocs: "최근 발급",
  recentUploads: "최근 업로드",

  expireSoon: "만료 임박",
  expired: "만료",
  settingsVaultHint: "화재보험·통장사본·사업자등록증·영업신고서는 「발급」보관함에서 관리해요.",
  settingsFloorPrint: "배치도 인쇄",
  confirmDeleteTitle: "증서를 삭제할까요?",
  confirmDeleteBody: "보관함과 파일에서 지워져요. 되돌릴 수 없어요.",
  fileTooBig: "파일이 너무 커요 (최대 20MB).",
  fileTypeBad: "PDF · JPG · PNG만 올릴 수 있어요.",
  titleRequired: "제목을 적어 주세요.",
  uploadOk: "증서를 올렸어요.",
  uploadFailTitle: "업로드에 실패했어요",
  uploadFail:
    "증서를 올리지 못했어요. 파일 형식(PDF·JPG·PNG)과 크기를 확인한 뒤 다시 시도해 주세요.",
  uploadFailAuth: "이 호텔에 올릴 권한이 없어요. 로그인을 확인해 주세요.",
  uploadFailDup: "같은 파일이 이미 있어요. 이름을 바꾸거나 기존 파일을 지운 뒤 올려 주세요.",
  uploadFailNetwork: "연결이 불안정해요. 잠시 후 다시 올려 주세요.",
  deleteOk: "증서를 지웠어요.",
  deleteFail: "증서를 지우지 못했어요. 잠시 후 다시 시도해 주세요.",
  openFail: "파일을 열지 못했어요.",
} as const;

export const HOTEL_DOC_KIND_LABEL: Record<HotelDocKind, string> = {
  fire_insurance: "화재보험증서",
  bank_book: "통장사본",
  business_license: "사업자등록증",
  operating_report: "영업신고서",
  other: "기타",
};

export function isHotelDocKind(v: unknown): v is HotelDocKind {
  return typeof v === "string" && (HOTEL_DOC_KINDS as readonly string[]).includes(v);
}

export function isHotelDocHubKind(v: unknown): v is HotelDocHubKind {
  return typeof v === "string" && (HOTEL_DOC_HUB_KINDS as readonly string[]).includes(v);
}

/** Hub card copy for a primary vault kind */
export function hotelDocHubCopy(kind: HotelDocHubKind): { title: string; hint: string } {
  if (kind === "bank_book") return { title: ISSUANCE_COPY.bankBook, hint: ISSUANCE_COPY.bankBookHint };
  if (kind === "business_license") return { title: ISSUANCE_COPY.businessReg, hint: ISSUANCE_COPY.businessRegHint };
  if (kind === "operating_report")
    return { title: ISSUANCE_COPY.operatingReport, hint: ISSUANCE_COPY.operatingReportHint };
  return { title: ISSUANCE_COPY.fireInsurance, hint: ISSUANCE_COPY.fireInsuranceHint };
}

export function isHotelDocMime(v: unknown): v is HotelDocMime {
  return typeof v === "string" && (HOTEL_DOC_MIMES as readonly string[]).includes(v);
}

export function mimeFromFile(file: File): HotelDocMime | null {
  const t = (file.type || "").toLowerCase();
  if (t === "application/pdf") return "application/pdf";
  if (t === "image/jpeg" || t === "image/jpg") return "image/jpeg";
  if (t === "image/png") return "image/png";
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  return null;
}

/**
 * Storage object key must match Supabase `isValidKey` (ASCII / S3-safe).
 * Hangul names like `사업자등록증.jpg` otherwise fail with InvalidKey 400.
 * Display title stays in `hotel_documents.title` — path is opaque.
 */
export function sanitizeDocFilename(name: string): string {
  const trimmed = (name || "").trim() || "document";
  const lastDot = trimmed.lastIndexOf(".");
  const rawExt = lastDot > 0 ? trimmed.slice(lastDot + 1) : "";
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  let base = rawBase
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  if (!base) base = "document";
  base = base.slice(0, 80);
  return ext ? `${base}.${ext}` : base;
}

/** `{hotel_id}/certs/{document_id}/{filename}` — filename ASCII-sanitized */
export function hotelDocStoragePath(hotelId: string, documentId: string, filename: string): string {
  return `${hotelId}/certs/${documentId}/${sanitizeDocFilename(filename)}`;
}

/** Map Storage / PostgREST errors → FO KR copy (never leak raw InvalidKey / 400). */
export function hotelDocFailMessage(e: unknown, fallback: string = ISSUANCE_COPY.uploadFail): string {
  const bits: string[] = [];
  if (e && typeof e === "object") {
    const o = e as {
      message?: unknown;
      error?: unknown;
      statusCode?: unknown;
      status?: unknown;
      code?: unknown;
      name?: unknown;
    };
    for (const v of [o.message, o.error, o.name, o.code, o.statusCode, o.status]) {
      if (typeof v === "string" && v.trim()) bits.push(v.trim());
      else if (typeof v === "number") bits.push(String(v));
    }
  } else if (typeof e === "string") {
    bits.push(e);
  }
  const blob = bits.join(" ").toLowerCase();
  if (/invalid.?key|invalid key/.test(blob)) return ISSUANCE_COPY.uploadFail;
  if (/mime|content.?type|not supported|allowed_mime|unsupported/.test(blob)) return ISSUANCE_COPY.fileTypeBad;
  if (/too large|maximum|413|payload|file size|exceeded/.test(blob)) return ISSUANCE_COPY.fileTooBig;
  if (/row-level security|rls|42501|403|not allowed|unauthorized|jwt|permission/.test(blob))
    return ISSUANCE_COPY.uploadFailAuth;
  if (/duplicate|already exists|23505|resource already/.test(blob)) return ISSUANCE_COPY.uploadFailDup;
  if (/network|fetch|failed to fetch|timeout|econn|offline/.test(blob)) return ISSUANCE_COPY.uploadFailNetwork;
  return fallback;
}

export function validateHotelDocumentDraft(d: HotelDocumentDraft): string | null {
  const title = d.title.trim();
  if (!title) return ISSUANCE_COPY.titleRequired;
  if (title.length > HOTEL_DOC_TITLE_MAX) return `제목은 ${HOTEL_DOC_TITLE_MAX}자까지예요.`;
  if (!isHotelDocKind(d.kind)) return "종류를 골라 주세요.";
  if (d.notes && d.notes.length > HOTEL_DOC_NOTES_MAX) return `메모는 ${HOTEL_DOC_NOTES_MAX}자까지예요.`;
  return null;
}

export function validateHotelDocFile(file: File): string | null {
  if (file.size > HOTEL_DOC_MAX_BYTES) return ISSUANCE_COPY.fileTooBig;
  if (!mimeFromFile(file)) return ISSUANCE_COPY.fileTypeBad;
  return null;
}

/** Expiry badge for list: expired | soon (≤30d) | null */
export function hotelDocExpiryBadge(
  expiresOn: string | null | undefined,
  today: string,
): "expired" | "soon" | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return "expired";
  const t = new Date(`${today}T12:00:00`);
  const e = new Date(`${expiresOn}T12:00:00`);
  const days = Math.round((e.getTime() - t.getTime()) / 86400000);
  if (days <= 30) return "soon";
  return null;
}

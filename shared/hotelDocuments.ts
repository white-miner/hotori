/** 호텔 증서 보관함 (화재보험 등). See docs/issuance-hub-scope-plan.md */

export const HOTEL_DOC_BUCKET = "hotel-documents" as const;
export const HOTEL_DOC_TITLE_MAX = 80;
export const HOTEL_DOC_NOTES_MAX = 280;
/** Soft cap ~20 MB (matches Storage bucket) */
export const HOTEL_DOC_MAX_BYTES = 20 * 1024 * 1024;

export const HOTEL_DOC_KINDS = ["fire_insurance", "business_license", "other"] as const;
export type HotelDocKind = (typeof HOTEL_DOC_KINDS)[number];

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
  stayConfirmHint: "예약에서 발급 · 장부·현황·수정 창",
  stayConfirmCta: "장부로 이동",
  quote: "견적서",
  quoteSoon: "준비 중",
  damage: "손해내역서",
  damageSoon: "준비 중",
  floorPlan: "객실 배치도",
  floorPlanHint: "설정 배치를 A4로 인쇄",
  floorPlanCta: "인쇄 미리보기",
  fireInsurance: "화재보험증서",
  fireInsuranceHint: "업로드 · 열기 · 인쇄",
  vaultCta: "보관함 열기",
  upload: "업로드",
  title: "제목",
  kind: "종류",
  file: "파일",
  issuedOn: "발급일",
  expiresOn: "만료일",
  notes: "메모",
  open: "열기",
  print: "인쇄",
  pdf: "PDF 저장",
  download: "내려받기",
  delete: "삭제",
  emptyVault: "아직 올린 증서가 없어요. 화재보험증서 PDF나 사진을 올려 두세요.",
  emptyRecent: "최근 업로드가 없어요.",
  expireSoon: "만료 임박",
  expired: "만료",
  settingsVaultHint: "화재보험 등 증서는 「발급」보관함에서 관리해요.",
  settingsFloorPrint: "배치도 인쇄",
  confirmDeleteTitle: "증서를 삭제할까요?",
  confirmDeleteBody: "보관함과 파일에서 지워져요. 되돌릴 수 없어요.",
  fileTooBig: "파일이 너무 커요 (최대 20MB).",
  fileTypeBad: "PDF · JPG · PNG만 올릴 수 있어요.",
  titleRequired: "제목을 적어 주세요.",
  uploadOk: "증서를 올렸어요.",
  deleteOk: "증서를 지웠어요.",
  openFail: "파일을 열지 못했어요.",
} as const;

export const HOTEL_DOC_KIND_LABEL: Record<HotelDocKind, string> = {
  fire_insurance: "화재보험",
  business_license: "영업허가",
  other: "기타",
};

export function isHotelDocKind(v: unknown): v is HotelDocKind {
  return typeof v === "string" && (HOTEL_DOC_KINDS as readonly string[]).includes(v);
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

export function sanitizeDocFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "document";
  return base.slice(0, 120);
}

/** `{hotel_id}/certs/{document_id}/{filename}` */
export function hotelDocStoragePath(hotelId: string, documentId: string, filename: string): string {
  return `${hotelId}/certs/${documentId}/${sanitizeDocFilename(filename)}`;
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

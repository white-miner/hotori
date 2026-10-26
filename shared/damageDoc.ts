/** 손해내역서 (P1.2b) — stay-bound damage assessment · ≠ 청구서. See docs/group-invoice-plan.md */
import type { PrintLang } from "./hotelBiz";

export const DAMAGE_ITEM_MAX = 40;
export const DAMAGE_DESC_MAX = 120;
export const DAMAGE_NOTES_MAX = 280;
export const DAMAGE_GUEST_MAX = 60;
export const DAMAGE_PHONE_MAX = 30;
export const DAMAGE_LINES_MAX = 40;

export type DamageStatus = "draft" | "issued";

export type DamageLine = {
  id: string;
  /** 항목 (예: TV · 침구 · 벽지) */
  item: string;
  /** 내용/설명 */
  description: string;
  amount: number;
};

export type DamageSnapshot = {
  guestName: string;
  guestPhone: string;
  roomNo: string;
  typeLabel: string;
  bookingId: string | null;
  notes: string;
  lines: DamageLine[];
  total: number;
  issuedAt: string;
};

export type DamageDoc = {
  id: string;
  hotelId: string;
  status: DamageStatus;
  bookingId: string | null;
  guestName: string;
  guestPhone: string;
  roomNo: string;
  typeLabel: string;
  notes: string;
  lines: DamageLine[];
  total: number;
  snapshot: DamageSnapshot | null;
  issuedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DamageDraft = {
  guestName: string;
  guestPhone: string;
  roomNo: string;
  typeLabel: string;
  notes: string;
  lines: DamageLine[];
  bookingId: string | null;
};

/** FO chrome (KR). Print body uses damagePrintStrings(lang). */
export const DAMAGE_COPY = {
  title: "손해내역서",
  hint: "파손·클레임 · 숙박에서 발급 (청구서와 별도)",
  cta: "손해내역서",
  hubCta: "최근·발급",
  notInvoice: "숙박비 정산은 「청구서」로 따로 발급해요.",
  guest: "투숙객",
  phone: "연락처",
  room: "객실",
  notes: "메모",
  lines: "손해 내역",
  addLine: "줄 추가",
  item: "항목",
  description: "내용",
  amount: "금액",
  total: "합계",
  attest: "위와 같이 손해 내역을 확인합니다.",
  issueDate: "발급일",
  print: "인쇄",
  pdf: "PDF",
  pdfHint: "인쇄 창에서「PDF로 저장」을 고르세요",
  close: "닫기",
  issue: "발급",
  issued: "발급됨",
  reprint: "다시 인쇄",
  delete: "삭제",
  tip: "발급하면 내용이 고정돼요. 고친 뒤엔 새 버전으로 재발급하세요.",
  tipLive: "미리보기는 지금 입력과 같아요. 발급 시 스냅샷으로 얼려요.",
  needLines: "손해 항목을 한 줄 이상 적어 주세요.",
  needItem: "항목 이름을 적어 주세요.",
  saveOk: "손해내역서를 저장했어요.",
  issueOk: "손해내역서를 발급했어요.",
  confirmIssueTitle: "손해내역서를 발급할까요?",
  confirmIssueBody: "내용이 고정돼요. 이미 건넨 PDF와 맞춰 재인쇄할 수 있어요.",
  confirmDeleteTitle: "손해내역서를 삭제할까요?",
  confirmDeleteBody: "발급 기록에서 지워져요. 되돌릴 수 없어요.",
  recentEmpty: "최근 손해내역서가 없어요.",
  fromStay: "숙박에서 발급",
} as const;

export const DAMAGE_COPY_EN_TITLE = "Damage Assessment" as const;

export type DamagePrintStrings = {
  title: string;
  bizNumber: string;
  phone: string;
  representativeShort: string;
  representative: string;
  seal: string;
  guest: string;
  room: string;
  type: string;
  notes: string;
  item: string;
  description: string;
  amount: string;
  total: string;
  attest: string;
  issueDate: string;
  print: string;
  pdf: string;
  pdfHint: string;
  close: string;
  langAria: string;
  langKo: string;
  langEn: string;
  roomSuffix: string;
  unassigned: string;
};

const DAMAGE_PRINT_KO: DamagePrintStrings = {
  title: DAMAGE_COPY.title,
  bizNumber: "사업자번호",
  phone: "전화",
  representativeShort: "대표",
  representative: "대표자",
  seal: "(인)",
  guest: DAMAGE_COPY.guest,
  room: DAMAGE_COPY.room,
  type: "타입",
  notes: DAMAGE_COPY.notes,
  item: DAMAGE_COPY.item,
  description: DAMAGE_COPY.description,
  amount: DAMAGE_COPY.amount,
  total: DAMAGE_COPY.total,
  attest: DAMAGE_COPY.attest,
  issueDate: DAMAGE_COPY.issueDate,
  print: DAMAGE_COPY.print,
  pdf: DAMAGE_COPY.pdf,
  pdfHint: DAMAGE_COPY.pdfHint,
  close: DAMAGE_COPY.close,
  langAria: "손해내역서 언어",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "호",
  unassigned: "미배정",
};

const DAMAGE_PRINT_EN: DamagePrintStrings = {
  title: DAMAGE_COPY_EN_TITLE,
  bizNumber: "Business Reg. No.",
  phone: "Tel",
  representativeShort: "Rep.",
  representative: "Representative",
  seal: "(Seal)",
  guest: "Guest",
  room: "Room",
  type: "Type",
  notes: "Notes",
  item: "Item",
  description: "Description",
  amount: "Amount",
  total: "Total",
  attest: "This certifies the damage items listed above.",
  issueDate: "Issued",
  print: "Print",
  pdf: "PDF",
  pdfHint: "In the print dialog, choose “Save as PDF”",
  close: "Close",
  langAria: "Damage letter language",
  langKo: "한국어",
  langEn: "English",
  roomSuffix: "",
  unassigned: "Unassigned",
};

export function damagePrintStrings(lang: PrintLang): DamagePrintStrings {
  return lang === "en" ? DAMAGE_PRINT_EN : DAMAGE_PRINT_KO;
}

export function damageRoomDisplay(roomNo: string, lang: PrintLang, suffix: string): string {
  const raw = roomNo.trim();
  if (!raw || raw === "미배정" || raw === "Unassigned") return lang === "en" ? "Unassigned" : "미배정";
  return suffix ? `${raw}${suffix}` : raw;
}

export function newDamageLineId(): string {
  return `dl_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDamageLine(): DamageLine {
  return { id: newDamageLineId(), item: "", description: "", amount: 0 };
}

export function damageTotal(lines: DamageLine[]): number {
  return lines.reduce((s, l) => s + Math.max(0, Math.round(l.amount) || 0), 0);
}

export function normalizeDamageLines(raw: unknown): DamageLine[] {
  if (!Array.isArray(raw)) return [emptyDamageLine()];
  const out: DamageLine[] = [];
  for (const row of raw.slice(0, DAMAGE_LINES_MAX)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : newDamageLineId(),
      item: String(r.item ?? "").slice(0, DAMAGE_ITEM_MAX),
      description: String(r.description ?? "").slice(0, DAMAGE_DESC_MAX),
      amount: Math.max(0, Math.round(Number(r.amount) || 0)),
    });
  }
  return out.length ? out : [emptyDamageLine()];
}

export function validateDamageDraft(draft: DamageDraft): string | null {
  if (draft.guestName.length > DAMAGE_GUEST_MAX) return `투숙객은 ${DAMAGE_GUEST_MAX}자까지예요.`;
  if (draft.guestPhone.length > DAMAGE_PHONE_MAX) return `연락처는 ${DAMAGE_PHONE_MAX}자까지예요.`;
  if (draft.notes.length > DAMAGE_NOTES_MAX) return `메모는 ${DAMAGE_NOTES_MAX}자까지예요.`;
  const lines = draft.lines.filter((l) => l.item.trim() || l.description.trim() || l.amount > 0);
  if (!lines.length) return DAMAGE_COPY.needLines;
  for (const l of lines) {
    if (!l.item.trim()) return DAMAGE_COPY.needItem;
    if (l.item.length > DAMAGE_ITEM_MAX) return `항목은 ${DAMAGE_ITEM_MAX}자까지예요.`;
    if (l.description.length > DAMAGE_DESC_MAX) return `내용은 ${DAMAGE_DESC_MAX}자까지예요.`;
  }
  if (draft.lines.length > DAMAGE_LINES_MAX) return `줄은 ${DAMAGE_LINES_MAX}개까지예요.`;
  return null;
}

export function freezeDamageSnapshot(draft: DamageDraft, issuedAt: string): DamageSnapshot {
  const lines = draft.lines
    .filter((l) => l.item.trim() || l.description.trim() || l.amount > 0)
    .map((l) => ({
      id: l.id,
      item: l.item.trim().slice(0, DAMAGE_ITEM_MAX),
      description: l.description.trim().slice(0, DAMAGE_DESC_MAX),
      amount: Math.max(0, Math.round(l.amount) || 0),
    }));
  return {
    guestName: draft.guestName.trim().slice(0, DAMAGE_GUEST_MAX),
    guestPhone: draft.guestPhone.trim().slice(0, DAMAGE_PHONE_MAX),
    roomNo: draft.roomNo.trim().slice(0, 20),
    typeLabel: draft.typeLabel.trim().slice(0, 40),
    bookingId: draft.bookingId,
    notes: draft.notes.trim().slice(0, DAMAGE_NOTES_MAX),
    lines,
    total: damageTotal(lines),
    issuedAt,
  };
}

export function draftFromBooking(opts: {
  guestName: string;
  guestPhone: string;
  roomNo: string;
  typeLabel: string;
  bookingId: string;
}): DamageDraft {
  return {
    guestName: opts.guestName.slice(0, DAMAGE_GUEST_MAX),
    guestPhone: opts.guestPhone.slice(0, DAMAGE_PHONE_MAX),
    roomNo: opts.roomNo,
    typeLabel: opts.typeLabel,
    notes: "",
    lines: [emptyDamageLine()],
    bookingId: opts.bookingId,
  };
}

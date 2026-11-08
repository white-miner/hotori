/**
 * 스마트등록 양식 — 플랫폼별 칸 이름(라벨)만 저장한다.
 * 정규식·스크립트·외부 AI를 쓰지 않는다. 손님 원문은 양식에 넣지 않는다.
 *
 * 아고다 파트너 허브 용어 (공식 안내 + 운영 의미):
 * - "확정된 예약"은 예약 확정이다. 결제 완료(PREPAID)나 현장 결제(TO BE PAID BY GUEST)가 아니다.
 * - "기준 판매 요금(세금 및 수수료 포함)"은 판매 총액(Reference Sell Rate)이다.
 *   숙소가 받는 정산(Base Rate)이나 수납 기록이 아니다.
 */
function nightsBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

export const PASTE_PLATFORM_IDS = ["yanolja", "yeogi", "agoda", "naver"] as const;
export type PastePlatformId = (typeof PASTE_PLATFORM_IDS)[number];

/** 스마트등록이 인식해서 미리보기·업로드에 쓰는 칸. amount의 저장 키는 salesTotal. */
export const PASTE_TEMPLATE_FIELDS = [
  "statusRaw",
  "guestName",
  "guestPhone",
  "adults",
  "typeRaw",
  "checkIn",
  "checkInTime",
  "checkOut",
  "checkOutTime",
  "nights",
  "salesTotal",
  "currency",
  "reservationId",
] as const;
export type PasteTemplateField = (typeof PASTE_TEMPLATE_FIELDS)[number];

/** 양식 버튼에 보이는 이름. 인원은 성인 수이고 예약 인원으로 저장된다. */
export const PASTE_FIELD_LABELS: Record<PasteTemplateField, string> = {
  statusRaw: "상태",
  guestName: "이름",
  guestPhone: "전화",
  adults: "인원",
  typeRaw: "타입",
  checkIn: "입실",
  checkInTime: "입실 시각",
  checkOut: "체크아웃",
  checkOutTime: "퇴실 시각",
  nights: "박수",
  salesTotal: "판매금",
  currency: "통화",
  reservationId: "예약번호",
};

/** 편집 중인 양식은 늦게 도착한 빈 설정이 덮지 못한다. 편집 중이 아니면 저장된 칸 이름을 받는다. */
export function keepTemplateDraft(
  local: PasteTemplate["labels"] | undefined,
  incoming: PasteTemplate["labels"] | undefined,
  editing: boolean,
): PasteTemplate["labels"] {
  const here = local ?? {};
  const next = incoming ?? {};
  if (editing) return here;
  if (Object.keys(here).length > 0 && Object.keys(next).length === 0) return here;
  return next;
}

/** 어느 칸 이름의 몇 번째 값인지. 손님 값 자체는 넣지 않는다. */
export interface PasteFieldRule {
  label: string;
  /** 같은 칸 이름이 여러 번일 때 0부터. 그 값들이 같으면 0이다. */
  occurrence: number;
}

export interface PasteTemplate {
  /** 호텔에 등록된 플랫폼 id. 예전 저장은 agoda·yanolja 같은 기본 프로필 id일 수 있다. */
  platformId: string;
  /** 아고다처럼 기본 인식이 있는 플랫폼. 없으면 저장한 칸 이름만 쓴다. */
  profileId?: PastePlatformId | null;
  version: 1;
  /** 예전 양식. 칸 이름만 있고 위치는 첫 값이다. */
  labels: Partial<Record<PasteTemplateField, string>>;
  /** 칸 이름과 위치. 없으면 labels의 첫 값으로 읽는다. */
  rules?: Partial<Record<PasteTemplateField, PasteFieldRule>>;
}

export const PASTE_TEMPLATE_VERSION = 1;
export const PASTE_LABEL_MAX = 40;
export const PASTE_TEMPLATE_MAX_CHARS = 8_000;
export const PASTE_TEMPLATE_STORAGE_PREFIX = "hotori:paste-templates:v1";

/** 아고다 파트너 예약 상세에 보이는 글자. 손님이 적은 이름·번호는 없다. */
export const BUILTIN_AGODA_TEMPLATE: PasteTemplate = {
  platformId: "agoda",
  version: 1,
  labels: {
    reservationId: "예약 번호",
    guestName: "투숙객",
    checkIn: "체크인",
    checkOut: "체크아웃",
    salesTotal: "기준 판매 요금",
  },
};

export const BUILTIN_TEMPLATES: Partial<Record<PastePlatformId, PasteTemplate>> = {
  agoda: BUILTIN_AGODA_TEMPLATE,
};

const PAYMENT_WORDS = [
  "결제금액",
  "결제액",
  "결제",
  "입금예정가",
  "입금액",
  "입금",
  "수납액",
  "수납",
  "정산액",
  "정산",
  "실입금",
  "지급액",
  "지급",
  "수수료",
  "payout",
  "prepaid",
  "paid",
  "net",
];

/** 비교용. 공백·콜론·NBSP를 없애고 소문자로. 사용자 글자를 정규식으로 컴파일하지 않는다. */
export function normLabel(s: string): string {
  return s
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function compactLabel(s: string): string {
  return normLabel(s).replace(/[()（）]/g, "");
}

export function isPaymentLabel(label: string): boolean {
  const compact = compactLabel(label);
  if (!compact) return false;
  return PAYMENT_WORDS.some((w) => compact === w || compact.startsWith(w));
}

export function pasteTemplateStorageKey(hotelId: string, userId: string): string | null {
  if (!hotelId || !userId) return null;
  if (hotelId.length > 80 || userId.length > 80) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(hotelId) || !/^[A-Za-z0-9_-]+$/.test(userId)) return null;
  return `${PASTE_TEMPLATE_STORAGE_PREFIX}:${hotelId}:${userId}`;
}

export function builtinTemplate(platformId: PastePlatformId): PasteTemplate | null {
  return BUILTIN_TEMPLATES[platformId] ?? null;
}

export function templateForPlatform(
  platformId: PastePlatformId,
  saved: readonly PasteTemplate[] | null | undefined,
): PasteTemplate | null {
  const custom = saved?.find((t) => t.platformId === platformId) ?? null;
  return custom ?? builtinTemplate(platformId);
}

function isPlatformId(v: string): v is PastePlatformId {
  return (PASTE_PLATFORM_IDS as readonly string[]).includes(v);
}

const PLATFORM_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function templateProfile(template: PasteTemplate): PastePlatformId | null {
  if (template.profileId && isPlatformId(template.profileId)) return template.profileId;
  if (isPlatformId(template.platformId)) return template.platformId;
  return null;
}

function isField(v: string): v is PasteTemplateField {
  return (PASTE_TEMPLATE_FIELDS as readonly string[]).includes(v);
}

export function statusKind(line: string): "confirmed" | "cancelled" | null {
  const n = normLabel(line);
  if (!n) return null;
  if (n === "확정된예약" || n === "confirmed" || n === "bookingconfirmed") return "confirmed";
  if (
    n === "취소된예약" ||
    n === "예약취소" ||
    n === "고객취소" ||
    n === "cancelled" ||
    n === "canceled" ||
    n === "noshow" ||
    n === "no-show"
  ) {
    return "cancelled";
  }
  return null;
}

export function validatePasteTemplate(
  input: unknown,
): { ok: true; template: PasteTemplate } | { ok: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "양식 형식이 아니에요" };
  }
  const o = input as Record<string, unknown>;
  if (typeof o.platformId !== "string" || !PLATFORM_ID_RE.test(o.platformId)) {
    return { ok: false, reason: "플랫폼을 골라 주세요" };
  }
  let profileId: PastePlatformId | null = null;
  if (o.profileId != null && o.profileId !== "") {
    if (typeof o.profileId !== "string" || !isPlatformId(o.profileId)) {
      return { ok: false, reason: "플랫폼을 골라 주세요" };
    }
    profileId = o.profileId;
  }
  if (o.labels != null && (typeof o.labels !== "object" || Array.isArray(o.labels))) {
    return { ok: false, reason: "칸 이름이 잘못됐어요" };
  }
  const src = (o.labels ?? {}) as Record<string, unknown>;
  const labels: PasteTemplate["labels"] = {};
  for (const field of PASTE_TEMPLATE_FIELDS) {
    const raw = src[field];
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string") return { ok: false, reason: "칸 이름은 글자만 적어요" };
    const label = raw.replace(/[\u00a0]/g, " ").trim();
    if (!label) continue;
    if (label.length > PASTE_LABEL_MAX) return { ok: false, reason: "칸 이름이 너무 길어요" };
    if (isPaymentLabel(label)) return { ok: false, reason: "받은 돈·정산 글자는 칸 이름으로 쓸 수 없어요" };
    if (field !== "statusRaw" && statusKind(label)) return { ok: false, reason: "예약 상태 글자는 칸 이름으로 쓸 수 없어요" };
    const n = normLabel(label);
    if (n.length < 2) return { ok: false, reason: "칸 이름은 두 글자 이상이어야 해요" };
    labels[field] = label;
  }
  const rules: PasteTemplate["rules"] = {};
  const rawRules = o.rules;
  if (rawRules != null && (typeof rawRules !== "object" || Array.isArray(rawRules))) {
    return { ok: false, reason: "칸 위치가 잘못됐어요" };
  }
  const ruleSrc = (rawRules ?? {}) as Record<string, unknown>;
  for (const field of PASTE_TEMPLATE_FIELDS) {
    const item = ruleSrc[field];
    if (item == null) continue;
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "칸 위치가 잘못됐어요" };
    const label = typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label.trim() : "";
    const occurrence = (item as { occurrence?: unknown }).occurrence;
    if (!label || label !== labels[field]) continue;
    if (typeof occurrence !== "number" || !Number.isInteger(occurrence) || occurrence < 0 || occurrence > 20) {
      return { ok: false, reason: "칸 위치가 잘못됐어요" };
    }
    rules[field] = { label, occurrence };
  }
  const template: PasteTemplate = { platformId: o.platformId, version: 1, labels };
  if (Object.keys(rules).length) template.rules = rules;
  if (profileId) template.profileId = profileId;
  return { ok: true, template };
}

export function normalizePasteTemplates(raw: unknown): PasteTemplate[] {
  return readPasteTemplateStore(JSON.stringify(Array.isArray(raw) ? raw : []));
}

export function readPasteTemplateStore(raw: string | null | undefined): PasteTemplate[] {
  if (!raw) return [];
  if (raw.length > PASTE_TEMPLATE_MAX_CHARS) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { templates?: unknown }).templates)
      ? (data as { templates: unknown[] }).templates
      : null;
  if (!list) return [];
  const byPlatform = new Map<string, PasteTemplate>();
  for (const item of list) {
    const v = validatePasteTemplate(item);
    if (!v.ok) continue;
    byPlatform.set(v.template.platformId, v.template);
  }
  return [...byPlatform.values()];
}

export function serializePasteTemplateStore(templates: readonly PasteTemplate[]): string {
  const clean: PasteTemplate[] = [];
  for (const t of templates) {
    const v = validatePasteTemplate(t);
    if (!v.ok) throw new Error(v.reason);
    if (Object.keys(v.template.labels).length) clean.push(v.template);
  }
  const text = JSON.stringify({ version: PASTE_TEMPLATE_VERSION, templates: clean });
  if (text.length > PASTE_TEMPLATE_MAX_CHARS) throw new Error("양식이 너무 커요");
  return text;
}

export function loadPasteTemplates(
  getItem: (key: string) => string | null,
  hotelId: string,
  userId: string,
): PasteTemplate[] {
  const key = pasteTemplateStorageKey(hotelId, userId);
  if (!key) return [];
  try {
    return readPasteTemplateStore(getItem(key));
  } catch {
    return [];
  }
}

function isRealDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 날짜로 시작하는 줄. 요일·쉼표·괄호 시각은 같은 날짜로 본다. 문장 속 날짜는 집지 않는다. */
function splitStayStamp(raw: string): { date: string; time: string | null; badTime: boolean } | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/u) || t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/u);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isRealDate(y, mo, d)) return null;
  const date = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let rest = t.slice(m[0].length);
  rest = rest.replace(/[월화수목금토일]요일/gu, " ").replace(/[（(]\s*[월화수목금토일]\s*[)）]/gu, " ");
  const clocks = [...rest.matchAll(/(\d{1,2}):(\d{2})/g)];
  let time: string | null = null;
  let badTime = false;
  if (clocks.length > 1) badTime = true;
  else if (clocks.length === 1) {
    const h = Number(clocks[0]![1]);
    const min = Number(clocks[0]![2]);
    if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) badTime = true;
    else time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    rest = rest.replace(clocks[0]![0], " ");
  }
  if (rest.replace(/[()（）,，.\s]/gu, "")) return null;
  return { date, time: badTime ? null : time, badTime };
}

export function parseStayDate(raw: string): string | null {
  return splitStayStamp(raw)?.date ?? null;
}

export function clockOnStayLine(raw: string): { time: string | null; badTime: boolean } {
  const stamp = splitStayStamp(raw);
  if (!stamp) return { time: null, badTime: false };
  return { time: stamp.time, badTime: stamp.badTime };
}

export function parseClock(raw: string): string | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  const m = t.match(/^[（(]?\s*(\d{1,2}):(\d{2})\s*[)）]?\s*$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseAdults(raw: string): number | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  const m = t.match(/^(?:성인\s*)?(\d{1,2})\s*명?$/u);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  return n;
}

const CURRENCY = /^(KRW|USD|EUR|JPY|CNY|GBP|THB|원|₩)$/i;

export function parseSalesTotal(raw: string): {
  amount: number | null;
  currency: string | null;
  ambiguous: boolean;
  foreign: boolean;
} {
  const t = raw.replace(/\u00a0/g, " ").trim();
  if (!t) return { amount: null, currency: null, ambiguous: false, foreign: false };
  const parts = t.split(/\s+/).filter(Boolean);
  let currency: string | null = null;
  const nums: string[] = [];
  for (const part of parts) {
    const bare = part.replace(/[()（）]/g, "");
    if (CURRENCY.test(bare)) {
      if (currency) return { amount: null, currency: null, ambiguous: true, foreign: false };
      currency = bare === "₩" || bare === "원" ? "KRW" : bare.toUpperCase();
      continue;
    }
    const num = bare.replace(/원$/u, "");
    if (/^[\d,]+$/.test(num)) {
      nums.push(num);
      continue;
    }
    if (/^[\p{L}]+$/u.test(bare)) continue;
    return { amount: null, currency: null, ambiguous: true, foreign: false };
  }
  if (nums.length !== 1) {
    return { amount: null, currency, ambiguous: nums.length > 1, foreign: false };
  }
  const num = nums[0]!;
  if (!/^\d{1,3}(,\d{3})+$/.test(num) && !/^\d+$/.test(num)) {
    return { amount: null, currency, ambiguous: true, foreign: false };
  }
  const n = Number(num.replace(/,/g, ""));
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) {
    return { amount: null, currency, ambiguous: true, foreign: false };
  }
  if (currency && currency !== "KRW") return { amount: null, currency, ambiguous: false, foreign: true };
  return { amount: n, currency, ambiguous: false, foreign: false };
}

export function parseReservationToken(raw: string): string | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z-]{3,31}$/.test(t)) return null;
  if (parseStayDate(t)) return null;
  return t;
}

function isIconLine(line: string): boolean {
  return /^athena-[a-z0-9-]+$/i.test(line.trim());
}

function stripLabelPrefix(line: string, label: string): string | null {
  const lb = [...label.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, "")].filter(
    (ch) => !/\s/u.test(ch) && ch !== ":" && ch !== "：",
  );
  const src = line.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ");
  let li = 0;
  let i = 0;
  while (i < src.length && li < lb.length) {
    const ch = src[i]!;
    if (/\s/u.test(ch) || ch === ":" || ch === "：") {
      i += 1;
      continue;
    }
    if (ch.toLowerCase() !== lb[li]!.toLowerCase()) return null;
    i += 1;
    li += 1;
  }
  if (li !== lb.length) return null;
  while (i < src.length && (/\s/u.test(src[i]!) || src[i] === ":" || src[i] === "：")) i += 1;
  const rest = src.slice(i).trim();
  if (/^[（(]/u.test(rest)) return "";
  return rest;
}

function matchLabel(line: string, label: string): { rest: string } | null {
  const lb = normLabel(label);
  if (lb.length < 2) return null;
  const ln = normLabel(line);
  if (!ln.startsWith(lb)) return null;
  if (ln !== lb) {
    const restNorm = ln.slice(lb.length);
    const note = restNorm.startsWith("(") || restNorm.startsWith("（");
    const inlineValue = /\d/u.test(restNorm);
    const colonValue = /[：:]/u.test(line);
    if (!note && !inlineValue && !colonValue) return null;
  }
  const rest = stripLabelPrefix(line, label);
  if (rest == null) return null;
  return { rest };
}

/** 기본 아고다 글자와 같은 칸일 때만 같이 보는 다른 표기. 사용자가 칸 이름을 바꾸면 그 글자만 쓴다. */
const AGODA_LABEL_ALIASES: Partial<Record<PasteTemplateField, string[]>> = {
  reservationId: ["예약 번호", "예약번호"],
  guestName: ["투숙객 이름", "투숙객"],
  guestPhone: ["연락처 정보", "연락처", "전화"],
  adults: ["성인"],
  statusRaw: ["상태", "예약상태"],
  checkInTime: ["입실 시각"],
  checkOutTime: ["퇴실 시각"],
  currency: ["통화"],
  nights: ["박수", "숙박일수", "숙박 기간"],
  typeRaw: ["객실 종류 및 혜택"],
  checkIn: ["체크인"],
  checkOut: ["체크아웃"],
  salesTotal: ["기준 판매 요금"],
};

function labelsFor(template: PasteTemplate): { field: PasteTemplateField; label: string }[] {
  const rows: { field: PasteTemplateField; label: string }[] = [];
  for (const field of PASTE_TEMPLATE_FIELDS) {
    const own = template.labels[field]?.trim() ?? "";
    const aliases = templateProfile(template) === "agoda" ? (AGODA_LABEL_ALIASES[field] ?? []) : [];
    const builtin = BUILTIN_AGODA_TEMPLATE.labels[field]?.trim() ?? "";
    const replaced = !!own && normLabel(own) !== normLabel(builtin) && !aliases.some((a) => normLabel(a) === normLabel(own));
    const labels = replaced ? [own] : [...new Set([own, ...aliases].filter((x) => x.length > 0))];
    for (const label of labels) rows.push({ field, label });
  }
  return rows.sort((a, b) => normLabel(b.label).length - normLabel(a.label).length);
}

function splitLines(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[\u200b\u200c\u200d\ufeff]/g, "").replace(/\u00a0/g, " "));
}

function hasStrongTable(text: string): boolean {
  if (/<table[\s>]/i.test(text)) return true;
  return splitLines(text).some((l) => l.split("\t").length >= 4);
}

/**
 * 아고다 파트너 상세의 고유 글자. 저장된 양식이 다른 플랫폼 표를 가로채지 못하게
 * 기본 글자만 보고, 사용자가 적은 라벨은 여기 쓰지 않는다.
 */
export function agodaPartnerSignature(text: string): boolean {
  if (!text.trim() || hasStrongTable(text)) return false;
  const lines = splitLines(text);
  const hasIcon = lines.some((l) => isIconLine(l));
  const norms = lines.map((l) => normLabel(l));
  const has = (label: string) => norms.some((n) => n.startsWith(normLabel(label)));
  const hasSell = has("기준 판매 요금");
  const hasConfirm = norms.some((n) => n === normLabel("확정된 예약"));
  const hasCheck = has("체크인") || has("체크아웃");
  const hasRes = has("예약 번호") || has("예약번호");
  if (hasIcon && hasCheck && (hasSell || hasConfirm || hasRes)) return true;
  if (hasSell && hasCheck && hasRes) return true;
  if (hasConfirm && hasCheck && hasRes) return true;
  return false;
}

export interface LabeledExtract {
  reservationId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  adults: number | null;
  typeRaw: string | null;
  checkIn: string | null;
  checkOut: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number | null;
  salesTotal: number | null;
  currency: string | null;
  statusRaw: string | null;
  statusKind: "confirmed" | "cancelled" | null;
  warnings: string[];
}

function emptyExtract(): LabeledExtract {
  return {
    reservationId: null,
    guestName: null,
    guestPhone: null,
    adults: null,
    typeRaw: null,
    checkIn: null,
    checkOut: null,
    checkInTime: null,
    checkOutTime: null,
    nights: null,
    salesTotal: null,
    currency: null,
    statusRaw: null,
    statusKind: null,
    warnings: [],
  };
}

interface Hit {
  field: PasteTemplateField;
  label: string;
  lineIndex: number;
  rest: string;
}

function findHits(lines: string[], template: PasteTemplate): Hit[] {
  const entries = labelsFor(template);
  const hits: Hit[] = [];
  lines.forEach((line, lineIndex) => {
    if (!line.trim() || isIconLine(line) || statusKind(line)) return;
    for (const e of entries) {
      const m = matchLabel(line, e.label);
      if (!m) continue;
      hits.push({ field: e.field, label: e.label, lineIndex, rest: m.rest });
      return;
    }
  });
  return hits;
}

function canonRaw(field: PasteTemplateField, raw: string): string {
  if (field === "checkIn" || field === "checkOut") {
    // 요약은 `2026년 11월 7일` + `(16:00)`, 상세는 `…토요일, 16:00`처럼 같은 날을 달리 적는다.
    return parseStayDate(raw) ?? raw.trim();
  }
  if (field === "checkInTime" || field === "checkOutTime") return parseClock(raw) ?? clockOnStayLine(raw).time ?? raw.trim();
  if (field === "adults") {
    const n = parseAdults(raw);
    return n == null ? raw.trim() : String(n);
  }
  if (field === "salesTotal") {
    const money = parseSalesTotal(raw);
    return money.amount == null ? raw.trim() : `${money.currency ?? ""}|${money.amount}`;
  }
  if (field === "reservationId") return parseReservationToken(raw) ?? raw.trim();
  if (field === "nights") {
    const m = raw.match(/(\d{1,3})/u);
    return m ? String(Number(m[1])) : raw.trim();
  }
  return raw.replace(/\s+/g, " ").trim();
}

function nextContent(lines: string[], start: number, labelLines: Set<number>): { index: number; text: string } | null {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || isIconLine(line)) continue;
    if (labelLines.has(i) || statusKind(line)) return null;
    return { index: i, text: line.trim() };
  }
  return null;
}

function clockAfter(lines: string[], afterIndex: number, labelLines: Set<number>): { time: string | null; invalid: boolean } {
  for (let i = afterIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || isIconLine(line)) continue;
    if (labelLines.has(i) || statusKind(line)) return { time: null, invalid: false };
    const clock = parseClock(line);
    if (clock) return { time: clock, invalid: false };
    if (/^[（(]?\s*\d{1,2}:\d{2}/u.test(line.trim())) return { time: null, invalid: true };
    return { time: null, invalid: false };
  }
  return { time: null, invalid: false };
}

function extractBlock(lines: string[], template: PasteTemplate): LabeledExtract {
  const out = emptyExtract();
  const hits = findHits(lines, template);
  const labelLines = new Set(hits.map((h) => h.lineIndex));
  const confirmLines: string[] = [];
  const cancelLines: string[] = [];
  for (const line of lines) {
    const kind = statusKind(line);
    if (kind === "confirmed") confirmLines.push(line.trim());
    else if (kind === "cancelled") cancelLines.push(line.trim());
  }
  if (confirmLines.length && cancelLines.length) {
    out.warnings.push("예약 상태가 서로 달라 비웠어요");
  } else if (confirmLines.length) {
    out.statusKind = "confirmed";
    out.statusRaw = confirmLines[0]!;
  } else if (cancelLines.length) {
    out.statusKind = "cancelled";
    out.statusRaw = cancelLines[0]!;
  }

  const byField = new Map<PasteTemplateField, Hit[]>();
  for (const hit of hits) {
    const list = byField.get(hit.field) ?? [];
    list.push(hit);
    byField.set(hit.field, list);
  }

  const valueOf = (hit: Hit): { raw: string; index: number } => {
    if (hit.rest.trim()) return { raw: hit.rest.trim(), index: hit.lineIndex };
    const next = nextContent(lines, hit.lineIndex + 1, labelLines);
    return next ? { raw: next.text, index: next.index } : { raw: "", index: hit.lineIndex };
  };
  const take = (field: PasteTemplateField): { raw: string; index: number } | { conflict: true } | null => {
    const list = byField.get(field);
    if (!list?.length) return null;
    const rule = template.rules?.[field];
    let pool = list;
    if (rule) {
      const same = list.filter((hit) => normLabel(hit.label) === normLabel(rule.label));
      const hit = same[rule.occurrence] ?? same[0];
      if (!hit) return null;
      pool = [hit];
    }
    const values = pool.map(valueOf);
    const first = values[0]!;
    if (values.some((v) => canonRaw(field, v.raw) !== canonRaw(field, first.raw))) return { conflict: true };
    if (!first.raw) return { raw: "", index: first.index };
    return first;
  };

  const id = take("reservationId");
  if (id && "conflict" in id) out.warnings.push("예약번호 글자가 서로 달라 비웠어요");
  else if (id) {
    const token = parseReservationToken(id.raw);
    if (token) out.reservationId = token;
    else if (id.raw) out.warnings.push("예약번호를 읽지 못했어요");
  }

  const guest = take("guestName");
  if (guest && "conflict" in guest) out.warnings.push("투숙객 글자가 서로 달라 비웠어요");
  else if (guest?.raw) {
    const name = guest.raw.replace(/\u00a0/g, " ").trim();
    if (!name || name.length > 80 || isIconLine(name) || statusKind(name) || parseClock(name) || parseStayDate(name) || /^\d+$/.test(name)) {
      out.warnings.push("투숙객을 읽지 못했어요");
    } else out.guestName = name;
  }

  const phone = take("guestPhone");
  if (phone && "conflict" in phone) out.warnings.push("연락처 글자가 서로 달라 비웠어요");
  else if (phone?.raw) {
    const t = phone.raw.trim();
    if (t.length <= 40 && /\d/.test(t) && !parseStayDate(t) && !parseClock(t)) out.guestPhone = t;
    else out.warnings.push("연락처를 읽지 못했어요");
  }

  const adultsPick = take("adults");
  if (adultsPick && "conflict" in adultsPick) out.warnings.push("인원 글자가 서로 달라 비웠어요");
  else if (adultsPick?.raw) {
    const n = parseAdults(adultsPick.raw);
    if (n == null) out.warnings.push("인원을 읽지 못했어요");
    else out.adults = n;
  } else {
    const adultsLine = lines.find((line) => parseAdults(line) != null && /성인|인원/u.test(line));
    if (adultsLine) {
      const n = parseAdults(adultsLine);
      if (n != null) out.adults = n;
    }
  }

  const typeRaw = take("typeRaw");
  if (typeRaw && "conflict" in typeRaw) out.warnings.push("객실 타입 글자가 서로 달라 비웠어요");
  else if (typeRaw?.raw) {
    const t = typeRaw.raw.trim();
    if (!t || t.length > 80 || isIconLine(t) || statusKind(t) || parseClock(t) || parseStayDate(t)) {
      out.warnings.push("객실 타입을 읽지 못했어요");
    } else {
      out.typeRaw = t;
      const rooms = t.match(/^(\d{1,2})\s*[xX×]\s+/u);
      const count = rooms ? Number(rooms[1]) : null;
      if (count != null && count > 1) out.warnings.push(`객실 ${count}개로 보여요. 한 줄만 두고 나머지는 만들지 않아요`);
    }
  }

  const statusPick = take("statusRaw");
  if (statusPick && "conflict" in statusPick) out.warnings.push("상태 글자가 서로 달라 비웠어요");
  else if (statusPick?.raw && !out.statusRaw) {
    out.statusRaw = statusPick.raw.trim();
    out.statusKind = statusKind(statusPick.raw);
  }

  const nightsPick = take("nights");
  if (nightsPick && "conflict" in nightsPick) out.warnings.push("박수 글자가 서로 달라 비웠어요");
  else if (nightsPick?.raw && out.nights == null) {
    const m = nightsPick.raw.match(/(\d{1,3})\s*박?/u);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 366) out.nights = n;
    else out.warnings.push("박수를 읽지 못했어요");
  }

  const readDate = (
    field: "checkIn" | "checkOut",
    label: string,
  ): { date: string | null; time: string | null } => {
    const hit = take(field);
    if (!hit) return { date: null, time: null };
    if ("conflict" in hit) {
      out.warnings.push(`${label} 글자가 서로 달라 비웠어요`);
      return { date: null, time: null };
    }
    if (!hit.raw) return { date: null, time: null };
    const date = parseStayDate(hit.raw);
    if (!date) {
      out.warnings.push(`${label} 날짜를 읽지 못했어요`);
      return { date: null, time: null };
    }
    const inline = clockOnStayLine(hit.raw);
    if (inline.badTime) out.warnings.push(`${label} 시각을 읽지 못했어요`);
    if (inline.time) return { date, time: inline.time };
    const clock = clockAfter(lines, hit.index, labelLines);
    if (clock.invalid) out.warnings.push(`${label} 시각을 읽지 못했어요`);
    return { date, time: clock.time };
  };

  const cin = readDate("checkIn", "체크인");
  const cout = readDate("checkOut", "체크아웃");
  out.checkIn = cin.date;
  out.checkOut = cout.date;
  out.checkInTime = cin.time;
  out.checkOutTime = cout.time;
  const readClock = (field: "checkInTime" | "checkOutTime", label: string): string | null => {
    const hit = take(field);
    if (!hit) return null;
    if ("conflict" in hit) {
      out.warnings.push(`${label}이 서로 달라 비웠어요`);
      return null;
    }
    if (!hit.raw) return null;
    const inline = parseClock(hit.raw) ?? clockOnStayLine(hit.raw).time;
    if (inline) return inline;
    const after = clockAfter(lines, hit.index, labelLines);
    if (after.time) return after.time;
    out.warnings.push(`${label}을 읽지 못했어요`);
    return null;
  };
  const inClock = readClock("checkInTime", "입실 시각");
  const outClock = readClock("checkOutTime", "퇴실 시각");
  if (inClock) out.checkInTime = inClock;
  if (outClock) out.checkOutTime = outClock;
  if (out.checkIn && out.checkOut) {
    const nights = nightsBetween(out.checkIn, out.checkOut);
    if (nights >= 1 && nights <= 366) {
      if (out.nights != null && out.nights !== nights) {
        out.warnings.push("숙박 기간과 날짜 차이가 달라요. 박수는 날짜 차이로 보이니 확인하세요");
      }
      out.nights = nights;
    } else out.warnings.push("체크아웃이 체크인보다 이르거나 너무 멀어 박수를 비웠어요");
  }

  const money = take("salesTotal");
  if (money && "conflict" in money) out.warnings.push("판매 총액 글자가 서로 달라 비웠어요");
  else if (money?.raw) {
    const parsed = parseSalesTotal(money.raw);
    if (parsed.ambiguous && template.rules?.salesTotal) {
      const first = money.raw.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/u);
      const n = first ? Number(first[1]!.replace(/,/g, "")) : NaN;
      if (Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000 && parsed.currency !== "USD" && parsed.currency !== "EUR") {
        out.salesTotal = n;
        out.currency = parsed.currency && parsed.currency !== "KRW" ? null : "KRW";
      }
    } else if (parsed.ambiguous) out.warnings.push("판매 금액을 하나로 정할 수 없어요");
    else if (parsed.foreign) {
      out.currency = parsed.currency;
      out.warnings.push("통화가 KRW가 아니라 판매 총액을 비웠어요");
    } else if (parsed.amount != null && parsed.currency !== "KRW") {
      out.warnings.push("통화를 읽지 못해서 판매 총액을 비웠어요");
    } else {
      out.salesTotal = parsed.amount;
      out.currency = parsed.currency;
    }
  }

  const currencyPick = take("currency");
  if (currencyPick && "conflict" in currencyPick) out.warnings.push("통화 글자가 서로 달라 비웠어요");
  else if (currencyPick?.raw) {
    const fromMoney = parseSalesTotal(currencyPick.raw).currency;
    const bare = currencyPick.raw.trim().toUpperCase();
    const code = fromMoney ?? (/^[A-Z]{3}$/.test(bare) ? bare : null);
    if (!code) out.warnings.push("통화를 읽지 못했어요");
    else if (out.currency && out.currency !== code) {
      out.warnings.push("통화가 서로 달라 판매 총액을 비웠어요");
      out.salesTotal = null;
      out.currency = null;
    } else out.currency = code;
  }

  if (!out.typeRaw) out.warnings.push("객실 타입·호실·방 수는 원문에 없어요");
  return out;
}

function useful(ex: LabeledExtract): boolean {
  return !!(ex.reservationId || ex.guestName || ex.checkIn || ex.checkOut || ex.salesTotal != null);
}

function blocksFor(lines: string[], template: PasteTemplate): string[][] {
  const label = template.rules?.reservationId?.label?.trim() || template.labels.reservationId?.trim();
  if (!label) return [lines];
  const marks: { index: number; token: string }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim() || !matchLabel(line, label)) return;
    const rest = matchLabel(line, label)?.rest.trim() ?? "";
    const raw = rest || lines.slice(index + 1).find((next) => next.trim() && !isIconLine(next))?.trim() || "";
    const token = parseReservationToken(raw) ?? raw;
    if (token) marks.push({ index, token });
  });
  const tokens = new Set(marks.map((mark) => mark.token));
  if (tokens.size <= 1) return [lines];
  const blocks = marks.map((mark, k) => lines.slice(mark.index, marks[k + 1]?.index ?? lines.length));
  if (blocks.every((block) => extractBlock(block, template).reservationId)) return blocks;
  return [lines];
}

export function extractLabeledPaste(text: string, template: PasteTemplate): LabeledExtract[] {
  const lines = splitLines(text);
  return blocksFor(lines, template).map((block) => extractBlock(block, template));
}

export interface LabeledTable {
  headers: string[];
  rows: string[][];
  delimiter: "tab";
}

const LABELED_HEADERS = [
  "예약번호",
  "투숙객",
  "연락처",
  "객실타입",
  "체크인",
  "체크아웃",
  "박수",
  "판매금액",
  "예약상태",
  "성인",
  "입실 시각",
  "퇴실 시각",
  "통화",
  "안내",
] as const;

function toTable(rows: LabeledExtract[]): LabeledTable | null {
  const usefulRows = rows.filter(useful);
  if (!usefulRows.length) return null;
  return {
    headers: [...LABELED_HEADERS],
    delimiter: "tab",
    rows: usefulRows.map((ex) => [
      ex.reservationId ?? "",
      ex.guestName ?? "",
      ex.guestPhone ?? "",
      ex.typeRaw ?? "",
      ex.checkIn ?? "",
      ex.checkOut ?? "",
      ex.nights == null ? "" : String(ex.nights),
      ex.salesTotal == null ? "" : String(ex.salesTotal),
      ex.statusRaw ?? "",
      ex.adults == null ? "" : String(ex.adults),
      ex.checkInTime ?? "",
      ex.checkOutTime ?? "",
      ex.currency ?? "",
      ex.warnings.join("\n"),
    ]),
  };
}

export function parseAgodaLabeledTable(
  raw: string,
  saved?: readonly PasteTemplate[] | null,
): LabeledTable | null {
  if (!agodaPartnerSignature(raw)) return null;
  const custom = saved?.find((t) => templateProfile(t) === "agoda") ?? null;
  let rows = extractLabeledPaste(raw, custom ?? BUILTIN_AGODA_TEMPLATE);
  const missed = rows.every((r) => !r.reservationId && !r.checkIn && !r.checkOut);
  if (custom && missed) rows = extractLabeledPaste(raw, BUILTIN_AGODA_TEMPLATE);
  return toTable(rows);
}

/** 표 인식이 실패하고 직원이 플랫폼을 직접 골랐을 때만. 다른 플랫폼의 표를 바꾸지 않는다. */
export function parseManualLabeledTable(
  raw: string,
  platformId: string,
  saved?: readonly PasteTemplate[] | null,
): LabeledTable | null {
  if (!raw.trim() || hasStrongTable(raw)) return null;
  const custom = saved?.find((t) => t.platformId === platformId) ?? null;
  const agoda = platformId === "agoda" || (custom != null && templateProfile(custom) === "agoda");
  if (agodaPartnerSignature(raw) && !agoda) return null;
  const template = custom ?? (agoda ? BUILTIN_AGODA_TEMPLATE : null);
  if (!template) return null;
  let rows = extractLabeledPaste(raw, template);
  const missed = rows.every((r) => !r.reservationId && !r.checkIn && !r.checkOut);
  if (agoda && custom && missed) rows = extractLabeledPaste(raw, BUILTIN_AGODA_TEMPLATE);
  return toTable(rows);
}

const SECTION_LINES = new Set(
  [
    "예약정보",
    "결제및요금",
    "정산(upc)",
    "정산upc",
    "셀프서비스",
    "smartflex",
    "예약로그",
    "객실및투숙인원",
    "투숙객세부사항및날짜정보",
    "요청사항및참고사항",
  ].map(normLabel),
);

function isSectionLine(line: string): boolean {
  return SECTION_LINES.has(normLabel(line));
}

/** 값과 모양이 같아도(예: `대한민국` 다음 `연락처 정보`) 항상 칸 이름인 줄. */
const KNOWN_HEADINGS = new Set(
  [
    ...Object.values(AGODA_LABEL_ALIASES).flat(),
    "투숙객 거주 국가",
    "아동",
    "간이침대",
    "특별 요청 사항",
    "최종 변경",
  ].map(normLabel),
);

function isKnownHeading(line: string): boolean {
  return KNOWN_HEADINGS.has(normLabel(cleanHeader(line))) || /^예약\s*생성일/u.test(line.trim());
}

function isLabelish(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40 || isIconLine(t) || isSectionLine(t) || statusKind(t)) return false;
  if (splitStayStamp(t) || parseClock(t) || parseReservationToken(t) || parseAdults(t)) return false;
  if (/^\d{1,3}\s*박$/u.test(t)) return false;
  if (/^(KRW|USD|EUR|JPY|CNY|GBP|THB)$/i.test(t)) return false;
  if (/[A-Za-z]/u.test(t) && /\s/u.test(t)) return false;
  const money = parseSalesTotal(t);
  if (money.amount != null || money.foreign || /^\d{1,2}\s*[xX×]\s+\S/u.test(t)) return false;
  return true;
}

export interface PasteReadLine {
  /** 보여 주는 값. 같은 줄이면 콜론 뒤만. */
  text: string;
  /** 이 줄을 고르면 저장할 칸 이름. 값이면 위 줄이나 콜론 앞, 칸 이름이면 그 줄. */
  label: string;
  /** 원문에서 이 값이 시작하는 위치. 부분 선택에 쓴다. */
  valueStart: number;
  valueEnd: number;
  /** `칸 이름: 값`처럼 한 줄에 둘 다 있다. */
  inline?: boolean;
}

function headerFlags(lines: string[]): boolean[] {
  const flags = lines.map(() => false);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isKnownHeading(lines[i]!)) {
      flags[i] = true;
      continue;
    }
    if (!isLabelish(lines[i]!)) continue;
    const next = lines[i + 1];
    if (!next) continue;
    flags[i] = !isLabelish(next) || !flags[i + 1]!;
  }
  // 이름 다음에 `성인 2명`처럼 자기 제목을 가진 줄이 오면, 이름을 항목으로 뒤집지 않는다.
  // 바로 위 제목이 항목이고, 고른 줄이 값이다.
  const first = flags.slice();
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!first[i]) continue;
    const next = lines[i + 1] ?? "";
    if (!/^성인\s*\d/u.test(next.trim())) continue;
    const prev = i > 0 ? lines[i - 1]! : "";
    if (prev && isLabelish(prev) && !statusKind(prev) && (!first[i - 1] || isKnownHeading(prev))) {
      flags[i] = false;
      flags[i - 1] = true;
    }
  }
  return flags;
}

function cleanHeader(line: string): string {
  return line.replace(/\s*[：:]\s*$/u, "").trim();
}

function contentSpans(text: string): { text: string; start: number; end: number }[] {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: { text: string; start: number; end: number }[] = [];
  let offset = 0;
  for (const part of src.split("\n")) {
    const lead = part.length - part.trimStart().length;
    const trimmed = part.replace(/[\u200b\u200c\u200d\ufeff]/g, "").replace(/\u00a0/g, " ").trim();
    if (trimmed && !isIconLine(trimmed)) out.push({ text: trimmed, start: offset + lead, end: offset + lead + part.trim().length });
    offset += part.length + 1;
  }
  return out;
}

/** 붙여넣은 글을 줄로 읽는다. 아이콘·빈 줄만 빼고, 나머지는 전부 보여 준다. */
export function readPasteLines(text: string): PasteReadLine[] {
  const spans = contentSpans(text);
  const lines = spans.map((span) => span.text);
  const headers = headerFlags(lines);
  return spans.map((span, i) => {
    const line = span.text;
    const adult = line.match(/^(성인)\s*\d{1,2}\s*명$/u);
    if (adult) return { text: line, label: adult[1]!, valueStart: span.start, valueEnd: span.end, inline: true };
    const colon = line.match(/^(.{2,40}?)\s*[：:]\s*(\S.*)$/u);
    const timeColon = !!colon && /\d\s*$/u.test(colon[1]!) && /^\d/u.test(colon[2]!);
    if (colon && !timeColon && isLabelish(colon[1]!)) {
      const value = colon[2]!.trim();
      const at = line.lastIndexOf(value);
      return { text: value, label: cleanHeader(colon[1]!), valueStart: span.start + Math.max(0, at), valueEnd: span.start + Math.max(0, at) + value.length, inline: true };
    }
    if (statusKind(line) || isSectionLine(line)) return { text: line, label: line, valueStart: span.start, valueEnd: span.end };
    if (headers[i]) return { text: cleanHeader(line), label: cleanHeader(line), valueStart: span.start, valueEnd: span.end };
    for (let j = i - 1; j >= 0; j--) {
      if (isSectionLine(lines[j]!)) break;
      if (!headers[j]) continue;
      return { text: line, label: cleanHeader(lines[j]!), valueStart: span.start, valueEnd: span.end };
    }
    return { text: line, label: cleanHeader(line), valueStart: span.start, valueEnd: span.end };
  });
}

/** 원문에서 드래그하거나 키보드로 고른 구간이 어느 값인지. 같은 글자가 여러 번이어도 그 위치만. */
export function lineIndexForSelection(lines: readonly PasteReadLine[], start: number, end: number): number {
  if (end <= start) return -1;
  let best = -1;
  let bestOverlap = 0;
  lines.forEach((line, i) => {
    const overlap = Math.min(end, line.valueEnd) - Math.max(start, line.valueStart);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  });
  return best;
}

export interface PasteValueChoice {
  label: string;
  value: string;
}

/** 붙여넣은 글에서 '칸 이름 → 값'만 고른다. 손님 글 전체를 양식으로 저장하지 않기 위한 목록. */
export function listPasteChoices(text: string): PasteValueChoice[] {
  const lines = readPasteLines(text).filter((l) => !isSectionLine(l.text));
  const out: PasteValueChoice[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.label === line.text && isLabelish(line.text) && !statusKind(line.text) && !/^(성인)\s*\d/u.test(line.text)) continue;
    const stamp = splitStayStamp(line.text);
    let value = line.text;
    if (stamp && !stamp.time) {
      const next = lines[i + 1];
      const clock = next ? parseClock(next.text) : null;
      if (clock) value = `${value} ${clock}`;
    }
    const key = `${normLabel(line.label)}\0${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: line.label, value });
  }
  return out;
}

/** 고른 줄의 칸 이름과 위치. 칸 이름이 없는 값이면 null이다. */
export function ruleForPickedLine(lines: PasteReadLine[], index: number, field: PasteTemplateField): PasteFieldRule | null {
  const line = lines[index];
  if (!line) return null;
  if (statusKind(line.text)) return { label: line.text.trim(), occurrence: 0 };
  let label = line.label.trim();
  if (!label || label === line.text) {
    label = "";
    for (let j = index - 1; j >= 0; j--) {
      const text = lines[j]!.text.trim();
      if (isSectionLine(text)) break;
      if (!text || statusKind(text)) continue;
      if (isLabelish(text)) {
        label = cleanHeader(text);
        break;
      }
    }
    if (!label) return null;
  }
  const values = lines.filter((item) => item.label.trim() === label && item.text !== item.label);
  // 저장하는 순번은 같은 칸 이름이 몇 번째로 나온 곳인지다. 값이 여러 줄이어도 칸 이름 하나로 센다.
  const headingsUpTo = lines
    .slice(0, index + 1)
    .filter((item) => item.label.trim() === label && (item.inline || item.text.trim() === label)).length;
  const occurrence = Math.max(0, headingsUpTo - 1);
  const same = values
    .filter((item) => choiceFitsField(field, item.text))
    .every((item) => canonRaw(field, item.text) === canonRaw(field, line.text));
  return { label, occurrence: same ? 0 : occurrence };
}

export function readFieldValue(text: string, field: PasteTemplateField, label: string, occurrence = 0): string {
  if (!label.trim()) return "";
  const template: PasteTemplate = {
    platformId: "p-read",
    version: 1,
    labels: { [field]: label },
    rules: { [field]: { label, occurrence } },
  };
  const row = extractLabeledPaste(text, template)[0];
  if (!row) return "";
  if (field === "reservationId") return row.reservationId ?? "";
  if (field === "guestName") return row.guestName ?? "";
  if (field === "guestPhone") return row.guestPhone ?? "";
  if (field === "adults") return row.adults == null ? "" : String(row.adults);
  if (field === "statusRaw") return row.statusRaw ?? "";
  if (field === "nights") return row.nights == null ? "" : String(row.nights);
  if (field === "checkInTime") return row.checkInTime ?? "";
  if (field === "checkOutTime") return row.checkOutTime ?? "";
  if (field === "currency") return row.currency ?? "";
  if (field === "typeRaw") return row.typeRaw ?? "";
  if (field === "checkIn") return [row.checkIn, row.checkInTime].filter(Boolean).join(" ");
  if (field === "checkOut") return [row.checkOut, row.checkOutTime].filter(Boolean).join(" ");
  if (field === "salesTotal") return row.salesTotal == null ? "" : `${row.currency ?? ""} ${row.salesTotal}`.trim();
  return "";
}

export function choiceFitsField(field: PasteTemplateField, value: string): boolean {
  if (field === "statusRaw") return statusKind(value) != null || (value.trim().length >= 2 && value.trim().length <= 20 && !splitStayStamp(value) && parseSalesTotal(value).amount == null);
  if (statusKind(value)) return false;
  if (field === "reservationId") return parseReservationToken(value) != null;
  if (field === "nights") return /^(?:\/\s*)?\d{1,3}\s*박?$/u.test(value.trim());
  if (field === "adults") return parseAdults(value) != null;
  if (field === "checkInTime" || field === "checkOutTime") return parseClock(value) != null || clockOnStayLine(value).time != null;
  if (field === "currency") return parseSalesTotal(value).currency != null || /^(KRW|USD|EUR|JPY|CNY|GBP|THB)$/i.test(value.trim());
  if (field === "guestName") {
    const t = value.trim();
    return t.length >= 2 && t.length <= 80 && !splitStayStamp(t) && !parseClock(t) && !parseReservationToken(t) && parseSalesTotal(t).amount == null && !/^\d/u.test(t);
  }
  if (field === "guestPhone") return /\d/.test(value) && !splitStayStamp(value) && value.trim().length <= 40;
  if (field === "checkIn" || field === "checkOut") return parseStayDate(value) != null;
  if (field === "salesTotal") {
    if (/^\d{1,2}\s*[xX×]\s+/u.test(value.trim())) return false;
    const money = parseSalesTotal(value);
    return (money.amount != null || money.foreign) && !money.ambiguous;
  }
  if (field === "typeRaw") {
    const t = value.trim();
    if (/^\d{1,2}\s*[xX×]\s+\S/u.test(t)) return true;
    return t.length >= 2 && t.length <= 80 && !splitStayStamp(t) && parseSalesTotal(t).amount == null && !parseReservationToken(t);
  }
  return false;
}

/** 표·카드가 아닌 세로 글이면 저장한 양식을 일반 표 해석보다 먼저 본다. */
export function canUseSavedTemplate(text: string): boolean {
  return !!text.trim() && !hasStrongTable(text);
}

export function parseBestSavedTemplate(
  text: string,
  saved?: readonly PasteTemplate[] | null,
): { table: LabeledTable; platformId: string } | null {
  if (!canUseSavedTemplate(text) || agodaPartnerSignature(text)) return null;
  let best: { template: PasteTemplate; score: number } | null = null;
  let second = 0;
  for (const template of saved ?? []) {
    const lines = splitLines(text);
    const fields = new Set<PasteTemplateField>();
    for (const { field, label } of labelsFor(template)) {
      if (lines.some((line) => matchLabel(line, label))) fields.add(field);
    }
    const usefulHit = fields.has("reservationId") || fields.has("checkIn") || fields.has("checkOut");
    const score = usefulHit ? fields.size : 0;
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { template, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < 2 || best.score - second < 1) return null;
  const table = parseManualLabeledTable(text, best.template.platformId, saved);
  if (!table) return null;
  return { table, platformId: best.template.platformId };
}

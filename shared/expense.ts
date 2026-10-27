// 지출: 수리·비품구매 등 분류 + 사용처·품목 · (거래처) · (입고일) · (금액) · 미수/입금 · 카드/현금/이체 · 영업일.
// 분류 이름은 등록 시점의 값으로 복사해 둬서, 설정에서 이름을 바꿔도 지난 기록은 그대로예요.
export type ExpensePayMethod = "card" | "cash" | "transfer";
export const EXPENSE_PAY_METHODS: ExpensePayMethod[] = ["card", "cash", "transfer"];
export const EXPENSE_PAY_LABEL: Record<ExpensePayMethod, string> = { card: "카드", cash: "현금", transfer: "이체" };
export const isExpensePayMethod = (v: unknown): v is ExpensePayMethod => v === "card" || v === "cash" || v === "transfer";

/** 거래처 종류: 마트 · 상사 · 옥션(온라인샵) · 기타 */
export type VendorType = "mart" | "wholesaler" | "auction" | "other";
export const VENDOR_TYPES: VendorType[] = ["mart", "wholesaler", "auction", "other"];
export const VENDOR_TYPE_LABEL: Record<VendorType, string> = {
  mart: "마트",
  wholesaler: "상사",
  auction: "옥션",
  other: "기타",
};
export const isVendorType = (v: unknown): v is VendorType =>
  v === "mart" || v === "wholesaler" || v === "auction" || v === "other";

export const EXPENSE_VENDOR_NAME_MAX = 40;

export interface ExpenseVendor {
  id: string;
  name: string;
  vendorType: VendorType;
  createdAt: string;
}

export interface ExpenseCategory {
  id: string;
  name: string; // 비어 있으면 지출 창에 안 나와요
}
export const EXPENSE_CATEGORY_MAX = 12; // 분류 이름 글자 수
export const EXPENSE_MEMO_MAX = 200;
export const EXPENSE_AMOUNT_MAX = 100_000_000;
/** 프론트 주 분류 수리·비품구매를 앞에, 나머지는 기존처럼 확장 */
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = ["수리", "비품구매", "식자재", "세탁", "공과금", "기타"].map((name, i) => ({
  id: `ec-${i + 1}`,
  name,
}));

/** 설정 JSON의 지출 분류: 없으면 기본 6개, 이상한 값은 걸러요 */
export function normalizeExpenseCategories(raw: unknown): ExpenseCategory[] {
  if (!Array.isArray(raw)) return DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set<string>();
  return raw
    .filter((c): c is ExpenseCategory => !!c && typeof c === "object" && typeof c.id === "string" && !!c.id && !seen.has(c.id) && !!seen.add(c.id))
    .slice(0, 40)
    .map((c) => ({ id: c.id, name: typeof c.name === "string" ? c.name.slice(0, EXPENSE_CATEGORY_MAX) : "" }));
}

export interface Expense {
  id: string;
  bizDate: string; // 영업일 YYYY-MM-DD
  stockInDate: string | null; // 입고날짜 (없으면 null)
  category: string; // 등록 시점의 분류 이름
  amount: number; // 원 · 0이면 아직 미정
  method: ExpensePayMethod | null; // 입금 완료면 필수
  paid: boolean; // false = 미수금(AP)
  memo: string | null; // 사용처·품목 (자유 기입)
  vendorId: string | null;
  vendorName: string | null; // 조인·표시용 (없으면 null)
  vendorType: VendorType | null;
  createdAt: string;
}

export interface ExpenseTotals {
  amount: number;
  count: number;
  card: number;
  cash: number;
  transfer: number;
  unpaid: number; // 미수금 합(금액 있는 것만)
  unpaidCount: number;
  byCategory: Map<string, number>;
}
export function expenseTotals(list: Expense[]): ExpenseTotals {
  const t: ExpenseTotals = { amount: 0, count: 0, card: 0, cash: 0, transfer: 0, unpaid: 0, unpaidCount: 0, byCategory: new Map() };
  for (const e of list) {
    t.amount += e.amount;
    t.count++;
    if (e.paid && e.method) t[e.method] += e.amount;
    if (!e.paid) {
      t.unpaid += e.amount;
      t.unpaidCount++;
    }
    t.byCategory.set(e.category, (t.byCategory.get(e.category) ?? 0) + e.amount);
  }
  return t;
}

/** 월별 분류 합계 (Pro): [{month: '2026-10', total, byCategory}] 최근 달이 위로 */
export function monthlyByCategory(list: Expense[]): { month: string; total: number; byCategory: Map<string, number> }[] {
  const m = new Map<string, { month: string; total: number; byCategory: Map<string, number> }>();
  for (const e of list) {
    const k = e.bizDate.slice(0, 7);
    const row = m.get(k) ?? { month: k, total: 0, byCategory: new Map() };
    row.total += e.amount;
    row.byCategory.set(e.category, (row.byCategory.get(e.category) ?? 0) + e.amount);
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * 장부 맨 위 요약: 매출(숙박·대실 + 매점) − 지출 = 순수익,
 * 현금 시재 = 현금으로 수납액(매점 현금 + 예약 선금·잔금 현금) − 현금 지출(입금 완료만).
 * 카드·이체·미수 지출은 시재에 안 넣어요.
 */
export function moneySummary(rooms: number, shop: number, shopCash: number, exp: Pick<ExpenseTotals, "amount" | "cash">, bookingCash = 0) {
  const sales = rooms + shop;
  const cashIn = shopCash + bookingCash;
  return { sales, expense: exp.amount, left: sales - exp.amount, cash: cashIn - exp.cash, cashIn, shopCash, bookingCash, cashOut: exp.cash };
}

export function validateVendor(v: { name: string; vendorType: string }): string | null {
  const name = v.name.trim();
  if (!name) return "거래처 이름을 입력해 주세요.";
  if (name.length > EXPENSE_VENDOR_NAME_MAX) return `거래처 이름은 ${EXPENSE_VENDOR_NAME_MAX}자까지예요.`;
  if (!isVendorType(v.vendorType)) return "거래처 종류를 골라 주세요.";
  return null;
}

/** 지출 창 검사: 문제가 있으면 한국어 안내. 금액은 미수일 때 비워 둘 수 있어요. */
export function validateExpense(e: {
  bizDate: string;
  stockInDate?: string | null;
  category: string;
  amount: number;
  method: string | null;
  paid: boolean;
  memo?: string | null;
  vendorId?: string | null;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.bizDate)) return "날짜를 골라 주세요.";
  if (e.stockInDate != null && e.stockInDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(e.stockInDate)) return "입고날짜를 확인해 주세요.";
  if (!e.category.trim()) return "분류를 골라 주세요.";
  if (!Number.isInteger(e.amount) || e.amount < 0) return "금액을 확인해 주세요.";
  if (e.amount > EXPENSE_AMOUNT_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (!e.memo?.trim()) return "사용처·품목을 입력해 주세요.";
  if (e.memo.trim().length > EXPENSE_MEMO_MAX) return `사용처·품목은 ${EXPENSE_MEMO_MAX}자까지예요.`;
  if (e.paid) {
    if (e.amount <= 0) return "입금 완료면 금액을 입력해 주세요.";
    if (!isExpensePayMethod(e.method)) return "카드 · 현금 · 이체 중에 골라 주세요.";
  } else if (e.method != null && e.method !== "" && !isExpensePayMethod(e.method)) {
    return "카드 · 현금 · 이체 중에 골라 주세요.";
  }
  return null;
}

/** 구매 주기용 기준일: 입고날짜 우선, 없으면 영업일 */
export function expenseAnchorDate(e: Pick<Expense, "stockInDate" | "bizDate">): string {
  return e.stockInDate && /^\d{4}-\d{2}-\d{2}$/.test(e.stockInDate) ? e.stockInDate : e.bizDate;
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export interface PurchaseCadence {
  count: number; // 기록 건수
  gaps: number; // 간격 개수 (≥1이면 주기 추정 가능)
  avgDays: number | null;
  medianDays: number | null;
  lastDate: string | null;
  /** 한국어 한 줄 안내. 간격이 없으면 null */
  label: string | null;
}

/**
 * 같은 키(거래처·품목 등)로 묶인 기록에서 구매 주기(일)를 추정해요.
 * 날짜는 입고일 우선. 같은 날은 한 번만. 간격이 1개 이상이어야 평균·중앙값을 줘요.
 */
export function purchaseCadence(list: Pick<Expense, "stockInDate" | "bizDate">[]): PurchaseCadence {
  const dates = [...new Set(list.map(expenseAnchorDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (dates.length < 2) {
    return { count: list.length, gaps: 0, avgDays: null, medianDays: null, lastDate: dates[0] ?? null, label: null };
  }
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const d = dayDiff(dates[i - 1]!, dates[i]!);
    if (d > 0) gaps.push(d);
  }
  if (!gaps.length) {
    return { count: list.length, gaps: 0, avgDays: null, medianDays: null, lastDate: dates[dates.length - 1]!, label: null };
  }
  const avgDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  const medianDays = median(gaps);
  const lastDate = dates[dates.length - 1]!;
  const label = gaps.length === 1 ? `약 ${medianDays}일마다` : `평균 ${avgDays}일 · 중앙 ${medianDays}일마다`;
  return { count: list.length, gaps: gaps.length, avgDays, medianDays, lastDate, label };
}

/** 거래처 id → 구매 주기 (목록에서 힌트용) */
export function vendorCadenceMap(list: Expense[]): Map<string, PurchaseCadence> {
  const by = new Map<string, Expense[]>();
  for (const e of list) {
    if (!e.vendorId) continue;
    const arr = by.get(e.vendorId) ?? [];
    arr.push(e);
    by.set(e.vendorId, arr);
  }
  const out = new Map<string, PurchaseCadence>();
  for (const [id, rows] of by) out.set(id, purchaseCadence(rows));
  return out;
}

/** 거래처+품목(메모 정규화) 키의 구매 주기 */
export function itemCadenceFor(list: Expense[], vendorId: string | null, memo: string): PurchaseCadence | null {
  const key = memo.trim().toLowerCase();
  if (!key) return null;
  const rows = list.filter((e) => (vendorId ? e.vendorId === vendorId : true) && (e.memo ?? "").trim().toLowerCase() === key);
  if (rows.length < 2) return null;
  const c = purchaseCadence(rows);
  return c.label ? c : null;
}

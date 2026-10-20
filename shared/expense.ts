// 지출: 수리·비품구매 등 분류 + 사용처·품목(자유 기입) · 금액 · 카드/현금/이체 · 영업일.
// 분류 이름은 적은 그때 값으로 복사해 둬서, 설정에서 이름을 바꿔도 지난 기록은 그대로예요.
export type ExpensePayMethod = "card" | "cash" | "transfer";
export const EXPENSE_PAY_METHODS: ExpensePayMethod[] = ["card", "cash", "transfer"];
export const EXPENSE_PAY_LABEL: Record<ExpensePayMethod, string> = { card: "카드", cash: "현금", transfer: "이체" };
export const isExpensePayMethod = (v: unknown): v is ExpensePayMethod => v === "card" || v === "cash" || v === "transfer";

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
  category: string; // 적은 그때 분류 이름
  amount: number; // 원
  method: ExpensePayMethod;
  memo: string | null; // 사용처·품목 (자유 기입)
  createdAt: string;
}

export interface ExpenseTotals {
  amount: number;
  count: number;
  card: number;
  cash: number;
  transfer: number;
  byCategory: Map<string, number>;
}
export function expenseTotals(list: Expense[]): ExpenseTotals {
  const t: ExpenseTotals = { amount: 0, count: 0, card: 0, cash: 0, transfer: 0, byCategory: new Map() };
  for (const e of list) {
    t.amount += e.amount;
    t.count++;
    t[e.method] += e.amount;
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
 * 장부 맨 위 요약: 매출(숙박·대실 + 매점) − 지출 = 남은 금액,
 * 현금 시재 = 현금으로 받은 돈(매점 현금 + 예약 선금·잔금 현금) − 현금 지출.
 * 카드·이체 지출은 시재에 안 넣어요.
 */
export function moneySummary(rooms: number, shop: number, shopCash: number, exp: Pick<ExpenseTotals, "amount" | "cash">, bookingCash = 0) {
  const sales = rooms + shop;
  const cashIn = shopCash + bookingCash;
  return { sales, expense: exp.amount, left: sales - exp.amount, cash: cashIn - exp.cash, cashIn, shopCash, bookingCash, cashOut: exp.cash };
}

/** 지출 창 검사: 문제가 있으면 한국어 안내 */
export function validateExpense(e: { bizDate: string; category: string; amount: number; method: string; memo?: string | null }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.bizDate)) return "날짜를 골라 주세요.";
  if (!e.category.trim()) return "분류를 골라 주세요.";
  if (!Number.isInteger(e.amount) || e.amount <= 0) return "금액을 적어 주세요.";
  if (e.amount > EXPENSE_AMOUNT_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (!isExpensePayMethod(e.method)) return "카드 · 현금 · 이체 중에 골라 주세요.";
  if (!e.memo?.trim()) return "사용처·품목을 적어 주세요.";
  if (e.memo.trim().length > EXPENSE_MEMO_MAX) return `사용처·품목은 ${EXPENSE_MEMO_MAX}자까지예요.`;
  return null;
}

// 지출: 비품·식자재·세탁·수리·공과금… 날짜(영업일)·분류·금액·카드/현금·메모를 한 줄씩 남겨요.
// 분류 이름은 적은 그때 값으로 복사해 둬서, 설정에서 이름을 바꿔도 지난 기록은 그대로예요.
import type { PayMethod } from "./shop";

export interface ExpenseCategory {
  id: string;
  name: string; // 비어 있으면 지출 창에 안 나와요
}
export const EXPENSE_CATEGORY_MAX = 12; // 분류 이름 글자 수
export const EXPENSE_MEMO_MAX = 200;
export const EXPENSE_AMOUNT_MAX = 100_000_000;
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = ["비품", "식자재", "세탁", "수리", "공과금", "기타"].map((name, i) => ({
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
  method: PayMethod;
  memo: string | null;
  createdAt: string;
}

export interface ExpenseTotals {
  amount: number;
  count: number;
  card: number;
  cash: number;
  byCategory: Map<string, number>;
}
export function expenseTotals(list: Expense[]): ExpenseTotals {
  const t: ExpenseTotals = { amount: 0, count: 0, card: 0, cash: 0, byCategory: new Map() };
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
 * 현금 시재 = 현금 매출 − 현금 지출. 숙박·대실은 결제 방법을 따로 적지 않아서 현금 매출은 매점 현금만이에요.
 */
export function moneySummary(rooms: number, shop: number, shopCash: number, exp: Pick<ExpenseTotals, "amount" | "cash">) {
  const sales = rooms + shop;
  return { sales, expense: exp.amount, left: sales - exp.amount, cash: shopCash - exp.cash, cashIn: shopCash, cashOut: exp.cash };
}

/** 지출 창 검사: 문제가 있으면 한국어 안내 */
export function validateExpense(e: { bizDate: string; category: string; amount: number; method: string }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.bizDate)) return "날짜를 골라 주세요.";
  if (!e.category.trim()) return "분류를 골라 주세요.";
  if (!Number.isInteger(e.amount) || e.amount <= 0) return "금액을 적어 주세요.";
  if (e.amount > EXPENSE_AMOUNT_MAX) return "금액이 너무 커요 (1억 원까지).";
  if (e.method !== "card" && e.method !== "cash") return "카드인지 현금인지 골라 주세요.";
  return null;
}

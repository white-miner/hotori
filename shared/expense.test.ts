import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  expenseTotals,
  itemCadenceFor,
  moneySummary,
  monthlyByCategory,
  normalizeExpenseCategories,
  purchaseCadence,
  validateExpense,
  validateVendor,
  vendorCadenceMap,
  type Expense,
  type ExpensePayMethod,
} from "./expense";
import { normalizeSettings } from "./ledger";
import { xlsx, zipStore } from "./xlsx";

const ex = (
  bizDate: string,
  category: string,
  amount: number,
  method: ExpensePayMethod | null,
  memo = "테스트",
  extra: Partial<Expense> = {},
): Expense => ({
  id: `${bizDate}-${category}-${amount}-${method}-${memo}`,
  bizDate,
  stockInDate: null,
  category,
  amount,
  method,
  paid: method != null,
  memo,
  vendorId: null,
  vendorName: null,
  vendorType: null,
  createdAt: `${bizDate}T10:00:00Z`,
  ...extra,
});

const list = [
  ex("2026-10-18", "비품구매", 30000, "cash"),
  ex("2026-10-19", "세탁", 45000, "card"),
  ex("2026-09-30", "비품구매", 12000, "cash"),
  ex("2026-10-19", "비품구매", 8000, "card"),
  ex("2026-10-19", "수리", 20000, "transfer", "보일러"),
  ex("2026-10-20", "비품구매", 15000, null, "라면", { paid: false, vendorId: "v1", vendorName: "동네마트", vendorType: "mart" }),
];

test("기본 지출 분류: 설정이 없으면 수리·비품구매를 앞에", () => {
  assert.deepEqual(
    normalizeExpenseCategories(undefined).map((c) => c.name),
    ["수리", "비품구매", "식자재", "세탁", "공과금", "기타"],
  );
  assert.deepEqual(normalizeSettings({}).expenseCategories, DEFAULT_EXPENSE_CATEGORIES);
  // 빈 배열은 사용자가 모두 지운 것 → 그대로 빈 목록
  assert.deepEqual(normalizeExpenseCategories([]), []);
});

test("지출 분류 정리: 잘못된 항목·중복 id 제거, 이름 길이 제한", () => {
  const out = normalizeExpenseCategories([{ id: "a", name: "비품" }, { id: "a", name: "중복" }, null, { name: "id없음" }, { id: "b", name: "아주아주아주아주긴분류이름입니다" }]);
  assert.equal(out.filter((c) => c.id === "a").length, 1);
  assert.ok(out.every((c) => c.name.length <= 12));
});

test("지출 합계: 카드·현금·이체·미수·분류별", () => {
  const t = expenseTotals(list);
  assert.equal(t.amount, 130000);
  assert.equal(t.count, 6);
  assert.equal(t.cash, 42000); // 입금 완료 현금만
  assert.equal(t.card, 53000);
  assert.equal(t.transfer, 20000);
  assert.equal(t.unpaid, 15000);
  assert.equal(t.unpaidCount, 1);
  assert.equal(t.byCategory.get("비품구매"), 65000);
  assert.equal(t.byCategory.get("세탁"), 45000);
  assert.equal(t.byCategory.get("수리"), 20000);
});

test("월별 분류 합계: 최근 달이 먼저", () => {
  const m = monthlyByCategory(list);
  assert.deepEqual(
    m.map((r) => r.month),
    ["2026-10", "2026-09"],
  );
  assert.equal(m[0].total, 118000);
  assert.equal(m[0].byCategory.get("비품구매"), 53000);
  assert.equal(m[1].byCategory.get("비품구매"), 12000);
});

test("남은 금액·현금 시재: 이체·미수는 시재에서 안 빼요", () => {
  const s = moneySummary(500000, 40000, 25000, expenseTotals(list));
  assert.equal(s.sales, 540000);
  assert.equal(s.expense, 130000);
  assert.equal(s.left, 410000);
  assert.equal(s.cash, 25000 - 42000); // 입금 완료 현금만
  const z = moneySummary(0, 0, 0, { amount: 0, cash: 0 });
  assert.equal(z.left, 0);
  assert.equal(z.cash, 0);
});

test("지출 입력 확인: 품목 필수, 입금 완료면 금액·결제, 미수는 금액 선택", () => {
  const ok = { bizDate: "2026-10-19", category: "수리", amount: 1000, method: "cash" as const, paid: true, memo: "수도꼭지" };
  assert.equal(validateExpense(ok), null);
  assert.equal(validateExpense({ ...ok, method: "transfer" }), null);
  assert.equal(validateExpense({ ...ok, method: "card" }), null);
  assert.match(validateExpense({ ...ok, amount: 0 }) ?? "", /금액/);
  assert.match(validateExpense({ ...ok, amount: 100_000_001 }) ?? "", /1억/);
  assert.match(validateExpense({ ...ok, category: " " }) ?? "", /분류/);
  assert.match(validateExpense({ ...ok, method: "bank" }) ?? "", /카드/);
  assert.match(validateExpense({ ...ok, bizDate: "" }) ?? "", /날짜/);
  assert.match(validateExpense({ ...ok, memo: "" }) ?? "", /사용처/);
  assert.match(validateExpense({ ...ok, memo: null }) ?? "", /사용처/);
  assert.match(validateExpense({ ...ok, memo: " " }) ?? "", /사용처/);
  // 미수금: 금액 0·결제 없음 OK
  assert.equal(validateExpense({ ...ok, paid: false, amount: 0, method: null }), null);
  assert.equal(validateExpense({ ...ok, paid: false, amount: 5000, method: null }), null);
  assert.match(validateExpense({ ...ok, paid: true, amount: 0, method: "cash" }) ?? "", /금액/);
  assert.match(validateExpense({ ...ok, stockInDate: "bad" }) ?? "", /입고/);
  assert.equal(validateExpense({ ...ok, stockInDate: "2026-10-18" }), null);
});

test("거래처 입력 확인", () => {
  assert.equal(validateVendor({ name: "쿠팡", vendorType: "auction" }), null);
  assert.match(validateVendor({ name: " ", vendorType: "mart" }) ?? "", /이름/);
  assert.match(validateVendor({ name: "ok", vendorType: "shop" }) ?? "", /종류/);
});

test("구매 주기: 입고일 우선 · 평균·중앙값", () => {
  const rows = [
    ex("2026-10-01", "비품구매", 1000, "cash", "라면", { vendorId: "v1", stockInDate: "2026-10-01" }),
    ex("2026-10-15", "비품구매", 1000, "cash", "라면", { vendorId: "v1", stockInDate: "2026-10-15" }),
    ex("2026-10-29", "비품구매", 1000, "cash", "라면", { vendorId: "v1", stockInDate: "2026-10-29" }),
  ];
  const c = purchaseCadence(rows);
  assert.equal(c.gaps, 2);
  assert.equal(c.avgDays, 14);
  assert.equal(c.medianDays, 14);
  assert.match(c.label ?? "", /14일/);
  assert.equal(itemCadenceFor(rows, "v1", "라면")?.medianDays, 14);
  assert.equal(itemCadenceFor(rows, "v1", "없는품목"), null);
  const one = purchaseCadence([rows[0]!]);
  assert.equal(one.label, null);
  const map = vendorCadenceMap(rows);
  assert.equal(map.get("v1")?.avgDays, 14);
});

test("구매 주기: 같은 날·불규칙 간격은 중앙값", () => {
  const rows = [
    ex("2026-09-01", "비품구매", 1, "cash", "컵", { vendorId: "v2" }),
    ex("2026-09-01", "비품구매", 1, "cash", "컵", { vendorId: "v2" }), // 같은 날
    ex("2026-09-11", "비품구매", 1, "cash", "컵", { vendorId: "v2" }), // +10
    ex("2026-10-01", "비품구매", 1, "cash", "컵", { vendorId: "v2" }), // +20
  ];
  const c = purchaseCadence(rows);
  assert.equal(c.gaps, 2);
  assert.equal(c.avgDays, 15);
  assert.equal(c.medianDays, 15);
});

// 아주 단순한 zip 읽기 (store 방식만)
function unzip(buf: Uint8Array) {
  const b = Buffer.from(buf);
  const files = new Map<string, string>();
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const method = b.readUInt16LE(p + 8);
    const size = b.readUInt32LE(p + 18);
    const nlen = b.readUInt16LE(p + 26);
    const xlen = b.readUInt16LE(p + 28);
    const name = b.subarray(p + 30, p + 30 + nlen).toString("utf8");
    const start = p + 30 + nlen + xlen;
    const raw = b.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    p = start + size;
  }
  assert.equal(b.readUInt32LE(b.length - 22), 0x06054b50, "central directory 끝 표시");
  assert.equal(b.readUInt16LE(b.length - 22 + 10), files.size);
  return files;
}

test("zip: CRC가 맞는 store zip", () => {
  const z = zipStore([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
  const b = Buffer.from(z);
  assert.equal(b.readUInt32LE(14), 0x3610a686); // crc32("hello")
  assert.equal(unzip(z).get("a.txt"), "hello");
});

test("엑셀 파일: 필요한 파트와 한글 셀", () => {
  const f = unzip(xlsx("지출", [["날짜", "분류", "금액"], ["2026-10-19", "비품 & <세제>", 30000]], [12, 10, 12]));
  for (const n of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) assert.ok(f.has(n), n);
  const sheet = f.get("xl/worksheets/sheet1.xml")!;
  assert.match(sheet, /비품 &amp; &lt;세제&gt;/);
  assert.match(sheet, /<v>30000<\/v>/);
  assert.match(f.get("xl/workbook.xml")!, /name="지출"/);
});

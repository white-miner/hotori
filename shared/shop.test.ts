import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_SHOP_ITEM_LIMIT, businessDate, normalizeSettings, normalizeShopItems } from "./ledger";
import { addMonths, canAddShopItem, payLine, inRange, lastSaleOf, ledgerSummary, monthRange, onDay, shopGroups, shopTotals, type ShopSale } from "./shop";

const sale = (
  id: string,
  itemId: string,
  price: number,
  bizDate: string,
  createdAt: string,
  name = itemId,
  method: ShopSale["method"] = "card",
): ShopSale => ({
  method,
  id,
  itemId,
  itemName: name,
  unitPrice: price,
  qty: 1,
  bizDate,
  createdAt,
});

test("매점 영업일: 새벽 6시 전 판매는 전날 매출", () => {
  // 10/19 05:59 KST = 10/18 20:59Z → 10/18 영업일, 06:00 KST → 10/19
  assert.equal(businessDate(new Date("2026-10-18T20:59:00Z")), "2026-10-18");
  assert.equal(businessDate(new Date("2026-10-18T21:00:00Z")), "2026-10-19");
  // 자정 넘어 01:30 KST 컵라면도 전날
  assert.equal(businessDate(new Date("2026-10-18T16:30:00Z")), "2026-10-18");
});

test("매점 합계: 그날 금액·개수, 물품별", () => {
  const s = [
    sale("1", "ramen", 3000, "2026-10-18", "2026-10-18T10:00:00Z", "컵라면"),
    sale("2", "ramen", 3000, "2026-10-18", "2026-10-18T11:00:00Z", "컵라면"),
    sale("3", "cola", 2000, "2026-10-18", "2026-10-18T12:00:00Z", "콜라"),
    sale("4", "cola", 2000, "2026-10-17", "2026-10-17T12:00:00Z", "콜라"),
  ];
  const t = shopTotals(s, onDay("2026-10-18"));
  assert.equal(t.amount, 8000);
  assert.equal(t.count, 3);
  assert.equal(t.byItem.get("ramen")?.count, 2);
  assert.equal(t.byItem.get("cola")?.amount, 2000);
  assert.equal(shopTotals(s).amount, 10000);
  assert.equal(shopTotals(s, inRange("2026-10-17", "2026-10-17")).count, 1);
});

test("가격을 바꿔도 지난 매출은 판 그때 가격", () => {
  const s = [sale("1", "beer", 4000, "2026-10-10", "a"), sale("2", "beer", 4500, "2026-10-18", "b")];
  assert.equal(shopTotals(s).amount, 8500);
});

test("되돌리기는 그날 그 물품의 가장 최근 판매", () => {
  const s = [
    sale("a", "ramen", 3000, "2026-10-18", "2026-10-18T10:00:00Z"),
    sale("b", "ramen", 3000, "2026-10-18", "2026-10-18T11:00:00Z"),
    sale("c", "ramen", 3000, "2026-10-19", "2026-10-19T09:00:00Z"),
    sale("d", "cola", 2000, "2026-10-18", "2026-10-18T12:00:00Z"),
  ];
  assert.equal(lastSaleOf(s, "ramen", "2026-10-18")?.id, "b");
  assert.equal(lastSaleOf(s, "ramen", "2026-10-17"), null);
});

test("매점 화면 묶음: 숨김·빈 이름 빼고, 분류 순서는 설정 순서", () => {
  const items = normalizeShopItems([
    { id: "1", name: "컵라면", price: 3000, category: "먹거리" },
    { id: "2", name: "콜라", price: 2000, category: "음료" },
    { id: "3", name: "생수", price: 1000, category: "음료", hidden: true },
    { id: "4", name: "  ", price: 1000 },
    { id: "5", name: "열쇠고리", price: 5000, category: "" },
    { id: "1", name: "중복", price: 1 },
  ]);
  assert.equal(items.length, 5);
  const g = shopGroups(items);
  assert.deepEqual(g.map((x) => x.category), ["먹거리", "음료", "기타"]);
  assert.deepEqual(g[1].items.map((x) => x.name), ["콜라"]);
});

test("물품 정리: 가격은 0 이상 정수, 잘못된 값은 버려요", () => {
  const [a] = normalizeShopItems([{ id: "x", name: "맥주", price: "4500.4", category: 3 }]);
  assert.deepEqual(a, { id: "x", name: "맥주", price: 4500, category: "", hidden: false });
  assert.equal(normalizeShopItems([{ id: "y", name: "a", price: -5 }])[0].price, 0);
  assert.deepEqual(normalizeShopItems("nope"), []);
  // 설정을 저장해도 물품이 사라지지 않아요
  assert.equal(normalizeSettings({ shopItems: [{ id: "z", name: "생수", price: 1000 }] }).shopItems.length, 1);
  assert.deepEqual(normalizeSettings({}).shopItems, []);
});

test("월 범위·달 이동", () => {
  assert.deepEqual(monthRange("2026-10"), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(monthRange("2028-02"), ["2028-02-01", "2028-02-29"]);
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("장부 합계: 숙박·대실과 매점 따로, 총 합계", () => {
  assert.deepEqual(ledgerSummary(250000, 23000), { rooms: 250000, shop: 23000, total: 273000 });
  assert.deepEqual(ledgerSummary(250000, null), { rooms: 250000, shop: null, total: 250000 });
});

test("Free는 물품 10개까지", () => {
  assert.equal(FREE_SHOP_ITEM_LIMIT, 10);
  assert.equal(canAddShopItem("free", 9, FREE_SHOP_ITEM_LIMIT), true);
  assert.equal(canAddShopItem("free", 10, FREE_SHOP_ITEM_LIMIT), false);
  assert.equal(canAddShopItem("pro", 50, FREE_SHOP_ITEM_LIMIT), true);
});

test("카드·현금 따로 합계, 미지정(예전 기록)은 0이 아닐 때만", () => {
  const s = [
    sale("1", "ramen", 3000, "2026-10-18", "a", "컵라면", "card"),
    sale("2", "ramen", 3000, "2026-10-18", "b", "컵라면", "cash"),
    sale("3", "beer", 4500, "2026-10-18", "c", "맥주", "card"),
    sale("4", "cola", 2000, "2026-10-18", "d", "콜라", null),
  ];
  const t = shopTotals(s);
  assert.deepEqual(t.pay, { card: 7500, cash: 3000, none: 2000 });
  assert.equal(t.pay.card + t.pay.cash + t.pay.none, t.amount);
  assert.equal(t.byItem.get("ramen")?.card, 1);
  assert.equal(t.byItem.get("ramen")?.cash, 1);
  const won = (v: number) => v.toLocaleString("ko-KR");
  assert.equal(payLine(t.pay, won), "카드 7,500 · 현금 3,000 · 미지정 2,000");
  assert.equal(payLine({ card: 18000, cash: 9500, none: 0 }, won), "카드 18,000 · 현금 9,500");
});

test("− 는 그 결제 방법으로 판 것 중 가장 최근 1건만", () => {
  const s = [
    sale("a", "ramen", 3000, "2026-10-18", "2026-10-18T10:00:00Z", "컵라면", "cash"),
    sale("b", "ramen", 3000, "2026-10-18", "2026-10-18T11:00:00Z", "컵라면", "card"),
    sale("c", "ramen", 3000, "2026-10-18", "2026-10-18T12:00:00Z", "컵라면", null),
  ];
  assert.equal(lastSaleOf(s, "ramen", "2026-10-18", "cash")?.id, "a");
  assert.equal(lastSaleOf(s, "ramen", "2026-10-18", "card")?.id, "b");
  assert.equal(lastSaleOf(s.slice(1), "ramen", "2026-10-18", "cash"), null); // 현금 0개면 지울 게 없어요
  assert.equal(lastSaleOf(s, "ramen", "2026-10-18")?.id, "c");
});

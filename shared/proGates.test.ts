import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_SHOP_ITEM_LIMIT } from "./ledger";
import { PRO_GATES_ENABLED, hasProAccess } from "./proGates";
import { canAddShopItem } from "./shop";

test("개발 중 Pro 게이트 OFF · hasProAccess는 free도 true", () => {
  assert.equal(PRO_GATES_ENABLED, false);
  assert.equal(hasProAccess("free"), true);
  assert.equal(hasProAccess("pro"), true);
});

test("게이트 OFF면 Free 매점 물품 한도 없음", () => {
  assert.equal(canAddShopItem("free", FREE_SHOP_ITEM_LIMIT, FREE_SHOP_ITEM_LIMIT), true);
  assert.equal(canAddShopItem("free", 99, FREE_SHOP_ITEM_LIMIT), true);
});

import { test, expect } from "@playwright/test";
for (const mode of ["now", "rooms"]) {
  for (const width of [1440, 768, 390, 320]) {
    test(`${mode}: fixed frames at ${width}px, across floors and adversarial content`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      // No production database traffic, including reads or writes.
      await page.route(/supabase\.co/, route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.goto(`/tests/fixtures/room-cards.html#/board/${mode}`);
      const cards = page.locator(".room-card-frame");
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeGreaterThan(12);
      await page.evaluate(() => document.fonts.ready);
      const measure = () => cards.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }));
      const before = await measure();
      for (const box of before) {
        expect(box.width).toBe(width <= 760 ? 168 : 208);
        expect(box.height).toBe(320);
      }
      const companies = page.locator(".room-card-frame .rc-co");
      await expect(companies.first()).toBeVisible();
      expect(await companies.first().evaluate(node => getComputedStyle(node).textOverflow)).toBe("ellipsis");
      await companies.first().evaluate(node => { node.textContent = "LongCompanyName無空格회사명".repeat(40); });
      expect(await measure()).toEqual(before);
      const detail = page.getByRole("button", { name: /호 예약 상세 보기/ }).first();
      await detail.focus();
      expect(await detail.evaluate(node => getComputedStyle(node).outlineWidth)).toBe("2px");
      await page.keyboard.press("Enter");
      await expect(page.locator("#fixture-action")).toHaveText(/^open:/);
      expect(errors).toEqual([]);
      await page.screenshot({ path: `test-results/room-cards-${mode}-${width}.png`, fullPage: true });
    });
  }
}

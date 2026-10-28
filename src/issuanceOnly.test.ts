// 발급 서류(견적서·청구서·손해내역서·숙박확인서·객실 배치도 인쇄)는 「발급」 화면(src/Issuance.tsx)에서만 열려요 (사용자 지시 t207u/t208u/t210u).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ISSUANCE_COPY } from "../shared/hotelDocuments";

const dir = new URL(".", import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");
const DOCS = ["QuoteLetter", "InvoiceLetter", "DamageLetter", "StayConfirmLetter", "FloorPlanPrint"] as const;
const OWN = new Set(DOCS.map((d) => `${d}.tsx`));

test("발급 서류 화면은 발급 화면만 불러와요", () => {
  for (const f of files) {
    if (OWN.has(f) || f === "Issuance.tsx") continue;
    const t = read(f);
    for (const d of DOCS) {
      assert.ok(!new RegExp(`\\b${d}\\b`).test(t), `${f} 에서 ${d} 를 열면 안 돼요`);
    }
  }
});

test("발급 서류 문서 화면끼리도 서로 불러오지 않아요", () => {
  for (const f of OWN) {
    const t = read(f);
    for (const d of DOCS) {
      if (`${d}.tsx` === f) continue;
      assert.ok(!new RegExp(`from "\\./${d}"`).test(t), `${f} 가 ${d} 를 불러오면 안 돼요`);
    }
  }
});

test("발급 화면은 서류 다섯 가지를 모두 열 수 있어요", () => {
  const t = read("Issuance.tsx");
  for (const d of DOCS) {
    assert.match(t, new RegExp(`import ${d} from`));
    assert.match(t, new RegExp(`<${d}\\b`));
  }
  assert.match(t, /ISSUANCE_COPY\.stayConfirmCta/);
  assert.match(t, /ISSUANCE_COPY\.damageCta/);
  assert.match(t, /ISSUANCE_COPY\.quoteCta/);
  assert.match(t, /ISSUANCE_COPY\.invoiceCta/);
  assert.match(t, /ISSUANCE_COPY\.floorPlanCta/);
  assert.equal(ISSUANCE_COPY.stayConfirm, "숙박확인서");
  assert.equal(ISSUANCE_COPY.damage, "손해내역서");
  assert.equal(ISSUANCE_COPY.quote, "견적서");
  assert.equal(ISSUANCE_COPY.invoice, "청구서");
});

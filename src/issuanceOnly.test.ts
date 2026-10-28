// 숙박확인서·손해내역서는 「발급」 화면(src/Issuance.tsx)에서만 열려요 (사용자 지시 t207u/t208u).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ISSUANCE_COPY } from "../shared/hotelDocuments";

const dir = new URL(".", import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");
const OWN = new Set(["StayConfirmLetter.tsx", "DamageLetter.tsx"]);

test("숙박확인서·손해내역서 문서 화면은 발급 화면만 불러와요", () => {
  for (const f of files) {
    if (OWN.has(f) || f === "Issuance.tsx") continue;
    const t = read(f);
    assert.ok(!/StayConfirmLetter|DamageLetter/.test(t), `${f} 에서 숙박확인서/손해내역서를 열면 안 돼요`);
  }
});

test("발급 화면은 숙박확인서·손해내역서를 둘 다 열 수 있어요", () => {
  const t = read("Issuance.tsx");
  assert.match(t, /import StayConfirmLetter from/);
  assert.match(t, /import DamageLetter from/);
  assert.match(t, /<StayConfirmLetter/);
  assert.match(t, /<DamageLetter/);
  assert.match(t, /ISSUANCE_COPY\.stayConfirmCta/);
  assert.match(t, /ISSUANCE_COPY\.damageCta/);
  assert.equal(ISSUANCE_COPY.stayConfirm, "숙박확인서");
  assert.equal(ISSUANCE_COPY.damage, "손해내역서");
});

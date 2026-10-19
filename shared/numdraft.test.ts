// 숫자 칸: 적는 동안 글자 그대로 · 칸을 벗어날 때만 범위 맞춤 · 기본 ≤ 최대 인원은 안내만
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDraft, commitDraft, guestRangeMsg, liveValue } from "./numdraft";

const G = { min: 1, max: 99 };
/** 칸에 글자를 하나씩 칠 때 화면에 보이는 글자 (예전 버그: '2'를 지우면 1이 들어가서 '10' → 110 → 99) */
function typeInto(start: string, keys: string[], o = G) {
  let draft = start;
  const saved: number[] = [];
  for (const k of keys) {
    draft = k === "⌫" ? draft.slice(0, -1) : cleanDraft(draft + k, false);
    const v = liveValue(draft, o);
    if (v !== null) saved.push(v);
  }
  return { draft, saved, final: commitDraft(draft, o) };
}

test("기본 인원 2 → 지우고 10: 글자 그대로 10 (50 · 99로 안 튀어요)", () => {
  const r = typeInto("2", ["⌫", "1", "0"]);
  assert.equal(r.draft, "10");
  assert.deepEqual(r.saved, [1, 10]);
  assert.equal(r.final, 10);
});
test("단체 · 특수 객실: 10~30명도 그대로", () => {
  for (const n of ["12", "20", "30"]) assert.equal(typeInto("", n.split("")).final, Number(n));
});
test("범위 밖은 적는 동안 저장하지 않고, 칸을 벗어날 때만 맞춰요", () => {
  const r = typeInto("", ["1", "5", "0"]);
  assert.equal(r.draft, "150");
  assert.deepEqual(r.saved, [1, 15]);
  assert.equal(r.final, 99);
  assert.equal(commitDraft("0", G), 1);
  assert.equal(commitDraft("", G), null); // 비우면 원래 값으로
});
test("금액 · 수수료율: 쉼표 무시, 소수점은 수수료율만", () => {
  assert.equal(cleanDraft("10,000"), "10000");
  assert.equal(liveValue("10,000", { min: 0, max: 1_000_000 }), 10000);
  assert.equal(cleanDraft("9.5.1", true), "9.51");
  assert.equal(liveValue("9.", { min: 0.01, max: 50, decimal: true }), 9);
  assert.equal(liveValue("75", { min: 0.01, max: 50, decimal: true }), null);
  assert.equal(commitDraft("75", { min: 0.01, max: 50, decimal: true }), 50);
  assert.equal(commitDraft("2.755", { min: 0.01, max: 50, decimal: true }), 2.76);
});
test("기본 > 최대 인원은 값을 안 바꾸고 안내만", () => {
  assert.equal(guestRangeMsg(10, 4), "기본 인원(10명)이 최대 인원(4명)보다 많아요. 최대 인원을 늘려 주세요.");
  assert.equal(guestRangeMsg(4, 10), null);
  assert.equal(guestRangeMsg(10, 10), null);
});

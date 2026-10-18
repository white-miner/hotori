import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, PRESETS, contrast, defaultPlatformColor, paint, platformColor, textOn, tint } from "./platform";
import { normalizeSettings } from "./ledger";

const P = (name: string, id = "p1", color?: string | null) => ({ id, name, abbr: name[0], color });

test("잘 알려진 플랫폼은 이름으로 기본 색", () => {
  assert.equal(defaultPlatformColor(P("네이버")), "#03C75A");
  assert.equal(defaultPlatformColor(P("야놀자")), "#FF3D8B");
  assert.equal(defaultPlatformColor(P("여기어때")), "#E3102D");
  assert.equal(defaultPlatformColor(P("아고다")), "#7B3FE4");
  assert.equal(defaultPlatformColor(P("부킹닷컴")), "#003B95");
  assert.equal(defaultPlatformColor(P("익스피디아")), "#FFC107");
  assert.equal(defaultPlatformColor(P("에어비앤비")), "#FF6A3D");
  assert.equal(defaultPlatformColor(P("현장·전화")), "#7A7A7A");
  assert.equal(defaultPlatformColor(P("전화 예약")), "#7A7A7A");
});

test("그 밖의 플랫폼은 id로 늘 같은 팔레트 색", () => {
  const a = defaultPlatformColor(P("동네 여행사", "p-abc"));
  assert.ok(PALETTE.includes(a));
  assert.equal(defaultPlatformColor(P("이름 바뀜", "p-abc")), a, "이름이 바뀌어도 id가 같으면 같은 색");
  const many = new Set(Array.from({ length: 30 }, (_, i) => defaultPlatformColor(P("x", `p${i}`))));
  assert.ok(many.size >= 6, "여러 플랫폼이 한 색으로 몰리지 않아요");
});

test("설정에서 고른 색이 먼저, 잘못된 값은 무시", () => {
  assert.equal(platformColor(P("네이버", "p1", "#123abc")), "#123ABC");
  assert.equal(platformColor(P("네이버", "p1", "red")), "#03C75A");
  assert.equal(platformColor(P("네이버", "p1", null)), "#03C75A");
});

test("꽉 찬 색 위 글자는 대비가 큰 쪽 (노랑엔 검정, 남색엔 흰색)", () => {
  assert.equal(textOn("#FFC107"), "#1A1A1A");
  assert.equal(textOn("#003B95"), "#FFFFFF");
  assert.equal(textOn("#7B3FE4"), "#FFFFFF");
  for (const c of PRESETS) assert.ok(contrast(c, textOn(c)) >= 3.5, `${c} 글자 대비`);
});

test("옅은 바탕은 흰색에 가깝고, 아주 밝은 색은 테두리를 조금 진하게", () => {
  assert.equal(tint("#000000", 0.16), "#D6D6D6");
  assert.ok(contrast(tint("#E3102D"), "#1A1A1A") > 10, "옅은 바탕 위 검은 글자");
  const y = paint(P("익스피디아"));
  assert.notEqual(y.b, y.c);
  assert.ok(contrast(y.b, "#FFFFFF") > contrast(y.c, "#FFFFFF"));
  const n = paint(P("네이버"));
  assert.equal(n.b, n.c);
  assert.equal(paint(null).c, "#9A9A9A");
});

test("기본 색끼리 겹치지 않아요", () => {
  const names = ["네이버", "야놀자", "여기어때", "아고다", "부킹닷컴", "익스피디아", "에어비앤비", "현장·전화"];
  assert.equal(new Set(names.map((n) => defaultPlatformColor(P(n)))).size, names.length);
});

test("설정 정리: 플랫폼 색은 #RRGGBB만 남겨요", () => {
  const s = normalizeSettings({ platforms: [{ id: "a", name: "네이버", abbr: "네", color: "#03c75a" }, { id: "b", name: "x", abbr: "x", color: "javascript:1" }, { id: "c", name: "y", abbr: "y" }] });
  assert.equal(s.platforms[0].color, "#03C75A");
  assert.equal("color" in s.platforms[1], false);
  assert.equal("color" in s.platforms[2], false);
});

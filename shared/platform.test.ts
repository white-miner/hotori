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

test("옅은 바탕은 흰색에 가깝고, 입실 완료 테두리는 같은 색을 조금 진하게", () => {
  assert.equal(tint("#000000", 0.16), "#D6D6D6");
  for (const c of PRESETS) {
    const x = paint(P("x", "p", c));
    assert.ok(contrast(x.t, "#1A1A1A") > 12, `${c} 옅은 바탕 위 검은 글자`);
    assert.ok(contrast(x.t, "#FFFFFF") < 1.35, `${c} 바탕은 흰색에 가깝게 (화면이 시끄럽지 않게)`);
    assert.ok(contrast(x.b, x.t) >= 1.9, `${c} 테두리가 바탕과 구분돼요`);
  }
  const y = paint(P("익스피디아"));
  assert.ok(contrast(y.b, "#FFFFFF") > 2, "노랑 테두리는 충분히 진하게");
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

test("층 색: 예전 파스텔은 같은 계열 진한 색, 진한 색은 그대로, 글자는 대비 큰 쪽", async () => {
  const { strongColor, FLOOR_PALETTE } = await import("./floorColor");
  assert.equal(strongColor("#DCE9F7"), "#2F7BEA");
  assert.equal(strongColor("#dce9f7"), "#2F7BEA");
  assert.equal(strongColor("#E2E2E2"), "#7A7A7A");
  assert.equal(strongColor("#2F7BEA"), "#2F7BEA");
  assert.equal(strongColor(null), null);
  assert.equal(strongColor("bad"), null);
  const c = strongColor("#FFE4F0")!; // 팔레트에 없는 옅은 분홍 → 진한 분홍
  assert.ok(contrast(c, "#FFFFFF") > 2.5, c);
  assert.equal(strongColor("#F0F0F0"), strongColor("#F0F0F0")); // 회색 계열은 회색
  for (const x of FLOOR_PALETTE) assert.ok(contrast(x.value, textOn(x.value)) >= 3.5, `${x.name} 방 번호 대비`);
});

test("방 번호 바탕은 예전 파스텔 그대로, 새 진한 팔레트 값만 짝 파스텔로", async () => {
  const { pastelColor, strongColor } = await import("./floorColor");
  assert.equal(pastelColor("#DCE9F7"), "#DCE9F7", "저장된 파스텔은 그대로");
  assert.equal(pastelColor("#2F7BEA"), "#DCE9F7", "새로 고른 진한 파랑 → 옅은 하늘");
  assert.equal(pastelColor("#123456"), "#123456", "직접 고른 색은 예전처럼 그대로");
  assert.equal(pastelColor(null), null);
  assert.equal(strongColor("#DCE9F7"), "#2F7BEA", "층 점은 진하게");
});

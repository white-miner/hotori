// 플랫폼 색: 설정에서 고른 색이 있으면 그 색, 없으면 잘 알려진 플랫폼은 그 브랜드에 가까운 색,
// 나머지는 팔레트에서 플랫폼 id로 늘 같은 색을 골라요.
import type { Platform } from "./ledger";

export const HEX = /^#[0-9a-fA-F]{6}$/;

// 이름으로 알아보는 기본 색 (위에서부터 먼저 맞는 것)
const KNOWN: [RegExp, string][] = [
  [/네이버|naver/i, "#03C75A"],
  [/야놀자|yanolja/i, "#FF3D8B"],
  [/여기어때|goodchoice/i, "#E3102D"],
  [/아고다|agoda/i, "#7B3FE4"],
  [/부킹|booking/i, "#003B95"],
  [/익스피디아|expedia|호텔스닷컴|hotels\.com/i, "#FFC107"],
  [/에어비앤비|airbnb/i, "#FF6A3D"],
  [/트립닷컴|trip\.com|씨트립/i, "#1E7BFF"],
  [/전화|현장|워크인|walk/i, "#7A7A7A"],
];
// 그 밖의 플랫폼: 서로 잘 구분되는 진한 색
export const PALETTE = ["#00A6A6", "#F57C00", "#1E88E5", "#7CB305", "#C2185B", "#3949AB", "#8D5A2B", "#00897B", "#D81B60", "#5E35B1"];
// 설정에서 고를 수 있는 색
export const PRESETS = ["#03C75A", "#FF3D8B", "#E3102D", "#FF6A3D", "#FFC107", "#00A6A6", "#1E7BFF", "#003B95", "#7B3FE4", "#8D5A2B", "#7A7A7A"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function defaultPlatformColor(p: Pick<Platform, "id" | "name">): string {
  for (const [re, c] of KNOWN) if (re.test(p.name ?? "")) return c;
  return PALETTE[hash(p.id ?? "") % PALETTE.length];
}

export function platformColor(p: Pick<Platform, "id" | "name"> & { color?: string | null }): string {
  return p.color && HEX.test(p.color) ? p.color.toUpperCase() : defaultPlatformColor(p);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** 흰색과 섞은 옅은 색 (a = 그 색의 비율) */
export function tint(hex: string, a = 0.16): string {
  return toHex(rgb(hex).map((v) => 255 + (v - 255) * a));
}

function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** 꽉 찬 색 위 글자: 흰색과 검은색 중 대비가 더 큰 쪽 */
export function textOn(hex: string): "#FFFFFF" | "#1A1A1A" {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#1A1A1A") ? "#FFFFFF" : "#1A1A1A";
}

/** 검은색과 섞은 진한 색 */
export function shade(hex: string, a = 0.18): string {
  return toHex(rgb(hex).map((v) => v * (1 - a)));
}

export interface PlatformPaint {
  c: string; // 꽉 찬 바탕
  b: string; // 테두리 (노랑처럼 아주 밝은 색은 조금 진하게 해서 흰 바탕에서도 보이게)
  t: string; // 옅은 바탕
  f: string; // 꽉 찬 바탕 위 글자
}
export function paint(p: (Pick<Platform, "id" | "name"> & { color?: string | null }) | null | undefined): PlatformPaint {
  const c = p ? platformColor(p) : "#9A9A9A";
  return { c, b: contrast(c, "#FFFFFF") < 1.8 ? shade(c, 0.22) : c, t: tint(c), f: textOn(c) };
}

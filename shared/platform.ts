// 플랫폼 색·한 글자 약자: 설정값이 있으면 그 값, 없으면 잘 알려진 플랫폼은 브랜드에 가까운 기본값.
// 약자(abbr)는 보드 `.pb` · StaySale 채널 칩 · Entry 칩이 같은 SoT를 써요.
import type { Platform } from "./ledger";

export const HEX = /^#[0-9a-fA-F]{6}$/;

/** 설정 「플랫폼 추가」 stub · 이름만 바꾸고 약자를 안 고치면 보드/칩에 「새」가 남아요 */
export const PLATFORM_ADD_STUB_ABBR = "새";
export const PLATFORM_ADD_STUB_NAME = "새 플랫폼";

// 이름으로 알아보는 기본 색 (위에서부터 먼저 맞는 것)
const KNOWN_COLOR: [RegExp, string][] = [
  [/네이버|naver/i, "#03C75A"],
  [/야놀자|yanolja/i, "#FF3D8B"],
  [/여기어때|goodchoice/i, "#E3102D"],
  [/아고다|agoda/i, "#7B3FE4"],
  [/호텔타임|hotel.?time/i, "#0B6E4F"],
  [/부킹|booking/i, "#003B95"],
  [/익스피디아|expedia|호텔스닷컴|hotels\.com/i, "#FFC107"],
  [/에어비앤비|airbnb/i, "#FF6A3D"],
  [/트립닷컴|trip\.com|씨트립/i, "#1E7BFF"],
  [/전화|현장|워크인|walk/i, "#7A7A7A"],
];
/** 보드·칩 앞글자 기본값 (아고다=아 · 에어비앤비=에 — 충돌 피함) */
const KNOWN_ABBR: [RegExp, string][] = [
  [/네이버|naver/i, "네"],
  [/야놀자|yanolja/i, "야"],
  [/여기어때|goodchoice/i, "여"],
  [/아고다|agoda/i, "아"],
  [/호텔타임|hotel.?time/i, "호"],
  [/부킹|booking/i, "부"],
  [/익스피디아|expedia|호텔스닷컴|hotels\.com/i, "익"],
  [/에어비앤비|airbnb/i, "에"],
  [/트립닷컴|trip\.com|씨트립/i, "트"],
  [/전화|현장|워크인|walk/i, "현"],
];
// 그 밖의 플랫폼: 서로 잘 구분되는 진한 색
export const PALETTE = ["#00A6A6", "#F57C00", "#1E88E5", "#7CB305", "#C2185B", "#3949AB", "#8D5A2B", "#00897B", "#D81B60", "#5E35B1"];
// 설정에서 고를 수 있는 색
export const PRESETS = ["#03C75A", "#FF3D8B", "#E3102D", "#FF6A3D", "#FFC107", "#00A6A6", "#1E7BFF", "#003B95", "#7B3FE4", "#0B6E4F", "#8D5A2B", "#7A7A7A"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 유니코드 한 글자 (한글·영문 모두) */
export function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return [...t][0] ?? "";
}

/** 이름만으로 기본 약자 (설정 추가·stub 복구) */
export function defaultPlatformAbbr(name: string | null | undefined): string {
  const n = name ?? "";
  for (const [re, a] of KNOWN_ABBR) if (re.test(n)) return a;
  return firstGrapheme(n) || "?";
}

/**
 * 표시용 한 글자 약자 SoT.
 * - 저장된 abbr 1글자 우선
 * - 비었거나 「플랫폼 추가」 stub「새」(이름이 「새…」가 아닐 때) → 이름 기본 약자
 */
export function platformAbbr(p: Pick<Platform, "name"> & { abbr?: string | null } | null | undefined): string {
  if (!p) return "?";
  const raw = typeof p.abbr === "string" ? firstGrapheme(p.abbr) : "";
  const name = typeof p.name === "string" ? p.name.trim() : "";
  const stubLeft =
    raw === PLATFORM_ADD_STUB_ABBR && name.length > 0 && !name.startsWith(PLATFORM_ADD_STUB_ABBR);
  if (!raw || stubLeft) return defaultPlatformAbbr(name);
  return raw;
}

export function defaultPlatformColor(p: Pick<Platform, "id" | "name">): string {
  for (const [re, c] of KNOWN_COLOR) if (re.test(p.name ?? "")) return c;
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
  c: string; // 플랫폼 색 (설정 견본)
  b: string; // 입실 완료 테두리: 조금 진하게 (노랑처럼 아주 밝은 색은 더 진하게 해서 옅은 바탕 위에서도 보이게)
  t: string; // 옅은 바탕 (입실 전·후 모두)
  d: string; // 대실 점 (입실 전): 막대 바탕보다 조금 진한 옅은 색
  f: string; // 꽉 찬 바탕 위 글자
}
export function paint(p: (Pick<Platform, "id" | "name"> & { color?: string | null }) | null | undefined): PlatformPaint {
  const c = p ? platformColor(p) : "#9A9A9A";
  return { c, b: shade(c, contrast(c, "#FFFFFF") < 1.8 ? 0.3 : 0.12), t: tint(c, 0.13), d: tint(c, 0.38), f: textOn(c) };
}

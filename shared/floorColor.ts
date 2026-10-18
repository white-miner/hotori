// 층·방 색: 예전 설정의 옅은 파스텔은 같은 색 계열의 진한 색으로 바꿔서 그려요.
import { HEX, textOn } from "./platform";

/** 설정 팔레트 (진한 색). 예전 파스텔 값 → 새 진한 값 */
export const FLOOR_PALETTE: { name: string; value: string; old: string }[] = [
  { name: "파랑", value: "#2F7BEA", old: "#DCE9F7" },
  { name: "주황", value: "#F2762E", old: "#F8E5D6" },
  { name: "초록", value: "#2FA84F", old: "#E1F0DC" },
  { name: "보라", value: "#7A4FD8", old: "#E9E3F5" },
  { name: "노랑", value: "#F2B705", old: "#F6EFCF" },
  { name: "분홍", value: "#E5497C", old: "#F6DFE5" },
  { name: "민트", value: "#12A58C", old: "#D9F0EC" },
  { name: "회색", value: "#7A7A7A", old: "#E2E2E2" },
];
const OLD = new Map(FLOOR_PALETTE.map((c) => [c.old, c.value]));

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 화면에 그릴 진한 색. 없거나 잘못된 값이면 null */
export function strongColor(raw: string | null | undefined): string | null {
  if (!raw || !HEX.test(raw)) return null;
  const hex = raw.toUpperCase();
  const known = OLD.get(hex);
  if (known) return known;
  const [h, s, l] = hsl(hex);
  if (l <= 0.7) return hex; // 이미 진한 색은 그대로
  // 아주 옅은 색: 같은 색상, 채도는 올리고 밝기는 내려요 (회색 계열은 회색 그대로)
  return s < 0.08 ? fromHsl(h, 0, 0.48) : fromHsl(h, Math.max(0.68, s), 0.5);
}

/** 진한 바탕 위 방 번호 글자색 */
export const onStrong = (hex: string) => textOn(hex);

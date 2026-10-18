import type { Building, Floor, HotelSettings, Platform, Room, RoomType } from "../shared/ledger";
import { isMultiBuilding, orderedFloors, typeLabel } from "../shared/ledger";

export const PALETTE: { name: string; value: string | null }[] = [
  { name: "기본", value: null },
  { name: "하늘", value: "#DCE9F7" },
  { name: "살구", value: "#F8E5D6" },
  { name: "연두", value: "#E1F0DC" },
  { name: "연보라", value: "#E9E3F5" },
  { name: "연노랑", value: "#F6EFCF" },
  { name: "분홍", value: "#F6DFE5" },
  { name: "민트", value: "#D9F0EC" },
  { name: "회색", value: "#E2E2E2" },
];

export function Brand({ sub }: { sub?: string }) {
  return (
    <div className="brand">
      <span className="wm">HOTORI</span>
      <span className="seal" aria-label="호토리">
        호<br />토<br />리
      </span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function TypeBadge({ t, className = "" }: { t?: RoomType | null; className?: string }) {
  const code = typeLabel(t) || "?";
  return (
    <span className={`tb ${className}`} title={t ? code : undefined}>
      {code}
    </span>
  );
}
/** 글자 폭 단위: 한글·한자 등 넓은 글자 1, 영문·숫자 약 0.62 */
export function textUnits(s: string): number {
  let u = 0;
  for (const ch of s) u += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : ch === " " ? 0.3 : 0.62;
  return Math.max(1, u);
}
/** 칸 너비에 맞춰 글자 크기를 줄여요(최대 → 최소), 그래도 넘치면 … 으로. 칸에 container-type: inline-size 가 있어야 해요 */
export function FitText({ text, className = "", title }: { text: string; className?: string; title?: string }) {
  return (
    <span className={`fit ${className}`} style={{ ["--u" as string]: textUnits(text).toFixed(2) }} title={title ?? text}>
      {text}
    </span>
  );
}
/** 방 칸 둘째 줄: 타입 이름 (칩 없이, 칸 너비 전체) */
export function TypeLine({ t }: { t?: RoomType | null }) {
  const label = typeLabel(t);
  return label ? <FitText className="tl" text={label} /> : <span className="tl none">타입 없음</span>;
}
export function PlatBadge({ p }: { p?: Platform | null }) {
  return (
    <span className="pb" title={p?.name}>
      {p?.abbr ?? "?"}
    </span>
  );
}

export function Ring({ on, size = 18 }: { on: boolean; size?: number }) {
  return on ? (
    <svg className="ring" width={size} height={size} viewBox="0 0 20 20" aria-label="입실">
      <path
        d="M10.5 2.6c4.3.1 7.2 3.3 7 7.4-.2 4.2-3.6 7.3-7.8 7.2C5.5 17 2.6 13.9 2.8 9.8 3 6 5.8 3.3 9.4 2.9"
        fill="none"
        stroke="#1A1A1A"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg className="ring off" width={size} height={size} viewBox="0 0 20 20" aria-label="입실 전">
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="#C4C4C4" strokeWidth="1.6" strokeDasharray="2.6 2.6" />
    </svg>
  );
}

export function lookups(s: HotelSettings) {
  const types = new Map(s.types.map((t) => [t.id, t]));
  const plats = new Map(s.platforms.map((p) => [p.id, p]));
  const multi = isMultiBuilding(s);
  const bmap = new Map(s.buildings.map((b) => [b.id, b]));
  const rooms = new Map<string, Room & { floor: Floor; building: Building | undefined; label: string }>(
    orderedFloors(s).flatMap((f) =>
      f.rooms.map((r) => {
        const building = bmap.get(f.buildingId);
        return [r.id, { ...r, floor: f, building, label: multi && building ? `${building.name} ${r.no}` : r.no }] as const;
      }),
    ),
  );
  /** "201" 또는 (건물 2개 이상) "별관 201" */
  const roomLabel = (id: string | null | undefined) => (id ? (rooms.get(id)?.label ?? null) : null);
  return { types, plats, rooms, roomLabel, multi, buildings: bmap };
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function isTypingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return (
    e.isContentEditable ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (tag === "INPUT" && !["checkbox", "radio", "button"].includes((e as HTMLInputElement).type))
  );
}

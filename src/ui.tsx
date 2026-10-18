import type { Building, Floor, HotelSettings, Platform, Room, RoomType } from "../shared/ledger";
import { isMultiBuilding, orderedFloors } from "../shared/ledger";

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
  const code = t?.code?.trim() || "?";
  return (
    <span className={`tb ${className}`} title={t ? (t.name && t.name !== code ? `${code} · ${t.name}` : code) : undefined}>
      {code}
    </span>
  );
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

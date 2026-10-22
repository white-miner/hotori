import type { Booking, Building, Floor, HotelSettings, Platform, Room, RoomType } from "../shared/ledger";
import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FLOOR_PALETTE, onStrong, strongColor } from "../shared/floorColor";
import { dayLabel, defaultBuildingName, isMultiBuilding, legsOf, orderedFloors, typeLabel } from "../shared/ledger";
import { GROUP_BADGE_COLORS, type GroupBadgeColor } from "../shared/settle";

// 층·방 색 고르기 (진한 색). 예전 파스텔 값은 strongColor로 같은 계열 진한 색이 돼요.
export const PALETTE: { name: string; value: string | null }[] = [{ name: "기본", value: null }, ...FLOOR_PALETTE.map(({ name, value }) => ({ name, value }))];
/** 층·방 색 그리기용: 진한 바탕 + 잘 보이는 글자색 */
export function floorPaint(raw: string | null | undefined): { bg: string; fg: string } | null {
  const bg = strongColor(raw);
  return bg ? { bg, fg: onStrong(bg) } : null;
}

export function Brand({ sub, onHome }: { sub?: string; onHome?: () => void }) {
  const mark = (
    <>
      <span className="wm">HOTORI</span>
      <span className="seal" aria-hidden={onHome ? true : undefined} aria-label={onHome ? undefined : "호토리"}>
        호<br />토<br />리
      </span>
    </>
  );
  return (
    <div className="brand">
      {onHome ? (
        // 로고: 처음 화면(보드 › 「현황」 · 오늘)으로. 새로 고침 없이 보기만 처음으로 돌려요
        <a
          className="brand-home"
          href="#/board/now"
          aria-label="HOTORI 처음 화면으로 (오늘 현장 현황)"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 새 탭 열기는 그대로
            e.preventDefault();
            onHome();
          }}
        >
          {mark}
        </a>
      ) : (
        mark
      )}
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
/** 타입 + 인원(우측 작게). 현황·배치 동일 */
export function TypeRow({ t, guests }: { t?: RoomType | null; guests?: number | null }) {
  return (
    <div className="tl-row">
      <TypeLine t={t} />
      {guests != null && guests >= 1 ? (
        <span className="gcount" title={`인원 ${guests}명`}>
          {guests}명
        </span>
      ) : null}
    </div>
  );
}
export function PlatBadge({ p }: { p?: Platform | null }) {
  return (
    <span className="pb" title={p?.name}>
      {p?.abbr ?? "?"}
    </span>
  );
}
/** 칸 「단체」뱃지 · 탭 → 6색 팔레트 · group.badgeColor 저장 */
export function GroupBadge({
  groupName,
  color,
  readOnly,
  onPick,
}: {
  groupName?: string | null;
  color?: GroupBadgeColor | null;
  readOnly?: boolean;
  onPick?: (c: GroupBadgeColor) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cls = `grptag${color ? ` ${color}` : ""}${open ? " open" : ""}`;
  const title = groupName ? `단체 ${groupName}` : "단체";
  if (readOnly || !onPick) {
    return (
      <span className={cls} title={title}>
        단체
      </span>
    );
  }
  return (
    <span className="grptag-wrap" ref={root}>
      <button
        type="button"
        className={cls}
        title={`${title} · 색 바꾸기`}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        단체
      </button>
      {open ? (
        <span className="grp-palette" role="listbox" aria-label="단체 뱃지 색" onClick={(e) => e.stopPropagation()}>
          {GROUP_BADGE_COLORS.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={color === id}
              className={`grp-swatch ${id}${color === id ? " on" : ""}`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                setBusy(true);
                void Promise.resolve(onPick(id))
                  .then(() => setOpen(false))
                  .finally(() => setBusy(false));
              }}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function lookups(s: HotelSettings) {
  const types = new Map(s.types.map((t) => [t.id, t]));
  const plats = new Map(s.platforms.map((p) => [p.id, p]));
  const multi = isMultiBuilding(s);
  // 이름을 안 적은 건물은 A동·B동… 으로 보여요
  const bmap = new Map(s.buildings.map((b, i) => [b.id, { ...b, name: b.name.trim() || defaultBuildingName(i) }]));
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
  /** 숙박의 방: 객실 이동이면 "301→305" */
  const stayRoomLabel = (b: Booking) => {
    const legs = legsOf(b);
    if (legs.length < 2) return roomLabel(b.roomId);
    // 같은 건물 안에서 옮기면 뒤 방은 번호만 (본관 207→209)
    return legs
      .map((l, i) => {
        const r = l.roomId ? rooms.get(l.roomId) : undefined;
        const prev = i > 0 && legs[i - 1].roomId ? rooms.get(legs[i - 1].roomId!) : undefined;
        if (!r) return "?";
        return i > 0 && prev && prev.building?.id === r.building?.id ? r.no : r.label;
      })
      .join("→");
  };
  return { types, plats, rooms, roomLabel, stayRoomLabel, multi, buildings: bmap };
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

/**
 * 날짜 칩: 눌러서 달력(showPicker)으로 고르거나 숫자로 적어요. Esc는 칸만 빠져나가요 (창은 그대로).
 * 예약 기록의 '날짜 고르기'와 같은 방식이에요.
 */
export function DateChip({ value, onChange, label, min, max }: { value: string; onChange: (v: string) => void; label: string; min?: string; max?: string }) {
  const open = (el: HTMLInputElement) => {
    try {
      el.showPicker?.();
    } catch {
      /* 이미 열려 있거나 지원하지 않는 브라우저 */
    }
  };
  return (
    <label className="chip datechip on-line">
      <CalendarDays size={15} />
      <span className="dl">{dayLabel(value)}</span>
      <input
        type="date"
        min={min ?? "2020-01-01"}
        max={max ?? "2099-12-31"}
        value={value}
        aria-label={label}
        title="눌러서 달력에서 고르거나, 숫자로 바로 적어도 돼요"
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(e.currentTarget);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

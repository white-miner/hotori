import type { Booking, Building, Floor, HotelSettings, Platform, Room, RoomType } from "../shared/ledger";
import { CalendarDays, X, Zap } from "lucide-react";
import { CELL_BADGE_LABEL, cellBadgeKinds, type CellBadgeFlags, type CellBadgeKind } from "../shared/cellBadges";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FLOOR_PALETTE, onStrong, strongColor } from "../shared/floorColor";
import { dayLabel, defaultBuildingName, isMultiBuilding, legsOf, orderedFloors, typeLabel } from "../shared/ledger";
import { platformAbbr } from "../shared/platform";
import { type GroupPeerRoomItem, groupPeerRoomsLine } from "../shared/group";
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
    <div className="tl-row" data-slot="type">
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
      {platformAbbr(p)}
    </span>
  );
}
/**
 * 칸 뱃지 줄 — 이름 줄(.nm)과 분리해 이름이 잘리지 않게. 뱃지가 없으면 줄 자체를 그리지 않아요(칸 높이 불변).
 * 모양+색: 청소X=빨강 채움 ✕ · 바로입실=검정 채움 ⚡ · 임시=노랑 점선 · 장기=파랑 외곽선 · 단체=단체색 리본.
 */
export function CellBadges({
  flags,
  group,
}: {
  flags: CellBadgeFlags;
  group?: {
    groupName?: string | null;
    color: GroupBadgeColor;
    label?: string | null;
    readOnly?: boolean;
    onPick?: (c: GroupBadgeColor) => void | Promise<void>;
    /** 다실 단체: 뱃지를 누르면 「기간 결제」 시트 (색 팔레트 대신) */
    onOpen?: () => void;
    /** 이름 줄에 이미 같은 이름이 있으면 리본엔 단체명을 또 쓰지 않음 */
    hideName?: boolean;
  } | null;
}) {
  const kinds = cellBadgeKinds(flags);
  if (!kinds.length && !group) return null;
  return (
    <div className="bdg-row">
      {group ? (
        <GroupBadge
          groupName={group.groupName}
          color={group.color}
          label={group.label}
          readOnly={group.readOnly}
          onPick={group.onPick}
          onOpen={group.onOpen}
          showName={!group.hideName}
        />
      ) : null}
      {kinds.map((k) => (
        <span key={k} className={`bdg bdg-${k}`} title={BADGE_TITLE[k]}>
          {k === "noClean" ? <X size={11} strokeWidth={3.2} aria-hidden /> : null}
          {k === "walkIn" ? <Zap size={11} strokeWidth={2.8} aria-hidden /> : null}
          {CELL_BADGE_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
const BADGE_TITLE: Record<CellBadgeKind, string> = {
  noClean: "청소하지 않음",
  walkIn: "바로 입실 · 이름·연락처 미입력",
  tentative: "임시 배치 · 재고는 막혀 있어요",
  longStay: "장기 · 퇴실 미정",
  openEnded: "끝 날짜 없이 계속 묵어요 · 앱이 오늘 밤까지 이어 줘요",
};
/** 칸 「단체」/「대표객실」뱃지 · 탭 → 6색 팔레트 · group.badgeColor 저장 */
export function GroupBadge({
  groupName,
  color,
  readOnly,
  onPick,
  onOpen,
  /** 다실 대표객실 칩: `대표객실` / `대표객실 601호` · 없으면 「단체」 */
  label,
  showName,
}: {
  groupName?: string | null;
  color?: GroupBadgeColor | null;
  readOnly?: boolean;
  onPick?: (c: GroupBadgeColor) => void | Promise<void>;
  /** 있으면 탭 = 기간 결제 시트 (팔레트는 시트 안으로) */
  onOpen?: () => void;
  label?: string | null;
  /** 리본형: 「단체」 옆에 단체명도 같이 (좁으면 말줄임) */
  showName?: boolean;
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
  const text = label?.trim() || "단체";
  const cls = `grptag${color ? ` ${color}` : ""}${open ? " open" : ""}${label ? " lead" : ""}`;
  const title = groupName ? `${text} · ${groupName}` : text;
  const inner = (
    <>
      <b className="grptag-k">{text}</b>
      {showName && groupName ? <span className="grptag-nm">{groupName}</span> : null}
    </>
  );
  if (readOnly || (!onPick && !onOpen)) {
    return (
      <span className={cls} title={title}>
        {inner}
      </span>
    );
  }
  if (onOpen) {
    return (
      <span className="grptag-wrap">
        <button
          type="button"
          className={`${cls} payable`}
          title={`${title} · 눌러서 기간 결제`}
          aria-haspopup="dialog"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {inner}
        </button>
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
        {inner}
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
                void Promise.resolve(onPick?.(id))
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

/**
 * 현황·배치 호수(.no) 히트 · 다실 단체 형제 말풍선.
 * hover(CSS) + click/tap 토글(`.open`). 칸 박스 크기 불변(absolute).
 */
export function GroupRoomNoHit({
  rooms,
  open,
  onToggle,
  groupName,
  children,
}: {
  rooms: readonly GroupPeerRoomItem[];
  open: boolean;
  onToggle: () => void;
  groupName?: string | null;
  children: ReactNode;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const line = groupPeerRoomsLine(rooms);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onToggle();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);
  if (rooms.length < 2) return <>{children}</>;
  const title = groupName ? `같은 단체 · ${groupName}` : `같은 단체 · ${rooms.length}실`;
  return (
    <span className={`grp-no-hit${open ? " open" : ""}`} ref={root}>
      <button
        type="button"
        className="grp-no-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${title}: ${line}`}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {children}
      </button>
      <span className="grp-rooms-pop" role="tooltip">
        <span className="grp-rooms-pop-k">{title}</span>
        <span className="grp-rooms-pop-line">
          {rooms.map((x, i) => (
            <span key={`${x.no}-${i}`}>
              {i > 0 ? <span className="grp-rooms-sep"> · </span> : null}
              <span className={x.lead ? "grp-rooms-lead" : undefined} title={x.lead ? "대표객실" : undefined}>
                {x.no}
                {x.lead ? <em className="grp-rooms-lead-mark">대표객실</em> : null}
              </span>
            </span>
          ))}
        </span>
      </span>
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
 * 날짜 칩: 눌러서 달력(showPicker)으로 고르거나 숫자로 입력해요. Esc는 칸만 빠져나가요 (창은 그대로).
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
        title="눌러서 달력에서 고르거나, 숫자로 바로 입력해도 돼요"
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

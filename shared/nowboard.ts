// 현장 현황 보드(「지금」): 영업일 기준 상태 파생 (저장 필드가 아니라 규칙)
import { clampHours } from "./extratime";
import { type Booking, addDays, isActive, md, occupiesNight, roomOnNight, stayEnd, usedNights } from "./ledger";

/** 칸·옆 패널에 쓰는 현장 상태 (우선순위 높은 것부터 판별) */
export type NowKind = "lateOut" | "departing" | "arriving" | "inhouse" | "unassigned" | "empty";

export interface NowFlags {
  kind: NowKind;
  tentative: boolean;
  group: boolean;
  /** 청소X: 이 투숙은 청소하지 않음 */
  noClean: boolean;
  /** 한글 짧은 라벨 */
  label: string;
}

/** 오늘 밤을 점유하는 활성 숙박의 현장 상태 */
export function nowFlags(b: Booking | null | undefined, date: string): NowFlags {
  if (!b || !isActive(b) || b.kind !== "stay" || !occupiesNight(b, date)) {
    return { kind: "empty", tentative: false, group: false, noClean: false, label: "빈 방" };
  }
  const tentative = !!b.tentative;
  const group = !!b.groupId;
  const noClean = !!b.noClean;
  const last = stayEnd(b); // earlyOut 반영한 퇴실일(= 마지막 점유 다음 날)
  const lastNight = addDays(last, -1);
  // 마지막 점유 밤 + 늦은 퇴실 시간 → 늦은 퇴실 (배치 보드의 「늦은 …」태그와 같은 밤)
  if (lastNight === date && !!clampHours(b.lateOut)) {
    return { kind: "lateOut", tentative, group, noClean, label: "늦은 퇴실" };
  }
  // 오늘이 마지막 점유 밤 → 퇴실 예정
  if (lastNight === date) {
    return { kind: "departing", tentative, group, noClean, label: "퇴실 예정" };
  }
  if (!b.roomId || !roomOnNight(b, date)) {
    return { kind: "unassigned", tentative, group, noClean, label: "미배정" };
  }
  if (b.checkIn === date && !b.arrived) {
    return { kind: "arriving", tentative, group, noClean, label: "입실 예정" };
  }
  if (b.arrived) {
    return { kind: "inhouse", tentative, group, noClean, label: "투숙 중" };
  }
  // 연박 중간인데 아직 입실 표시 없음
  return { kind: "arriving", tentative, group, noClean, label: "입실 예정" };
}

export interface NowLists {
  unassigned: Booking[];
  tentative: Booking[];
  departing: Booking[];
  lateOut: Booking[];
  arriving: Booking[];
}

/** 오늘 점유 활성 숙박을 옆 패널용으로 분류 */
export function nowLists(bookings: Booking[], date: string): NowLists {
  const active = bookings.filter((b) => isActive(b) && b.kind === "stay" && occupiesNight(b, date));
  const unassigned: Booking[] = [];
  const tentative: Booking[] = [];
  const departing: Booking[] = [];
  const lateOut: Booking[] = [];
  const arriving: Booking[] = [];
  for (const b of active) {
    const f = nowFlags(b, date);
    if (f.tentative) tentative.push(b);
    if (f.kind === "unassigned") unassigned.push(b);
    else if (f.kind === "lateOut") lateOut.push(b);
    else if (f.kind === "departing") departing.push(b);
    else if (f.kind === "arriving") arriving.push(b);
  }
  const byName = (a: Booking, b: Booking) => a.guestName.localeCompare(b.guestName, "ko");
  return {
    unassigned: unassigned.sort(byName),
    tentative: tentative.sort(byName),
    departing: departing.sort(byName),
    lateOut: lateOut.sort(byName),
    arriving: arriving.sort(byName),
  };
}

/** 타입만 미배정: 단체명·타입별 개수 묶음 */
export function unassignedTypeCounts(list: Booking[]): { key: string; groupName: string | null; typeId: string; n: number; bookings: Booking[] }[] {
  const m = new Map<string, { groupName: string | null; typeId: string; bookings: Booking[] }>();
  for (const b of list) {
    const key = `${b.groupId ?? ""}|${b.typeId}`;
    let g = m.get(key);
    if (!g) {
      g = { groupName: b.groupName ?? null, typeId: b.typeId, bookings: [] };
      m.set(key, g);
    }
    g.bookings.push(b);
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v, n: v.bookings.length }));
}

export const NOW_KIND_LABEL: Record<NowKind, string> = {
  lateOut: "늦은 퇴실",
  departing: "퇴실 예정",
  arriving: "입실 예정",
  inhouse: "투숙 중",
  unassigned: "미배정",
  empty: "빈 방",
};

/** 테스트·표시용: 이용 박수 라벨 */
export function nowStayHint(b: Booking, date: string): string {
  const chips = nowStayChips(b, date);
  if (!chips.length) return "1박";
  if (chips.length === 1) return chips[0]!;
  return `${chips[0]} · ${chips[1]}`;
}

/**
 * 「지금」 칸 화이트보드 칩 (사실만 · 액션 아님).
 * 연박: `11박` + `9박째` (「11박 중 9박째」를 칩 둘로). 1박은 칩 없음.
 */
export function nowStayChips(b: Booking, date: string): string[] {
  const u = usedNights(b) ?? b.nights ?? 0;
  if (u <= 1) return [];
  const raw = Math.round((Date.parse(date) - Date.parse(b.checkIn)) / 864e5) + 1;
  const night = Math.min(Math.max(raw, 1), u);
  return [`${u}박`, `${night}박째`];
}

/**
 * 「지금」 칸 날짜: **점유 밤** 구간 `checkIn ~ (stayEnd−1)`.
 * 퇴실 아침(stayEnd)은 구간에 넣지 않음 (예: 2박 입19·퇴21 → `10/19~20`).
 * Entry는 입·퇴·박을 쓰고, 보드는 밤 구간만 쓴다.
 */
export function nowNightRange(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  /** 1박은 `10/19`, 연박은 `10/19~20` */
  label: string;
} {
  const lastNight = addDays(stayEnd(b), -1);
  const fromLabel = md(b.checkIn);
  const toLabel = md(lastNight);
  // 같은 달이면 `10/19~20`, 달 넘기면 `10/30~11/2`
  const sameMonth = b.checkIn.slice(0, 7) === lastNight.slice(0, 7);
  const rangeEnd = sameMonth ? String(Number(lastNight.slice(8, 10))) : toLabel;
  return {
    from: b.checkIn,
    to: lastNight,
    fromLabel,
    toLabel,
    label: b.checkIn === lastNight ? fromLabel : `${fromLabel}~${rangeEnd}`,
  };
}

/** @deprecated 보드 주 표기는 nowNightRange. Entry용 입·퇴 라벨이 필요할 때만 */
export function nowStayDates(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): {
  checkIn: string;
  checkOut: string;
  inLabel: string;
  outLabel: string;
} {
  const out = stayEnd(b);
  return { checkIn: b.checkIn, checkOut: out, inLabel: md(b.checkIn), outLabel: md(out) };
}

/** 화이트보드용 한 줄 = 점유 밤 구간 */
export function nowDateLine(b: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">): string {
  return nowNightRange(b).label;
}

// 메모 + 변경 기록 (순수 함수) — 저장은 booking_changes, 여기는 문장 만들기·거르기만

export type ChangeKind = "note" | "money" | "room" | "rate" | "stay";
export type Change = {
  id: string;
  groupId: string | null;
  bookingId: string | null;
  kind: ChangeKind;
  summary: string;
  effectiveOn: string | null;
  pinned: boolean;
  /** ISO 시각 */
  at: string;
};
export const NOTE_MAX = 300;
export type ChangeFilter = "all" | "money" | "room" | "rate" | "note";
export const CHANGE_FILTERS: { id: ChangeFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "money", label: "결제" },
  { id: "room", label: "객실" },
  { id: "rate", label: "요금" },
  { id: "note", label: "메모" },
];

/** 메모 정리: 앞뒤 공백 제거 · 300자 · 비면 null */
export function cleanNote(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t || null;
}

export function matchesFilter(c: Change, f: ChangeFilter): boolean {
  if (f === "all") return true;
  if (f === "room") return c.kind === "room" || c.kind === "stay";
  return c.kind === f;
}

/** 이 단체/예약의 기록 (최신이 위 · 고정 메모는 맨 위) */
export function changesFor(list: Change[], scope: { groupId?: string | null; bookingIds?: string[] }, f: ChangeFilter = "all"): Change[] {
  const ids = new Set(scope.bookingIds ?? []);
  return list
    .filter((c) => (scope.groupId && c.groupId === scope.groupId) || (c.bookingId && ids.has(c.bookingId)))
    .filter((c) => matchesFilter(c, f))
    .sort((a, b) => Number(b.pinned && b.kind === "note") - Number(a.pinned && a.kind === "note") || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** 메모에 이 말이 들어 있는 예약 id들 (검색용) */
export function noteBookingIds(list: Change[], q: string, groupBookings: (groupId: string) => string[]): Set<string> {
  const s = q.trim().toLowerCase();
  const out = new Set<string>();
  if (s.length < 2) return out;
  for (const c of list) {
    if (c.kind !== "note" || !c.summary.toLowerCase().includes(s)) continue;
    if (c.bookingId) out.add(c.bookingId);
    if (c.groupId) groupBookings(c.groupId).forEach((id) => out.add(id));
  }
  return out;
}

/** 고정된 메모 1줄 (보드·패널 미리보기) */
export function pinnedNote(list: Change[], scope: { groupId?: string | null; bookingIds?: string[] }): Change | null {
  return changesFor(list, scope, "note").find((c) => c.pinned) ?? null;
}

const wonStr = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** KST 기준 `10/28 14:10` */
export function atLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function joinSummary(p: { roomNo: string; checkIn: string; nights: number; rate?: number | null }): string {
  return `${p.roomNo}호 객실 추가 · ${md(p.checkIn)}부터 ${p.nights}박${p.rate ? ` · 1박 ${wonStr(p.rate)}` : ""}`;
}
export function leaveSummary(p: { roomNo: string; leaveDate: string; nights: number; price: number }): string {
  return `${p.roomNo}호 조기 퇴실 처리 · ${md(p.leaveDate)} 퇴실 · ${p.nights}박 ${wonStr(p.price)}`;
}
export function extendSummary(p: { roomNo: string; fromNights: number; toNights: number; throughDate?: string | null }): string {
  return `${p.roomNo}호 ${p.fromNights}박 → ${p.toNights}박 연장${p.throughDate ? ` (~${md(p.throughDate)})` : ""}`;
}

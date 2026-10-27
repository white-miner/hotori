/**
 * 미배정 예약 정렬 — 「현황」「배치」운영패널 공용.
 * 입실일순 / 예약일순 (오름·내림). 같은 값이면 입실일 → 타입 → 이름 순으로 안정 정렬.
 */
import type { Booking } from "./ledger";

export type UaSortKey = "checkIn" | "booked";
export type UaSortDir = "asc" | "desc";
export interface UaSort {
  key: UaSortKey;
  dir: UaSortDir;
}

export const UA_SORT_DEFAULT: UaSort = { key: "checkIn", dir: "asc" };
export const UA_SORT_KEYS: { id: UaSortKey; label: string }[] = [
  { id: "checkIn", label: "입실일순" },
  { id: "booked", label: "예약일순" },
];
export const UA_SORT_STORAGE_KEY = "hotori.uaSort";

export function normalizeUaSort(raw: unknown): UaSort {
  if (!raw || typeof raw !== "object") return { ...UA_SORT_DEFAULT };
  const o = raw as Record<string, unknown>;
  const key: UaSortKey = o.key === "booked" ? "booked" : "checkIn";
  const dir: UaSortDir = o.dir === "desc" ? "desc" : "asc";
  return { key, dir };
}

/** 같은 키를 다시 누르면 방향 반전, 다른 키는 오름차순부터 */
export function toggleUaSort(cur: UaSort, key: UaSortKey): UaSort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 새 배열을 돌려줘요 (입력 불변). */
export function sortUnassigned(list: readonly Booking[], sort: UaSort = UA_SORT_DEFAULT): Booking[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  const primary = (b: Booking) => (sort.key === "booked" ? (b.createdAt ?? "") : b.checkIn);
  return [...list].sort((a, b) => {
    const p = cmpStr(primary(a), primary(b)) * sign;
    if (p) return p;
    // 예약일이 같으면(스마트 등록 일괄) 입실일 오름차순 · 입실일이 같으면 예약일 오름차순
    const secondary = sort.key === "booked" ? cmpStr(a.checkIn, b.checkIn) : cmpStr(a.createdAt ?? "", b.createdAt ?? "");
    if (secondary) return secondary;
    const t = cmpStr(a.typeId ?? "", b.typeId ?? "");
    if (t) return t;
    const n = (a.guestName ?? "").localeCompare(b.guestName ?? "", "ko");
    if (n) return n;
    return cmpStr(a.id, b.id);
  });
}

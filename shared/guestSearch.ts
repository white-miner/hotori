/** 「현황」·「배치」보드 고객 이름/연락처 검색 (클라이언트 · 로드된 예약만) */
import { type Booking, isActive } from "./ledger";

/** 운영패널 목록 검색 부가 필드 (타입·플랫폼 · 예약번호=memo) */
export interface OpsSearchMeta {
  typeName?: string | null;
  platformName?: string | null;
  platformAbbr?: string | null;
}

export interface GuestSearchQuery {
  /** 소문자·공백 제거된 이름 키 (빈 문자열이면 이름 매칭 안 함) */
  nameKey: string;
  /** 숫자만 남긴 연락처 쿼리 (비면 전화 매칭 안 함) */
  digits: string;
}

export interface GuestSearchChip {
  key: string;
  bookingId: string;
  roomId: string | null;
  labelName: string;
  /** 호수 표시 (예: `601` · `본관 601` · `미배정`) */
  labelRoom: string;
}

export interface BoardGuestSlot {
  roomId: string;
  booking: Booking | null | undefined;
}

export interface GuestSearchGroup {
  payerName?: string | null;
}

export function phoneDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function normalizeGuestName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "");
}

/** trim 후 비면 null — 검색 비활성 */
export function parseGuestQuery(raw: string): GuestSearchQuery | null {
  const t = raw.trim();
  if (!t) return null;
  return { nameKey: normalizeGuestName(t), digits: phoneDigits(t) };
}

/**
 * 손님 이름(부분) · 연락처 숫자 · 그룹명 · 대표 손님명.
 * 바로입실 자동명(`바로입실 10/21`)도 guestName 그대로 매칭.
 */
export function textMatchesGuest(
  query: GuestSearchQuery,
  guestName: string | null | undefined,
  guestPhone: string | null | undefined,
  groupName?: string | null,
  payerName?: string | null,
): boolean {
  const { nameKey, digits } = query;
  if (nameKey) {
    if (normalizeGuestName(guestName).includes(nameKey)) return true;
    if (normalizeGuestName(groupName).includes(nameKey)) return true;
    if (normalizeGuestName(payerName).includes(nameKey)) return true;
  }
  if (digits.length > 0 && phoneDigits(guestPhone).includes(digits)) return true;
  return false;
}

/**
 * 운영패널 목록 검색: 이름·전화 + 타입·플랫폼·예약번호(memo)·id.
 * 보드 게스트 검색 UX와 동일 정규화(부분·숫자).
 */
export function textMatchesOpsBooking(
  query: GuestSearchQuery,
  b: Pick<Booking, "id" | "guestName" | "guestPhone" | "groupName" | "memo">,
  meta?: OpsSearchMeta,
): boolean {
  if (textMatchesGuest(query, b.guestName, b.guestPhone, b.groupName)) return true;
  const { nameKey, digits } = query;
  if (nameKey) {
    if (normalizeGuestName(meta?.typeName).includes(nameKey)) return true;
    if (normalizeGuestName(meta?.platformName).includes(nameKey)) return true;
    if (normalizeGuestName(meta?.platformAbbr).includes(nameKey)) return true;
    if (normalizeGuestName(b.memo).includes(nameKey)) return true;
    if (normalizeGuestName(b.id).includes(nameKey)) return true;
  }
  if (digits.length > 0) {
    if (phoneDigits(b.memo).includes(digits)) return true;
    if (phoneDigits(b.id).includes(digits)) return true;
  }
  return false;
}

/** raw 비면 원본 · 있으면 매칭만 */
export function filterOpsBookings<T extends Booking>(
  list: T[],
  queryRaw: string,
  metaOf: (b: T) => OpsSearchMeta,
): T[] {
  const query = parseGuestQuery(queryRaw);
  if (!query) return list;
  return list.filter((b) => textMatchesOpsBooking(query, b, metaOf(b)));
}

function bookingMatches(
  b: Booking,
  query: GuestSearchQuery,
  groups: Map<string, GuestSearchGroup> | undefined,
): boolean {
  const g = b.groupId && groups ? groups.get(b.groupId) : undefined;
  return textMatchesGuest(query, b.guestName, b.guestPhone, b.groupName, g?.payerName);
}

/**
 * 보드에 보이는 칸(+미배정)에서 매칭.
 * 그룹/대표명 또는 단체 일원 매칭 시 같은 groupId의 보드 호실 전부 하이라이트.
 */
export function boardGuestSearch(opts: {
  slots: BoardGuestSlot[];
  unassigned?: Booking[];
  groups?: Map<string, GuestSearchGroup>;
  queryRaw: string;
  roomLabel: (roomId: string) => string;
  /** 메모 본문에 검색어가 있는 예약 id (메모 · 기록 검색) */
  noteIds?: Set<string>;
}): { active: boolean; roomIds: Set<string>; chips: GuestSearchChip[] } {
  const query = parseGuestQuery(opts.queryRaw);
  if (!query) return { active: false, roomIds: new Set(), chips: [] };

  const groups = opts.groups;
  const matchedGroupIds = new Set<string>();
  const direct: { roomId: string | null; booking: Booking }[] = [];

  for (const { roomId, booking } of opts.slots) {
    if (!booking || !isActive(booking)) continue;
    if (bookingMatches(booking, query, groups) || opts.noteIds?.has(booking.id)) {
      direct.push({ roomId, booking });
      if (booking.groupId) matchedGroupIds.add(booking.groupId);
    }
  }
  for (const b of opts.unassigned ?? []) {
    if (!isActive(b)) continue;
    if (bookingMatches(b, query, groups) || opts.noteIds?.has(b.id)) {
      direct.push({ roomId: null, booking: b });
      if (b.groupId) matchedGroupIds.add(b.groupId);
    }
  }

  const roomIds = new Set<string>();
  const chips: GuestSearchChip[] = [];
  const seen = new Set<string>();

  const add = (roomId: string | null, booking: Booking) => {
    const key = `${booking.id}:${roomId ?? "ua"}`;
    if (seen.has(key)) return;
    seen.add(key);
    chips.push({
      key,
      bookingId: booking.id,
      roomId,
      labelName: booking.guestName?.trim() || "이름 없음",
      labelRoom: roomId ? opts.roomLabel(roomId) : "미배정",
    });
    if (roomId) roomIds.add(roomId);
  };

  for (const h of direct) add(h.roomId, h.booking);

  // 단체 확장: 일원 매칭 → 보드上 같은 그룹 호실 전부
  if (matchedGroupIds.size) {
    for (const { roomId, booking } of opts.slots) {
      if (!booking || !isActive(booking) || !booking.groupId) continue;
      if (matchedGroupIds.has(booking.groupId)) add(roomId, booking);
    }
  }

  return { active: true, roomIds, chips };
}

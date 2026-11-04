/**
 * 견적 발급 → Path A 미배정(타입홀드) 예약 (기본).
 * 줄에 roomIds가 rooms 수와 맞으면 그 호실로 배정(Path B).
 * 다실 = 1 group + N bookings · 단실 = 단일 booking.
 * See docs/group-invoice-plan.md · type-hold-unassigned-booking-plan.md
 */
import { groupDrafts, hashGroupBadgeColor } from "./group";
import { addDays, allRooms, occupiesNight, roomOnNight, type Booking, type HotelSettings, typeLabel, usableTypes } from "./ledger";
import { isOnsite } from "./payment";
import { type GroupInfo } from "./settle";
import { type QuoteDraft, type QuoteLine, QUOTE_COPY, normalizeQuoteTaxMode } from "./quoteDoc";

export const QUOTE_BOOKING_MEMO_PREFIX = "[견적]" as const;

export type QuoteBookingPlan =
  | { kind: "skip"; reason: string }
  | { kind: "single"; booking: Booking }
  | {
      kind: "group";
      groupId: string;
      drafts: Booking[];
      info: Omit<GroupInfo, "payments">;
    };

/** 견적 발급용 채널: 현장·전화 우선 (기관 정산) · 없으면 첫 플랫폼 */
export function quotePlatformId(s: HotelSettings): string {
  return s.platforms.find((p) => isOnsite(p))?.id ?? s.platforms[0]?.id ?? "";
}

type Slot = { typeId: string; roomId: string | null; checkIn: string; nights: number; price: number; rate: number; nightRates: Record<string, number>; guests: number };

function expandSlots(lines: QuoteLine[], taxMode: "included" | "excluded" | "exempt"): Slot[] {
  const slots: Slot[] = [];
  for (const line of lines) {
    const rooms = Math.max(0, Math.round(line.rooms) || 0);
    if (!line.typeId || rooms <= 0) continue;
    const nights = Math.max(1, Math.round(line.nights) || 1);
    const rate = Math.max(0, Math.round(line.rate) || 0);
    const lineAmt = Math.max(0, Math.round(line.amount) || rate * nights * rooms);
    const nightly = Object.fromEntries((line.nightAmounts ?? []).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)).map((c) => [c.date, Math.max(0, Math.round(c.amount))]));
    const perRoom = rooms > 0 ? Math.floor(lineAmt / rooms) : 0;
    const rem = lineAmt - perRoom * rooms;
    const ids = line.roomIds ?? [];
    for (let i = 0; i < rooms; i++) {
      const roomAmount = perRoom + (i === 0 ? rem : 0);
      const hasNightTable = Object.keys(nightly).length === nights;
      const roomNightRates = hasNightTable
        ? Object.fromEntries(Object.entries(nightly).map(([date, amount]) => [date, taxMode === "excluded" ? amount + Math.round(amount / 10) : amount]))
        : {};
      const price = hasNightTable
        ? Object.values(roomNightRates).reduce((sum, amount) => sum + amount, 0)
        : taxMode === "excluded" ? roomAmount + Math.round(roomAmount / 10) : roomAmount;
      const roomRate = hasNightTable
        ? Math.round(Object.values(roomNightRates).reduce((sum, amount) => sum + amount, 0) / nights)
        : taxMode === "excluded" ? rate + Math.round(rate / 10) : rate;
      slots.push({
        typeId: line.typeId,
        roomId: ids[i] ?? null,
        checkIn: line.checkIn || "",
        nights,
        price,
        rate: roomRate,
        nightRates: roomNightRates,
        guests: Math.max(0, Math.round(line.pax) || 0),
      });
    }
  }
  return slots;
}

export function validateQuoteForBookings(draft: QuoteDraft, s: HotelSettings, bookings: Booking[] = []): string | null {
  const types = new Set(usableTypes(s.types).map((t) => t.id));
  const usable = draft.lines.filter((l) => Math.round(l.rooms) > 0);
  if (!usable.length) return QUOTE_COPY.emptyLines;
  if (!draft.checkIn && usable.some((line) => !line.checkIn)) return "각 견적 항목의 입실일(이용 날짜)을 입력해 주세요.";
  for (const l of usable) {
    if (!l.typeId || !types.has(l.typeId)) return "객실 타입을 골라 주세요. (발급 시 타입 홀드 예약용)";
    if ((Math.round(l.nights) || 0) <= 0 && (Math.round(draft.nights) || 0) <= 0) {
      return "박수를 입력해 주세요.";
    }
  }
  const roomsById = new Map(allRooms(s).map((r) => [r.id, r]));
  const assigned: Array<{ id: string; typeId: string; from: string; to: string }> = [];
  for (const line of usable) {
    const start = line.checkIn || draft.checkIn;
    if (!start) return "각 견적 항목의 이용 날짜를 입력해 주세요.";
    const nights = Math.max(1, Math.round(line.nights) || Math.round(draft.nights) || 1);
    const end = addDays(start, nights);
    for (const roomId of line.roomIds ?? []) {
      const room = roomsById.get(roomId);
      if (!room || room.typeId !== line.typeId) return "객실 타입과 호실 배정이 맞지 않아요. 호실을 다시 선택해 주세요.";
      for (let offset = 0; offset < nights; offset++) {
        const date = addDays(start, offset);
        const occupied = bookings.find((booking) => booking.id !== line.id && occupiesNight(booking, date) && roomOnNight(booking, date) === roomId);
        if (occupied) return `${room.no}호는 ${date}에 이미 예약되어 있어요. 다른 호실을 선택해 주세요.`;
      }
      if (assigned.some((x) => x.id === roomId && start < x.to && x.from < end)) {
        return `${room.no}호가 겹치는 날짜에 두 번 배정됐어요. 날짜별 호실 배정을 확인해 주세요.`;
      }
      assigned.push({ id: roomId, typeId: line.typeId, from: start, to: end });
    }
  }
  if (!quotePlatformId(s)) return "설정에 플랫폼(현장·전화)이 필요해요.";
  return null;
}

/**
 * Expand quote lines → Path A (roomId null) or Path B when roomIds match count.
 */
export function planQuoteTypeHoldBookings(opts: {
  draft: QuoteDraft;
  quoteId: string;
  s: HotelSettings;
  bookings?: Booking[];
  guestPhone?: string | null;
}): QuoteBookingPlan {
  const v = validateQuoteForBookings(opts.draft, opts.s, opts.bookings);
  if (v) return { kind: "skip", reason: v };
  const checkIn = opts.draft.checkIn || opts.draft.lines.find((line) => line.checkIn)?.checkIn || "";
  const platformId = quotePlatformId(opts.s);
  const name = (opts.draft.clientName.trim() || opts.draft.title.trim() || QUOTE_COPY.title).slice(0, 60);
  const memo = `${QUOTE_BOOKING_MEMO_PREFIX} ${name}`.slice(0, 80);

  const lines: QuoteLine[] = opts.draft.lines.map((l) => ({
    ...l,
    nights: Math.max(1, Math.round(l.nights) || Math.round(opts.draft.nights) || 1),
    checkIn: l.checkIn || checkIn,
  }));
  const slots = expandSlots(lines, normalizeQuoteTaxMode(opts.draft.taxMode));
  if (!slots.length) return { kind: "skip", reason: QUOTE_COPY.emptyLines };

  const phone = opts.guestPhone?.trim() || opts.draft.clientPhone.trim() || null;
  const typeIds = slots.map((x) => x.typeId);
  const rates = slots.map((x) => x.rate);
  const roomIds = slots.map((x) => x.roomId);

  if (slots.length === 1) {
    const now = new Date().toISOString();
    const slot = slots[0]!;
    const booking: Booking = {
      id: crypto.randomUUID(),
      kind: "stay",
      status: "active",
      platformId,
      price: slot.price,
      guestName: name,
      guestPhone: phone,
      typeId: slot.typeId,
      roomId: slot.roomId,
      segments: null,
      checkIn: slot.checkIn,
      nights: slot.nights,
      nightRates: Object.keys(slot.nightRates).length ? { nights: slot.nightRates } : { flat: slot.rate },
      startTime: null,
      endTime: null,
      arrived: false,
      tentative: false,
      earlyOut: null,
      checkedOutAt: null,
      refund: null,
      memo,
      guests: slot.guests || null,
      groupId: null,
      groupName: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    return { kind: "single", booking };
  }

  const groupId = crypto.randomUUID();
  const stayGroups = new Map<string, number[]>();
  slots.forEach((slot, i) => {
    const key = `${slot.checkIn}|${slot.nights}`;
    stayGroups.set(key, [...(stayGroups.get(key) ?? []), i]);
  });
  const drafts = [...stayGroups.values()].flatMap((indices) => {
    const first = slots[indices[0]!]!;
    return groupDrafts({
      groupId,
      groupName: name,
      platformId,
      checkIn: first.checkIn,
      nights: first.nights,
      typeIds: indices.map((i) => slots[i]!.typeId),
      prices: indices.map((i) => slots[i]!.price),
      memberRates: indices.map((i) => slots[i]!.rate),
      memberNightRates: indices.map((i) => {
        const table = slots[i]!.nightRates;
        return Object.keys(table).length ? { nights: table } : null;
      }),
      s: opts.s,
      guestsOf: (typeId) => {
        const i = indices.find((index) => slots[index]!.typeId === typeId);
        return i == null ? null : slots[i]!.guests || null;
      },
    }).map((booking, j) => ({
      ...booking,
      id: crypto.randomUUID(),
      guestPhone: phone,
      memo,
      guests: slots[indices[j]!]!.guests || null,
      roomId: roomIds[indices[j]!] ?? null,
    }));
  });

  const ratesPersist: Record<string, number> = {};
  for (let i = 0; i < typeIds.length; i++) {
    const tid = typeIds[i]!;
    if (rates[i]! > 0 && ratesPersist[tid] == null) ratesPersist[tid] = rates[i]!;
  }

  return {
    kind: "group",
    groupId,
    drafts,
    info: {
      id: groupId,
      payMode: "postpaid",
      dueOn: null,
      payerCompany: name,
      payerName: null,
      payerPhone: phone,
      rates: Object.keys(ratesPersist).length ? ratesPersist : null,
      extras: [],
      badgeColor: hashGroupBadgeColor(groupId),
    },
  };
}

export function quoteLineTypeOptions(s: HotelSettings): { id: string; label: string }[] {
  return usableTypes(s.types).map((t) => ({ id: t.id, label: typeLabel(t) }));
}

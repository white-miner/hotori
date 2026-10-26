/**
 * 견적 발급 → Path A 미배정(타입홀드) 예약 (기본).
 * 줄에 roomIds가 rooms 수와 맞으면 그 호실로 배정(Path B).
 * 다실 = 1 group + N bookings · 단실 = 단일 booking.
 * See docs/group-invoice-plan.md · type-hold-unassigned-booking-plan.md
 */
import { groupDrafts, hashGroupBadgeColor } from "./group";
import { type Booking, type HotelSettings, typeLabel, usableTypes } from "./ledger";
import { isOnsite } from "./payment";
import { type GroupInfo } from "./settle";
import { type QuoteDraft, type QuoteLine, QUOTE_COPY } from "./quoteDoc";

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

type Slot = { typeId: string; roomId: string | null; price: number; rate: number; guests: number };

function expandSlots(lines: QuoteLine[]): Slot[] {
  const slots: Slot[] = [];
  for (const line of lines) {
    const rooms = Math.max(0, Math.round(line.rooms) || 0);
    if (!line.typeId || rooms <= 0) continue;
    const nights = Math.max(1, Math.round(line.nights) || 1);
    const rate = Math.max(0, Math.round(line.rate) || 0);
    const lineAmt = Math.max(0, Math.round(line.amount) || rate * nights * rooms);
    const perRoom = rooms > 0 ? Math.floor(lineAmt / rooms) : 0;
    const rem = lineAmt - perRoom * rooms;
    const ids = line.roomIds ?? [];
    const useRooms = ids.length === rooms;
    for (let i = 0; i < rooms; i++) {
      slots.push({
        typeId: line.typeId,
        roomId: useRooms ? ids[i] ?? null : null,
        price: perRoom + (i === 0 ? rem : 0),
        rate,
        guests: Math.max(0, Math.round(line.pax) || 0),
      });
    }
  }
  return slots;
}

export function validateQuoteForBookings(draft: QuoteDraft, s: HotelSettings): string | null {
  if (!draft.checkIn) return "입실 예정일을 적어 주세요. (발급 시 미배정 예약이 만들어져요)";
  const types = new Set(usableTypes(s.types).map((t) => t.id));
  const usable = draft.lines.filter((l) => Math.round(l.rooms) > 0);
  if (!usable.length) return QUOTE_COPY.emptyLines;
  for (const l of usable) {
    if (!l.typeId || !types.has(l.typeId)) return "객실 타입을 골라 주세요. (발급 시 타입 홀드 예약용)";
    if ((Math.round(l.nights) || 0) <= 0 && (Math.round(draft.nights) || 0) <= 0) {
      return "박수를 적어 주세요.";
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
  guestPhone?: string | null;
}): QuoteBookingPlan {
  const v = validateQuoteForBookings(opts.draft, opts.s);
  if (v) return { kind: "skip", reason: v };
  const checkIn = opts.draft.checkIn!;
  const platformId = quotePlatformId(opts.s);
  const name = (opts.draft.clientName.trim() || opts.draft.title.trim() || QUOTE_COPY.title).slice(0, 60);
  const memo = `${QUOTE_BOOKING_MEMO_PREFIX} ${name}`.slice(0, 80);

  const lines: QuoteLine[] = opts.draft.lines.map((l) => ({
    ...l,
    nights: Math.max(1, Math.round(l.nights) || Math.round(opts.draft.nights) || 1),
  }));
  const nights = Math.max(...lines.map((l) => l.nights), 1);
  const slots = expandSlots(lines);
  if (!slots.length) return { kind: "skip", reason: QUOTE_COPY.emptyLines };

  const phone = opts.guestPhone?.trim() || opts.draft.clientPhone.trim() || null;
  const typeIds = slots.map((x) => x.typeId);
  const prices = slots.map((x) => x.price);
  const rates = slots.map((x) => x.rate);
  const guests = slots.map((x) => x.guests);
  const roomIds = slots.map((x) => x.roomId);
  const allAssigned = roomIds.every((id) => !!id);
  const noneAssigned = roomIds.every((id) => !id);

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
      checkIn,
      nights,
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
  const drafts = (
    allAssigned
      ? groupDrafts({
          groupId,
          groupName: name,
          platformId,
          checkIn,
          nights,
          roomIds: roomIds as string[],
          prices,
          memberRates: rates,
          s: opts.s,
          guestsOf: (typeId) => {
            const i = typeIds.indexOf(typeId);
            return guests[i] || null;
          },
        })
      : groupDrafts({
          groupId,
          groupName: name,
          platformId,
          checkIn,
          nights,
          typeIds,
          prices,
          memberRates: rates,
          s: opts.s,
          guestsOf: (typeId) => {
            const i = typeIds.indexOf(typeId);
            return guests[i] || null;
          },
        })
  ).map((b, i) => ({
    ...b,
    id: crypto.randomUUID(),
    guestPhone: phone,
    memo,
    // Mixed assign: force per-slot roomId (groupDrafts type-only path is all null)
    roomId: noneAssigned || allAssigned ? b.roomId : roomIds[i] ?? null,
  }));

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

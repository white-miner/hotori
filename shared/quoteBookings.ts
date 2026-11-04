/**
 * 견적 발급 → Path A 미배정(타입홀드) 예약 (기본).
 * 줄에 roomIds가 rooms 수와 맞으면 그 호실로 배정(Path B).
 * 다실 = 1 group + N bookings · 단실 = 단일 booking.
 * See docs/group-invoice-plan.md · type-hold-unassigned-booking-plan.md
 */
import { groupDrafts, hashGroupBadgeColor } from "./group";
import { addDays, allRooms, freeRooms, type Booking, type HotelSettings, typeLabel, usableTypes } from "./ledger";
import { nightRatesFromTotal, occupiedNightDates, type StayNightRates } from "./nightrates";
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

type Slot = {
  typeId: string;
  roomId: string | null;
  checkIn: string;
  nights: number;
  price: number;
  nightRates: StayNightRates;
  guests: number;
  detail?: string;
};

function expandSlots(lines: QuoteLine[], checkIn: string, taxMode: QuoteDraft["taxMode"]): Slot[] {
  const slots: Slot[] = [];
  let cumulative = 0;
  for (const line of lines) {
    const rooms = Math.max(0, Math.round(line.rooms) || 0);
    if (!line.typeId || rooms <= 0) continue;
    const nights = Math.max(1, Math.round(line.nights) || 1);
    const start = line.checkIn ?? checkIn;
    const dates = occupiedNightDates(start, nights);
    const lineAmt = Math.max(0, Math.round(line.amount));
    const perRoom = Math.floor(lineAmt / rooms);
    const rem = lineAmt - perRoom * rooms;
    const ids = line.roomIds ?? [];
    for (let i = 0; i < rooms; i++) {
      const amount = perRoom + (i === 0 ? rem : 0);
      const cells = line.nightAmounts;
      const explicit = cells?.length === dates.length &&
        cells.reduce((sum, cell) => sum + cell.amount, 0) === amount;
      const amounts = explicit ? cells!.map((cell) => cell.amount) :
        Object.values(nightRatesFromTotal(start, nights, amount).nights ?? {});
      const gross = amounts.map((value) => {
        if (taxMode !== "excluded") return value;
        const tax = Math.round((cumulative + value) / 10) - Math.round(cumulative / 10);
        cumulative += value;
        return value + tax;
      });
      slots.push({
        typeId: line.typeId,
        roomId: ids[i] ?? null,
        checkIn: start,
        nights,
        price: gross.reduce((sum, value) => sum + value, 0),
        nightRates: {
          flat: gross.every((value) => value === gross[0]) ? gross[0] ?? null : null,
          weekday: null,
          weekend: null,
          nights: Object.fromEntries(dates.map((day, index) => [day, gross[index] ?? 0])),
        },
        guests: Math.max(0, Math.round(line.pax) || 0),
        detail: line.detail,
      });
    }
  }
  return slots;
}

export function validateQuoteForBookings(draft: QuoteDraft, s: HotelSettings, bookings: Booking[] = []): string | null {
  const types = new Set(usableTypes(s.types).map((t) => t.id));
  const rooms = new Map(allRooms(s).map((room) => [room.id, room]));
  const assigned = new Map<string, { from: string; to: string }[]>();
  const usable = draft.lines.filter((l) => Math.round(l.rooms) > 0);
  if (!usable.length) return QUOTE_COPY.emptyLines;
  for (const l of usable) {
    if (!l.typeId || !types.has(l.typeId)) return "객실 타입을 골라 주세요. (발급 시 타입 홀드 예약용)";
    const nights = Math.round(l.nights) || Math.round(draft.nights);
    if (nights < 1 || nights > 365) return "박수는 1~365박으로 입력해 주세요.";
    if (l.rooms > 100) return "항목당 객실 수는 100실까지 입력할 수 있어요.";
    if ((l.roomIds?.length ?? 0) > l.rooms) return "선택한 호실 수가 객실 수보다 많아요.";
    const from = l.checkIn || draft.checkIn;
    if (!from) return "입실 예정일을 입력해 주세요.";
    const to = addDays(from, nights);
    const free = l.roomIds?.length ? freeRooms(s, bookings, {
      id: l.id, kind: "stay", checkIn: from, nights, startTime: null, endTime: null,
    }) : null;
    for (const id of l.roomIds ?? []) {
      const room = rooms.get(id);
      if (!room || room.typeId !== l.typeId) return "객실 타입과 맞는 호실을 다시 골라 주세요.";
      if (free && !free.has(id)) return `${room.no}호는 해당 기간에 배정할 수 없어요. 다른 호실을 선택해 주세요.`;
      const periods = assigned.get(id) ?? [];
      if (periods.some((period) => from < period.to && period.from < to)) {
        return `${room.no}호의 배정 기간이 겹쳐요. 호실이나 날짜를 확인해 주세요.`;
      }
      assigned.set(id, [...periods, { from, to }]);
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
  }));
  const nights = Math.max(...lines.map((l) => l.nights), 1);
  const slots = expandSlots(lines, checkIn, opts.draft.taxMode);
  if (!slots.length) return { kind: "skip", reason: QUOTE_COPY.emptyLines };

  const phone = opts.guestPhone?.trim() || opts.draft.clientPhone.trim() || null;
  const typeIds = slots.map((x) => x.typeId);
  const prices = slots.map((x) => x.price);
  const slotMemo = (slot: Slot) => (slot.detail ? `${memo} · ${slot.detail}` : memo).slice(0, 80);

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
      nightRates: slot.nightRates,
      startTime: null,
      endTime: null,
      arrived: false,
      tentative: false,
      earlyOut: null,
      checkedOutAt: null,
      refund: null,
      memo: slotMemo(slot),
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
  const drafts = groupDrafts({ groupId, groupName: name, platformId, checkIn, nights, typeIds, prices, s: opts.s })
    .map((booking, index) => {
      const slot = slots[index]!;
      return {
        ...booking,
        id: crypto.randomUUID(),
        guestPhone: phone,
        memo: slotMemo(slot),
        roomId: slot.roomId,
        guests: slot.guests || null,
        checkIn: slot.checkIn,
        nights: slot.nights,
        nightRates: slot.nightRates,
      };
    });

  const ratesPersist: Record<string, number> = {};
  for (const typeId of new Set(typeIds)) {
    const members = slots.filter((slot) => slot.typeId === typeId);
    const rate = members[0]?.nightRates.flat;
    if (rate && members.every((slot) => slot.nightRates.flat === rate)) ratesPersist[typeId] = rate;
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

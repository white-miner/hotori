// 단체·다실 요금: 객실마다(타입이 아니라) 박마다 요금을 따로 정해요.
//  · 호텔 요금 설정(특별일 > 시즌 > 평일/주말 > 기본)은 칸을 채워 주는 "제안"일 뿐이에요 — 방마다 자유롭게 고쳐요.
//  · 같은 타입이어도 인원·이불·계약 조건에 따라 가격이 달라서, 타입으로 가격을 정하거나 잠그지 않아요.
//  · 객실마다 추가 항목(인원 추가·추가 이불·계약 조건 …)을 붙일 수 있고, 그 객실 소계에 더해져요.
//  · 총액은 객실 소계의 합으로만 보여요 (총액을 먼저 적거나 나누지 않아요).
import { type HotelSettings, STAY_NIGHTS_MAX, won } from "./ledger";
import {
  type NightAmountMap,
  type RoomExtra,
  type StayNightRates,
  ROOM_EXTRA_MAX,
  cleanRoomExtras,
  extrasTotal,
  occupiedNightDates,
  priceFromNightMatrix,
  sumNightAmounts,
} from "./nightrates";
import { type RateSource } from "./seasonRates";
import { resolveNightRate } from "./salesCalendar";

/** 요금 줄 하나 = 객실 하나 (호실 미정이면 타입 안의 n번째) */
export interface RateSlot {
  key: string;
  roomId: string | null;
  typeId: string;
  /** `602호` · `스탠다드 #1` */
  label: string;
  /** `SD` · `호실 미정` */
  sub: string;
}

/** 추가 항목을 적는 칸 (박당이면 박수만큼 곱해서 소계에 더해요) */
export interface ExtraDraft {
  name: string;
  amount: number;
  /** true = 박당 금액 · false = 한 번만 */
  perNight: boolean;
}

/** 직원이 손댄 값. rates가 있으면 「직접 수정됨」 */
export interface SlotEdit {
  rates?: StayNightRates | null;
  extras?: ExtraDraft[];
}
export type RateEdits = Record<string, SlotEdit>;

export const roomSlotKey = (roomId: string) => `r:${roomId}`;

/** 호실을 고른 경우: 방마다 한 줄 */
export function roomSlots(
  roomIds: readonly string[],
  info: (roomId: string) => { typeId: string; label: string; sub: string },
): RateSlot[] {
  return roomIds.map((id) => {
    const x = info(id);
    return { key: roomSlotKey(id), roomId: id, typeId: x.typeId, label: x.label, sub: x.sub };
  });
}

/** 호실 미정: 타입마다 n줄 (스탠다드 #1 · 스탠다드 #2 …) — 줄은 따로, 가격도 따로 */
export function typeSlots(
  typeIds: readonly string[],
  info: (typeId: string) => { name: string },
): RateSlot[] {
  const seen = new Map<string, number>();
  return typeIds.map((typeId) => {
    const k = (seen.get(typeId) ?? 0) + 1;
    seen.set(typeId, k);
    return { key: `t:${typeId}#${k}`, roomId: null, typeId, label: `${info(typeId).name} #${k}`, sub: "호실 미정" };
  });
}

export const ROW_SOURCE_LABEL: Record<RateSource | "edited", string> = {
  date: "특별일 요금",
  season: "시즌 요금",
  weekend: "주말 요금",
  weekday: "평일 요금",
  flat: "기본 요금",
  none: "요금 없음",
  edited: "직접 수정",
};

export interface SuggestedNight {
  date: string;
  amount: number;
  source: RateSource;
  seasonName?: string;
}

/** 호텔 요금 설정에서 온 박별 제안 (타입의 제안일 뿐 · 저장 값이 아니에요) */
export function suggestNights(s: HotelSettings, typeId: string, checkIn: string, nights: number): SuggestedNight[] {
  return occupiedNightDates(checkIn, Math.min(nights, STAY_NIGHTS_MAX)).map((date) => {
    const r = resolveNightRate(s, typeId, date);
    return { date, amount: r.amount, source: r.source, seasonName: r.seasonName };
  });
}

export function normalizeExtraDrafts(list: readonly ExtraDraft[] | undefined): ExtraDraft[] {
  return (list ?? [])
    .map((x) => ({ name: x.name.trim(), amount: Math.max(0, Math.round(x.amount || 0)), perNight: !!x.perNight }))
    .filter((x) => x.name && x.amount > 0)
    .slice(0, ROOM_EXTRA_MAX);
}

/** 적은 항목 → 객실에 붙는 줄 (박당은 박수를 곱해요) */
export function resolveExtras(list: readonly ExtraDraft[] | undefined, nights: number): RoomExtra[] {
  const n = Math.max(1, Math.round(nights));
  return cleanRoomExtras(normalizeExtraDrafts(list).map((x) => (x.perNight ? { name: x.name, amount: x.amount * n, perNight: x.amount } : { name: x.name, amount: x.amount })));
}

/**
 * 객실 한 줄의 요금표 (박별 금액 + 추가 항목).
 *  · 고친 적 없으면 호텔 요금 제안 그대로
 *  · 고쳤으면 그 값 (새로 늘어난 박은 고친 1박 요금, 없으면 제안)
 */
export function slotRates(s: HotelSettings, slot: RateSlot, edits: RateEdits, checkIn: string, nights: number): StayNightRates {
  const edit = edits[slot.key];
  const sug = suggestNights(s, slot.typeId, checkIn, nights);
  const dates = sug.map((x) => x.date);
  const map: NightAmountMap = {};
  const rates = edit?.rates ?? null;
  const flat = rates?.flat != null && rates.flat > 0 ? Math.round(rates.flat) : 0;
  for (const x of sug) {
    const own = rates?.nights?.[x.date];
    map[x.date] = own != null && Number.isFinite(Number(own)) ? Math.max(0, Math.round(Number(own))) : rates ? flat || x.amount : x.amount;
  }
  const first = dates.length ? map[dates[0]!]! : 0;
  const extras = resolveExtras(edit?.extras, nights);
  return { flat: first > 0 ? first : null, weekday: null, weekend: null, nights: map, ...(extras.length ? { extras } : {}) };
}

export const isEdited = (edits: RateEdits, key: string): boolean => !!edits[key]?.rates;

/** 객실 소계 = 박별 합 + 추가 항목 */
export const slotSubtotal = (rates: StayNightRates): number => priceFromNightMatrix(rates);
/** 객실료만 (추가 항목 빼고) */
export const slotRoomCharge = (rates: StayNightRates): number => sumNightAmounts(rates.nights);

export interface SlotRow {
  slot: RateSlot;
  rates: StayNightRates;
  subtotal: number;
  roomCharge: number;
  extras: number;
  edited: boolean;
  /** 박마다 같은 금액이면 그 금액, 다르면 null (평균 안 내요) */
  uniform: number | null;
  /** 박마다 요금이 어디서 왔는지 (겹치지 않게) */
  sources: string[];
}

export function slotRows(s: HotelSettings, slots: readonly RateSlot[], edits: RateEdits, checkIn: string, nights: number): SlotRow[] {
  return slots.map((slot) => {
    const rates = slotRates(s, slot, edits, checkIn, nights);
    const vals = Object.values(rates.nights ?? {});
    const edited = isEdited(edits, slot.key);
    const sug = suggestNights(s, slot.typeId, checkIn, nights);
    let sources: string[];
    if (edited) {
      const diff = sug.some((x) => (rates.nights?.[x.date] ?? 0) !== x.amount);
      sources = diff ? [ROW_SOURCE_LABEL.edited] : sourceLabels(sug);
    } else sources = sourceLabels(sug);
    return {
      slot,
      rates,
      subtotal: slotSubtotal(rates),
      roomCharge: slotRoomCharge(rates),
      extras: extrasTotal(rates),
      edited,
      uniform: vals.length && vals.every((v) => v === vals[0]) ? vals[0]! : null,
      sources,
    };
  });
}

function sourceLabels(sug: readonly SuggestedNight[]): string[] {
  const out: string[] = [];
  for (const x of sug) {
    const l = x.source === "season" && x.seasonName ? `시즌 요금 · ${x.seasonName}` : ROW_SOURCE_LABEL[x.source];
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** 단체 총액 = 객실 소계의 합 (총액을 따로 입력하지 않아요) */
export const groupTotal = (rows: readonly SlotRow[]): number => rows.reduce((n, r) => n + r.subtotal, 0);

/** 객실료가 0원인 객실 (요금이 없어 저장할 수 없어요) */
export const unpricedSlots = (rows: readonly SlotRow[]): RateSlot[] => rows.filter((r) => !(r.roomCharge > 0)).map((r) => r.slot);

export function unpricedMessage(rows: readonly SlotRow[]): string | null {
  const bad = unpricedSlots(rows);
  if (!bad.length) return null;
  const names = bad.slice(0, 3).map((x) => x.label).join(", ");
  return `${names}${bad.length > 3 ? ` 외 ${bad.length - 3}실` : ""} 요금을 입력해 주세요.`;
}

/** groupDrafts에 넘길 방별 요금표 · 판매가 (price = 박별 합 + 추가 항목) */
export function draftRates(rows: readonly SlotRow[]): { memberNightRates: StayNightRates[]; prices: number[] } {
  return { memberNightRates: rows.map((r) => r.rates), prices: rows.map((r) => r.subtotal) };
}

/** 요약 문구 (평균 없이): `3박 × 70,000원` · `3박 · 70,000~90,000원` */
export function rowRateLine(r: Pick<SlotRow, "rates" | "uniform">, nights: number): string {
  const vals = Object.values(r.rates.nights ?? {});
  if (!vals.length) return "";
  if (r.uniform != null) return `${nights}박 × ${won(r.uniform)}원`;
  return `${nights}박 · ${won(Math.min(...vals))}~${won(Math.max(...vals))}원 (박마다 달라요)`;
}

// 빠른 입실 · 늦은 퇴실: 호텔 기본 시간(settings.stayTimes)에서 몇 시간 앞당기고 미루는지만 예약에 적어요.
// 금액(timeFee)은 판매 가격에 들어 있어요 (추가 인원처럼): 매출·잔금에 그대로 들어가요. 0원 + 시간 있음 = 서비스.
import { type Booking, type HotelSettings, addDays, isActive, legsOf } from "./ledger";
import { shiftTime } from "./tiers";

export const EXTRA_HOURS_MAX = 12;
export const clampHours = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(EXTRA_HOURS_MAX, Math.round(n))) : 0);

type TimePick = Pick<Booking, "earlyIn" | "lateOut">;
type S = Pick<HotelSettings, "stayTimes" | "extraHourFee">;

/** 이 예약의 입실 시간 (빠른 입실이면 앞당긴 시간) */
export const inTimeOf = (s: Pick<HotelSettings, "stayTimes">, b: TimePick) => shiftTime(s.stayTimes.checkIn, -clampHours(b.earlyIn)).time;
/** 이 예약의 퇴실 시간 (늦은 퇴실이면 미룬 시간) */
export const outTimeOf = (s: Pick<HotelSettings, "stayTimes">, b: TimePick) => shiftTime(s.stayTimes.checkOut, clampHours(b.lateOut)).time;
/** 자동 금액: (빠른 + 늦은) 시간 × 1시간 요금 */
export const autoTimeFee = (s: S, early: number, late: number) => (clampHours(early) + clampHours(late)) * s.extraHourFee;
export const hasExtraTime = (b: TimePick) => clampHours(b.earlyIn) > 0 || clampHours(b.lateOut) > 0;
/** 서비스: 시간은 있는데 금액이 0원 */
export const isTimeService = (b: TimePick & Pick<Booking, "timeFee">) => hasExtraTime(b) && !b.timeFee;

/** 칸·막대에 붙는 짧은 글자: ['빠른 14:00', '늦은 14:00'] */
export function timeTags(s: Pick<HotelSettings, "stayTimes">, b: TimePick & Pick<Booking, "kind">): string[] {
  if (b.kind !== "stay") return [];
  const out: string[] = [];
  if (clampHours(b.earlyIn)) out.push(`빠른 ${inTimeOf(s, b)}`);
  if (clampHours(b.lateOut)) out.push(`늦은 ${outTimeOf(s, b)}`);
  return out;
}

/** 금액 줄: '빠른 입실 2시간 · 늦은 퇴실 1시간 = 30,000원' */
export function timeLine(b: TimePick): string {
  const p: string[] = [];
  if (clampHours(b.earlyIn)) p.push(`빠른 입실 ${clampHours(b.earlyIn)}시간`);
  if (clampHours(b.lateOut)) p.push(`늦은 퇴실 ${clampHours(b.lateOut)}시간`);
  return p.join(" · ");
}

export interface TurnWarn {
  /** 경고가 붙는 예약 */
  id: string;
  /** 상대 예약 */
  other: string;
  roomId: string;
  date: string;
  text: string;
}
type WB = Pick<Booking, "id" | "kind" | "status" | "checkIn" | "nights" | "roomId" | "segments" | "earlyOut" | "earlyIn" | "lateOut">;
/**
 * 같은 방 같은 날 퇴실 → 입실이 겹칠 수 있으면 경고 (막지는 않아요)
 *  · 앞 손님이 늦은 퇴실이고 그날 다음 손님이 들어오면
 *  · 다음 손님 빠른 입실이 앞 손님 퇴실 시간보다 이르면
 * 앞 손님이 조기 퇴실했으면 그 날짜에 나간 걸로 봐요 (늦은 퇴실은 원래 퇴실날에만 써요).
 */
export function turnoverWarnings(s: Pick<HotelSettings, "stayTimes">, list: WB[]): TurnWarn[] {
  const outs = new Map<string, WB[]>(); // room|date → 그날 그 방에서 나가는 예약
  const ins = new Map<string, WB[]>();
  for (const b of list) {
    if (b.kind !== "stay" || !isActive(b as Booking)) continue;
    const legs = legsOf(b);
    if (!legs.length) continue;
    const first = legs[0];
    const last = legs[legs.length - 1];
    if (first.roomId) {
      const k = `${first.roomId}|${first.checkIn}`;
      ins.set(k, [...(ins.get(k) ?? []), b]);
    }
    if (last.roomId) {
      const k = `${last.roomId}|${addDays(last.checkIn, last.nights)}`;
      outs.set(k, [...(outs.get(k) ?? []), b]);
    }
  }
  const res: TurnWarn[] = [];
  for (const [k, nexts] of ins) {
    const prevs = outs.get(k);
    if (!prevs) continue;
    const [roomId, date] = k.split("|");
    for (const n of nexts)
      for (const p of prevs) {
        if (p.id === n.id) continue;
        const late = !p.earlyOut && clampHours(p.lateOut) > 0;
        const pOut = p.earlyOut ? s.stayTimes.checkOut : outTimeOf(s, p);
        const nIn = inTimeOf(s, n);
        const early = clampHours(n.earlyIn) > 0 && nIn < pOut;
        if (!late && !early) continue;
        res.push({
          id: n.id,
          other: p.id,
          roomId,
          date,
          text: late ? `앞 손님 늦은 퇴실 ${pOut}${early ? ` · 빠른 입실 ${nIn}` : ""}` : `앞 손님 퇴실 ${pOut} 전에 빠른 입실 ${nIn}`,
        });
        res.push({ id: p.id, other: n.id, roomId, date, text: early ? `다음 손님 빠른 입실 ${nIn}` : `다음 손님 같은 날 입실 ${nIn}` });
      }
  }
  return res;
}

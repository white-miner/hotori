import { addDays, STAY_NIGHTS_MAX, type Booking, type HotelSettings, typeLabel, usableTypes } from "./ledger";
import { GROUP_ROOMS_MAX, groupDrafts } from "./group";
import type { StayNightRates } from "./nightrates";

export type GroupDailyPlan = Record<string, Record<string, { rooms: number | null; rate: number | null }>>;
export type DailyMember = { typeId: string; checkIn: string; nights: number; rates: StayNightRates; price: number };
export type DailySummary = { date: string; rooms: number; total: number; arrivals: number; departures: number };
export type GroupDailyResult = { members: DailyMember[]; days: DailySummary[]; total: number; roomNights: number; error: string | null };

/** 실 수 감소는 마지막 순번부터 예정 퇴실, 증가는 새 예약. 각 객실의 날짜·요금은 독립 저장한다. */
export function buildGroupDailyPlan(s: HotelSettings, checkIn: string, nights: number, plan: GroupDailyPlan): GroupDailyResult {
  const empty = (error: string): GroupDailyResult => ({ members: [], days: [], total: 0, roomNights: 0, error });
  const date = new Date(`${checkIn}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== checkIn) return empty("입실 날짜를 확인해 주세요.");
  if (!Number.isInteger(nights) || nights < 1 || nights > STAY_NIGHTS_MAX) return empty("기간을 확인해 주세요.");
  const types = usableTypes(s.types).filter((t) => typeLabel(t));
  const selected = Object.keys(plan);
  if (selected.some((id) => !types.some((t) => t.id === id))) return empty("등록된 객실 타입을 선택해 주세요.");
  const dates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
  for (const id of selected) for (const d of dates) {
    const cell = plan[id]?.[d], count = cell?.rooms ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > GROUP_ROOMS_MAX) return empty(`${typeLabel(types.find((t) => t.id === id))} ${d} 실 수를 확인해 주세요.`);
    if (count && (!Number.isInteger(cell?.rate) || cell!.rate! <= 0 || cell!.rate! > 100_000_000)) return empty(`${typeLabel(types.find((t) => t.id === id))} ${d} 객실당 요금을 입력해 주세요.`);
  }
  const days: DailySummary[] = dates.map((d) => ({ date: d, rooms: 0, total: 0, arrivals: 0, departures: 0 }));
  const members: DailyMember[] = [];
  // 설정의 타입 순서 사용. 날짜 범위 밖 임시 입력은 저장·계산에 포함하지 않는다.
  for (const type of types.filter((t) => selected.includes(t.id))) {
    let active: DailyMember[] = [];
    dates.forEach((d, i) => {
      const count = plan[type.id]?.[d]?.rooms ?? 0, rate = plan[type.id]?.[d]?.rate ?? 0;
      const before = active.length;
      days[i]!.departures += Math.max(0, before - count);
      active = active.slice(0, count);
      while (active.length < count) {
        const member: DailyMember = { typeId: type.id, checkIn: d, nights: 0, rates: { flat: null, nights: {} }, price: 0 };
        members.push(member); active.push(member); days[i]!.arrivals++;
      }
      for (const member of active) {
        member.nights++; member.rates.nights![d] = rate; member.price += rate;
      }
      days[i]!.rooms += count; days[i]!.total += count * rate;
    });
  }
  const total = days.reduce((n, d) => n + d.total, 0), roomNights = days.reduce((n, d) => n + d.rooms, 0);
  const error = members.length < 2 ? "타입을 선택하고 총 두 실 이상의 예약을 입력해 주세요." : members.length > GROUP_ROOMS_MAX ? `한 번에 ${GROUP_ROOMS_MAX}실까지 만들 수 있어요.` : null;
  return { members, days, total, roomNights, error };
}

/** 기존 예약 모델·단체 저장 경로를 재사용한다. 기간이 짧은 방에 나머지 밤 요금을 채우지 않는다. */
export function groupDailyDrafts(result: GroupDailyResult, opts: { s: HotelSettings; groupId: string; groupName: string; platformId: string; guestsOf?: (typeId: string) => number | null }): Booking[] {
  if (result.error) throw new Error(result.error);
  return result.members.map((m, i) => ({ ...groupDrafts({ ...opts, checkIn: m.checkIn, nights: m.nights, typeIds: [m.typeId], prices: [m.price], memberNightRates: [m.rates] })[0]!, id: `__g${i}` }));
}

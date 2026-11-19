import type { ExtendWriteLine } from "./groupExtend";
import { addDays, daysBetween, fitSegments, isEarlyOut, legsOf, occupiesRoom, roomOnNight, STAY_NIGHTS_MAX, type Booking } from "./ledger";
import { extrasTotal, occupiedNightDates, stayNightRatesToJson, type StayNightRates } from "./nightrates";
import { stayAddons } from "./extend";

export interface ScheduleEdit {
  out: string;
  rates: Record<string, number | null>;
  openEnded: boolean;
  replaceTotal: boolean;
}
export type SchedulePatch = Pick<Booking, "nights" | "nightRates" | "price" | "segments" | "openEnded" | "priceUnset">;
export interface ScheduleChange { before: Booking; patch: SchedulePatch }

/** DB 쓰기 허용 열만 구성. room_id·단체 관계·결제·실제 입퇴실 필드는 포함하지 않는다. */
export function scheduleUpdateRow(patch: SchedulePatch) {
  return { nights: patch.nights, price: patch.price, price_unset: !!patch.priceUnset, night_rates: stayNightRatesToJson(patch.nightRates), open_ended: !!patch.openEnded,
    room_segments: patch.segments?.map(x => ({ room: x.roomId, nights: x.nights })) ?? null };
}

export function scheduleLock(b: Booking): string | null {
  if (b.status !== "active") return "취소·노쇼 예약";
  if (b.kind !== "stay") return "대실 예약";
  if (b.checkedOutAt || isEarlyOut(b)) return "이미 퇴실한 예약 · 기록 정정에서 수정";
  if (b.stayMode === "long_stay") return "장기 투숙 원장 · 장기 설정에서 수정";
  if (!b.nights || !validDate(b.checkIn)) return "이용 기간 확인 필요";
  return null;
}
export function validDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= "2020-01-01" && s <= "2099-12-31" && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** 저장된 밤 셀만 사용한다. 총액을 나누거나 기본/타입 요금으로 과거 약정을 추정하지 않는다. */
export function scheduleEdit(b: Booking): ScheduleEdit {
  const rates: ScheduleEdit["rates"] = {};
  for (const d of occupiedNightDates(b.checkIn, b.nights ?? 0)) {
    const own = b.nightRates?.nights?.[d];
    rates[d] = own ?? null;
  }
  return { out: addDays(b.checkIn, b.nights ?? 1), rates, openEnded: !!b.openEnded, replaceTotal: false };
}
export function scheduleDirty(b: Booking, e: ScheduleEdit): boolean {
  const initial = scheduleEdit(b);
  return e.out !== initial.out || e.openEnded !== initial.openEnded || occupiedNightDates(b.checkIn, b.nights ?? 0).some(d => e.rates[d] !== initial.rates[d]);
}
export function schedulePlan(b: Booking, e: ScheduleEdit): { patch: SchedulePatch | null; error: string | null } {
  const bad = (error: string) => ({ patch: null, error });
  if (!scheduleDirty(b, e)) return { patch: null, error: null };
  const locked = scheduleLock(b);
  if (locked) return bad(locked);
  if (!validDate(e.out)) return bad("퇴실일을 확인해 주세요.");
  const nights = daysBetween(b.checkIn, e.out);
  if (!Number.isInteger(nights) || nights < 1 || nights > STAY_NIGHTS_MAX) return bad(`입실 다음 날부터 최대 ${STAY_NIGHTS_MAX}박까지 정해 주세요.`);
  if (e.openEnded && e.out !== addDays(b.checkIn, b.nights ?? 1)) return bad("퇴실 미정을 해제한 뒤 퇴실일을 정해 주세요.");
  const map: Record<string, number> = {};
  for (const d of occupiedNightDates(b.checkIn, nights)) {
    const amount = e.rates[d];
    if (amount == null || !Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) return bad(`${d} 숙박 요금을 입력해 주세요 (0원 이상 정수).`);
    map[d] = amount;
  }
  const original = scheduleEdit(b);
  const complete = Object.values(original.rates).every(v => v != null);
  if (!complete && !e.replaceTotal) return bad("기존 박별 요금이 없는 예약입니다. 모든 박 요금을 입력하고 총액 변경에 동의해 주세요.");
  const originalSum = Object.values(original.rates).reduce<number>((n, v) => n + (v ?? 0), 0);
  // 기존 총액의 가산/할인 차액은 보존. 박당 추가 항목만 바뀐 박수에 맞춘다.
  const adjustment = complete ? b.price - originalSum - extrasTotal(b.nightRates) : stayAddons(b);
  const extras = b.nightRates?.extras?.map(x => x.perNight ? { ...x, amount: x.perNight * nights } : { ...x });
  const nightRates: StayNightRates = { ...b.nightRates, nights: map, ...(extras ? { extras } : {}) };
  const price = Object.values(map).reduce((n, v) => n + v, 0) + extrasTotal(nightRates) + adjustment;
  if (!Number.isSafeInteger(price) || price < 0 || price > 100_000_000) return bad("추가 항목·할인을 포함한 객실 총액은 0원~1억원이어야 합니다.");
  if ((b.refund ?? 0) > price) return bad("변경 총액이 기존 환불액보다 작습니다. 기록 정정에서 환불 근거를 먼저 확인해 주세요.");
  return { patch: { nights, price, nightRates, segments: e.out === original.out ? b.segments ?? null : fitSegments(b.segments, b.roomId, nights), openEnded: e.openEnded, priceUnset: false }, error: null };
}

/** 수납은 비교/쓰기 대상이 아니다. 예약 행이 바뀌면 저장 전 중단한다. */
export function scheduleSame(a: Booking, b: Booking): boolean {
  return a.id === b.id && a.updatedAt === b.updatedAt && JSON.stringify(scheduleGuard(a)) === JSON.stringify(scheduleGuard(b));
}
function scheduleGuard(b: Booking) {
  const r = b.nightRates;
  return [b.groupId, b.status, b.kind, b.typeId, b.roomId, b.segments ?? null, b.checkIn, b.nights,
    r ? [r.flat ?? null, r.weekday ?? null, r.weekend ?? null, Object.entries(r.nights ?? {}).sort(([a], [c]) => a.localeCompare(c)), r.extras ?? []] : null,
    b.price, !!b.priceUnset, !!b.openEnded, b.checkedOutAt ?? null, b.earlyOut ?? null, b.stayMode ?? "standard"];
}
export function scheduleMatches(b: Booking, change: ScheduleChange): boolean {
  const expected = { ...change.before, ...change.patch, updatedAt: b.updatedAt };
  return scheduleSame(b, expected);
}
export interface ScheduleSaveResult { saved: Booking[]; error: string | null }

/** 한 트랜잭션 저장 줄 (DB 함수 extend_group_stay와 같은 모양). 배정 호실은 그대로 넘겨 바꾸지 않아요. 결제 열은 없어요. */
export function scheduleWriteLine(change: ScheduleChange): ExtendWriteLine {
  const row = scheduleUpdateRow(change.patch);
  return {
    id: change.before.id,
    nights: row.nights ?? change.before.nights ?? 1,
    price: row.price,
    night_rates: row.night_rates as ExtendWriteLine["night_rates"],
    open_ended: row.open_ended,
    room_id: change.before.roomId ?? null,
    room_segments: row.room_segments,
    updated_at: change.before.updatedAt ?? "",
  };
}

/**
 * 단체 일정·요금 저장: 전부 되거나 전부 안 되거나 (기간 연장과 같은 DB 함수 한 번 = 한 트랜잭션).
 * 저장 전에 행 버전을 확인하고, 다른 사람이 먼저 고쳤으면 아무것도 쓰지 않아요.
 * 금액미정 해제(price_unset)는 박수·요금이 한 번에 저장된 뒤 같은 객실에만 따로 맞춰요 (몇 번 해도 결과가 같아요).
 */
export async function saveScheduleChanges(changes: ScheduleChange[], io: {
  read: (ids: string[]) => Promise<Booking[]>;
  saveAll: (lines: ExtendWriteLine[]) => Promise<Booking[]>;
  clearPriceUnset?: (ids: string[]) => Promise<Booking[]>;
}): Promise<ScheduleSaveResult> {
  const none = (msg: string): ScheduleSaveResult => ({ saved: [], error: msg });
  if (!changes.length) return { saved: [], error: null };
  if (new Set(changes.map(x => x.before.id)).size !== changes.length) return none("중복 예약이 있습니다.");
  // 금액미정 표시는 트랜잭션 저장 뒤에 맞추므로, 그 전 비교는 원래 표시로 해요
  const stage1 = (c: ScheduleChange): ScheduleChange => ({ ...c, patch: { ...c.patch, priceUnset: !!c.before.priceUnset } });
  const ids = changes.map(x => x.before.id);
  try {
    const fresh = await io.read(ids);
    if (changes.some(x => !fresh.some(b => scheduleSame(b, x.before)))) return none("다른 작업에서 예약이 변경됐습니다. 최신 정보를 다시 불러온 뒤 수정해 주세요.");
  } catch { return none("서버 연결을 확인해 주세요. 아무 객실도 바꾸지 않았습니다."); }
  let saved: Booking[];
  try {
    saved = await io.saveAll(changes.map(scheduleWriteLine));
  } catch {
    // 응답만 잃었을 수 있어요: 한 번 조회해서 전부 반영됐는지만 확인 (다시 쓰지 않아요)
    try {
      const actual = await io.read(ids);
      const all = changes.map(c => actual.find(b => scheduleMatches(b, stage1(c))));
      if (all.every(Boolean)) saved = all as Booking[];
      else return none("저장하지 못했습니다. 아무 객실도 바뀌지 않았습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.");
    } catch { return none("저장 결과를 확인하지 못했습니다. 최신 정보를 다시 불러와 확인해 주세요."); }
  }
  if (changes.some(c => !saved.some(b => scheduleMatches(b, stage1(c))))) return { saved, error: "저장 결과가 요청과 다릅니다. 최신 정보를 확인해 주세요." };
  const unset = changes.filter(c => !!c.before.priceUnset && !c.patch.priceUnset).map(c => c.before.id);
  if (unset.length && io.clearPriceUnset) {
    try {
      const cleared = await io.clearPriceUnset(unset);
      const m = new Map(cleared.map(b => [b.id, b]));
      saved = saved.map(b => m.get(b.id) ?? b);
    } catch {
      return { saved, error: "박수·요금은 저장했지만 금액미정 표시를 지우지 못했습니다. 다시 저장해 주세요." };
    }
  }
  return { saved, error: null };
}

/** 새로 늘어난 점유 밤만 검사: 이미 존재한 겹침과 구분하며 단체 내부 예약도 검사한다. */
export function scheduleClashes(all: Booking[], changes: ScheduleChange[]): { bookingId: string; date: string; roomId: string; otherId: string }[] {
  const next = all.map(b => { const c = changes.find(x => x.before.id === b.id); return c ? { ...b, ...c.patch } : b; });
  const hits: ReturnType<typeof scheduleClashes> = [];
  for (const c of changes) {
    const b = next.find(x => x.id === c.before.id)!;
    for (const d of occupiedNightDates(b.checkIn, b.nights ?? 0)) {
      const roomId = roomOnNight(b, d);
      if (!roomId || roomOnNight(c.before, d) === roomId) continue;
      for (const other of next) {
        if (other.id !== b.id && occupiesRoom(other) && other.kind === "stay" && legsOf(other).some(l => l.roomId === roomId && l.checkIn <= d && addDays(l.checkIn, l.nights) > d)) hits.push({ bookingId: b.id, date: d, roomId, otherId: other.id });
      }
    }
  }
  return hits;
}

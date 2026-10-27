// 단체 결제 요약: 방마다 들어오고 나가도, 며칠씩 묶어 결제해도, 한 줄로 현재 상태를 보여 줘요.
// 규칙은 하나뿐: 이미 등록된 결제 내역과 박별 요금으로 계산해요. 결제 방식을 강요하지 않아요.
import { addDays, daysBetween, won } from "./ledger";
import { type NightSlot, type PeriodBooking, type StayCoverage, isPeriodPayable, stayCoverage } from "./periodPay";

export interface RoomLedger {
  bookingId: string;
  /** 단체 풀(총 결제 잔액)까지 반영한 박별 채움 */
  nights: NightSlot[];
  /** 방 자체 결제 요약 (stayCoverage 그대로) */
  cov: StayCoverage;
  firstNight: string | null;
  lastNight: string | null;
  /** 오늘 밤까지 받을 금액 (오늘 밤 포함) */
  dueToday: number;
  /** 앞에서부터 끊김 없이 결제가 끝난 마지막 박 · 없으면 null */
  paidThrough: string | null;
  /** 맨 앞 미결제 박 · 다 냈으면 null */
  firstUncovered: string | null;
  /** 오늘 밤에 머무는 중이면 true (입실 ≤ 오늘 ≤ 마지막 박) */
  staying: boolean;
  /** 아직 남은 박이 있음 (마지막 박 ≥ 오늘) */
  live: boolean;
  /** 오늘 밤 요금 (머무는 중일 때) */
  tonight: number;
}

export interface GroupLedger {
  rooms: RoomLedger[];
  /** 결제 대상 객실 수 (취소·대실·장기 제외) */
  roomCount: number;
  /** 아직 남은 박이 있는 객실 수 */
  liveCount: number;
  /** 단체 몫 결제 합 (객실에 안 나눈 결제) */
  lump: number;
  /** 결제 내역 합계 (객실별 + 단체 몫) */
  paid: number;
  /** 전체 박 합계 + 단체 추가 항목 */
  due: number;
  /** 오늘 밤까지 받을 금액 + 단체 추가 항목 */
  dueToday: number;
  /** 결제 합 − 오늘 밤까지 금액. 음수 = 미수금, 양수 = 선수금 */
  balance: number;
  /** 미수금 (오늘 밤까지) */
  owed: number;
  /** 선수금 (오늘 밤까지를 넘겨 낸 금액) */
  prepaid: number;
  /** 단체 전체가 앞에서부터 결제 끝난 마지막 박 (남은 객실 기준) · 없으면 null */
  paidThrough: string | null;
  /** 단체 맨 앞 미결제 박 (남은 객실 기준) */
  firstUncovered: string | null;
  /** 오늘 밤까지 결제 안 된 박 수 (맨 앞 미결제 박 ~ 오늘, 포함) */
  unpaidNightsToday: number;
  /** 오늘 밤 하룻밤 합계 */
  tonight: number;
  /** 선수금으로 앞으로 며칠 밤 더 커버되는지 (오늘 밤 합계가 있을 때) */
  coverNights: number | null;
  /** 앞서 결제 등록한 기간 박수 (가장 최근) · 없으면 null */
  lastPeriodNights: number | null;
}

/** 박 하나에 박별 금액을 채우는 단체 풀 (객실 순서는 입력 순서) */
function fillPool(rooms: { nights: NightSlot[] }[], pool: number): number {
  let rest = pool;
  const flat: { n: NightSlot; i: number }[] = [];
  rooms.forEach((r, i) => r.nights.forEach((n) => flat.push({ n, i })));
  flat.sort((a, b) => a.n.date.localeCompare(b.n.date) || a.i - b.i);
  for (const { n } of flat) {
    if (rest <= 0) break;
    const take = Math.min(rest, n.amount - n.covered);
    if (take > 0) {
      n.covered += take;
      rest -= take;
    }
  }
  return rest;
}

export interface GroupLedgerOpts {
  /** 단체 추가 항목(식사 등) 합 · 날짜가 없어 오늘 밤까지 금액에 바로 들어가요 */
  extras?: number;
}

/**
 * 단체 요약. members = 단체의 예약 전부 (취소·대실은 자동으로 빠져요), lump = 단체 몫 결제 합.
 * today = 영업일. 객실이 중간에 들어오면 그 객실은 입실일부터, 자기 요금으로만 계산돼요.
 */
export function groupLedger(members: readonly PeriodBooking[], lump: number, today: string, opts: GroupLedgerOpts = {}): GroupLedger {
  const payable = members.filter(isPeriodPayable);
  const covs = payable.map((b) => stayCoverage(b));
  const extras = Math.max(0, Math.round(opts.extras ?? 0));
  const lumpSum = Math.round(lump) || 0;
  // 객실에 낸 돈이 그 객실 몫을 넘으면 넘친 만큼도 단체 풀로
  const pool = lumpSum + covs.reduce((n, c) => n + c.over, 0);
  const filled = covs.map((c) => ({ cov: c, nights: c.nights.map((n) => ({ ...n })) }));
  fillPool(filled, pool);

  const rooms: RoomLedger[] = filled.map(({ cov, nights }) => {
    const dueToday = nights.filter((n) => n.date <= today).reduce((s, n) => s + n.amount, 0);
    const first = nights.find((n) => n.covered < n.amount) ?? null;
    const lastNight = nights.length ? nights[nights.length - 1]!.date : null;
    const firstNight = nights[0]?.date ?? null;
    let paidThrough: string | null = null;
    for (const n of nights) {
      if (n.covered >= n.amount) paidThrough = n.date;
      else break;
    }
    const tonightSlot = nights.find((n) => n.date === today);
    return {
      bookingId: cov.bookingId,
      nights,
      cov,
      firstNight,
      lastNight,
      dueToday,
      paidThrough,
      firstUncovered: first?.date ?? null,
      staying: !!tonightSlot,
      live: !!lastNight && lastNight >= today,
      tonight: tonightSlot?.amount ?? 0,
    };
  });

  const paidRooms = covs.reduce((n, c) => n + c.paid, 0);
  const paid = paidRooms + lumpSum;
  const due = covs.reduce((n, c) => n + c.due, 0) + extras;
  const dueToday = rooms.reduce((n, r) => n + r.dueToday, 0) + extras;
  const balance = paid - dueToday;
  const scope = rooms.some((r) => r.live) ? rooms.filter((r) => r.live) : rooms;
  // 남은 객실 중 가장 이른 미결제 박
  let firstUncovered: string | null = null;
  for (const r of scope) if (r.firstUncovered && (!firstUncovered || r.firstUncovered < firstUncovered)) firstUncovered = r.firstUncovered;
  // 단체가 결제 끝난 마지막 박 = 맨 앞 미결제 박의 전날 · 다 냈으면 가장 늦은 마지막 박
  let paidThrough: string | null = null;
  if (scope.length) {
    if (firstUncovered) {
      const firstNightAll = scope.map((r) => r.firstNight).filter((x): x is string => !!x).sort()[0] ?? null;
      paidThrough = firstNightAll && addDays(firstUncovered, -1) >= firstNightAll ? addDays(firstUncovered, -1) : null;
    } else {
      paidThrough = scope.map((r) => r.lastNight).filter((x): x is string => !!x).sort().pop() ?? null;
    }
  }
  const unpaidNightsToday = firstUncovered && firstUncovered <= today ? daysBetween(firstUncovered, today) + 1 : 0;
  const tonight = rooms.reduce((n, r) => n + r.tonight, 0);
  const coverNights = tonight > 0 && balance > 0 ? Math.floor(balance / tonight) : tonight > 0 ? 0 : null;

  // 가장 최근에 등록한 기간 결제의 박수 (다음 결제 기본값)
  let last: { at: string; n: number } | null = null;
  for (const b of payable)
    for (const p of b.payments ?? []) {
      if (p.nightDate && p.periodNights && p.periodNights > 0 && (!last || p.createdAt > last.at)) last = { at: p.createdAt, n: p.periodNights };
    }

  return {
    rooms,
    roomCount: payable.length,
    liveCount: rooms.filter((r) => r.live).length,
    lump: lumpSum,
    paid,
    due,
    dueToday,
    balance,
    owed: Math.max(0, -balance),
    prepaid: Math.max(0, balance),
    paidThrough,
    firstUncovered,
    unpaidNightsToday,
    tonight,
    coverNights,
    lastPeriodNights: last?.n ?? null,
  };
}

export type GroupTone = "owed" | "prepaid" | "even" | "none";
export function groupTone(g: GroupLedger): GroupTone {
  if (!g.roomCount) return "none";
  return g.owed > 0 ? "owed" : g.prepaid > 0 ? "prepaid" : "even";
}

/** 헤더 큰 숫자: `미수금 690,000원` · `선수금 300,000원` · `잔액 0원` */
export function balanceLabel(g: GroupLedger): string {
  if (g.owed > 0) return `미수금 ${won(g.owed)}원`;
  if (g.prepaid > 0) return `선수금 ${won(g.prepaid)}원`;
  return "잔액 0원";
}

/** 헤더 보조: `결제 완료 ~10/31` · `결제 내역 없음` */
export function paidThroughLabel(g: GroupLedger, md: (d: string) => string): string {
  if (g.paidThrough) return `결제 완료 ~${md(g.paidThrough)}`;
  return g.paid > 0 ? "첫날부터 미결제" : "결제 내역 없음";
}

/** 헤더 경고줄: 오늘 밤까지 미결제가 있으면 `오늘 밤까지 3박 미결제` */
export function unpaidTodayLabel(g: GroupLedger): string | null {
  return g.unpaidNightsToday > 0 ? `오늘 밤까지 ${g.unpaidNightsToday}박 미결제` : null;
}

/** 선수금 안내: `선수금 3박 더 커버` */
export function coverLabel(g: GroupLedger): string | null {
  return g.prepaid > 0 && g.coverNights != null && g.coverNights > 0 ? `선수금으로 ${g.coverNights}박 더 커버` : null;
}

/**
 * 확인 필요 (꼬임) 탐지 — 순수 함수. 안내만 하고 저장·입실·퇴실·결제를 막지 않아요.
 * 규칙마다 `signature`가 있어요: 값이 바뀌면 달라져서 "이대로 둠"이 풀리고 다시 나타나요.
 */
import { type Booking, type Leg, type Platform, addDays, legsClash, legsOf, md, occupiesRoom, stayEnd, won } from "./ledger";
import { groupLedger } from "./groupLedger";
import { isOnsite, paidOf, payState } from "./payment";
import { type GroupInfo } from "./settle";
import { openFollowBlocked, unusedNightRefund } from "./extend";

/** T01 퇴실 미처리 · T02 환불 비어 있음 · T04 낸 돈이 더 많음 · T05 박당 금액 이상 · T07 금액 미정 · T08 겹침 · T09 방 미배정 · T11 중복 · T12 열린 숙박이 다음 밤 다른 예약과 겹침 */
export type TangleRule = "T01" | "T02" | "T04" | "T05" | "T07" | "T08" | "T09" | "T11" | "T12";

/** 고치기 버튼이 하는 일 (한 번 탭). open = 해당 예약을 열어 직접 고치기 */
export type TangleFix =
  | { kind: "checkout"; label: string; hint: string; date: string }
  | { kind: "price"; label: string; hint: string; total: number }
  | { kind: "open"; label: string; hint: string };

export interface TangleCtx {
  /** 영업일 (6시 컷). 없으면 날짜가 걸린 규칙은 건너뜀 */
  today?: string;
  label?: RoomLabel;
  plat?: (platformId: string) => (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined;
  group?: (groupId: string) => GroupInfo | null | undefined;
}
export type TangleSeverity = "high" | "mid" | "low";

export interface Tangle {
  /** 규칙 + 대상 id (안정적) */
  key: string;
  rule: TangleRule;
  severity: TangleSeverity;
  /** 대상 예약 id (정렬됨) */
  ids: string[];
  /** 한 줄 설명 */
  title: string;
  /** 보조 한 줄 */
  detail: string;
  /** 값이 바뀌면 달라지는 서명 ("이대로 둠" 기억용) */
  signature: string;
  /** 고치기 (없으면 열기만) */
  fix?: TangleFix;
}

export type RoomLabel = (roomId: string | null | undefined) => string;
const defaultLabel: RoomLabel = (id) => id ?? "?";
const nameOf = (b: Booking) => (b.guestName || "").trim() || "(이름 없음)";

/** T08 · 같은 방 같은 밤을 정상 예약 둘 이상이 써요 (방 이동 구간 포함, 퇴실 처리된 건 제외) */
export function findOverlaps(bookings: readonly Booking[], label: RoomLabel = defaultLabel): Tangle[] {
  const byRoom = new Map<string, { b: Booking; leg: Leg }[]>();
  for (const b of bookings) {
    if (b.kind !== "stay" || !occupiesRoom(b)) continue;
    for (const leg of legsOf(b)) {
      if (!leg.roomId) continue;
      const l = byRoom.get(leg.roomId);
      if (l) l.push({ b, leg });
      else byRoom.set(leg.roomId, [{ b, leg }]);
    }
  }
  const out: Tangle[] = [];
  const seen = new Set<string>();
  for (const [roomId, list] of byRoom) {
    list.sort((x, y) => x.leg.checkIn.localeCompare(y.leg.checkIn));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const c = list[j]!;
        // 정렬돼 있으니 c 가 a 끝 이후에 시작하면 이후도 전부 안 겹침
        if (c.leg.checkIn >= addDays(a.leg.checkIn, a.leg.nights)) break;
        if (a.b.id === c.b.id || !legsClash(a.leg, c.leg)) continue;
        const ids = [a.b.id, c.b.id].sort();
        const key = `T08:${roomId}:${ids.join("+")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const first = a.leg.checkIn > c.leg.checkIn ? a.leg.checkIn : c.leg.checkIn;
        out.push({
          key,
          rule: "T08",
          severity: "high",
          ids,
          title: `${label(roomId)}호 ${md(first)} 밤에 예약이 겹쳐요`,
          detail: `${nameOf(a.b)} · ${nameOf(c.b)} (한 쪽을 다른 방으로 옮기면 돼요)`,
          signature: `${roomId}|${a.leg.checkIn}+${a.leg.nights}|${c.leg.checkIn}+${c.leg.nights}`,
          fix: { kind: "open", label: "방 옮기기", hint: "예약을 열어 한 쪽 방을 바꿔요" },
        });
      }
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/** T11 · 단체가 아닌 예약이 이름·입실·박수·플랫폼·금액까지 똑같아요 (실수로 두 번 넣었을 수 있어요) */
export function findDuplicates(bookings: readonly Booking[], label: RoomLabel = defaultLabel): Tangle[] {
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.kind !== "stay" || b.status !== "active" || b.groupId) continue;
    const name = (b.guestName || "").trim();
    if (!name) continue;
    const k = [name, b.checkIn, b.nights ?? "", b.platformId, b.price].join("|");
    const l = groups.get(k);
    if (l) l.push(b);
    else groups.set(k, [b]);
  }
  const out: Tangle[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const ids = list.map((b) => b.id).sort();
    const rooms = list.map((b) => (b.roomId ? `${label(b.roomId)}호` : "방 미정"));
    const f = list[0]!;
    out.push({
      key: `T11:${ids.join("+")}`,
      rule: "T11",
      severity: "low",
      ids,
      title: `${nameOf(f)} 님 예약이 ${list.length}건 똑같아요`,
      detail: `입실 ${md(f.checkIn)} · ${f.nights ?? "?"}박 · ${rooms.join(", ")} (여러 방이면 그대로 두세요)`,
      signature: k,
      fix: { kind: "open", label: "열어서 보기", hint: "한 건이면 취소하고, 여러 방이면 그대로 두세요" },
    });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : Math.round((a[m - 1]! + a[m]!) / 2);
};

/** T01 · 입실했는데 퇴실일이 지나도록 퇴실 처리가 안 됐어요 */
export function findUncheckedOut(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const today = ctx.today;
  if (!today) return [];
  const label = ctx.label ?? defaultLabel;
  const out: Tangle[] = [];
  for (const b of bookings) {
    if (b.kind !== "stay" || b.status !== "active" || b.stayMode === "long_stay" || b.checkedOutAt || !b.arrived || !b.nights) continue;
    if (b.openEnded) continue; // 열린 숙박은 따라가기 · 겹침이면 T12가 알려요
    const end = stayEnd(b);
    if (end >= today) continue;
    out.push({
      key: `T01:${b.id}`,
      rule: "T01",
      severity: "low",
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}${nameOf(b)} 님 ${md(end)} 퇴실 예정인데 퇴실 처리가 안 됐어요`,
      detail: "계속 묵고 있다면 '오늘까지 연장'을 눌러 주세요",
      signature: `${b.checkIn}+${b.nights}|${b.earlyOut ?? ""}`,
      fix: { kind: "checkout", label: `${md(end)} 퇴실로 처리`, hint: `퇴실일을 ${md(end)}로 기록하고 방을 비워요`, date: end },
    });
  }
  return out;
}

/** T02 · 조기 퇴실인데 환불이 비어 있고, 낸 돈이 이용한 만큼보다 많아요 */
export function findRefundGaps(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const label = ctx.label ?? defaultLabel;
  const out: Tangle[] = [];
  for (const b of bookings) {
    if (b.kind !== "stay" || b.status !== "active" || !b.earlyOut || b.refund) continue;
    const refund = unusedNightRefund(b, b.earlyOut);
    if (refund <= 0 || paidOf(b) <= b.price - refund) continue;
    out.push({
      key: `T02:${b.id}`,
      rule: "T02",
      severity: "mid",
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}${nameOf(b)} 님 조기 퇴실 환불이 비어 있어요`,
      detail: `이용하지 않은 박 기준 ${won(refund)}원 · 환불하거나 잔액 보관 중 하나를 정해 주세요`,
      signature: `${b.earlyOut}|${paidOf(b)}|${b.price}`,
      fix: { kind: "open", label: `환불 ${won(refund)}원 정하기`, hint: "조기 퇴실 화면을 열어요" },
    });
  }
  return out;
}

/** T04 · 낸 돈이 전체 금액보다 많아요 (선수금이 아니라 초과) */
export function findOverpaid(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const label = ctx.label ?? defaultLabel;
  const today = ctx.today ?? "9999-12-31";
  const out: Tangle[] = [];
  const byGroup = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.groupId) {
      const l = byGroup.get(b.groupId);
      if (l) l.push(b);
      else byGroup.set(b.groupId, [b]);
      continue;
    }
    if (b.kind !== "stay" || b.status !== "active" || b.stayMode === "long_stay") continue;
    const ps = payState(b, ctx.plat?.(b.platformId) ?? null);
    if (!ps.tracked || ps.paid <= ps.due || ps.due <= 0) continue;
    out.push({
      key: `T04:${b.id}`,
      rule: "T04",
      severity: "mid",
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}${nameOf(b)} 님 결제 내역이 청구액보다 ${won(ps.paid - ps.due)}원 많아요`,
      detail: `청구 ${won(ps.due)}원 · 결제 ${won(ps.paid)}원 (환불하거나 잔액으로 보관하세요)`,
      signature: `${ps.due}|${ps.paid}`,
      fix: { kind: "open", label: "결제 내역 보기", hint: "예약을 열어 초과분을 정리해요" },
    });
  }
  for (const [gid, members] of byGroup) {
    const info = ctx.group?.(gid) ?? null;
    if (!info) continue;
    if (!members.some((m) => isOnsite(ctx.plat?.(m.platformId) ?? null))) continue;
    const g = groupLedger(members, (info.payments ?? []).reduce((n, x) => n + x.amount, 0), today, {
      extras: (info.extras ?? []).reduce((n, x) => n + x.amount, 0),
    });
    if (!g.roomCount || g.paid <= g.due || g.due <= 0) continue;
    const ids = members.filter((m) => m.status === "active").map((m) => m.id).sort();
    if (!ids.length) continue;
    out.push({
      key: `T04:g:${gid}`,
      rule: "T04",
      severity: "mid",
      ids,
      title: `단체 ${ids.length}실 결제 내역이 청구액보다 ${won(g.paid - g.due)}원 많아요`,
      detail: `청구 ${won(g.due)}원 · 결제 ${won(g.paid)}원 (환불하거나 선수금으로 보관하세요)`,
      signature: `${g.due}|${g.paid}`,
      fix: { kind: "open", label: "단체 결제 보기", hint: "단체를 열어 초과분을 정리해요" },
    });
  }
  return out;
}

/** T05 · 7박 이상인데 박당 금액이 이상해요 (1박 요금만 적은 걸 수도 있어요) */
export function findOddRates(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const label = ctx.label ?? defaultLabel;
  const live = bookings.filter((b) => b.kind === "stay" && b.status === "active" && b.stayMode !== "long_stay" && !b.priceUnset && (b.nights ?? 0) >= 7 && b.price > 0);
  const out: Tangle[] = [];
  for (const b of live) {
    const per = b.price / b.nights!;
    // 같은 단체 3실 이상일 때만 중앙값으로 비교 (본인 포함 — 한두 실이 튀어도 기준이 흔들리지 않게)
    const sibs = live.filter((x) => b.groupId && x.groupId === b.groupId).map((x) => x.price / x.nights!);
    const sibMed = sibs.length >= 3 ? median(sibs) : 0;
    const tooLow = per < 10_000;
    const offSib = sibMed > 0 && (per < sibMed * 0.3 || per > sibMed * 1.7);
    if (!tooLow && !offSib) continue;
    const per0 = Math.round(per);
    const suggestPer = sibMed >= 10_000 ? Math.round(sibMed / 1000) * 1000 : 0;
    out.push({
      key: `T05:${b.id}`,
      rule: "T05",
      severity: "mid",
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}총액 ${won(b.price)}원 / ${b.nights}박 (박당 약 ${won(per0)}원)이에요`,
      detail: "1박 요금만 적으신 걸 수도 있어요",
      signature: `${b.price}|${b.nights}`,
      fix: suggestPer
        ? { kind: "price", label: `박당 ${won(suggestPer)}원으로 고치기`, hint: `총액이 ${won(suggestPer * b.nights!)}원으로 바뀌어요`, total: suggestPer * b.nights! }
        : { kind: "open", label: "금액 고치기", hint: "예약을 열어 금액을 직접 고쳐요" },
    });
  }
  return out;
}

/** T07 · 금액이 정해지지 않았어요 */
export function findPriceUnset(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const label = ctx.label ?? defaultLabel;
  const today = ctx.today;
  return bookings
    .filter((b) => b.kind === "stay" && b.status === "active" && b.priceUnset && (!today || stayEnd(b) >= addDays(today, -1)))
    .map((b) => ({
      key: `T07:${b.id}`,
      rule: "T07" as const,
      severity: "low" as const,
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}${nameOf(b)} 님 금액이 정해지지 않았어요`,
      detail: "금액을 넣으면 결제 등록과 미수금이 정확해져요",
      signature: `${b.checkIn}+${b.nights}`,
      fix: { kind: "open" as const, label: "금액 넣기", hint: "예약을 열어요" },
    }));
}

/** T09 · 입실일이 지났는데 방이 정해지지 않았어요 */
export function findUnassignedPast(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const today = ctx.today;
  if (!today) return [];
  return bookings
    .filter((b) => b.kind === "stay" && b.status === "active" && !b.checkedOutAt && !b.roomId && !b.segments?.length && b.checkIn < today && stayEnd(b) >= today)
    .map((b) => ({
      key: `T09:${b.id}`,
      rule: "T09" as const,
      severity: "mid" as const,
      ids: [b.id],
      title: `${nameOf(b)} 님 ${md(b.checkIn)} 입실인데 방이 정해지지 않았어요`,
      detail: `${b.nights ?? "?"}박 · 빈 방을 정해 주세요`,
      signature: `${b.checkIn}+${b.nights}`,
      fix: { kind: "open" as const, label: "방 정하기", hint: "예약을 열어요" },
    }));
}

const RULE_RANK: Record<TangleRule, number> = { T02: 0, T04: 1, T05: 2, T08: 3, T09: 4, T12: 5, T01: 6, T07: 7, T11: 8 };
/** 돈 → 겹침 → 정리 순 */
export function sortTangles(list: readonly Tangle[]): Tangle[] {
  return [...list].sort((a, b) => RULE_RANK[a.rule] - RULE_RANK[b.rule] || a.key.localeCompare(b.key));
}

/** T12 · 열린 숙박인데 이어서 묵을 밤에 같은 방 다른 예약이 있어요 (방 옮기기 / 이대로 둠) */
export function findOpenBlocked(bookings: readonly Booking[], ctx: TangleCtx): Tangle[] {
  const today = ctx.today;
  if (!today) return [];
  const label = ctx.label ?? defaultLabel;
  const all = [...bookings];
  const out: Tangle[] = [];
  for (const b of all) {
    if (!b.openEnded) continue;
    const hits = openFollowBlocked(b, all, today);
    if (!hits.length) continue;
    const hit = hits[0]!;
    out.push({
      key: `T12:${b.id}`,
      rule: "T12",
      severity: "mid",
      ids: [b.id],
      title: `${b.roomId ? `${label(b.roomId)}호 ` : ""}${nameOf(b)} 님은 계속 묵는데 ${md(hit.checkIn)} 입실 ${nameOf(hit)} 님 예약과 밤이 겹쳐요`,
      detail: "열린 숙박이라 오늘 밤을 이으려면 겹쳐요 · 방을 옮기거나 그대로 두세요",
      signature: `${b.checkIn}+${b.nights}|${hits.map((h) => h.id).sort().join(",")}`,
      fix: { kind: "open", label: "방 옮기기", hint: "예약을 열어 방을 정해요" },
    });
  }
  return out;
}

/** 겹침 + 중복 + 나머지 전부 (정렬됨) */
export function findTangles(bookings: readonly Booking[], ctx: TangleCtx = {}): Tangle[] {
  const label = ctx.label ?? defaultLabel;
  return sortTangles([
    ...findOverlaps(bookings, label),
    ...findDuplicates(bookings, label),
    ...findUncheckedOut(bookings, ctx),
    ...findRefundGaps(bookings, ctx),
    ...findOverpaid(bookings, ctx),
    ...findOddRates(bookings, ctx),
    ...findPriceUnset(bookings, ctx),
    ...findUnassignedPast(bookings, ctx),
    ...findOpenBlocked(bookings, ctx),
  ]);
}

/** "이대로 둠"으로 기억된 것을 빼요 (서명이 같을 때만 — 값이 바뀌면 다시 나와요) */
export function visibleTangles(list: readonly Tangle[], ignored: ReadonlyMap<string, string>): Tangle[] {
  return list.filter((t) => ignored.get(t.key) !== t.signature);
}

/** 이전 목록에 없던 새 꼬임만 (저장 직후 한 번만 알려주려고) */
export function newTangles(prev: readonly Tangle[], next: readonly Tangle[]): Tangle[] {
  const had = new Set(prev.map((t) => `${t.key}#${t.signature}`));
  return next.filter((t) => !had.has(`${t.key}#${t.signature}`));
}



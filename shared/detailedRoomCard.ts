import { addDays, md, stayEnd, type Booking, type HotelSettings } from "./ledger";
import { clampHours } from "./extratime";
import { shiftTime } from "./tiers";
import { nowFlags, type NowOpts } from "./nowboard";
import { contrast, shade, HEX } from "./platform";
import { nowPayParts, nowPayText } from "./nowCard";
import type { RoomCardModel } from "./roomCard";

/** 단체 공통 수납은 객실 자체의 결제와 혼동하지 않도록 범위를 함께 표시한다. */
export function cardPaymentMethods(b: Booking, model: RoomCardModel | null) {
  const ctx = model?.groupCtx;
  const payments = ctx ? [...(ctx.info?.payments ?? []), ...ctx.members.flatMap((m) => m.payments ?? [])] : b.payments ?? [];
  const parts = nowPayParts(payments);
  const scope = ctx ? "단체 " : "";
  return {
    label: parts.length ? scope + parts.map((p) => p.method).join("·") : "수납 기록 없음",
    title: parts.length ? `${scope}실제 수납 · ${nowPayText(parts, parts.length)}` : "결제수단을 임의로 추정하지 않습니다. 수납 기록이 없습니다.",
  };
}

/** 흰색 번호를 유지하고 밝은 선택색의 번호 배경만 같은 계열로 보정한다. */
export function roomNumberColor(color: string): string {
  let bg = HEX.test(color) ? color : "#2F7BEA";
  for (let i = 0; i < 16 && contrast(bg, "#FFFFFF") < 4.5; i++) bg = shade(bg, .12);
  return bg;
}

/** 요약에는 날짜, 상세에는 시간·연도까지 표시한다. */
export function compactCardPeriod(b: Booking, s: Pick<HotelSettings, "stayTimes">): string {
  const { range, duration } = compactCardPeriodParts(b, s);
  return duration ? `${range} · ${duration}` : range;
}

export function compactCardPeriodParts(b: Booking, s: Pick<HotelSettings, "stayTimes">) {
  const t = detailedTimes(b, s);
  if (b.kind === "dayuse") return { range: `${t.inTime ?? "미정"}–${t.outTime ?? "미정"}`, duration: null };
  if (!t.outDate) return { range: `${md(t.inDate)} → 미정`, duration: null };
  const end = t.inDate.slice(0, 7) === t.outDate.slice(0, 7) ? String(Number(t.outDate.slice(8))) : md(t.outDate);
  return { range: `${md(t.inDate)} → ${end}`, duration: `${b.nights ?? 0}박` };
}

export type CardStatus = { label: string; tone: "stay" | "dayuse" | "available" | "departing" | "neutral"; note?: string };

/** 표시만 바꾼다. 점유·자동 입실·퇴실 판단은 기존 nowFlags가 소유한다. */
export function detailedStatus(b: Booking | null, date: string, opts: NowOpts, held = false): CardStatus {
  if (!b || b.status !== "active") return held
    ? { label: "판매중지", tone: "neutral" }
    : { label: "판매가능", tone: "available" };
  if (b.checkedOutAt) return { label: b.kind === "dayuse" ? "이용 종료" : "퇴실 완료", tone: "neutral", note: "실제 퇴실 처리 기록이 있는 예약" };
  if (b.kind === "dayuse") return { label: "대실", tone: "dayuse", note: b.arrived ? undefined : "대실 예약 · 입실 전" };
  const f = nowFlags(b, date, opts);
  if (f.kind === "departing" || f.kind === "lateOut") return { label: "퇴실예정", tone: "departing", note: f.kind === "lateOut" ? "늦은 퇴실" : undefined };
  if (f.arrived) return { label: "투숙 중", tone: "stay" };
  return { label: "입실예정", tone: "neutral", note: "숙박 예약 · 입실 전" };
}

/** 시각은 호텔 기본 시간 + 예약의 시간 조정. 자정 경계의 날짜도 반영한다. */
export function detailedTimes(b: Booking, s: Pick<HotelSettings, "stayTimes">) {
  if (b.kind === "dayuse") {
    const nextDay = !!b.startTime && !!b.endTime && b.endTime <= b.startTime;
    return {
      inDate: b.checkIn, inTime: b.startTime,
      outDate: addDays(b.checkIn, nextDay ? 1 : 0), outTime: b.endTime,
      basis: "예약에 입력된 대실 시간",
    };
  }
  const start = shiftTime(s.stayTimes.checkIn, -clampHours(b.earlyIn));
  const end = shiftTime(s.stayTimes.checkOut, b.earlyOut ? 0 : clampHours(b.lateOut));
  const open = b.openEnded && !b.earlyOut;
  return {
    inDate: addDays(b.checkIn, start.days), inTime: start.time,
    outDate: open ? null : addDays(stayEnd(b), end.days), outTime: open ? null : end.time,
    basis: "호텔 기본 입퇴실 시간에 빠른 입실·늦은 퇴실 반영 (실제 처리 시각과 구분)",
  };
}

export const cardDateTime = (date: string | null, time: string | null) => date ? `${md(date)} ${time ?? "시간 미입력"}` : "퇴실 미정";

export interface GroupRegistry { groups: Record<string, { number: number; members: string[] }> }
export const emptyRegistry = (): GroupRegistry => ({ groups: {} });

/** 표시 ID와 구성원 순서를 객실번호·대표객실에서 분리한다. 제거된 ID는 재사용하지 않는다. */
export function registerCardGroups(registry: GroupRegistry, bookings: readonly Booking[]): GroupRegistry {
  const groups = { ...registry.groups };
  let next = Math.max(0, ...Object.values(groups).map((g) => g.number));
  let changed = false;
  for (const b of [...bookings].sort((a, c) => a.createdAt.localeCompare(c.createdAt) || a.id.localeCompare(c.id))) {
    if (!b.groupId) continue;
    const old = groups[b.groupId];
    if (!old) {
      groups[b.groupId] = { number: ++next, members: [b.id] };
      changed = true;
    } else if (!old.members.includes(b.id)) {
      groups[b.groupId] = { ...old, members: [...old.members, b.id] };
      changed = true;
    }
  }
  return changed ? { groups } : registry;
}

export function orderedGroupMembers(registry: GroupRegistry, gid: string, bookings: readonly Booking[]): Booking[] {
  const ids = registry.groups[gid]?.members ?? [];
  const rank = new Map(ids.map((id, i) => [id, i]));
  return bookings.filter((b) => b.groupId === gid && b.status === "active" && b.kind === "stay")
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

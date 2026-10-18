// 주차 관리: 도보 · 차량, 차량 대수 · 번호. 추가 차량 요금과 도보 할인은 판매 가격에 따로 더하고 빼요 (예약 창에서 고칠 수 있어요).
import { type Booking, type HotelSettings, addDays, isActive, legsOf } from "./ledger";

export const CARS_MAX = 10;
export const PLATE_MAX = 16;
export type Arrival = "walk" | "car";
export const ARRIVAL_LABEL: Record<Arrival, string> = { walk: "도보", car: "차량" };

type P = Pick<HotelSettings, "parking">;
type PB = Pick<Booking, "arrival" | "cars" | "plates">;

/** 추가 차량 금액: 2번째 차부터 1대 × 1박 요금 × 박수 (대실은 1번) */
export function autoCarFee(s: P, arrival: Arrival | null | undefined, cars: number, nights: number | null): number {
  if (!s.parking.enabled || arrival !== "car") return 0;
  return Math.max(0, Math.min(CARS_MAX, Math.round(cars)) - 1) * s.parking.extraCarFee * Math.max(1, nights ?? 1);
}
/** 도보 할인: 예약 1건에 한 번 */
export function autoWalkOff(s: P, arrival: Arrival | null | undefined): number {
  return s.parking.enabled && arrival === "walk" ? s.parking.walkDiscount : 0;
}
/** 차량번호 비교용: 띄어쓰기 · 하이픈 빼고 대문자 ('12가 3456' = '12가3456') */
export const normPlate = (v: string) => v.replace(/[\s-]+/g, "").toUpperCase();
/** 저장할 차량번호: 빈 칸 빼고, 길이 자르고, 대수만큼만 */
export function cleanPlates(list: string[] | null | undefined, cars: number): string[] {
  return (list ?? [])
    .slice(0, Math.max(0, Math.min(CARS_MAX, cars)))
    .map((x) => x.trim().replace(/\s+/g, " ").slice(0, PLATE_MAX))
    .filter(Boolean);
}
/** 검색: 차량번호가 맞으면 (띄어쓰기 무시) */
export function plateMatches(b: PB, q: string): boolean {
  const n = normPlate(q);
  return n.length >= 2 && (b.plates ?? []).some((p) => normPlate(p).includes(n));
}
/** 칸에 붙는 작은 표시: '차2' · '차' · '도보' · 없음 */
export function parkingMark(b: PB): string | null {
  if (b.arrival === "walk") return "도보";
  if (b.arrival === "car") return (b.cars ?? 1) > 1 ? `차${b.cars}` : "차";
  return null;
}
/** 금액 줄 */
export function carFeeLine(cars: number, nights: number | null, fee: number): string {
  const extra = Math.max(0, cars - 1);
  return extra ? `추가 차량 ${extra}대 × ${(nights ?? 1)}박 × ${fee.toLocaleString("ko-KR")}` : "";
}

export interface ParkRow {
  b: Booking;
  roomId: string | null;
  arrival: Arrival | null;
  cars: number;
  plates: string[];
  /** 오늘 입실 · 오늘 밤 묵음 · 대실 */
  when: "in" | "stay" | "dayuse";
}
/**
 * 주차 현황: 그날 밤 묵는 숙박 + 그날 대실. 방은 그날 밤 방(객실 이동이면 그 구간).
 * 도보면 0대, 차량인데 대수를 안 적었으면 1대로 봐요.
 */
export function parkingRows(bookings: Booking[], date: string): ParkRow[] {
  const out: ParkRow[] = [];
  for (const b of bookings) {
    if (!isActive(b)) continue;
    let roomId: string | null = null;
    let when: ParkRow["when"];
    if (b.kind === "stay") {
      const leg = legsOf(b).find((l) => l.checkIn <= date && date < addDays(l.checkIn, l.nights));
      if (!leg) continue;
      roomId = leg.roomId;
      when = b.checkIn === date ? "in" : "stay";
    } else {
      if (b.checkIn !== date) continue;
      roomId = b.roomId;
      when = "dayuse";
    }
    const arrival = b.arrival ?? null;
    out.push({ b, roomId, arrival, cars: arrival === "car" ? Math.max(1, b.cars ?? 1) : 0, plates: arrival === "car" ? (b.plates ?? []) : [], when });
  }
  return out;
}
export type ParkFilter = "all" | "car" | "walk" | "unset";
export function filterParking(rows: ParkRow[], f: ParkFilter, q: string, roomNo: (id: string | null) => string): ParkRow[] {
  const t = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f === "car" && r.arrival !== "car") return false;
    if (f === "walk" && r.arrival !== "walk") return false;
    if (f === "unset" && r.arrival) return false;
    if (!t) return true;
    return plateMatches(r.b, t) || r.b.guestName.toLowerCase().includes(t) || roomNo(r.roomId).toLowerCase().includes(t);
  });
}
export function parkingTotals(rows: ParkRow[]) {
  return {
    cars: rows.reduce((n, r) => n + r.cars, 0),
    carRooms: rows.filter((r) => r.arrival === "car").length,
    walk: rows.filter((r) => r.arrival === "walk").length,
    unset: rows.filter((r) => !r.arrival).length,
  };
}

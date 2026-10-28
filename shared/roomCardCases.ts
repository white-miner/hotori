// 객실 카드 검증 표(docs/room-card-spec.md §7): 같은 입력을 현황·배치 두 화면이 같게 보여 주는지 확인해요.
import type { Booking } from "./ledger";
import type { GroupInfo } from "./settle";

export const TODAY = "2026-10-28";

export const ONSITE = { name: "현장", onsite: true };
export const YANOLJA = { name: "야놀자", onsite: false };

export function mk(over: Record<string, unknown>): Booking {
  return {
    id: "b1",
    kind: "stay",
    status: "active",
    groupId: null,
    checkIn: "2026-10-28",
    nights: 1,
    price: 0,
    arrived: true,
    checkedOutAt: null,
    openEnded: false,
    stayMode: "standard",
    roomId: "r1",
    typeId: "t",
    segments: null,
    nightRates: null,
    platformId: "p",
    guestName: "손님",
    payments: [],
    priceUnset: false,
    extraFee: 0,
    earlyIn: false,
    lateOut: false,
    timeFee: 0,
    arrival: null,
    carFee: 0,
    walkOff: 0,
    earlyOut: null,
    company: null,
    ...over,
  } as unknown as Booking;
}

/** 박별 요금표: 입실일부터 amounts 순서대로 */
export function matrix(checkIn: string, amounts: number[]) {
  const nights: Record<string, number> = {};
  amounts.forEach((a, i) => {
    nights[new Date(Date.parse(checkIn) + i * 864e5).toISOString().slice(0, 10)] = a;
  });
  return { flat: null, nights };
}

export const pay = (method: string, amount: number) => ({ id: `p${method}${amount}`, bookingId: "b1", kind: "deposit", method, amount, bizDate: TODAY, createdAt: "" });

export interface CardExpect {
  /** 이용기간 + 박수 한 줄: `10/27~10/29 · 2/3박` */
  line: string;
  /** 박당 요금 글자 (없으면 null — 평균·추정을 만들지 않아요) */
  rate: string | null;
  varies?: boolean;
  /** 결제 방식·금액 (받은 돈) */
  pay: string | null;
  /** 받아야 할 돈 (오늘 밤 기준 미수금) */
  due: number;
  /** 「대표객실」 글자 (대표객실 카드에만) */
  lead: boolean;
  /** 단체의 다른 객실 */
  member?: boolean;
  company?: string | null;
}

export interface CardCase {
  id: string;
  name: string;
  b: Booking;
  plat: { name: string; onsite: boolean } | null;
  bookings: Booking[];
  info: GroupInfo | null;
  view: string;
  /** 현황은 항상 오늘만 봐요 — 오늘이 아닌 날짜는 배치에서만 */
  boardOnly?: boolean;
  expect: CardExpect;
}

const solo = (b: Booking) => [b];
const noInfo = null;

// ── 단체 (602 모양: 대표 + 다른 객실 3, 단체 이체 770,000) ──
const gmember = (id: string, roomId: string, per: number, checkIn: string, nights: number, over: Record<string, unknown> = {}) =>
  mk({ id, roomId, groupId: "g", checkIn, nights, price: per * nights, nightRates: matrix(checkIn, Array(nights).fill(per)), guestName: `단체${id}`, ...over });
const G = [
  gmember("a", "r602", 70_000, "2026-10-25", 4),
  gmember("b", "r501", 80_000, "2026-10-25", 4),
  gmember("c", "r301", 80_000, "2026-10-25", 4, { platformId: "yano" }),
  gmember("d", "r502", 80_000, "2026-10-27", 2),
];
const ginfo = { id: "g", payerCompany: "(주)호토리", payments: [{ id: "gp", method: "transfer", amount: 770_000 }], extras: [], leadBookingId: "a" } as unknown as GroupInfo;
const gcase = (id: string, name: string, b: Booking, plat: CardCase["plat"], expect: CardExpect): CardCase => ({ id, name, b, plat, bookings: G, info: ginfo, view: TODAY, expect });

const c02 = mk({ checkIn: "2026-10-27", nights: 3, price: 240_000, nightRates: matrix("2026-10-27", [70_000, 80_000, 90_000]), payments: [pay("card", 100_000)] });
const c03 = mk({ nights: 3, price: 210_000, nightRates: matrix("2026-10-28", [70_000, 70_000, 70_000]), payments: [pay("cash", 210_000)] });
const c04 = mk({ checkIn: "2026-10-20", nights: 12, price: 720_000, nightRates: matrix("2026-10-20", Array(12).fill(60_000)), payments: [pay("transfer", 300_000)] });
const c05 = mk({
  checkIn: "2026-10-20",
  nights: 9,
  stayMode: "long_stay",
  openEnded: true,
  price: 0,
  longStayRate: { kind: "flat", flatAmount: 60_000 },
  charges: [{ id: "c1", date: "2026-10-20", amount: 540_000, kind: "room" }],
  payments: [pay("transfer", 400_000)],
});
const c06 = mk({ checkIn: "2026-10-27", nights: 3, price: 270_000, platformId: "yano", nightRates: matrix("2026-10-27", [80_000, 100_000, 90_000]) });
const c07 = mk({ checkIn: "2026-10-27", nights: 3, price: 270_000, platformId: "yano" });
const c08 = mk({ checkIn: "2026-10-27", nights: 3, price: 270_000, platformId: "yano", nightRates: matrix("2026-10-27", [90_000, 90_000, 90_000]), payments: [pay("card", 20_000)] });
const c09 = mk({ company: "오서건설", nights: 2, price: 140_000, nightRates: matrix("2026-10-28", [70_000, 70_000]), payments: [pay("card", 140_000)] });
const c11a = mk({ id: "s1", groupId: "gs", nights: 2, price: 160_000, nightRates: matrix("2026-10-28", [80_000, 80_000]) });
const c11b = mk({ id: "s2", groupId: "gs", status: "cancelled", nights: 2, price: 160_000 });
const c12 = mk({ checkIn: "2026-10-25", nights: 4, openEnded: true, price: 280_000, nightRates: matrix("2026-10-25", [70_000, 70_000, 70_000, 70_000]), payments: [pay("transfer", 100_000)] });
const c13 = mk({ status: "cancelled", nights: 2, price: 160_000, nightRates: matrix("2026-10-28", [80_000, 80_000]) });
const c14 = mk({ nights: 2, price: 0, priceUnset: true });
const c15 = mk({ nights: 3, price: 255_000, nightRates: { flat: 80_000, nights: { "2026-10-28": 95_000 } }, payments: [pay("cash", 255_000)] });
const c16 = mk({ checkIn: "2026-10-26", nights: 3, price: 270_000, nightRates: matrix("2026-10-26", [80_000, 100_000, 90_000]), payments: [pay("card", 270_000)] });
const c18 = mk({ checkIn: "2026-10-30", nights: 2, arrived: false, price: 160_000, nightRates: matrix("2026-10-30", [80_000, 80_000]) });
const c19 = mk({ checkIn: "2026-10-28", nights: 1, arrived: false, price: 70_000, nightRates: matrix("2026-10-28", [70_000]), payments: [pay("cash", 70_000)] });

export const CARD_CASES: CardCase[] = [
  { id: "C01", name: "개인 · 1박 · 현장 · 미결제", b: mk({ price: 80_000 }), plat: ONSITE, bookings: solo(mk({ price: 80_000 })), info: noInfo, view: TODAY, expect: { line: "10/28 · 1박", rate: "₩80,000", pay: "미결제", due: 80_000, lead: false } },
  { id: "C02", name: "개인 · 3박 · 박마다 다름 · 카드 일부 결제", b: c02, plat: ONSITE, bookings: solo(c02), info: noInfo, view: TODAY, expect: { line: "10/27~10/29 · 2/3박", rate: "₩80,000", varies: true, pay: "카드100,000", due: 140_000, lead: false } },
  { id: "C03", name: "개인 · 3박 · 같은 요금 · 완납(현금)", b: c03, plat: ONSITE, bookings: solo(c03), info: noInfo, view: TODAY, expect: { line: "10/28~10/30 · 1/3박", rate: "₩70,000", pay: "현금210,000", due: 0, lead: false } },
  { id: "C04", name: "개인 · 12박 장기 연박 · 일부 결제", b: c04, plat: ONSITE, bookings: solo(c04), info: noInfo, view: TODAY, expect: { line: "10/20~10/31 · 9/12박", rate: "₩60,000", pay: "이체300,000", due: 420_000, lead: false } },
  { id: "C05", name: "장기숙박(요금표) · 퇴실 미정 · 일부 결제", b: c05, plat: ONSITE, bookings: solo(c05), info: noInfo, view: TODAY, expect: { line: "10/20 ~ · 9박째", rate: "₩60,000", pay: "이체400,000", due: 140_000, lead: false } },
  { id: "C06", name: "OTA 야놀자 · 3박 · 박별 요금", b: c06, plat: YANOLJA, bookings: solo(c06), info: noInfo, view: TODAY, expect: { line: "10/27~10/29 · 2/3박", rate: "₩100,000", varies: true, pay: "야놀자270,000", due: 0, lead: false } },
  { id: "C07", name: "OTA · 3박 · 박별 요금 없음 (평균 금지)", b: c07, plat: YANOLJA, bookings: solo(c07), info: noInfo, view: TODAY, expect: { line: "10/27~10/29 · 2/3박", rate: null, pay: "야놀자270,000", due: 0, lead: false } },
  { id: "C08", name: "OTA + 현장 카드 20,000", b: c08, plat: YANOLJA, bookings: solo(c08), info: noInfo, view: TODAY, expect: { line: "10/27~10/29 · 2/3박", rate: "₩90,000", pay: "야놀자270,000 · 카드20,000", due: 0, lead: false } },
  { id: "C09", name: "기관(회사 예약) · 2박 · 완납", b: c09, plat: ONSITE, bookings: solo(c09), info: noInfo, view: TODAY, expect: { line: "10/28~10/29 · 1/2박", rate: "₩70,000", pay: "카드140,000", due: 0, lead: false, company: "오서건설" } },
  gcase("C10", "단체 대표객실 · 단체 결제 이체 770,000", G[0]!, ONSITE, { line: "10/25~10/28 · 4/4박", rate: "₩70,000", pay: "이체770,000", due: 310_000, lead: true, company: "(주)호토리" }),
  gcase("C11", "단체 다른 객실 · 자기 기간·요금만", G[1]!, ONSITE, { line: "10/25~10/28 · 4/4박", rate: "₩80,000", pay: null, due: 0, lead: false, member: true, company: "(주)호토리" }),
  gcase("C12", "단체 다른 객실 · 중간 입실", G[3]!, ONSITE, { line: "10/27~10/28 · 2/2박", rate: "₩80,000", pay: null, due: 0, lead: false, member: true, company: "(주)호토리" }),
  gcase("C13", "단체 다른 객실 · 플랫폼 판매금액", G[2]!, YANOLJA, { line: "10/25~10/28 · 4/4박", rate: "₩80,000", pay: "야놀자320,000", due: 0, lead: false, member: true, company: "(주)호토리" }),
  { id: "C14", name: "단체지만 활성 객실 1개 → 개인처럼 (대표객실 글자 없음)", b: c11a, plat: ONSITE, bookings: [c11a, c11b], info: noInfo, view: TODAY, expect: { line: "10/28~10/29 · 1/2박", rate: "₩80,000", pay: "미결제", due: 160_000, lead: false } },
  { id: "C15", name: "퇴실 미정 · 개인 · 일부 결제", b: c12, plat: ONSITE, bookings: solo(c12), info: noInfo, view: TODAY, expect: { line: "10/25 ~ · 4박째", rate: "₩70,000", pay: "이체100,000", due: 180_000, lead: false } },
  { id: "C16", name: "취소 예약 (카드에 요금·결제 줄 없음)", b: c13, plat: ONSITE, bookings: solo(c13), info: noInfo, view: TODAY, expect: { line: "", rate: null, pay: null, due: 0, lead: false } },
  { id: "C17", name: "금액 미정", b: c14, plat: ONSITE, bookings: solo(c14), info: noInfo, view: TODAY, expect: { line: "10/28~10/29 · 1/2박", rate: null, pay: "금액미정", due: 0, lead: false } },
  { id: "C18", name: "박별 요금 일부만 적음 → 적은 박은 그 값", b: c15, plat: ONSITE, bookings: solo(c15), info: noInfo, view: TODAY, expect: { line: "10/28~10/30 · 1/3박", rate: "₩95,000", varies: true, pay: "현금255,000", due: 0, lead: false } },
  { id: "C19", name: "배치에서 다른 날짜(10/27) 보기 · 2박째", b: c16, plat: ONSITE, bookings: solo(c16), info: noInfo, view: "2026-10-27", boardOnly: true, expect: { line: "10/26~10/28 · 2/3박", rate: "₩100,000", varies: true, pay: "카드270,000", due: 0, lead: false } },
  { id: "C20", name: "입실 전 예약 (10/30 입실) · 몇째 밤 숨김", b: c18, plat: ONSITE, bookings: solo(c18), info: noInfo, view: TODAY, expect: { line: "10/30~10/31 · 2박", rate: "₩80,000", pay: "미결제", due: 160_000, lead: false } },
  { id: "C21", name: "오늘 입실 · 아직 입실 전 · 1박 · 완납", b: c19, plat: ONSITE, bookings: solo(c19), info: noInfo, view: TODAY, expect: { line: "10/28 · 1박", rate: "₩70,000", pay: "현금70,000", due: 0, lead: false } },
];

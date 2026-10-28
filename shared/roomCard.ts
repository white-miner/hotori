// 객실 카드(현황·배치) 한 장의 내용을 정하는 곳 — 두 화면이 같은 함수를 써요 (docs/room-card-spec.md).
// 순서: 객실번호(+건물) → 이용기간(+박수) → 결제 방식·금액 → 손님 이름 → 회사 → 박당 요금.
// 색: 박당 요금=빨강 · 받은 돈=검정 · 받아야 할 돈(오늘 밤 기준 미수금)=파랑.
import { type Booking, type Platform, isActive } from "./ledger";
import { type GroupInfo } from "./settle";
import { isLongStay } from "./longstay";
import { payState } from "./payment";
import {
  type NowAmountTone,
  type NowPayGroupCtx,
  groupStayPeers,
  nowAmountTone,
  nowDueAmount,
  nowStaySummary,
} from "./nowboard";
import { groupLeadBooking } from "./group";
import {
  type NowNightRate,
  nowCompanyOf,
  nowLongStayRate,
  nowNightRate,
  nowPayParts,
  nowPayText,
  nowPlatformPayPart,
  nowRangeFull,
} from "./nowCard";

type Plat = (Pick<Platform, "name"> & { onsite?: boolean | null }) | null | undefined;

export interface RoomCardInput {
  b: Booking;
  plat: Plat;
  /** 같은 날 전체 예약 (단체 형제를 찾아요) */
  bookings: readonly Booking[];
  /** 단체 정보 (booking_groups) */
  info: GroupInfo | null;
  /** 보는 날짜 (박당 요금·몇째 밤 기준) */
  view: string;
  /** 영업일 (받아야 할 돈은 오늘 밤 기준) */
  today: string;
  /** 단체 대표객실 예약 id — 직원이 지정한 대표객실 */
  preferredLeadId?: string | null;
  /** 입실 전엔 몇째 밤을 숨겨요 (기본: 보는 날짜가 입실일 이후일 때만 보여요) */
  showProgress?: boolean;
}

export interface RoomCardModel {
  /** 취소·퇴실 등 활성이 아니면 카드는 사실 줄 없이 상태만 */
  active: boolean;
  /** 둘 이상 묶인 단체에 속함 */
  inGroup: boolean;
  /** 대표객실 — 「대표객실」 글자와 단체 결제는 여기에만 */
  isLead: boolean;
  /** 단체의 다른 객실 */
  isMember: boolean;
  longStay: boolean;
  /** 이용기간 `10/25~10/27` · 퇴실 미정 `10/25 ~` · 하루 `10/25` */
  period: string;
  openEnded: boolean;
  /** 박수: `3박` · 몇째 밤 `2/3박` · 퇴실 미정 `2박째` */
  progress: string;
  /** 박당 요금 (총액·평균·추정 없음) */
  rate: NowNightRate;
  /** 결제 방식+금액 (검정) — 플랫폼 예약은 `야놀자270,000` */
  payText: string | null;
  payTitle: string;
  /** 받아야 할 돈 (파랑, 0이면 안 보여요) */
  due: number;
  tone: NowAmountTone;
  company: string | null;
  groupCtx: NowPayGroupCtx | null;
}

export function roomCardModel(i: RoomCardInput): RoomCardModel {
  const { b, plat, view, today } = i;
  const active = isActive(b);
  const longStay = isLongStay(b);
  const peers = b.groupId ? groupStayPeers(i.bookings, b.groupId) : [];
  const inGroup = !!b.groupId && peers.length >= 2 && !longStay;
  const lead = inGroup ? groupLeadBooking(peers, { preferredId: i.preferredLeadId ?? null, today }) : null;
  const isLead = inGroup && lead?.id === b.id;
  const isMember = inGroup && !isLead;
  const groupCtx: NowPayGroupCtx | null = b.groupId ? { members: peers, info: i.info } : null;
  const openEnded = b.openEnded === true && b.kind === "stay" && !b.earlyOut;

  const platPart = nowPlatformPayPart(b, plat);
  const parts = [...(platPart ? [platPart] : []), ...nowPayParts(b.payments, isLead ? i.info?.payments : null)];
  const tone: NowAmountTone = longStay ? "due" : nowAmountTone(b, plat, groupCtx, today);
  const due = longStay ? (b.priceUnset ? 0 : Math.round(payState(b, plat).left)) : nowDueAmount(b, plat, groupCtx, today, isLead);
  // 단체의 다른 객실은 받은 돈을 쓰지 않아요 (단체 결제는 대표객실에만) — 자기 플랫폼 금액만
  const payText = isMember
    ? platPart
      ? nowPayText([platPart])
      : null
    : (nowPayText(parts) ?? (b.priceUnset ? "금액미정" : tone === "due" && b.price > 0 && due > 0 ? "미결제" : null));

  return {
    active,
    inGroup,
    isLead,
    isMember,
    longStay,
    period: nowRangeFull(b),
    openEnded,
    progress: nowStaySummary(b, view, i.showProgress ?? view >= b.checkIn),
    rate: longStay ? nowLongStayRate(b.longStayRate, view) : nowNightRate(b, view),
    payText,
    payTitle: platPart
      ? `${plat?.name ?? "플랫폼"}에 낸 결제 금액 (예약에 적힌 판매가)`
      : isLead
        ? "결제 수단 · 금액 (방 결제 + 단체 결제)"
        : "결제 수단 · 금액 (이 객실 결제)",
    due,
    tone,
    company: nowCompanyOf(b, i.info),
    groupCtx,
  };
}

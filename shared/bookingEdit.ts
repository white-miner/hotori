// 숙박 수정(amend): 박수·입실 본문 반영 · 「1박 연장」과 경로 분리
import { checkOutFromStayNights, clampStayNights, stayEnd, type Booking } from "./ledger";

/** ops / 칸 / Entry 제목 통일 */
export const EDIT_COPY = "수정하기";

/**
 * Edit 경로에서 박수·입실 변경을 폼 state에 커밋.
 * nights↑ 해도 openExtend=false — 「1박 연장」은 별도 CTA(`planExtend` / ops #134)만.
 */
export function commitEditStayDates(input: {
  nextNights: number;
  nextCheckIn: string;
}): { nights: number; checkIn: string; stayEnd: string; openExtend: false } {
  const nights = clampStayNights(input.nextNights);
  const checkIn = input.nextCheckIn;
  return {
    nights,
    checkIn,
    stayEnd: checkOutFromStayNights(checkIn, nights),
    openExtend: false,
  };
}

/** 저장본 대비 박수↑가 연장 패널만 열도록 가로채면 안 됨 (P0 정책). */
export function nightsUpOpensExtendPanel(): boolean {
  return false;
}

/** 보드 퇴실예정 해제 여부: amend 후 stayEnd가 boardDate를 지나면 당일 퇴실예정 아님 */
export function editNightsClearsDeparting(opts: {
  prev: Pick<Booking, "checkIn" | "nights" | "kind" | "earlyOut">;
  nextNights: number;
  nextCheckIn?: string;
  boardDate: string;
}): boolean {
  const checkIn = opts.nextCheckIn ?? opts.prev.checkIn;
  const next = { ...opts.prev, checkIn, nights: clampStayNights(opts.nextNights) };
  const wasEnd = stayEnd(opts.prev);
  const nextEnd = stayEnd(next);
  return wasEnd === opts.boardDate && nextEnd > opts.boardDate;
}

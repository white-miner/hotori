/** 호텔 사업자·기본정보 (숙박확인서 헤더). See docs/stay-confirmation-letter-plan.md */

export interface HotelBiz {
  /** 상호(사업자명). 비우면 hotels.name */
  businessName: string;
  /** 사업자번호 */
  businessNumber: string;
  address: string;
  phone: string;
  representative: string;
}

export const HOTEL_BIZ_NAME_MAX = 60;
export const HOTEL_BIZ_NUMBER_MAX = 20;
export const HOTEL_BIZ_ADDRESS_MAX = 120;
export const HOTEL_BIZ_PHONE_MAX = 30;
export const HOTEL_BIZ_REP_MAX = 40;

/** FO CTA · 기본 라벨 (한국어) */
export const STAY_CONFIRM_COPY = "숙박확인서" as const;
export const STAY_CONFIRM_COPY_EN = "Stay Confirmation" as const;

/** Letter body language (modal toggle). FO chrome CTAs stay KR. */
export type StayConfirmLang = "ko" | "en";

export type StayConfirmStrings = {
  title: string;
  bizNumber: string;
  phone: string;
  representativeShort: string;
  guest: string;
  room: string;
  unassigned: string;
  roomSuffix: string;
  stayPeriod: string;
  nights: (n: number) => string;
  reservation: string;
  bookingNo: string;
  attest: string;
  issued: string;
  representative: string;
  seal: string;
  tipFilled: string;
  tipEmpty: string;
  print: string;
  pdf: string;
  pdfHint: string;
  close: string;
  langAria: string;
  langKo: string;
  langEn: string;
};

const STAY_CONFIRM_KO: StayConfirmStrings = {
  title: STAY_CONFIRM_COPY,
  bizNumber: "사업자번호",
  phone: "전화",
  representativeShort: "대표",
  guest: "투숙객",
  room: "객실",
  unassigned: "미배정",
  roomSuffix: "호",
  stayPeriod: "숙박기간",
  nights: (n) => `${n}박`,
  reservation: "예약",
  bookingNo: "예약번호",
  attest: "위와 같이 숙박하였음을 확인합니다.",
  issued: "발급일",
  representative: "대표자",
  seal: "(인)",
  tipFilled: "설정에 저장한 사업자 정보가 인쇄됩니다.",
  tipEmpty: "설정 → 호텔 사업자 정보를 넣으면 상호·사업자번호가 함께 인쇄됩니다.",
  print: "인쇄",
  pdf: "PDF",
  pdfHint: "인쇄 창에서「PDF로 저장」을 고르세요",
  close: "닫기",
  langAria: "확인서 언어",
  langKo: "한국어",
  langEn: "English",
};

const STAY_CONFIRM_EN: StayConfirmStrings = {
  title: STAY_CONFIRM_COPY_EN,
  bizNumber: "Business Reg. No.",
  phone: "Tel",
  representativeShort: "Rep.",
  guest: "Guest",
  room: "Room",
  unassigned: "Unassigned",
  roomSuffix: "",
  stayPeriod: "Stay",
  nights: (n) => (n === 1 ? "1 night" : `${n} nights`),
  reservation: "Booking",
  bookingNo: "Conf. No.",
  attest: "This certifies that the above guest stayed at our property.",
  issued: "Issued",
  representative: "Representative",
  seal: "(Seal)",
  tipFilled: "Hotel business details from Settings will appear on the printout.",
  tipEmpty: "Add hotel business details in Settings to print the legal name and registration number.",
  print: "Print",
  pdf: "PDF",
  pdfHint: "In the print dialog, choose “Save as PDF”",
  close: "Close",
  langAria: "Letter language",
  langKo: "한국어",
  langEn: "English",
};

export function stayConfirmStrings(lang: StayConfirmLang): StayConfirmStrings {
  return lang === "en" ? STAY_CONFIRM_EN : STAY_CONFIRM_KO;
}

/** EN letter uses ISO dates (unambiguous). KR keeps dayLabel (M/D(요일)). */
export function stayConfirmDateRange(
  lang: StayConfirmLang,
  checkIn: string,
  checkOut: string,
  nights: number,
  dayLabelKo: (d: string) => string,
): string {
  const span = stayConfirmStrings(lang).nights(nights);
  if (lang === "en") return `${checkIn} ~ ${checkOut} · ${span}`;
  return `${dayLabelKo(checkIn)} ~ ${dayLabelKo(checkOut)} · ${span}`;
}

export function emptyHotelBiz(): HotelBiz {
  return { businessName: "", businessNumber: "", address: "", phone: "", representative: "" };
}

export function normalizeHotelBiz(raw: unknown): HotelBiz {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : "");
  return {
    businessName: s("businessName", HOTEL_BIZ_NAME_MAX),
    businessNumber: s("businessNumber", HOTEL_BIZ_NUMBER_MAX),
    address: s("address", HOTEL_BIZ_ADDRESS_MAX),
    phone: s("phone", HOTEL_BIZ_PHONE_MAX),
    representative: s("representative", HOTEL_BIZ_REP_MAX),
  };
}

/** 확인서·인쇄에 쓰는 상호: hotelBiz.businessName → hotels.name */
export function hotelBizDisplayName(biz: HotelBiz, hotelName: string): string {
  return biz.businessName.trim() || hotelName.trim() || "호텔";
}

export function hotelBizHasAny(biz: HotelBiz): boolean {
  return !!(biz.businessName || biz.businessNumber || biz.address || biz.phone || biz.representative);
}

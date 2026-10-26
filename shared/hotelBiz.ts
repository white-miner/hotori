/** 호텔 사업자·기본정보 (숙박확인서 헤더). See docs/stay-confirmation-letter-plan.md */

export interface HotelBiz {
  /** 상호(사업자명). 비우면 hotels.name */
  businessName: string;
  /** 사업자번호 */
  businessNumber: string;
  address: string;
  phone: string;
  representative: string;
  /** 업종 (예: 호텔) */
  upjong: string;
  /** 업태 (예: 숙박업) */
  uptae: string;
}

export const HOTEL_BIZ_NAME_MAX = 60;
export const HOTEL_BIZ_NUMBER_MAX = 20;
export const HOTEL_BIZ_ADDRESS_MAX = 120;
export const HOTEL_BIZ_PHONE_MAX = 30;
export const HOTEL_BIZ_REP_MAX = 40;
export const HOTEL_BIZ_UPJONG_MAX = 40;
export const HOTEL_BIZ_UPTAE_MAX = 40;

/** FO CTA · 기본 라벨 (한국어) */
export const STAY_CONFIRM_COPY = "숙박확인서" as const;
export const STAY_CONFIRM_COPY_EN = "Stay Confirmation" as const;

/** Letter body language (modal toggle). FO chrome CTAs stay KR. */
export type PrintLang = "ko" | "en";
/** @deprecated alias — use PrintLang */
export type StayConfirmLang = PrintLang;

export type StayConfirmStrings = {
  title: string;
  bizNumber: string;
  phone: string;
  representativeShort: string;
  upjong: string;
  uptae: string;
  guest: string;
  room: string;
  unassigned: string;
  roomSuffix: string;
  stayPeriod: string;
  nights: (n: number) => string;
  reservation: string;
  bookingNo: string;
  /** 이용 금액 블록 (기관 환급용 · settle과 일치) */
  amounts: string;
  sale: string;
  paid: string;
  balance: string;
  amountUnset: string;
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
  upjong: "업종",
  uptae: "업태",
  guest: "투숙객",
  room: "객실",
  unassigned: "미배정",
  roomSuffix: "호",
  stayPeriod: "숙박기간",
  nights: (n) => `${n}박`,
  reservation: "예약",
  bookingNo: "예약번호",
  amounts: "이용 금액",
  sale: "판매가",
  paid: "받은",
  balance: "잔금",
  amountUnset: "금액미정",
  attest: "위와 같이 숙박하였음을 확인합니다.",
  issued: "발급일",
  representative: "대표자",
  seal: "(인)",
  tipFilled: "설정에 저장한 사업자 정보가 인쇄됩니다.",
  tipEmpty: "설정 → 호텔 사업자 정보를 넣으면 상호·사업자번호·업종·업태가 함께 인쇄됩니다.",
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
  upjong: "Industry",
  uptae: "Type of business",
  guest: "Guest",
  room: "Room",
  unassigned: "Unassigned",
  roomSuffix: "",
  stayPeriod: "Stay",
  nights: (n) => (n === 1 ? "1 night" : `${n} nights`),
  reservation: "Booking",
  bookingNo: "Conf. No.",
  amounts: "Charges",
  sale: "Sale",
  paid: "Paid",
  balance: "Balance",
  amountUnset: "Amount TBD",
  attest: "This certifies that the above guest stayed at our property.",
  issued: "Issued",
  representative: "Representative",
  seal: "(Seal)",
  tipFilled: "Hotel business details from Settings will appear on the printout.",
  tipEmpty:
    "Add hotel business details in Settings to print the legal name, registration number, industry, and type of business.",
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
export function printDateLabel(
  lang: PrintLang,
  date: string,
  dayLabelKo: (d: string) => string,
): string {
  return lang === "en" ? date : dayLabelKo(date);
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
  return {
    businessName: "",
    businessNumber: "",
    address: "",
    phone: "",
    representative: "",
    upjong: "",
    uptae: "",
  };
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
    upjong: s("upjong", HOTEL_BIZ_UPJONG_MAX),
    uptae: s("uptae", HOTEL_BIZ_UPTAE_MAX),
  };
}

/** 확인서·인쇄에 쓰는 상호: hotelBiz.businessName → hotels.name */
export function hotelBizDisplayName(biz: HotelBiz, hotelName: string): string {
  return biz.businessName.trim() || hotelName.trim() || "호텔";
}

export function hotelBizHasAny(biz: HotelBiz): boolean {
  return !!(
    biz.businessName ||
    biz.businessNumber ||
    biz.address ||
    biz.phone ||
    biz.representative ||
    biz.upjong ||
    biz.uptae
  );
}

/** 인쇄 헤더용 업종·업태 한 줄. 둘 다 비면 빈 문자열. */
export function hotelBizUpjongUptaeLine(
  biz: HotelBiz,
  labels: { upjong: string; uptae: string },
): string {
  const parts: string[] = [];
  if (biz.upjong.trim()) parts.push(`${labels.upjong} ${biz.upjong.trim()}`);
  if (biz.uptae.trim()) parts.push(`${labels.uptae} ${biz.uptae.trim()}`);
  return parts.join(" · ");
}

/** ko/en 라벨 — 견적·청구·손해 등 StayConfirmStrings 밖에서도 동일. */
export function hotelBizFieldLabels(lang: PrintLang): { upjong: string; uptae: string } {
  return lang === "en"
    ? { upjong: "Industry", uptae: "Type of business" }
    : { upjong: "업종", uptae: "업태" };
}

/**
 * 발급 서류 게이트: 상호(또는 hotels.name)·사업자번호·업종·업태.
 * 주소·전화·대표는 선택.
 */
export function hotelBizIsReady(biz: HotelBiz, hotelName = ""): boolean {
  return hotelBizMissingLabels(biz, hotelName).length === 0;
}

export function hotelBizMissingLabels(biz: HotelBiz, hotelName = ""): string[] {
  const missing: string[] = [];
  if (!(biz.businessName.trim() || hotelName.trim())) missing.push("상호");
  if (!biz.businessNumber.trim()) missing.push("사업자번호");
  if (!biz.upjong.trim()) missing.push("업종");
  if (!biz.uptae.trim()) missing.push("업태");
  return missing;
}

export const HOTEL_BIZ_GATE_COPY = {
  title: "사업자 정보가 필요해요",
  body: (missing: string[]) =>
    `발급 서류에는 ${missing.join("·")}이(가) 필요해요.\n설정 → 호텔 사업자 정보에서 입력해 주세요.`,
  confirmLabel: "설정으로 이동",
  cancelLabel: "닫기",
  settingsHash: "#/settings/hotel-biz",
} as const;

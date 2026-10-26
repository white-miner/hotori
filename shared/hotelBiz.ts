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

export const STAY_CONFIRM_COPY = "숙박확인서" as const;

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

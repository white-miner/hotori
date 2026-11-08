/** 아고다·야놀자 카드가 아닌 예약 화면 모양. 이름·번호·전화는 모두 가짜다. */

/** 에어비앤비 호스트 예약 상세(한국어). 받은 돈 줄(게스트 결제 금액·호스트 수령액)은 판매금이 아니다. */
export const AIRBNB_KO = `예약 확정됨
게스트
Mina Park
게스트 2명
체크인
2026년 11월 7일 (토)
오후 4:00
체크아웃
2026년 11월 9일 (월)
오전 11:00
예약 번호
HMABCD1234
객실
오션뷰 더블
게스트 결제 금액
₩230,000
호스트 수령액
₩200,000`;

/** Booking.com 엑스트라넷 예약 상세(영어, 칸 이름: 값). */
export const BOOKING_EN = `Booking number: 4000000004
Guest name: Ari Stone
Check-in: Tue, Dec 1, 2026
Check-out: Fri, Dec 4, 2026
Length of stay: 3 nights
Total guests: 2 adults
Room: Deluxe Double Room
Total price: KRW 330,000
Commission: KRW 49,500`;

/** 국내 사이트 예약 상세(칸 이름 값 한 줄). */
export const DOMESTIC_KO = `예약번호 2026110700001
예약자명 Ara Min Lee
연락처 050-1234-5678
객실명 스탠다드 더블
입실일 2026-11-07 (토) 15:00
퇴실일 2026-11-09 (월) 11:00
판매금액 180,000원`;

/** 처음 보는 칸 이름(예약 코드 대신 `주문 코드`, 이름 대신 `방문자`). 직원이 한 번 골라 알려 준다. */
export const UNKNOWN_LABELS_A = `주문 코드
ZX1000000001
방문자
Mina Park
입실일
2026-11-07
퇴실일
2026-11-09
판매금액
KRW 210,000`;

export const UNKNOWN_LABELS_B = `주문 코드
ZX2000000002
방문자
Ari Stone
입실일
2026-12-01
퇴실일
2026-12-04
판매금액
KRW 330,000`;

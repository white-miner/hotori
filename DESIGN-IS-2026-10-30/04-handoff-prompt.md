```text
/make-plan Redesign HOTORI 신규 현장 수납 UI. Current design failed audit at 15/30 with a critical gap in #2 useful (0).

Verdict:
> 신규 현장 수납 UI는 15/30(50/100)이며 핵심 업무인 복합결제를 직접 지원하지 않아, 원장과 브랜드는 보존하고 결제 입력·확인·실패 복구 흐름을 다시 설계한다.

Why redesign: 신규 화면에서 카드14만원＋현금2만원의 주요 업무가 직접 지원되지 않는다.
Preserve: Payment[]의 금액·수단·영업일(shared/payment.ts:32–50); 단체 소유 수납(src/data.ts:1006–1027); 정정/복원(RecordSheet.tsx:100–141); 화이트 브랜드와 간격 토큰(src/styles.css).
Discard: 단일 depMethod에 의존하는 신규 수납(shared/payment.ts:233–264); 수납 실패 후 성공 콜백으로 닫기(SimpleBooking.tsx:591–616); 모드→수단→판매금→수납으로 분산된 검토(SimpleBooking.tsx:963–1187).

Top moves:
1. #2 유용성: 단일·복합 수납을 같은 금액 입력 흐름에서 처리한다. 근거 E1.
2. #8 완성도: 예약 저장과 수납 저장의 부분 성공을 분리하고 동일 요청으로 수납만 재시도한다. 근거 E2.
3. #4 이해성: 판매금·기수납·이번 수납·등록 후 잔금을 한 요약으로 보여준다. 근거 E4.
4. #3 심미성: 닫기·증감 버튼의 실제 클릭 면적과 CSS 범위를 통일한다. 근거 E3.
5. #10 최소성: 정정·환불·청구액 변경은 수납 입력과 분리하되 기존 내역 입구를 재사용한다. 근거 E4.

Principles: useful → understandable → minimal. New IA: 예약 요약 / 판매·박별요금 / 수납수단별 금액 / 영업일·내역 / 고정 합계·저장. Empty/loading/error/success/focus/disabled/부분 성공/응답 불명 상태를 정의한다. 마이그레이션은 승인 전 실행하지 않는다. 긴급 복합 수납 개선은 기존 테이블과 고정 UUID를 사용하고, 예약＋수납 전체 원자성은 별도 승인 대상이다. 카드 승인 기능이 없는 화면에 승인 완료라는 표현을 쓰지 않는다. 실 데이터 조회와 격리 저장 테스트를 구분하며 운영 예약에 시험 수납을 만들지 않는다. 기존 직원 흐름을 유지하면서 생성·기존 수납·퇴실 정산에 같은 입력부를 순서대로 적용하고 회귀 통과 후 이전 입력을 제거한다. 두 디자인을 무기한 병존시키지 않는다.
Deliverables: 파일별 구현·검증 계획, 이전/이후 업무 흐름, type/spacing/contrast tokens, 상태 체크리스트, 중복·부분 실패 테스트, 컷오버 기준 및 미구현 명시.
```

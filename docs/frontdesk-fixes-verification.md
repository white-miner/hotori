# 프런트 업무 수정 결과 · 2026-10-30

기준: main bc6002b 이후. 운영 예약·수납·퇴실 기록을 시험용으로 생성/수정/삭제하지 않았다. 스키마·마이그레이션·RLS 변경 없음.

## 변경

- 스마트등록: `Standard2 ㅣ스탠다드`의 구분자 공백 때문에 기존 `Standard2ㅣ스탠다드 → 스탠다드 2PC` 설정을 놓치는 원인을 수정했다. 구분자 공백 정규화, 숫자 코드 보존, 불명확한 부분 일치 거절. 호텔별 기존 매칭을 사용하며 전역 하드코딩이나 설정 중복 추가를 하지 않았다.
- 과거 현황: 퇴실한 예약을 과거 배치에 보여주기 위해 `checkedOutAt`을 지우던 복사본을 제거했다. 배치는 보존하면서 실제 퇴실 기록을 유지하고 `퇴실 완료`로 표시한다. 과거 미처리 퇴실도 확인창으로 연결하되 날짜 경과만으로 자동 처리하지 않는다. 처리 시 최신 원본 예약을 다시 확인한다.
- 복합 수납: 간단 예약·상세 신규 예약·숙박 판매에서 카드/현금/이체별 금액을 입력하고 합계·잔금을 확인한다. 선금·후불·금액미정과 기존 단일 수단을 유지한다. 단체 수납은 단체 소유로 한 번만 저장한다.
- 저장 복구: 수납 행을 한 요청으로 저장, UUID 고정, 기존 행 덮어쓰기 금지, 전체 행 재조회 검증. 예약 성공 후 수납 실패는 별도 팝업에서 수납만 재시도한다. 원래 폼 재저장 및 연속 제출을 차단한다. 숙박 판매의 시간 추가금도 별도 수납 행으로 한 번씩만 기록하며 설명 메모를 보존한다.
- 증감 버튼: 사이드바와 `.sb` 이름이 충돌해 버튼이 fixed 위치로 이동하던 원인을 제거했다. 사이드바 루트를 `.app-sidebar`로 분리한다. 인원·박수 기존 min/max와 busy를 유지한다.
- 숙박 판매: 입실일→퇴실일 달력 추가, 선택한 모든 객실의 예약 밤을 차단 표시. 날짜·박수를 함께 반영하며 결제 영업일은 현재 영업일로 유지한다.
- 팝업: 공용 닫기 `.x` 및 설정/박별 팝오버 닫기를 최소 44px, 좁은 화면 `.x`는 48px. 하단 업무 버튼도 44px 이상. 기존 disabled/닫기 핸들러 유지. 초록 저장 버튼 대비 개선. 회사명 예시 ‘오서건설’ 제거(저장된 회사명 불변).

## 실제 UI 확인

로컬 로그인 화면에서 확인했다. FHD 1920×1080, 실제 59개 객실·8개 층. 본관 1/9/10/10/10실, 별관 9/9/1실. 카드 171.5×214.375px로 4:5, 층별 기존 순서 유지. 문서 전체 가로 넘침 없음.

- 간단 예약·숙박 판매: 판매금 160,000, 카드 140,000, 현금 20,000 → 수납 합계 160,000, 잔금 0. 입력만 검증하고 운영 저장은 누르지 않았다.
- 774×712 숙박 판매: 인원 1→2, 박수 1→2 버튼 동작. 증감 버튼 40×40px, position static. 달력으로 10/31 입실→11/2 퇴실 2박 적용. 실제 차단 밤 표시 확인.
- 356×580: 간단 예약 닫기 48×48px, 모달 폭 341px. 복합 수납 영역 폭/scrollWidth/clientWidth 모두 290px로 잘림 없음.
- FHD 퇴실예정 버튼 → 실제 `퇴실처리` 확인 모달 열림. 최종 처리는 실행하지 않고 닫음.
- 10/29 과거 본관 303 → `퇴실 완료`, 상세 팝업에도 퇴실 완료 및 실제 기록 안내. 예약·수납·회사·단체 정보 조회 유지. 이미 퇴실한 예약을 다시 퇴실 대상으로 만들지 않음.
- 스마트등록 가명 원문: `Standard2 ㅣ스탠다드 (스타일러ㅣ공기청정기)` → 기존 호텔 매칭의 `스탠다드 2PC`, `Standard ㅣ스탠다드 …` → `스탠다드`. 확인 업로드는 실행하지 않음. 호텔 타입 매칭 설정도 읽기만 함.
- 별도 메모리 화면에 실제 `SimpleBooking` 컴포넌트를 연결: 첫 수납 실패 시 예약1건/수납시도1회/수납0줄 → `수납만 다시 저장` 후 예약1건/수납시도2회/수납2줄/저장완료. 운영 DB 연결 없음.

## 자동 검증

- `npm test`: **817 tests, 5 suites, 817 pass, 0 fail**.
- `npm run build`: TypeScript·Vite·서버 빌드 통과. 기존 대형 JS chunk 경고는 남아 있다.
- Canvas는 SDK 선언 기준 TypeScript 검사 통과.
- 회귀 범위: 예약/원장/단체/현금 시재/정정/퇴실/이동/요금 계산 기존 테스트. 새 테스트는 두 타입의 구분, 실제 공백 사례, 알 수 없는 숫자 코드, 과거 완료 보존·미처리 분기, 복합 합계/초과/선금/후불/금액미정, 응답 불명 재조회·동일 UUID 재시도·부분 조회 실패를 포함한다.
- 소스 기준 공용 닫기 버튼과 예외를 조사했으며 모든 팝업을 실제로 하나씩 열었다고 주장하지 않는다. 실제 화면 검증은 간단 예약·숙박 판매·날짜 선택·객실 상세·퇴실 확인 입구다.

## 파일 목록

공유 로직: `shared/detailedRoomCard.ts`, `shared/nowboard.ts`, `shared/nowboard.test.ts`, `shared/payment.ts`, `shared/payment.test.ts`, `shared/receiptBatch.ts`, `shared/smartRegister.ts`, `shared/smartRegister.test.ts`, `shared/staySale.ts`.

화면/저장: `src/Dashboard.tsx`, `src/Entry.tsx`, `src/NightPickCalendar.tsx`, `src/NowSidePanel.tsx`, `src/OnsitePayModeFields.tsx`, `src/Sidebar.tsx`, `src/SimpleBooking.tsx`, `src/StayDatesPopup.tsx`, `src/StaySaleModal.tsx`, `src/data.ts`, `src/primitives/Stepper.tsx`, `src/styles.css`, `src/useCreateReceipts.tsx`.

평가·전체 기획: `DESIGN-IS-2026-10-30/00-scope.md`~`05-redesign-plan.md`. 이 검증 문서. Canvas는 작업공간 밖 관리 디렉터리에 별도 보관.

## 남은 범위와 제한

- 원래 결제창 평가 50/100, 전체 수정 기획 작성 완료. 전체 기획의 단계2(기존 수납·퇴실 정산의 복합 입력 통합), 단계3(예약＋수납 트랜잭션/새로고침 복구)는 미구현이며 긴급 개선과 구분한다.
- 현재 재시도는 열린 화면 안에서 제공한다. 예약 생성 응답 자체가 불명인 경우, 창을 닫거나 새로고침한 경우까지 완전한 중복 방지를 보장하지 않는다. 먼저 실제 예약·수납 내역을 확인해야 한다.
- 수납 배치의 DB 실쓰기 테스트 및 운영 예약 CRUD/퇴실 실행은 하지 않았다. 운영 데이터 손상을 피하기 위해 실제 UI 조회와 격리 저장 테스트를 구분했다.
- 80cm 거리의 물리적 가독성·직원 업무 소요 시간·TTI는 현장 측정하지 않았다.

## 화면 증거 (로컬)

`test-results/frontdesk-2026-10-30/`의 `simple-mixed.png`, `stay-mixed.png`, `mixed-narrow.png`, `receipt-recovery.png`, `receipt-retry-success.png`, `checkout-confirm.png`, `checkout-history.png`, `standard2-matched.png`. 가명 미리보기 외 실제 객실 화면은 고객 정보가 포함될 수 있어 Git에 올리지 않는다.

저장 방식 확인 참고: [Supabase bulk insert](https://supabase.com/docs/reference/javascript/insert), [고정 키 upsert 옵션](https://supabase.com/docs/reference/javascript/upsert). 실제 구현은 중복 키를 수정하지 않고 모든 요청 ID를 재조회한다.

# 좌측 사이드바 통합 (구현 메모)

기준 문서: `HOTORI-좌측사이드바-통합기획서-보강본.md` (§16 단계 1~5 구현 완료, 6~7 남음)

## 항상 켜짐
- 데스크톱(760px 초과)에서는 사이드바가 **항상** 켜져 있다. 끄는 방법이 없다: `?sidebar=0`·`?sidebar=1` 인자와 예전 저장값(`hotori.sidebarSwitch`)은 읽지 않고 무시한다. "예전 화면으로" 단추는 없다.
- 760px 이하: 6단계 전까지 기존 모바일 화면 (`active = !mobile`, `useSidebarState` 안의 `useMobile`).
- 공유 링크 `/s/<token>` (Shared.tsx) 에는 사이드바 없음.
- 사이드바 구조가 없는 기존 화면 코드(`active` 가 false 일 때의 제자리 렌더, 모바일용 `<aside className="side">`)는 모바일이 7단계까지 쓰므로 남아 있다.

## 구조
- `src/Sidebar.tsx` — SidebarProvider / `useSidebarSlots()` / Sidebar. 고정 순서 슬롯: views · date · building · search · platform · status · minimap · ops.
- `src/SidebarParts.tsx` — 상단(로고→보드, 간단 예약, 알림·계정), 메뉴 항목.
- 화면(Dashboard 등)은 `sbx.into(슬롯, 노드)` 로 자기 컨트롤을 슬롯에 포털로 넣는다. `active` 가 false(모바일·공유 화면)이면 노드를 그대로 돌려줘 기존 위치에 렌더된다.
- **상태는 Dashboard 에 그대로 둔다** (`selectedRoomIds`, `sideMode`, `mvB`, `assigning` 등). 사이드바는 렌더 위치만 바꾼다.
- 구역 C(`ops`) = 현황 운영 패널 `NowSidePanel`(N1~N21) 내부 변경 없음. 현황에서만 보임.
- 배치 화면에서는 구역 C(`ops`) 에 배치 오른쪽 패널(미배정 예약·검색·오늘/일주일/한달·방 이동/배정 등 안은 기존 그대로 `roomsSideBody`)이 들어간다. 상태·핸들러는 Dashboard 그대로. 기존 패널 접기 단추(R1)는 사이드바 자체가 접히므로 사이드바 켜짐일 때 그리지 않는다. 배치 본문은 한 칸이라 오른쪽에 아무것도 없다.
- 사이드바가 켜져 있으면 `.nowlayout` 은 한 칸, 기존 우측 `.nowside` 는 렌더되지 않는다.

## 펼침 / 고정 / Esc
- 기본 레일 56px. 펼침 320px.
- 임시 펼침은 보드 위에 겹침(카드 열 수 불변). 고정(`hotori.sidebarPinned`)하면 보드가 좁아짐.
- 임시 펼침은 Esc 또는 토글로만 닫힘(바깥 클릭으로 닫지 않음). 고정은 Esc 로 닫히지 않음. 열린 메뉴(.pop)가 있으면 Esc 는 메뉴부터 닫음 (`escSidebarAction`).
- z-index: .top 30 · .mvbar 30 · .sb 32 · FAB 35 · 하단탭 36 · .pop 40 · .dim 50.

## 선택 자동 해제 (최소 범위)
- 사이드바가 켜져 있고 현황일 때만, 건물·층·"임시만" 필터로 **숨겨진** 객실이 선택돼 있으면 선택에서 뺀다 (`selectionAfterFilter`, `visibleNowRoomIds`).
- 플랫폼 필터·손님 검색·미니맵 점유 필터는 카드를 흐리게만 하므로 해제하지 않는다.

## 차이 / 남은 일
- 발급 문서 5종(숙박확인서·손해내역서·청구서·견적서·배치도 인쇄)은 발급 화면 전용. 기획서 N16·목업의 해당 버튼은 만들지 않음.
- 주차 날짜 이동, 월간 예약 필터 검색, 기간 DateChip·박수/오버 안내는 본문에 그대로.
- 6단계 모바일 드로어, 7단계 구 코드(모바일용 기존 화면) 제거.
- 사이드바가 켜져 있어도 오른쪽 고정 패널이 남은 다른 화면은 이 문서에 따로 적지 않음 (보고서 참조).

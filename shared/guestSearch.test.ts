import assert from "node:assert/strict";
import { test } from "node:test";
import { type Booking } from "./ledger";
import {
  boardGuestSearch,
  normalizeGuestName,
  parseGuestQuery,
  phoneDigits,
  textMatchesGuest,
} from "./guestSearch";

let n = 0;
const bk = (p: Partial<Booking>): Booking => ({
  id: `b${++n}`,
  kind: "stay",
  status: "active",
  platformId: "p",
  price: 100000,
  guestName: "손님",
  typeId: "s",
  roomId: "r1",
  checkIn: "2026-10-21",
  nights: 1,
  startTime: null,
  endTime: null,
  arrived: true,
  memo: null,
  cancelledAt: null,
  createdAt: "",
  updatedAt: "",
  segments: null,
  earlyOut: null,
  refund: null,
  checkedOutAt: null,
  ...p,
});

test("parseGuestQuery: trim · 이름키 · 숫자", () => {
  assert.equal(parseGuestQuery("  "), null);
  assert.deepEqual(parseGuestQuery(" 김 태 훈 "), { nameKey: "김태훈", digits: "" });
  assert.deepEqual(parseGuestQuery("010-1234-5678"), { nameKey: "010-1234-5678".replace(/\s+/g, "").toLowerCase(), digits: "01012345678" });
  assert.equal(phoneDigits("010-1234-5678"), "01012345678");
  assert.equal(normalizeGuestName("김 태 훈"), "김태훈");
});

test("이름 부분 일치 · 대소문자·공백 무시", () => {
  const q = parseGuestQuery("김태")!;
  assert.equal(textMatchesGuest(q, "김태훈", null), true);
  assert.equal(textMatchesGuest(q, "김 태 훈", null), true);
  assert.equal(textMatchesGuest(q, "이수진", null), false);
});

test("연락처 숫자 매칭", () => {
  const q = parseGuestQuery("1234")!;
  assert.equal(textMatchesGuest(q, "아무개", "010-1234-5678"), true);
  assert.equal(textMatchesGuest(q, "아무개", "010-9999-0000"), false);
  assert.equal(textMatchesGuest(q, "1234호실아님", null), true); // 이름에도 포함되면 OK
});

test("바로입실 자동명 검색", () => {
  const q = parseGuestQuery("바로입실")!;
  assert.equal(textMatchesGuest(q, "바로입실 10/21", null), true);
  assert.equal(textMatchesGuest(parseGuestQuery("10/21")!, "바로입실 10/21", null), true);
});

test("보드 검색: 복수 매칭 칩 · 클리어(빈 쿼리) 비활성", () => {
  const a = bk({ id: "a", guestName: "김태훈", guestPhone: "01011112222", roomId: "r601" });
  const b = bk({ id: "b", guestName: "김수영", guestPhone: "01033334444", roomId: "r203" });
  const c = bk({ id: "c", guestName: "박민수", roomId: "r101" });
  const slots = [
    { roomId: "r601", booking: a },
    { roomId: "r203", booking: b },
    { roomId: "r101", booking: c },
  ];
  const label = (id: string) => ({ r601: "본관 601", r203: "별관 203", r101: "101" }[id] ?? id);

  const empty = boardGuestSearch({ slots, queryRaw: "", roomLabel: label });
  assert.equal(empty.active, false);
  assert.equal(empty.chips.length, 0);

  const hits = boardGuestSearch({ slots, queryRaw: "김", roomLabel: label });
  assert.equal(hits.active, true);
  assert.equal(hits.roomIds.size, 2);
  assert.ok(hits.roomIds.has("r601"));
  assert.ok(hits.roomIds.has("r203"));
  assert.equal(hits.chips.length, 2);
  assert.deepEqual(
    hits.chips.map((x) => `${x.labelName} · ${x.labelRoom}`),
    ["김태훈 · 본관 601", "김수영 · 별관 203"],
  );

  const phone = boardGuestSearch({ slots, queryRaw: "3333", roomLabel: label });
  assert.equal(phone.chips.length, 1);
  assert.equal(phone.chips[0].labelName, "김수영");
});

test("단체: 그룹명·대표명 매칭 → 묶인 호실 전부 · 일원 이름도 확장", () => {
  const g1 = bk({ id: "g1", guestName: "대표김", groupId: "grp", groupName: "한빛여행", roomId: "r1" });
  const g2 = bk({ id: "g2", guestName: "동료이", groupId: "grp", groupName: "한빛여행", roomId: "r2" });
  const other = bk({ id: "o", guestName: "외부", roomId: "r3" });
  const slots = [
    { roomId: "r1", booking: g1 },
    { roomId: "r2", booking: g2 },
    { roomId: "r3", booking: other },
  ];
  const label = (id: string) => id;

  const byGroup = boardGuestSearch({
    slots,
    queryRaw: "한빛",
    roomLabel: label,
    groups: new Map([["grp", { payerName: "결제자박" }]]),
  });
  assert.equal(byGroup.roomIds.size, 2);
  assert.ok(byGroup.roomIds.has("r1") && byGroup.roomIds.has("r2"));

  const byPayer = boardGuestSearch({
    slots,
    queryRaw: "결제자",
    roomLabel: label,
    groups: new Map([["grp", { payerName: "결제자박" }]]),
  });
  assert.equal(byPayer.roomIds.size, 2);

  // 일원 이름 → 같은 그룹 다른 방도
  const byMember = boardGuestSearch({ slots, queryRaw: "동료이", roomLabel: label });
  assert.equal(byMember.roomIds.size, 2);
  assert.ok(byMember.roomIds.has("r1") && byMember.roomIds.has("r2"));
});

test("미배정 칩 · 취소는 제외", () => {
  const ua = bk({ id: "ua", guestName: "미배정김", roomId: null });
  const cx = bk({ id: "cx", guestName: "김취소", roomId: "r9", status: "cancelled", cancelledAt: "x" });
  const r = boardGuestSearch({
    slots: [{ roomId: "r9", booking: cx }],
    unassigned: [ua],
    queryRaw: "김",
    roomLabel: () => "9",
  });
  assert.equal(r.chips.length, 1);
  assert.equal(r.chips[0].labelRoom, "미배정");
  assert.equal(r.roomIds.size, 0);
});

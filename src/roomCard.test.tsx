// 객실 카드 검증 표 (docs/room-card-spec.md §7): 현황·배치가 같은 모델을 쓰고, 실제 렌더 결과(RoomCardFacts)까지 확인해요.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import RoomCardFacts from "./RoomCardFacts";
import { CARD_CASES, TODAY, type CardCase } from "../shared/roomCardCases";
import { roomCardModel } from "../shared/roomCard";
import { groupLeadChipLabel, groupPeerRoomItems } from "../shared/group";
import { nowRateText } from "../shared/nowCard";

const model = (c: CardCase, site: "now" | "board") =>
  roomCardModel({ b: c.b, plat: c.plat, bookings: c.bookings, info: c.info, view: site === "now" ? TODAY : c.view, today: TODAY, preferredLeadId: c.info?.leadBookingId ?? null });
const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/^\||\|$/g, "");

/** 배치 칸처럼 그리는 방식 (period = 이용기간 + 박수) */
const EMPTY_SLOT = /<div[^>]*data-slot="[^"]+"[^>]*><\/div>/g;
/** 값이 끼워진 자리만 (빈 자리는 항상 그려지지만 내용이 없어요 — 빈 자리 구조는 아래 슬롯 테스트에서) */
const renderFacts = (m: ReturnType<typeof model>, slot: "top" | "who", withPeriod: boolean) => renderRawFacts(m, slot, withPeriod).replace(EMPTY_SLOT, "");
const renderRawFacts = (m: ReturnType<typeof model>, slot: "top" | "who", withPeriod: boolean) =>
  renderToStaticMarkup(
    <RoomCardFacts
      slot={slot}
      rate={m.rate}
      payText={m.payText}
      payTitle={m.payTitle}
      tone={m.tone}
      due={m.due}
      company={m.company}
      linkLabel={m.isMember ? "본관 602호" : null}
      viewLabel="10/28"
      openEnded={m.openEnded}
      period={withPeriod ? [m.period, m.progress].filter(Boolean).join(" · ") : undefined}
    />,
  );

for (const site of ["now", "board"] as const) {
  for (const c of CARD_CASES) {
    if (site === "now" && c.boardOnly) continue;
    test(`카드 ${site === "now" ? "현황" : "배치"} · ${c.id} ${c.name}`, () => {
      const m = model(c, site);
      const e = c.expect;
      if (e.line === "") {
        assert.equal(m.active, false, "취소 예약은 카드에 사실 줄을 만들지 않아요");
        return;
      }
      assert.equal([m.period, m.progress].filter(Boolean).join(" · "), e.line, "이용기간 + 박수");
      assert.equal(nowRateText(m.rate), e.rate, "박당 요금");
      if (e.varies != null) assert.equal(m.rate.varies, e.varies, "변동 표시");
      assert.equal(m.payText, e.pay, "결제 방식·금액");
      assert.equal(m.due, e.due, "받아야 할 돈");
      assert.equal(m.isLead, e.lead, "대표객실은 대표 카드에만");
      assert.equal(m.isMember, e.member === true);
      if (e.company !== undefined) assert.equal(m.company, e.company);

      // 실제 렌더: 순서(기간 → 결제 → 받을 돈 / 회사 → 박당 요금)와 색 클래스
      const top = renderFacts(m, "top", site === "board");
      const who = renderFacts(m, "who", false);
      if (site === "board") assert.ok(top.includes(e.line.split(" · ")[0]!), "배치 카드에도 이용기간 줄이 있어요");
      const iPeriod = top.indexOf("rc-period");
      const iPay = top.indexOf("rc-pay");
      const iDue = top.indexOf("rc-due");
      if (m.isMember) {
        // 구성원 카드: 객실번호 · 기간 · 연동 · (자기 플랫폼 판매금액 한 줄) · 박당 요금. 단체 이체/카드·받을 돈·회사는 없음
        assert.match(top, /class="rc-link"[^>]*>연동 본관 602호</, "구성원은 연동 대표객실을 작게");
        assert.equal(iDue, -1, "구성원 카드에는 받을 돈 줄이 없어요");
        if (e.pay) {
          assert.match(top, /class="rc-pay amt-paid"/, "자기 플랫폼 판매금액 한 줄");
          assert.match(text(top), /야놀자 320,000/, "플랫폼 이름 + 금액");
          assert.doesNotMatch(top, /이체|카드|현금/, "단체 이체·카드는 구성원 카드에 없어요");
        } else assert.equal(iPay, -1, "플랫폼 금액이 없으면 결제 줄 없음");
        assert.doesNotMatch(who, /rc-co/, "구성원 카드에는 회사 줄이 없어요");
        if (e.rate) assert.match(who, /class="rc-rate amt-rate"/);
        return;
      }
      assert.doesNotMatch(top, /rc-link/, "연동 줄은 구성원만");
      if (e.pay) {
        assert.match(top, /class="rc-pay amt-paid"/, "받은 돈=검정");
        assert.ok(text(top).replace(/\s/g, "").includes(e.pay.split(" · ")[0]!.replace(/\s/g, "")));
        if (iPeriod >= 0) assert.ok(iPeriod < iPay, "이용기간이 결제보다 위");
      } else assert.equal(iPay, -1, "결제 줄 없음");
      if (e.due > 0) {
        assert.match(top, /class="rc-due amt-due"/, "받아야 할 돈=파랑");
        assert.match(top, /받을 돈/, "받을 돈 라벨");
        assert.ok(top.includes(e.due.toLocaleString("en-US")));
        if (iPay >= 0) assert.ok(iPay < iDue, "받을 돈은 결제 아래");
      } else assert.equal(iDue, -1);
      if (e.rate) {
        assert.match(who, /class="rc-rate amt-rate"/, "객실 가격=빨강");
        assert.ok(who.includes(`${e.rate}/박`), "박당 요금은 ₩…/박으로 분명히");
        if (e.company) assert.ok(who.indexOf(e.company) < who.indexOf("rc-rate"), "회사가 박당 요금보다 위");
      } else assert.doesNotMatch(who, /rc-rate/, "요금을 모르면 비워요 (평균·추정 금지)");
      assert.equal(who.includes("변동"), e.varies === true);
      // 총액·평균·플랫폼 예약번호는 카드에 없어요
      assert.doesNotMatch(text(top + who), /예약번호|평균|추정|YN-/);
      assert.doesNotMatch(top + who, /대표객실/, "대표객실 글자는 머리줄에서만 (사실 줄에는 없어요)");
    });
  }
}

test("카드 · 퇴실 미정은 `10/25 ~` · 단체 대표객실의 단체 결제는 대표 카드에만", () => {
  const open = CARD_CASES.find((c) => c.id === "C15")!;
  assert.equal(model(open, "now").period, "10/25 ~");
  assert.match(renderFacts(model(open, "board"), "top", true), /10\/25 ~ · 4박째/);
  const lead = CARD_CASES.filter((c) => c.expect.lead).map((c) => c.id);
  assert.deepEqual(lead, ["C10"]);
  for (const c of CARD_CASES.filter((x) => x.expect.member)) assert.equal(model(c, "now").due, 0);
});

test("카드 · 건물 이름은 다른 객실을 가리킬 때만 (구성원 카드의 대표객실 표시 · 대표객실 연동 목록)", () => {
  const lead = { id: "a", roomId: "r602" };
  const label = (id: string) => (id === "r602" ? "본관 602" : "별관 301");
  assert.equal(groupLeadChipLabel("b", lead, label), "본관 602호", "구성원 카드는 대표객실을 건물+호수로 가리켜요");
  assert.equal(groupLeadChipLabel("a", lead, label), "대표객실", "대표객실 카드는 글자만");
  const mk = (id: string, roomId: string) => ({ id, roomId, payments: [], createdAt: "2026-10-25T00:00:00Z" });
  const items = groupPeerRoomItems([mk("a", "r602"), mk("b", "r301")], label, { preferredId: "a" });
  assert.deepEqual(items, [{ no: "별관 301", lead: false }, { no: "본관 602", lead: true }], "연동 객실 목록도 건물+호수");
  const src = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /rc-bld|bldTag/, "일반 카드 머리줄에는 건물 이름을 붙이지 않아요");
  assert.match(src, /groupPeerRoomItems\(groupStayPeers\(bookings, b\.groupId\), \(id\) => L\.roomLabel\(id\)/, "연동 목록은 roomLabel(건물+호수)");
  assert.match(src, /groupLeadChipLabel\(b\.id, lead, \(id\) => L\.roomLabel\(id\)/, "구성원 칩은 roomLabel");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /rc-bld/);
});

test("카드 · 현황 한 화면(배치 합침) · 그림 순서는 이름 위에 기간·결제 → 이름 → 회사·박당 요금", () => {
  const src = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/cardModelOf\(/g) ?? []).length, 1, "현황 한 곳에서만 카드 모델을 만들어요 (배치 합침)");
  assert.doesNotMatch(src, /nownights-acc/, "배치 아래쪽에 따로 박수 칩을 두지 않아요 (이용기간 줄에 합침)");
  assert.doesNotMatch(src, /rooms-room-/, "배치 칸은 현황으로 합쳐졌어요");
  // 현황
  const now = src.slice(src.indexOf('id={`now-room-${r.id}`}', src.indexOf("const f = nowFlags(b, viewDate")));
  assert.ok(now.indexOf('slot="top"') < now.indexOf('className="nm"'));
  assert.ok(now.indexOf('className="nm"') < now.indexOf('slot="who"'));
  // 대표객실 글자는 leadTag(isLeadRoom)만
  assert.equal((src.match(/>\s*대표객실\s*</g) ?? []).length, 1);
});

test("카드 · 글자 크기 위계 (docs/room-card-spec.md §3): 기간·결제·받을 돈 13px↑ · 박당 요금 15px↑ 굵게 · 회사·연동은 작게", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const size = (sel: string) => {
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const items = m[1]!.split(",").map((x) => x.trim());
      const fs = /font-size:\s*([\d.]+)px/.exec(m[2]!);
      if (fs && items.includes(`.cell ${sel}`)) return Number(fs[1]);
    }
    assert.fail(`${sel} 글자 크기`);
  };
  for (const k of [".rc-period", ".rc-due-k"]) assert.ok(size(k) >= 13, k);
  assert.ok(size(".rc-rate") >= 15, "박당 요금");
  assert.ok(size(".rc-co") < size(".rc-pay") && size(".rc-link") < size(".rc-co"), "회사 < 결제, 연동 < 회사");
  assert.ok(size(".rc-pay") >= 13 && size(".rc-due") >= 13, "결제 · 받을 돈");
});

test("카드 · 이름 바꾸기: 화면에는 `룸 타임라인`이 남지 않아요 (월간 예약)", () => {
  for (const f of ["Dashboard.tsx", "RoomCalendar.tsx", "Settings.tsx"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /룸 타임라인/, f);
  }
  assert.match(readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8"), /<h1>월간 예약<\/h1>/);
});

// ───────── 슬롯(고정 자리) — docs/room-card-spec.md §11 ─────────
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]!);
const emptyCard = (slot: "top" | "who", withPeriod: boolean) =>
  renderToStaticMarkup(
    <RoomCardFacts slot={slot} rate={null} payText={null} tone="neutral" company={null} viewLabel="10/28" due={null} linkLabel={null} period={withPeriod ? "" : undefined} />,
  );

test("카드 · 슬롯: 어떤 내용이 들어가도 사실 줄 자리와 순서는 같아요 (전부 있음 · 회사 없음 · 결제 없음 · 받을 돈 없음 · 구성원 · 빈 값)", () => {
  const byId = (id: string) => CARD_CASES.find((c) => c.id === id)!;
  const sets = {
    전부있음: model(byId("C09"), "board"),
    회사없음: model(byId("C01"), "board"),
    결제없음: model(byId("C17"), "board"),
    받을돈없음: model(byId("C03"), "board"),
    구성원: model(byId("C11"), "board"),
  };
  assert.ok(sets.전부있음.company, "전부 있음: 회사가 있는 경우");
  assert.equal(sets.받을돈없음.due, 0);
  assert.ok(sets.구성원.isMember);
  for (const withPeriod of [true, false]) {
    const expected = [...slotsOf(emptyCard("top", withPeriod)), ...slotsOf(emptyCard("who", withPeriod))];
    assert.deepEqual(expected, [...(withPeriod ? ["period"] : []), "link", "pay", "due", "company", "rate"], "기준 순서: 기간(배치) → 연동 → 결제 → 받을 돈 | 회사 → 박당 요금");
    for (const [k, m] of Object.entries(sets)) {
      const got = [...slotsOf(renderRawFacts(m, "top", withPeriod)), ...slotsOf(renderRawFacts(m, "who", withPeriod))];
      assert.deepEqual(got, expected, `${k}: 자리가 늘거나 줄거나 바뀌지 않아요`);
    }
  }
  // 값이 없으면 자리는 비어 있을 뿐 (내용·글자 없음)
  assert.equal(text(emptyCard("top", true).replace(/<div[^>]*>/g, "").replace(/<\/div>/g, "")), "");
});

test("카드 · 슬롯: 현황 소스의 자리 순서와, 자리마다 고정 높이·행이 있고 합이 카드 높이 안이에요", () => {
  const src = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const ui = readFileSync(new URL("./ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /className="tl-row" data-slot="type"/);
  assert.equal((src.match(/data-slot="head"/g) ?? []).length, 1, "머리줄 자리: 빈 칸과 예약 칸이 같은 머리줄을 써요");
  const nowBody = src.slice(src.indexOf("const f = nowFlags(b, viewDate"));
  const order = (code: string, names: string[]) => {
    let from = 0;
    for (const n of names) {
      const i = code.slice(from).search(new RegExp(`data-slot="${n}"|slot="${n}"|factsEl\\("${n}"\\)`));
      assert.ok(i >= 0, `자리 없음 또는 순서 어긋남: ${n}`);
      from += i + 1;
    }
  };
  order(nowBody, ["period", "top", "name", "badges", "move", "who", "grp", "status"]);
  // CSS: 자리마다 grid-row가 있고, 높이 변수 합 + 위아래 여백 2×2 + 테두리가 카드 높이(--room-card-h) 안
  const vars = Object.fromEntries([...css.matchAll(/--rc-h-([a-z]+):\s*(\d+)px/g)].map((m) => [m[1]!, Number(m[2])]));
  const cardH = Number(/--room-card-h:\s*(\d+)px/.exec(css)![1]);
  const now13 = ["head", "type", "period", "link", "pay", "due", "name", "badges", "move", "co", "rate", "grp", "status"];
  for (const rows of [now13]) {
    const sum = rows.reduce((n, k) => n + vars[k]!, 0);
    assert.ok(sum + 4 + 3 <= cardH, `슬롯 높이 합 ${sum}px + 여백·테두리가 카드 ${cardH}px 안`);
  }
  for (const n of ["head", "type", "period", "link", "pay", "due", "name", "badges", "move", "company", "rate", "grp", "status"]) {
    assert.match(css, new RegExp(`\\.rc-grid > \\[data-slot="${n}"\\][^{]*\\{[^}]*grid-row:\\s*\\d+`), `${n} 자리 grid-row`);
  }
  assert.match(css, /\.rc-grid > \[data-slot="pay"\][^{]*\{[^}]*-webkit-line-clamp:\s*2/, "결제 줄은 두 줄까지");
});

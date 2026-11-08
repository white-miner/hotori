import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { url: "http://127.0.0.1/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

const { createElement, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { normalizeSettings } = await import("../shared/ledger.ts");
const { default: SmartRegister } = await import("./SmartRegister.tsx");

const FIRST = [
  "예약 번호",
  "1000000001",
  "확정된 예약",
  "투숙객",
  "Mina Park",
  "성인",
  "2명",
  "연락처",
  "010-0000-0000",
  "객실 종류 및 혜택",
  "1 X 스탠다드",
  "체크인",
  "2026년 11월 7일 16:00",
  "체크아웃",
  "2026년 11월 9일 12:00",
  "박수",
  "2",
  "기준 판매 요금(세금 및 수수료 포함)",
  "KRW 210,000",
].join("\n");

const SECOND = [
  "예약 번호",
  "2000000002",
  "확정된 예약",
  "투숙객",
  "Ari Stone",
  "성인",
  "3명",
  "연락처",
  "010-1111-2222",
  "객실 종류 및 혜택",
  "1 X 디럭스",
  "체크인",
  "2026년 12월 1일 15:00",
  "체크아웃",
  "2026년 12월 3일 11:00",
  "박수",
  "2",
  "기준 판매 요금(세금 및 수수료 포함)",
  "KRW 180,000",
].join("\n");

type Api = {
  refresh: () => void;
  emptyLate: () => void;
  failSave: { current: boolean };
  saves: { current: string[] };
  writes: { current: number };
};

let hostPlatformName = "아고다";
let hostPlatforms: { id: string; name: string; abbr: string }[] | null = null;

function Host() {
  const platformName = hostPlatformName;
  const platformId = platformName === "야놀자" ? "p-ya" : "p-ag";
  const [s, setS] = useState(() =>
    normalizeSettings({
      platforms: hostPlatforms ?? [{ id: platformId, name: platformName, abbr: platformName.slice(0, 1) }],
      types: [{ id: "std", name: "스탠다드" }, { id: "ondol", name: "온돌" }, { id: "dlx", name: "디럭스" }],
      stayTimes: { checkIn: "16:00", checkOut: "12:00" },
    }),
  );
  const failSave = useRef(true);
  const saves = useRef<string[]>([]);
  const writes = useRef(0);
  const api: Api = {
    refresh() {
      setS((cur) => normalizeSettings({ ...cur, pasteTemplates: cur.pasteTemplates.map((t) => ({ ...t, labels: { ...t.labels } })) }));
    },
    emptyLate() {
      setS((cur) => normalizeSettings({ ...cur, pasteTemplates: [] }));
    },
    failSave,
    saves,
    writes,
  };
  (dom.window as unknown as { __hotori: Api }).__hotori = api;
  return createElement(SmartRegister, {
    data: {
      bookings: [],
      async saveHotel(input: { settings?: { pasteTemplates?: unknown } }) {
        if (failSave.current) throw new Error("저장 실패");
        saves.current.push(JSON.stringify(input.settings?.pasteTemplates ?? []));
        setS(normalizeSettings(input.settings ?? {}));
      },
      async saveBooking() {
        writes.current += 1;
        return {};
      },
    },
    s,
    today: "2026-11-08",
    tabs: null,
    banner: null,
    notify: () => {},
    onOpenBooking: () => {},
  } as never);
}

function bridge() {
  return (dom.window as unknown as { __hotori: Api }).__hotori;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

function fieldButton(id: string) {
  const el = document.querySelector(`[data-field="${id}"]`);
  if (!el) throw new Error(`없는 칸 ${id}`);
  return el;
}

function lineButton(text: string, which = 0) {
  const found = [...document.querySelectorAll(".paste-template-values button")].filter((node) => node.querySelector("b")?.textContent === text);
  const el = found[which];
  if (!el) throw new Error(`없는 줄 ${text} #${which} :: ${[...document.querySelectorAll(".paste-template-values b")].map((n) => n.textContent).join(" | ")}`);
  return el;
}

async function pick(id: string, line: string, which = 0) {
  await click(fieldButton(id));
  await click(lineButton(line, which));
}

function fieldText() {
  return [...document.querySelectorAll("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.textContent?.replace(/\s+/g, " ").trim()}`).join("\n");
}

async function paste(text: string) {
  const area = document.querySelector("textarea");
  if (!area) throw new Error("붙여넣기 칸 없음");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("스마트등록 화면에서 항목을 순서대로 지정해도 인원과 이전 값이 남는다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  await paste(FIRST);

  await pick("guestName", "Mina Park");
  await act(async () => {
    bridge().emptyLate();
  });
  await act(async () => {
    bridge().refresh();
  });
  let shown = fieldText();
  assert.match(shown, /guestName:이름 · Mina Park/);

  await pick("guestPhone", "010-0000-0000");
  await pick("typeRaw", "1 X 스탠다드");
  await pick("checkIn", "2026년 11월 7일 16:00");
  await pick("nights", "2");
  await pick("salesTotal", "KRW 210,000");
  await pick("reservationId", "1000000001");
  await act(async () => {
    bridge().refresh();
  });
  shown = fieldText();
  for (const piece of [
    "guestName:이름 · Mina Park",
    "guestPhone:전화 · 010-0000-0000",
    "checkIn:입실 · 2026-11-07 16:00",
    "salesTotal:판매금 · KRW 210000",
    "reservationId:예약번호 · 1000000001",
  ]) {
    assert.ok(shown.includes(piece), `${piece}\n${shown}`);
  }

  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 버튼 없음");
  await click(save);
  assert.equal(bridge().saves.current.length, 0);
  assert.match(fieldText(), /guestName:이름 · Mina Park/);
  assert.match(fieldText(), /guestPhone:전화 · 010-0000-0000/);

  bridge().failSave.current = false;
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  assert.equal(stored.includes("010-0000-0000"), false);
  assert.equal(stored.includes("210000"), false);
  assert.equal(stored.includes("2명"), false);
  assert.match(stored, /투숙객/);
  assert.equal(bridge().writes.current, 0);

  const close = document.querySelector('[aria-label="닫기"]');
  if (!close) throw new Error("닫기 없음");
  await click(close);
  assert.equal(document.querySelector("[data-field]"), null);
  const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!reopen) throw new Error("다시 열기 없음");
  await click(reopen);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · Mina Park/);
  assert.match(shown, /reservationId:예약번호 · 1000000001/);

  await paste(SECOND);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · Ari Stone/);
  assert.match(shown, /guestPhone:전화 · 010-1111-2222/);
  assert.match(shown, /checkIn:입실 · 2026-12-01 15:00/);
  assert.match(shown, /salesTotal:판매금 · KRW 180000/);
  assert.match(shown, /reservationId:예약번호 · 2000000002/);
  assert.equal(bridge().writes.current, 0);

  await act(async () => {
    root.unmount();
  });
});

test("이름 칸에서 한글 이름 줄을 누르면 그 이름이 들어간다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!open) throw new Error("양식 설정 없음");
    await click(open);
    await paste(["투숙객", "김민수", "성인 2명", "체크인", "2026년 12월 1일", "체크아웃", "2026년 12월 3일"].join("\n"));
    await pick("guestName", "김민수");
    assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
    assert.equal(document.body.textContent?.includes("이 값의 칸 이름"), false);
    assert.match(fieldText(), /guestName:이름 · 김민수/);
    assert.equal(bridge().saves.current.length, 0);
    assert.equal(bridge().writes.current, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("한글 이름과 객실명은 위 칸 이름으로 연결되고 다음 글의 값으로 바뀐다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  const text = [
    "예약 번호",
    "HOTORI-UI-TEST-20261108",
    "투숙객 이름",
    "테스트손님",
    "성인",
    "2",
    "체크인",
    "2026년 12월 1일 (16:00)",
    "체크아웃",
    "2026년 12월 3일 (11:00)",
    "기준 판매 요금",
    "KRW 180,000",
    "객실 종류 및 혜택",
    "테스트 객실",
  ].join("\n");
  await paste(text);
  await pick("guestName", "테스트손님");
  await pick("typeRaw", "테스트 객실");
  await pick("salesTotal", "KRW 180,000");
  await pick("checkIn", "2026년 12월 1일 (16:00)");
  let shown = fieldText();
  assert.match(shown, /guestName:이름 · 테스트손님/);
  assert.match(shown, /typeRaw:타입 · 테스트 객실/);
  assert.match(shown, /checkIn:입실 · 2026-12-01 16:00/);
  assert.match(shown, /salesTotal:판매금 · KRW 180000/);
  assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
  bridge().failSave.current = false;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 버튼 없음");
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("테스트손님"), false);
  assert.equal(stored.includes("테스트 객실"), false);
  assert.match(stored, /투숙객 이름/);
  assert.match(stored, /객실 종류 및 혜택/);
  const next = text.replace("테스트손님", "다른손님").replace("테스트 객실", "다른 객실").replace("HOTORI-UI-TEST-20261108", "HOTORI-UI-TEST-NEXT").replace("180,000", "90,000").replace("성인\n2", "성인\n5");
  await paste(next);
  shown = fieldText();
  assert.match(shown, /guestName:이름 · 다른손님/);
  assert.match(shown, /typeRaw:타입 · 다른 객실/);
  assert.match(shown, /salesTotal:판매금 · KRW 90000/);
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("같은 줄의 일부 선택과 반복된 2는 고른 칸만 연결하고 다음 선택을 덮지 않는다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  const text = ["예약자: 홍길동", "객실 종류: 디럭스 더블", "도착일: 2026-12-05", "판매가: KRW 90,000", "숙박 기간: 2", "성인: 2"].join("\n");
  await paste(text);
  const area = document.querySelector(".paste-template-sample textarea") as HTMLTextAreaElement;
  const select = async (needle: string, which: number) => {
    let from = 0;
    let at = -1;
    for (let n = 0; n <= which; n++) {
      at = area.value.indexOf(needle, from);
      from = at + needle.length;
    }
    area.focus();
    area.setSelectionRange(at, at + needle.length);
    area.dispatchEvent(new dom.window.Event("select", { bubbles: true }));
    area.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  };
  const down = async (field: string) => {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el) throw new Error(field);
    await act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
  };
  await select("홍길동", 0);
  await down("guestName");
  const adultMark = area.value.lastIndexOf("성인: ");
  area.focus();
  area.setSelectionRange(adultMark + "성인: ".length, adultMark + "성인: ".length + 1);
  area.dispatchEvent(new dom.window.Event("select", { bubbles: true }));
  area.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  await down("nights");
  await down("typeRaw");
  let shown = fieldText();
  assert.match(shown, /guestName:이름 · 홍길동/);
  assert.match(shown, /nights:박수 · 2/);
  assert.equal(shown.includes("typeRaw:타입 ·"), false);
  await select("디럭스 더블", 0);
  const typeBtn = document.querySelector('[data-field="typeRaw"]');
  if (!typeBtn) throw new Error("타입 없음");
  await act(async () => {
    typeBtn.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await pick("checkIn", "2026-12-05");
  await pick("salesTotal", "KRW 90,000");
  shown = fieldText();
  assert.match(shown, /typeRaw:타입 · 디럭스 더블/);
  assert.match(shown, /checkIn:입실 · 2026-12-05/);
  assert.match(shown, /salesTotal:판매금 · KRW 90000/);
  bridge().failSave.current = true;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 없음");
  await click(save);
  assert.match(fieldText(), /guestName:이름 · 홍길동/);
  bridge().failSave.current = false;
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("홍길동"), false);
  assert.equal(stored.includes("디럭스"), false);
  const close = document.querySelector('[aria-label="닫기"]');
  if (!close) throw new Error("닫기 없음");
  await click(close);
  const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!reopen) throw new Error("다시 열기 없음");
  await click(reopen);
  await paste(["예약자: 김테스트", "객실 종류: 온돌", "도착일: 2027-03-09", "판매가: KRW 70,000", "성인: 4"].join("\n"));
  shown = fieldText();
  assert.match(shown, /guestName:이름 · 김테스트/);
  assert.match(shown, /typeRaw:타입 · 온돌/);
  assert.match(shown, /checkIn:입실 · 2027-03-09/);
  assert.match(shown, /salesTotal:판매금 · KRW 70000/);
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("야놀자 카드의 한글 이름을 이름 칸에 지정하면 다음 카드의 다른 이름으로 바뀐다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  hostPlatformName = "야놀자";
  await act(async () => {
    root.render(createElement(Host));
  });
  hostPlatformName = "아고다";
  const card = (name: string, id: string, when: string) =>
    [id, name, "0503-0000-0001", "온돌", "숙박", "/ 1박", when, "2026.12.10(목) 11:00", "예약완료", "판매가 90,000원"].join("\n");
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 버튼 없음");
  await click(open);
  await paste(card("김민수", "2610151829300184", "2026.12.01(화) 16:00"));
  await click(lineButton("김민수"));
  assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
  assert.match(fieldText(), /guestName:이름 · 김민수/);
  bridge().failSave.current = false;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 없음");
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("김민수"), false);
  assert.match(stored, /예약자/);
  await paste(card("이수진", "2610152133600141", "2026.12.05(토) 16:00"));
  assert.match(fieldText(), /guestName:이름 · 이수진/);
  const previewName = document.querySelector('[aria-label="이름"]') as HTMLInputElement | null;
  assert.equal(previewName?.value, "이수진");
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("아고다 요약과 상세에 같은 칸 이름이 반복돼도 양식을 저장한다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Host));
  });
  const agoda = (name: string, id: string, adults: string, nights: string, checkIn: string, checkOut: string, money: string) =>
    [
      "예약 번호:",
      id,
      "확정된 예약",
      "투숙객",
      name,
      `성인 ${adults}명`,
      "체크인",
      checkIn,
      "(16:00)",
      "체크아웃",
      checkOut,
      "(12:00)",
      "기준 판매 요금(세금 및 수수료 포함)",
      money,
      "투숙객 세부 사항 및 날짜 정보",
      "예약 번호",
      id,
      "투숙객 이름",
      name,
      "체크인",
      `${checkIn} 토요일, 16:00`,
      "체크아웃",
      `${checkOut} 월요일, 12:00`,
      "객실 종류 및 혜택",
      "1 X 스탠다드",
      "숙박 기간",
      nights,
      "성인",
      adults,
    ].join("\n");
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 없음");
  await click(open);
  await paste(agoda("Mina Park", "1000000001", "2", "2", "2026년 11월 7일", "2026년 11월 9일", "KRW 210,000"));
  await pick("reservationId", "1000000001", 0);
  await pick("guestName", "Mina Park", 0);
  await pick("nights", "2", 0);
  await pick("typeRaw", "1 X 스탠다드");
  await pick("checkIn", "2026년 11월 7일");
  await pick("salesTotal", "KRW 210,000");
  assert.equal(document.body.textContent?.includes("같은 글자가 두 칸에 있어요"), false);
  assert.match(fieldText(), /guestName:이름 · Mina Park/);
  assert.match(fieldText(), /nights:박수 · 2/);
  bridge().failSave.current = false;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 없음");
  await click(save);
  assert.equal(document.body.textContent?.includes("같은 글자가 두 칸에 있어요"), false);
  const stored = bridge().saves.current.at(-1) ?? "";
  assert.equal(stored.includes("Mina Park"), false);
  assert.equal(stored.includes("1000000001"), false);
  assert.match(stored, /투숙객/);
  await paste(agoda("Ari Stone", "2000000002", "4", "3", "2026년 12월 1일", "2026년 12월 4일", "KRW 180,000"));
  assert.match(fieldText(), /guestName:이름 · Ari Stone/);
  assert.match(fieldText(), /nights:박수 · 3/);
  const name = document.querySelector('[aria-label="이름"]') as HTMLInputElement | null;
  assert.equal(name?.value, "Ari Stone");
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("야놀자 카드 스캔이 읽은 칸은 양식에서 지정하고 다음 카드 값으로 바뀐다", async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  hostPlatformName = "야놀자";
  await act(async () => {
    root.render(createElement(Host));
  });
  hostPlatformName = "아고다";
  const card = (opts: { id: string; name: string; phone: string; type: string; nights: string; checkIn: string; checkOut: string; status: string; amount: string }) =>
    [opts.id, opts.name, opts.phone, opts.type, "숙박", `/ ${opts.nights}박`, opts.checkIn, opts.checkOut, opts.status, `판매가 ${opts.amount}원`].join("\n");
  const first = card({
    id: "2610151829300184",
    name: "김민수",
    phone: "0503-0000-0001",
    type: "온돌",
    nights: "2",
    checkIn: "2026.12.01(화) 16:00",
    checkOut: "2026.12.03(목) 11:00",
    status: "예약완료",
    amount: "90,000",
  });
  const second = card({
    id: "2610152133600141",
    name: "이수진",
    phone: "0503-0000-0002",
    type: "디럭스",
    nights: "3",
    checkIn: "2026.12.05(토) 15:00",
    checkOut: "2026.12.08(화) 11:00",
    status: "예약취소",
    amount: "80,000",
  });
  const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!open) throw new Error("양식 설정 없음");
  await click(open);
  await paste(first);
  await pick("reservationId", "2610151829300184");
  await pick("guestName", "김민수");
  await pick("guestPhone", "0503-0000-0001");
  await pick("typeRaw", "온돌");
  await pick("nights", "/ 2박");
  await pick("checkIn", "2026.12.01(화) 16:00");
  await pick("salesTotal", "판매가 90,000원");
  assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
  const shown = fieldText();
  assert.match(shown, /reservationId:예약번호 · 2610151829300184/);
  assert.match(shown, /guestName:이름 · 김민수/);
  assert.match(shown, /guestPhone:전화 · 0503-0000-0001/);
  assert.match(shown, /typeRaw:타입 · 온돌/);
  assert.match(shown, /nights:박수 · 2/);
  assert.match(shown, /checkIn:입실 · 2026\.12\.01/);
  assert.match(shown, /salesTotal:판매금 · 90000/);
  assert.equal(/adults:인원 · \d/.test(shown), false);
  assert.equal(/currency:통화 · [A-Z]{3}/.test(shown), false);
  assert.equal(/checkInTime:입실 시각 · \d/.test(shown), false);
  bridge().failSave.current = false;
  const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
  if (!save) throw new Error("저장 없음");
  await click(save);
  const stored = bridge().saves.current.at(-1) ?? "";
  for (const secret of ["김민수", "0503-0000-0001", "2610151829300184", "90000", "90,000"]) {
    assert.equal(stored.includes(secret), false, secret);
  }
  const close = document.querySelector('[aria-label="닫기"]');
  if (!close) throw new Error("닫기 없음");
  await click(close);
  const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
  if (!reopen) throw new Error("다시 열기 없음");
  await click(reopen);
  await paste(second);
  const next = fieldText();
  assert.match(next, /reservationId:예약번호 · 2610152133600141/);
  assert.match(next, /guestName:이름 · 이수진/);
  assert.match(next, /guestPhone:전화 · 0503-0000-0002/);
  assert.match(next, /typeRaw:타입 · 디럭스/);
  assert.match(next, /nights:박수 · 3/);
  assert.match(next, /checkIn:입실 · 2026\.12\.05/);
  assert.match(next, /salesTotal:판매금 · 80000/);
  const previewName = document.querySelector('[aria-label="이름"]') as HTMLInputElement | null;
  const previewPhone = document.querySelector('[aria-label="전화"]') as HTMLInputElement | null;
  const previewIn = document.querySelector('[aria-label="입실"]') as HTMLInputElement | null;
  const previewNights = document.querySelector('[aria-label="박수"]') as HTMLInputElement | null;
  const previewAmount = document.querySelector('[aria-label="판매금"]') as HTMLInputElement | null;
  assert.equal(previewName?.value, "이수진");
  assert.equal(previewPhone?.value, "0503-0000-0002");
  assert.equal(previewIn?.value, "2026-12-05");
  assert.equal(previewNights?.value, "3");
  assert.equal(previewAmount?.value, "80000");
  assert.equal(document.body.textContent?.includes("2610152133600141"), true);
  const nightInputs = [...document.querySelectorAll('[aria-label$="1박 요금"]')] as HTMLInputElement[];
  assert.equal(nightInputs.every((input) => input.value === ""), true);
  assert.equal(bridge().writes.current, 0);
  await act(async () => {
    root.unmount();
  });
});

test("5글자 한글 이름은 야놀자 카드에서 전화로 밀리지 않고 이름 칸에 붙는다", async () => {
  hostPlatformName = "야놀자";
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    const text = [
      "2610151829300184",
      "가상손님가",
      "0503-0000-0001",
      "온돌",
      "숙박",
      "/ 1박",
      "2026.12.01(화) 16:00",
      "2026.12.02(수) 12:00",
      "예약완료",
      "판매가 90,000원",
    ].join("\n");
    const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!open) throw new Error("양식 설정 없음");
    await click(open);
    await paste(text);
    await click(lineButton("가상손님가"));
    assert.equal(document.body.textContent?.includes("칸 이름이 없어요"), false);
    assert.match(fieldText(), /guestName:이름 · 가상손님가/);
    const previewName = document.querySelector('[aria-label="이름"]') as HTMLInputElement | null;
    assert.equal(previewName?.value, "가상손님가");
    const previewPhone = document.querySelector('[aria-label="전화"]') as HTMLInputElement | null;
    assert.equal(previewPhone?.value, "0503-0000-0001");
    assert.equal(bridge().writes.current, 0);
    assert.equal(bridge().saves.current.length, 0);
  } finally {
    hostPlatformName = "아고다";
    await act(async () => {
      root.unmount();
    });
  }
});

test("저장하지 않고 양식 창을 닫아도 보고 있던 플랫폼의 지정이 남는다", async () => {
  hostPlatforms = [
    { id: "p-ya", name: "야놀자", abbr: "야" },
    { id: "p-ag", name: "아고다", abbr: "아" },
  ];
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    const text = [
      "예약 번호",
      "2000000002",
      "투숙객 이름",
      "Ari Stone",
      "성인",
      "4",
      "객실 종류 및 혜택",
      "Deluxe Twin",
      "체크인",
      "2026년 12월 1일 15:00",
      "체크아웃",
      "2026년 12월 3일 11:00",
      "기준 판매 요금(세금 및 수수료 포함)",
      "KRW 180,000",
    ].join("\n");
    const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!open) throw new Error("양식 설정 없음");
    await click(open);
    const agoda = [...document.querySelectorAll("button.chip")].find((el) => el.textContent?.trim() === "아고다");
    if (!agoda) throw new Error("아고다 칩 없음");
    await click(agoda);
    await paste(text);
    await pick("guestName", "Ari Stone");
    await pick("typeRaw", "Deluxe Twin");
    await pick("checkIn", "2026년 12월 1일 15:00");
    await pick("salesTotal", "KRW 180,000");
    assert.match(fieldText(), /guestName:이름 · Ari Stone/);
    assert.match(fieldText(), /typeRaw:타입 · Deluxe Twin/);
    assert.match(fieldText(), /checkIn:입실 · 2026-12-01 15:00/);
    assert.match(fieldText(), /salesTotal:판매금 · KRW 180000/);
    const close = document.querySelector('[aria-label="닫기"]');
    if (!close) throw new Error("닫기 없음");
    await click(close);
    assert.equal(document.querySelector("[data-field]"), null);
    const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!reopen) throw new Error("다시 열기 없음");
    await click(reopen);
    const dialog = document.querySelector('[aria-labelledby="paste-template-title"]');
    if (!dialog) throw new Error("양식 창 없음");
    const selected = [...dialog.querySelectorAll("button.chip.on")].map((el) => el.textContent?.trim());
    assert.deepEqual(selected, ["아고다"]);
    const again = fieldText();
    assert.match(again, /guestName:이름 · Ari Stone/);
    assert.match(again, /typeRaw:타입 · Deluxe Twin/);
    assert.match(again, /checkIn:입실 · 2026-12-01 15:00/);
    assert.match(again, /salesTotal:판매금 · KRW 180000/);
    const area = document.querySelector(".paste-template-sample textarea") as HTMLTextAreaElement | null;
    assert.equal(area?.value.includes("Ari Stone"), true);
    assert.equal(area?.value.includes("Deluxe Twin"), true);
    assert.equal(bridge().saves.current.length, 0);
    assert.equal(bridge().writes.current, 0);
  } finally {
    hostPlatforms = null;
    await act(async () => {
      root.unmount();
    });
  }
});

test("아고다 화면 전체 복사로 양식을 등록하면 다음 예약도 같은 방식으로 읽는다", async () => {
  const { AGODA_FULL_A, AGODA_FULL_B, agodaFullText } = await import("../shared/testFixtures/agodaPartnerFull.ts");
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  const noisy = ["번째 값이 없어요", "다른 위치 값이 달라", "하나로 정할 수 없어요", "글자가 서로 달라", "칸 이름이 없어요", "같은 글자가 두 칸에 있어요"];
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    const open = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!open) throw new Error("양식 설정 없음");
    await click(open);
    await paste(agodaFullText(AGODA_FULL_A));
    const offered = [...document.querySelectorAll(".paste-template-values b")].map((n) => n.textContent);
    for (const heading of ["투숙객 세부 사항 및 날짜 정보", "예약 번호:", "결제 및 요금", "연락처 정보"]) {
      assert.equal(offered.includes(heading), false, heading);
    }
    await pick("reservationId", "1000000001");
    await pick("guestName", "Mina Park", 1);
    await pick("typeRaw", AGODA_FULL_A.room);
    await pick("checkIn", "2026년 11월 7일 토요일, 16:00");
    await pick("nights", "2");
    await pick("salesTotal", "KRW 210,000");
    const shown = fieldText();
    for (const piece of [
      "reservationId:예약번호 · 1000000001",
      "guestName:이름 · Mina Park",
      `typeRaw:타입 · ${AGODA_FULL_A.room}`,
      "checkIn:입실 · 2026-11-07 16:00",
      "nights:박수 · 2",
      "salesTotal:판매금 · KRW 210000",
    ]) {
      assert.ok(shown.includes(piece), `${piece}\n${shown}`);
    }
    for (const msg of noisy) assert.equal(document.body.textContent?.includes(msg), false, msg);

    bridge().failSave.current = false;
    const save = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "계정에 저장");
    if (!save) throw new Error("저장 없음");
    await click(save);
    const stored = bridge().saves.current.at(-1) ?? "";
    for (const secret of ["Mina Park", "1000000001", "210,000", "210000", "1000000999"]) assert.equal(stored.includes(secret), false, secret);
    assert.match(stored, /투숙객 이름/);
    assert.match(stored, /숙박 기간/);

    const close = document.querySelector('[aria-label="닫기"]');
    if (!close) throw new Error("닫기 없음");
    await click(close);
    const reopen = [...document.querySelectorAll("button")].find((el) => el.textContent?.includes("양식 설정"));
    if (!reopen) throw new Error("다시 열기 없음");
    await click(reopen);
    await paste(agodaFullText(AGODA_FULL_B));
    const next = fieldText();
    for (const piece of [
      "reservationId:예약번호 · 2000000002",
      "guestName:이름 · Ari Stone",
      `typeRaw:타입 · ${AGODA_FULL_B.room}`,
      "checkIn:입실 · 2026-12-01 16:00",
      "nights:박수 · 3",
      "salesTotal:판매금 · KRW 330000",
    ]) {
      assert.ok(next.includes(piece), `${piece}\n${next}`);
    }
    const value = (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null)?.value;
    assert.equal(value("이름"), "Ari Stone");
    assert.equal(value("입실"), "2026-12-01");
    assert.equal(value("박수"), "3");
    assert.equal(value("판매금"), "330000");
    assert.equal(value("전화"), "");
    for (const msg of noisy) assert.equal(document.body.textContent?.includes(msg), false, msg);
    assert.equal(document.body.textContent?.includes("Mina Park"), false);
    assert.equal(bridge().writes.current, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

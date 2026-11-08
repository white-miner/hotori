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
const { ConfirmHost } = await import("./ConfirmDialog.tsx");

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
  notes: { current: string[] };
  settings: () => unknown;
};

let hostPlatformName = "아고다";
let hostPlatforms: { id: string; name: string; abbr: string }[] | null = null;
let hostTemplates: unknown[] = [];

function Host() {
  const platformName = hostPlatformName;
  const platformId = platformName === "야놀자" ? "p-ya" : "p-ag";
  const [s, setS] = useState(() =>
    normalizeSettings({
      platforms: hostPlatforms ?? [{ id: platformId, name: platformName, abbr: platformName.slice(0, 1) }],
      types: [{ id: "std", name: "스탠다드" }, { id: "ondol", name: "온돌" }, { id: "dlx", name: "디럭스" }],
      stayTimes: { checkIn: "16:00", checkOut: "12:00" },
      pasteTemplates: hostTemplates,
    }),
  );
  const failSave = useRef(true);
  const saves = useRef<string[]>([]);
  const writes = useRef(0);
  const notes = useRef<string[]>([]);
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
    notes,
    settings: () => s,
  };
  (dom.window as unknown as { __hotori: Api }).__hotori = api;
  const page = createElement(SmartRegister, {
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
    notify: (m: string) => notes.current.push(m),
    onOpenBooking: () => {},
  } as never);
  return createElement("div", null, page, createElement(ConfirmHost));
}

function bridge() {
  return (dom.window as unknown as { __hotori: Api }).__hotori;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
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

test("박별 요금을 입력하는 중에 호텔 설정이 다시 불러와져도 입력한 값이 남는다", async () => {
  const { AGODA_FULL_A, agodaFullText } = await import("../shared/testFixtures/agodaPartnerFull.ts");
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    await paste(agodaFullText(AGODA_FULL_A));
    const nights = () => [...document.querySelectorAll('[aria-label$="1박 요금"]')] as HTMLInputElement[];
    const type = async (el: HTMLInputElement, v: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(el, v);
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    assert.equal(nights().length, 2);
    await type(nights()[0]!, "100000");
    await act(async () => {
      bridge().refresh();
    });
    await type(nights()[1]!, "110000");
    await act(async () => {
      bridge().refresh();
    });
    assert.deepEqual(nights().map((el) => el.value), ["100000", "110000"]);
    assert.equal((document.querySelector('[aria-label="이름"]') as HTMLInputElement | null)?.value, "Mina Park");
    assert.equal((document.querySelector("textarea") as HTMLTextAreaElement | null)?.value.includes("Mina Park"), true);
    assert.equal(bridge().writes.current, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

/** 브라우저 자동 번역 화면으로 등록돼 운영 호텔에 남아 있던 아고다 양식(칸 이름만, 손님 값 없음). */
const TRANSLATED_AGODA_TEMPLATE = {
  platformId: "p3",
  profileId: "agoda",
  version: 1,
  labels: {
    adults: "성인",
    nights: "체류 기간",
    checkIn: "체크인",
    typeRaw: "객실 유형 및 혜택",
    checkOut: "점검",
    guestName: "손님",
    salesTotal: "참조 판매 포함",
    checkInTime: "체크인",
    checkOutTime: "점검",
    reservationId: "투숙객 정보 및 날짜",
  },
  rules: {
    adults: { label: "성인", occurrence: 0 },
    nights: { label: "체류 기간", occurrence: 0 },
    checkIn: { label: "체크인", occurrence: 0 },
    typeRaw: { label: "객실 유형 및 혜택", occurrence: 0 },
    checkOut: { label: "점검", occurrence: 0 },
    guestName: { label: "손님", occurrence: 0 },
    salesTotal: { label: "참조 판매 포함", occurrence: 0 },
    checkInTime: { label: "체크인", occurrence: 1 },
    checkOutTime: { label: "점검", occurrence: 1 },
    reservationId: { label: "투숙객 정보 및 날짜", occurrence: 0 },
  },
};

async function previewPick(field: string, text: string) {
  const box = document.querySelector(`[data-pick="${field}"]`);
  if (!box) throw new Error(`원문에서 고르기 없음 ${field}`);
  await click(box.querySelector("button")!);
  const item = [...box.querySelectorAll(".smart-reg-pick-item")].find((el) => el.textContent?.includes(text));
  if (!item) throw new Error(`${field} 후보 없음 ${text} :: ${[...box.querySelectorAll(".smart-reg-pick-item")].map((el) => el.textContent).join(" | ")}`);
  await click(item);
}

function chip(text: string) {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`칩 없음 ${text}`);
  return el;
}

test("처음 보는 플랫폼: 미리보기에서 원문 값을 한 번 고르면 다음 예약부터 칸 이름으로 읽고 업로드도 막히지 않는다", async () => {
  const { UNKNOWN_LABELS_A, UNKNOWN_LABELS_B } = await import("../shared/testFixtures/otherPlatforms.ts");
  hostPlatforms = [
    { id: "p3", name: "아고다", abbr: "아" },
    { id: "p-x", name: "동네예약", abbr: "동" },
  ];
  hostTemplates = [TRANSLATED_AGODA_TEMPLATE];
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  const value = (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null)?.value;
  const rid = () => document.querySelector(".smart-reg-rid")?.textContent;
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    bridge().failSave.current = false;
    await paste(UNKNOWN_LABELS_A);
    assert.equal(value("입실"), "2026-11-07", "공용 칸 이름으로 입실");
    assert.equal(value("판매금"), "210000");
    assert.equal(value("이름"), "");
    assert.ok(document.body.textContent?.includes("어느 플랫폼 예약인가요?"));
    await click(chip("동네예약"));

    await previewPick("guestName", "Mina Park");
    await previewPick("reservationId", "ZX1000000001");
    assert.equal(value("이름"), "Mina Park");
    assert.equal(rid(), "ZX1000000001");
    assert.equal(value("입실"), "2026-11-07", "고른 뒤에도 다른 칸은 그대로");

    const stored = bridge().saves.current.at(-1) ?? "";
    assert.match(stored, /"platformId":"p-x"/);
    assert.match(stored, /방문자/);
    assert.match(stored, /주문 코드/);
    assert.equal(stored.includes("Mina Park"), false);
    assert.equal(stored.includes("ZX1000000001"), false);
    assert.equal(stored.includes("p3") && !stored.includes("손님"), false, "아고다 양식은 그대로");

    const upload = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("확인 업로드"))!;
    assert.equal((upload as HTMLButtonElement).disabled, false);
    await act(async () => {
      const sel = document.querySelector('[aria-label="타입"]') as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set?.call(sel, "std");
      sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await click(upload);
    assert.equal(bridge().notes.current.some((m) => m.includes("설정에 맞는 플랫폼이 없어요")), false, bridge().notes.current.join("\n"));
    assert.ok(document.querySelector(".modal"), "업로드 확인창이 열린다");
    const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "취소")!;
    await click(cancel);

    const main = document.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set?.call(main, UNKNOWN_LABELS_B);
      main.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(value("이름"), "Ari Stone", "다음 예약 이름");
    assert.equal(rid(), "ZX2000000002", "다음 예약번호");
    assert.equal(value("입실"), "2026-12-01");
    assert.equal(value("박수"), "3");
    const active = [...document.querySelectorAll(".smart-reg-chip-block button.on")].map((b) => b.textContent?.trim());
    assert.deepEqual(active, ["동네예약"], "배운 칸 이름으로 플랫폼을 다시 고르지 않는다");
    assert.equal(bridge().writes.current, 0);
  } finally {
    hostPlatforms = null;
    hostTemplates = [];
    await act(async () => {
      root.unmount();
    });
  }
});

test("예전 번역 화면 아고다 양식이 있어도 한국어·영어·번역 화면을 읽고, 잘못 배운 칸 이름은 목록에서 지운다", async () => {
  const { AGODA_FULL_A, AGODA_FULL_B, agodaScreenText } = await import("../shared/testFixtures/agodaPartnerFull.ts");
  hostPlatforms = [
    { id: "p1", name: "야놀자", abbr: "야" },
    { id: "p3", name: "아고다", abbr: "아" },
  ];
  hostTemplates = [TRANSLATED_AGODA_TEMPLATE];
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  const value = (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null)?.value;
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    bridge().failSave.current = false;
    for (const [lang, s, name, id, checkIn] of [
      ["ko", AGODA_FULL_A, "Mina Park", "1000000001", "2026-11-07"],
      ["en", AGODA_FULL_B, "Ari Stone", "2000000002", "2026-12-01"],
      ["ko-translated", AGODA_FULL_A, "Mina Park", "1000000001", "2026-11-07"],
    ] as const) {
      await paste(agodaScreenText(s, lang));
      assert.equal(value("이름"), name, `${lang} 이름`);
      assert.equal(value("입실"), checkIn, `${lang} 입실`);
      assert.equal(document.querySelector(".smart-reg-rid")?.textContent, id, `${lang} 예약번호`);
      assert.equal(document.querySelector('[data-pick="guestName"]'), null, "읽은 칸에는 고르기를 보이지 않는다");
    }
    assert.equal([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("양식 설정")), false);

    await click(chip("배운 칸 이름"));
    const row = document.querySelector('[data-learned="p3:reservationId"]');
    assert.ok(row?.textContent?.includes("투숙객 정보 및 날짜"));
    await click(row!.querySelector("button")!);
    const stored = bridge().saves.current.at(-1) ?? "";
    assert.equal(stored.includes("투숙객 정보 및 날짜"), false, "지운 칸 이름");
    assert.match(stored, /"guestName":"손님"/, "다른 칸 이름은 남는다");
    assert.equal(document.querySelector('[data-learned="p3:reservationId"]'), null);
    await click(document.querySelector('[aria-label="닫기"]')!);
    assert.equal(document.querySelector(".smart-reg-rid")?.textContent, "1000000001", "지운 뒤에도 기본 판독으로 읽는다");
    assert.equal(bridge().writes.current, 0);
  } finally {
    hostPlatforms = null;
    hostTemplates = [];
    await act(async () => {
      root.unmount();
    });
  }
});

test("아무것도 못 읽은 글: 플랫폼과 원문 값을 고르면 칸 이름만 저장하고 미리보기가 나온다", async () => {
  const TEXT_A = ["주문 코드", "QQ1000000001", "방문자", "Mina Park", "도착", "2026-11-07", "도착 시간", "15:00", "출발", "2026-11-09", "요금 합계", "KRW 210,000"].join("\n");
  const TEXT_B = ["주문 코드", "QQ2000000002", "방문자", "Ari Stone", "도착", "2026-12-01", "도착 시간", "14:00", "출발", "2026-12-04", "요금 합계", "KRW 330,000"].join("\n");
  hostPlatforms = [
    { id: "p3", name: "아고다", abbr: "아" },
    { id: "p-x", name: "동네예약", abbr: "동" },
  ];
  hostTemplates = [];
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("root 없음");
  const root = createRoot(rootEl);
  const value = (label: string) => (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null)?.value;
  const teachPick = async (field: string, text: string) => {
    const box = document.querySelector(`[data-teach="${field}"]`);
    if (!box) throw new Error(`칸 고르기 없음 ${field}`);
    await click(box.querySelector(".smart-reg-pick-toggle")!);
    const item = [...box.querySelectorAll(".smart-reg-pick-item")].find((el) => el.textContent?.includes(text));
    if (!item) throw new Error(`${field} 후보 없음 ${text} :: ${[...box.querySelectorAll(".smart-reg-pick-item")].map((el) => el.textContent).join(" | ")}`);
    await click(item);
  };
  try {
    await act(async () => {
      root.render(createElement(Host));
    });
    bridge().failSave.current = false;
    await paste(TEXT_A);
    assert.equal(document.querySelectorAll(".smart-reg-table tbody tr td input").length, 0, "처음에는 못 읽는다");
    assert.ok(document.querySelector('[aria-label="칸 고르기"]'));
    assert.ok((document.querySelector('[data-teach="reservationId"] .smart-reg-pick-toggle') as HTMLButtonElement).disabled, "플랫폼부터");
    await click(chip("동네예약"));
    await teachPick("reservationId", "QQ1000000001");
    await teachPick("checkIn", "2026-11-07");
    if (document.querySelector('[data-teach="checkOut"]')) await teachPick("checkOut", "2026-11-09");
    else await previewPick("checkOut", "2026-11-09");
    assert.equal(document.querySelector(".smart-reg-rid")?.textContent, "QQ1000000001", "미리보기가 나온다");
    assert.equal(value("입실"), "2026-11-07");
    assert.equal(value("박수"), "2");
    if (!value("이름")) await previewPick("guestName", "Mina Park");
    if (!value("판매금")) await previewPick("salesTotal", "KRW 210,000");
    assert.equal(value("판매금"), "210000");
    const timePick = document.querySelector('[data-pick="checkInTime"]');
    assert.ok(timePick, "입실 시각 고르기");
    await previewPick("checkInTime", "15:00");
    assert.ok(document.body.textContent?.includes("입실 15:00"));

    const stored = bridge().saves.current.at(-1) ?? "";
    for (const label of ["주문 코드", "도착", "출발", "요금 합계", "도착 시간"]) assert.ok(stored.includes(label), `${label} 저장 :: ${stored}`);
    for (const v of ["QQ1000000001", "Mina Park", "2026-11-07", "210,000"]) assert.equal(stored.includes(v), false, `손님 값 ${v}`);

    await paste(TEXT_B);
    assert.equal(document.querySelector(".smart-reg-rid")?.textContent, "QQ2000000002");
    assert.equal(value("이름"), "Ari Stone");
    assert.equal(value("입실"), "2026-12-01");
    assert.equal(value("박수"), "3");
    assert.equal(value("판매금"), "330000");
    assert.ok(document.body.textContent?.includes("입실 14:00"));
    assert.deepEqual([...document.querySelectorAll(".smart-reg-chip-block button.on")].map((b) => b.textContent?.trim()), ["동네예약"]);
    assert.equal(bridge().writes.current, 0);
  } finally {
    hostPlatforms = null;
    hostTemplates = [];
    await act(async () => {
      root.unmount();
    });
  }
});

import { EXPENSE_CATEGORY_MAX } from "../shared/expense";
import { pastelColor, strongColor } from "../shared/floorColor";
import { isOnsite } from "../shared/payment";
import { GUESTS_MAX, tierLabel, typeGuests } from "../shared/surcharge";
import { SpecialDates, TierSettings } from "./SurchargeSettings";
import FeeSettings from "./FeeSettings";
import NumInput from "./NumInput";
import type { ToastOpt } from "./App";
import { applyType, bulkToast, floorAllSelected, pickRoom, toggleFloor, undoType } from "../shared/bulktype";
import { guestRangeMsg } from "../shared/numdraft";
import { PRESETS as PLAT_PRESETS, defaultPlatformColor, paint as platPaint } from "../shared/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Building2, CheckSquare, Copy, Eye, EyeOff, Link2, Minus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { Building, Floor, HotelSettings, Room } from "../shared/ledger";
import {
  FREE_SHOP_ITEM_LIMIT,
  SHOP_CATEGORY_MAX,
  SHOP_NAME_MAX,
  TYPE_NAME_MAX,
  addRoomsToFloor,
  businessDate,
  buildingName,
  defaultBuildingName,
  floorsOf,
  addFloorOnTop,
  isMultiBuilding,
  moveFloor,
  parseRoomInput,
  removeBuilding,
  typeLabel,
  typeTotals,
  usableTypes,
} from "../shared/ledger";
import { type HotelData, type ShareState, hasShopSales, shareCreate, shareDisable, shareStatus, shareUrl } from "./data";
import { canAddShopItem, makeShopItem } from "../shared/shop";
import { FitText, PALETTE, PlatBadge, floorPaint, TypeBadge, TypeLine, uid } from "./ui";

interface Props {
  data: HotelData;
  email: string;
  notify: (m: string, opt?: ToastOpt) => void;
}
/** 받침이 있으면 a(과·은·이), 없으면 b(와·는·가) */
const josa = (w: string, a: string, b: string) => {
  const c = w.trim().slice(-1).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? a : b;
  return /[0-9lmnLMN136780]$/.test(w.trim()) ? a : b;
};
const NO_TYPE = "__none";

/** 현황 공유 링크 (Pro): 직원이 로그인 없이 현황판을 보기만 해요 */
function ShareCard({ hotelId, plan, notify }: { hotelId: string; plan: "free" | "pro"; notify: (m: string) => void }) {
  const pro = plan === "pro";
  const [st, setSt] = useState<ShareState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!pro) return;
    shareStatus(hotelId)
      .then(setSt)
      .catch((e) => setErr(e instanceof Error && /not allowed/.test(e.message) ? "호텔 주인 계정만 공유 링크를 관리할 수 있어요." : "공유 상태를 불러오지 못했어요."));
  }, [hotelId, pro]);
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await f();
      setSt(await shareStatus(hotelId));
      setErr(null);
      notify(ok);
    } catch {
      setErr("처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const url = st?.enabled && st.token ? shareUrl(st.token) : null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify("공유 링크를 복사했어요");
    } catch {
      notify("복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.");
    }
  };
  return (
    <section className={`card share ${pro ? "" : "locked"}`} id="set-share">
      <h3>
        현황 공유 링크 <span className={`tag ${pro ? "" : "pro"}`}>Pro</span>
      </h3>
      <div className="sub">직원이 로그인 없이 재고 현황·객실 배치(대실·방 미배정 목록 포함)를 볼 수 있어요. 보기만 되고, 판매 가격과 메모는 보이지 않아요.</div>
      {!pro ? (
        <>
          <div className="share-lock">현황 공유 링크는 Pro에서 쓸 수 있어요.</div>
          <button className="btn line sm" disabled>
            <Link2 size={14} />
            링크 만들기
          </button>
        </>
      ) : url ? (
        <>
          <div className="share-url">
            <input className="inp sm" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="공유 링크" />
            <button className="btn red sm" onClick={() => void copy()}>
              <Copy size={14} />
              복사
            </button>
          </div>
          <div className="share-act">
            <button
              className="btn line sm"
              disabled={busy}
              onClick={() => confirm("새 링크를 만들까요? 지금 링크는 바로 열리지 않게 돼요.") && void run(() => shareCreate(hotelId), "새 링크를 만들었어요. 직원에게 새 링크를 보내 주세요.")}
            >
              <RefreshCw size={14} />
              새 링크 만들기
            </button>
            <button className="btn danger sm" disabled={busy} onClick={() => void run(() => shareDisable(hotelId), "공유를 껐어요. 지금 링크는 더 이상 열리지 않아요.")}>
              공유 끄기
            </button>
          </div>
          <p className="fine">링크를 아는 사람은 누구나 볼 수 있어요. 직원이 바뀌면 '새 링크 만들기'를 눌러 주세요.</p>
        </>
      ) : (
        <>
          <div className="share-lock">지금은 공유가 꺼져 있어요.</div>
          <button className="btn red sm" disabled={busy || !st} onClick={() => void run(() => shareCreate(hotelId), "공유 링크를 만들었어요")}>
            <Link2 size={14} />
            링크 만들기
          </button>
        </>
      )}
      {err ? <div className="share-err">{err}</div> : null}
    </section>
  );
} // '타입 없음'으로 칠하기
const move = <T,>(a: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  const b = a.slice();
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};
// "601~610" 범위 입력은 shared/ledger.ts의 parseRoomInput 그대로예요.
export { parseRoomInput };

function Swatches({ value, onChange, noneLabel = "기본" }: { value: string | null | undefined; onChange: (c: string | null) => void; noneLabel?: string }) {
  return (
    <div className="swatches">
      {PALETTE.map((c) => (
        <button
          type="button"
          key={c.name}
          className={`sw ${(strongColor(value) ?? null) === c.value ? "on" : ""} ${c.value ? "" : "none"}`}
          style={c.value ? { background: c.value } : undefined}
          title={c.value ? c.name : noneLabel}
          onClick={() => onChange(c.value)}
        >
          {c.value ? null : <span>{noneLabel}</span>}
        </button>
      ))}
      <label className="sw custom" title="직접 고르기">
        <input type="color" value={strongColor(value) ?? "#2F7BEA"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <Plus size={12} />
      </label>
    </div>
  );
}

export default function Settings({ data, email, notify }: Props) {
  const hotel = data.hotel!;
  const [s, setS] = useState<HotelSettings>(hotel.settings);
  const [name, setName] = useState(hotel.name);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [paint, setPaintRaw] = useState<string | null>(null);
  // 여러 개 선택: 방을 눌러 고르고(층·건물이 달라도), 아래 막대에서 타입을 골라 한 번에
  const [bulk, setBulk] = useState(false);
  const [bsel, setBsel] = useState<Set<string>>(new Set());
  const [blast, setBlast] = useState<string | null>(null);
  const [btype, setBtype] = useState("");
  const setPaint = (v: string | null) => {
    setPaintRaw(v);
    if (v) setBulk(false);
  };
  const endBulk = () => {
    setBulk(false);
    setBsel(new Set());
    setBlast(null);
  };
  const [selRoom, setSelRoom] = useState<string | null>(null);
  const [selFloor, setSelFloor] = useState<string | null>(null);
  const [selBuilding, setSelBuilding] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addVal, setAddVal] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ s, name });
  latest.current = { s, name };

  // 다른 기기에서 바뀐 설정은 내가 고치는 중이 아닐 때만 받아요
  useEffect(() => {
    if (!dirty) {
      setS(hotel.settings);
      setName(hotel.name);
    }
  }, [hotel.settings, hotel.name, dirty]);

  const flush = async () => {
    setSaving("saving");
    try {
      await data.saveHotel({ settings: latest.current.s, name: latest.current.name.trim() || hotel.name });
      setSaving("saved");
      setDirty(false);
    } catch (e) {
      setSaving("error");
      notify(e instanceof Error ? `설정을 저장하지 못했어요: ${e.message}` : "설정을 저장하지 못했어요");
    }
  };
  const update = (fn: (x: HotelSettings) => HotelSettings) => {
    setS((x) => fn(x));
    setDirty(true);
    setSaving("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // 매점 → 설정 딥링크(#/settings/shop)처럼 /settings/<칸> 이면 그 칸으로 스크롤해요
  useEffect(() => {
    const focus = () => {
      const parts = location.hash.replace(/^#\/?/, "").split("/");
      if (parts[0] !== "settings" || !parts[1]) return;
      const id = parts[1].startsWith("set-") ? parts[1] : `set-${parts[1]}`;
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    focus();
    window.addEventListener("hashchange", focus);
    return () => window.removeEventListener("hashchange", focus);
  }, []);
  // 여러 개 선택 중에는 아래 막대가 보이게: 예약 기록 단추는 숨기고 알림은 막대 위로
  useEffect(() => {
    document.body.classList.toggle("bulking", bulk);
    return () => document.body.classList.remove("bulking");
  }, [bulk]);
  useEffect(() => {
    if (!bulk) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (bsel.size ? (setBsel(new Set()), setBlast(null)) : setBulk(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulk, bsel]);
  // '여러 개 선택' 단추: '+ 층 추가' 바로 옆 (건물이 여럿이면 첫 건물 줄)
  const bulkBtn = usableTypes(s.types).length ? (
    <button
      className={`btn line sm bulkon ${bulk ? "on" : ""}`}
      aria-pressed={bulk}
      title="방 여러 개를 골라 타입을 한 번에 · Shift/Ctrl+클릭으로도 시작돼요"
      onClick={() => (bulk ? endBulk() : (setPaintRaw(null), setBulk(true), setSelRoom(null), setSelFloor(null), setSelBuilding(null)))}
    >
      <CheckSquare size={14} />
      {bulk ? "선택 끝내기" : "여러 개 선택"}
    </button>
  ) : null;
  const applyBulk = () => {
    if (!bsel.size) return;
    if (!btype) return notify("바꿀 타입을 골라 주세요");
    const target = btype === NO_TYPE ? null : btype;
    const r = applyType(s, bsel, target);
    const tname = target ? typeLabel(typeOf(target)) : null;
    if (!r.changed) return notify(`고른 ${bsel.size}개는 이미 모두 ${tname ?? "타입 없음"}이에요`);
    update(() => r.settings); // 고른 방 전부 · 설정 한 번 저장
    const prev = r.prev;
    notify(bulkToast(s, bsel, bsel.size, tname), { ms: 6000, action: { label: "되돌리기", run: () => (update((x) => undoType(x, prev)), notify("되돌렸어요")) } });
    setBsel(new Set());
    setBlast(null);
  };
  useEffect(() => {
    if (!paint) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPaint(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paint]);

  const totals = useMemo(() => typeTotals(s), [s]);
  const roomTotal = s.floors.reduce((n, f) => n + f.rooms.length, 0);
  const used = useMemo(() => {
    const t = new Set<string>();
    const p = new Set<string>();
    for (const b of data.bookings) {
      t.add(b.typeId);
      p.add(b.platformId);
    }
    return { t, p };
  }, [data.bookings]);
  const setShop = (id: string, patch: Partial<HotelSettings["shopItems"][number]>) =>
    update((x) => ({ ...x, shopItems: x.shopItems.map((y) => (y.id === id ? { ...y, ...patch } : y)) }));
  const removeShop = async (id: string, hidden: boolean) => {
    let sold = false;
    try {
      sold = await hasShopSales(hotel.id, id);
    } catch {
      return notify("판매 기록을 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요");
    }
    if (sold && !hidden) {
      setShop(id, { hidden: true });
      return notify("판매 기록이 있어서 지우지 않고 숨겼어요. 한 번 더 누르면 목록에서 지워요");
    }
    update((x) => ({ ...x, shopItems: x.shopItems.filter((y) => y.id !== id) }));
    if (sold) notify("목록에서 지웠어요. 지난 매출은 그대로 남아요");
  };
  const typeOf = (id: string | null) => s.types.find((t) => t.id === id) ?? null;

  const setFloor = (fid: string, fn: (f: Floor) => Floor) => update((x) => ({ ...x, floors: x.floors.map((f) => (f.id === fid ? fn(f) : f)) }));
  const setRoom = (rid: string, fn: (r: Room) => Room) =>
    update((x) => ({ ...x, floors: x.floors.map((f) => ({ ...f, rooms: f.rooms.map((r) => (r.id === rid ? fn(r) : r)) })) }));

  const multi = isMultiBuilding(s);
  const paintTarget = paint === NO_TYPE ? null : paint;
  const paintFloor = (f: Floor) => {
    const n = f.rooms.filter((r) => (r.typeId ?? null) !== paintTarget).length;
    if (!n) return notify(paintTarget ? `${f.name}은 이미 모두 ${typeLabel(typeOf(paintTarget))} 타입이에요` : `${f.name}은 이미 모두 타입이 없어요`);
    setFloor(f.id, (x) => ({ ...x, rooms: x.rooms.map((r) => ({ ...r, typeId: paintTarget })) }));
    notify(`${f.name} ${n}실을 ${paintTarget ? `${typeLabel(typeOf(paintTarget))} 타입으로` : "타입 없음으로"} 바꿨어요`);
  };
  const choosePaint = (id: string) => {
    setPaint(id);
    setSelRoom(null);
    document.getElementById("set-paint")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const addRooms = (fid: string) => {
    // 같은 건물 안에서만 번호가 겹치지 않으면 돼요 (본관 201 · 별관 201 가능)
    const res = addRoomsToFloor(s, fid, addVal, paint === NO_TYPE ? null : (paint ?? usableTypes(s.types)[0]?.id ?? null), () => uid("r"));
    if (!res.added.length) {
      if (res.skipped.length) notify(`이미 있는 방 번호예요: ${res.skipped.slice(0, 5).join(", ")}`);
      return setAdding(null);
    }
    update((x) => addRoomsToFloor(x, fid, addVal, paint === NO_TYPE ? null : (paint ?? usableTypes(x.types)[0]?.id ?? null), () => uid("r")).settings);
    setAddVal("");
    setAdding(null);
    notify(`방 ${res.added.length}개를 추가했어요${res.skipped.length ? ` · 이미 있는 ${res.skipped.length}개는 건너뛰었어요` : ""}`);
  };
  const addFloor = (buildingId: string) => {
    const id = uid("f");
    update((x) => addFloorOnTop(x, buildingId, id));
    setSelFloor(id);
    setSelRoom(null);
    setSelBuilding(null);
  };
  const addBuilding = () => {
    const id = uid("b");
    update((x) => ({
      ...x,
      buildings: [...x.buildings, { id, name: "" }], // 이름은 비워 두고 A동·B동… 으로 보여요
      floors: [...x.floors, { id: uid("f"), name: "1층", buildingId: id, color: null, rooms: [] }],
    }));
    setSelBuilding(id);
    setSelFloor(null);
    setSelRoom(null);
    notify(`${defaultBuildingName(s.buildings.length)}을 추가했어요. 이름을 적고 층에 방을 추가해 주세요`);
  };
  const setBuilding = (bid: string, fn: (b: Building) => Building) =>
    update((x) => ({ ...x, buildings: x.buildings.map((b) => (b.id === bid ? fn(b) : b)) }));
  const room = selRoom ? s.floors.flatMap((f) => f.rooms.map((r) => ({ r, f }))).find((x) => x.r.id === selRoom) : undefined;
  const floor = selFloor ? s.floors.find((f) => f.id === selFloor) : undefined;
  const building = selBuilding ? s.buildings.find((b) => b.id === selBuilding) : undefined;
  const bRooms = (bid: string) => floorsOf(s, bid).reduce((n, f) => n + f.rooms.length, 0);

  return (
    <main className="page settings">
      <div className="ph">
        <div>
          <h1>설정</h1>
          <div className="sub">처음 한 번만 등록하면 돼요. 화이트보드처럼 층과 방 번호를 적고, 방마다 타입을 정해요.</div>
        </div>
        <div className="chips">
          <span className={`save-st ${saving}`}>
            {saving === "saving" ? "저장 중…" : saving === "saved" ? "저장됨" : saving === "error" ? "저장 안 됨" : ""}
          </span>
          {[
            ["rooms", "객실·타입"],
            ["plats", "플랫폼"],
            ["fees", "수수료"],
            ["pcolor", "플랫폼 색"],
            ["shop", "매점"],
            ["exp", "지출 분류"],
            ["share", "현황 공유"],
            ["plan", "요금제"],
          ].map(([id, l]) => (
            <a
              key={id}
              className="chip"
              href={`#/settings/${id}`}
              onClick={(e) => (e.preventDefault(), (location.hash = `#/settings/${id}`), document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth" }))}
            >
              {l}
            </a>
          ))}
        </div>
      </div>

      <div className="sgrid">
        <section className="card wide" id="set-rooms">
          <h3>
            객실 배치 <span className="tag">총 {roomTotal}실{hotel.isDemo ? " · 예시 배정" : ""}</span>
          </h3>
          <div className="sub">
            층 줄의 +를 눌러 방을 추가하고(예: <b>601~610</b>), 층 이름을 누르면 번호줄 색을 바꿀 수 있어요.
          </div>
          <div className="stools">
            <span className="push" />
            {!multi ? bulkBtn : null}
            {!multi ? (
              <button className="btn line sm" onClick={() => addFloor(s.buildings[0].id)}>
                <Plus size={14} />층 추가
              </button>
            ) : null}
            <button className="btn line sm" onClick={addBuilding} title="본관·별관처럼 건물이 나뉘어 있을 때">
              <Building2 size={14} />건물 추가
            </button>
          </div>
          <div className={`paint ${paint ? "active" : ""}`} id="set-paint">
            <span className="pl">객실 타입 지정</span>
            <div className="pchips">
              {usableTypes(s.types).map((t) => (
                <button
                  key={t.id}
                  className={`chip sm ${paint === t.id ? "on" : ""}`}
                  aria-pressed={paint === t.id}
                  onClick={() => setPaint(paint === t.id ? null : t.id)}
                >
                  {typeLabel(t)}
                  <i>{totals.get(t.id) ?? 0}</i>
                </button>
              ))}
              {usableTypes(s.types).length ? (
                <button className={`chip sm none ${paint === NO_TYPE ? "on" : ""}`} aria-pressed={paint === NO_TYPE} onClick={() => setPaint(paint === NO_TYPE ? null : NO_TYPE)}>
                  타입 없음
                </button>
              ) : null}
              {paint ? (
                <button className="btn line sm pdone" onClick={() => setPaint(null)}>
                  끝내기
                </button>
              ) : null}
            </div>
            <div className="phint">
              {!usableTypes(s.types).length ? (
                "아래 '객실 타입'에서 타입을 먼저 만들어 주세요"
              ) : bulk ? (
                <>
                  방을 눌러 고르고 아래에서 타입을 고르세요 · 층이 달라도 돼요<span className="pc-only"> · <b>Shift</b>+클릭은 같은 층 범위 · <b>Ctrl</b>+클릭은 하나씩</span>
                </>
              ) : paint ? (
                <>
                  <b>{paint === NO_TYPE ? "타입 없음" : typeLabel(typeOf(paint))}</b> 선택됨 · 방을 누르면 바로 바뀌고, 층 이름을 누르면 그 층 전체가 바뀌어요
                </>
              ) : (
                <>
                  타입을 고른 뒤 방을 누르면 한꺼번에 지정돼요<span className="pc-only"> · <b>Shift</b>·<b>Ctrl</b>+클릭은 여러 개 선택</span>
                </>
              )}
            </div>
          </div>
          {s.buildings.map((bd) => (
            <div className={multi ? "sbld" : undefined} key={bd.id}>
              {multi ? (
                <div className="sbh">
                  <button
                    className={`sbn ${selBuilding === bd.id ? "on" : ""}`}
                    title="건물 이름·순서 고치기"
                    onClick={() => (setSelBuilding(selBuilding === bd.id ? null : bd.id), setSelFloor(null), setSelRoom(null))}
                  >
                    <Building2 size={14} />
                    <span>{buildingName(s, bd.id)}</span>
                  </button>
                  <span className="tag">{bRooms(bd.id)}실</span>
                  <span className="push" />
                  {bd.id === s.buildings[0].id ? bulkBtn : null}
                  <button className="btn line sm" onClick={() => addFloor(bd.id)}>
                    <Plus size={14} />층 추가
                  </button>
                </div>
              ) : null}
              {floorsOf(s, bd.id).map((f) => (
            <div className="sfl" key={f.id}>
              <div className="flcol">
                <button className={`fl flbtn ${selFloor === f.id ? "on" : ""}`} title={paint ? `${f.name} 전체를 이 타입으로` : f.name} onClick={() => (bulk ? setBsel((x) => toggleFloor(s, x, f.id)) : paint ? paintFloor(f) : (setSelFloor(selFloor === f.id ? null : f.id), setSelRoom(null), setSelBuilding(null)))}>
                  <span className="fdot" style={floorPaint(f.color) ? { background: floorPaint(f.color)!.bg } : undefined} />
                  {f.name}
                </button>
                {bulk && f.rooms.length ? (
                  <button type="button" className={`flall ${floorAllSelected(s, bsel, f.id) ? "on" : ""}`} aria-pressed={floorAllSelected(s, bsel, f.id)} aria-label={`${f.name} 층 전체 선택`} onClick={() => setBsel((x) => toggleFloor(s, x, f.id))}>
                    층 전체
                  </button>
                ) : null}
              </div>
              <div className={`rboxes ${paint ? "painting" : ""} ${bulk ? "bulking" : ""}`}>
                {f.rooms.map((r) => {
                  const strip = pastelColor(r.color ?? f.color);
                  return (
                    <button
                      key={r.id}
                      className={`rbox ${/^\d+$/.test(r.no) ? "" : "k"} ${selRoom === r.id && !paint && !bulk ? "sel" : ""} ${paint && paintTarget === (r.typeId ?? null) ? "same" : ""} ${bulk && bsel.has(r.id) ? "bsel" : ""}`}
                      aria-pressed={bulk ? bsel.has(r.id) : undefined}
                      style={strip ? { background: strip } : undefined}
                      onMouseDown={(e) => (e.shiftKey || e.ctrlKey || e.metaKey) && e.preventDefault()}
                      onClick={(e) => {
                        // Shift·Ctrl/⌘ 클릭은 모드가 꺼져 있어도 여러 개 선택으로 (칠하기 중엔 빼고)
                        const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
                        const next = paint && !bulk ? null : pickRoom(s, { bulk, sel: bsel, last: blast }, r.id, mods);
                        if (next) {
                          if (!bulk) (setBulk(true), setSelRoom(null), setSelFloor(null), setSelBuilding(null));
                          setBsel(new Set(next.sel));
                          setBlast(next.last);
                          return;
                        }
                        setBlast(r.id);
                        if (paint) {
                          // 이미 그 타입이면 아무것도 안 해요
                          if ((r.typeId ?? null) !== paintTarget) setRoom(r.id, (x) => ({ ...x, typeId: paintTarget }));
                        }
                        else {
                          setSelRoom(selRoom === r.id ? null : r.id);
                          setSelFloor(null);
                          setSelBuilding(null);
                        }
                      }}
                    >
                      <FitText className="no" text={r.no} />
                      <TypeLine t={typeOf(r.typeId)} />
                    </button>
                  );
                })}
                {adding === f.id ? (
                  <form
                    className="addroom"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addRooms(f.id);
                    }}
                  >
                    <input autoFocus className="inp" placeholder="예: 601~610 또는 701, 702" value={addVal} onChange={(e) => setAddVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
                    <button className="btn red sm">추가</button>
                  </form>
                ) : (
                  <button className="plus" aria-label={`${f.name}에 방 추가`} onClick={() => (setAdding(f.id), setAddVal(""))}>
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
              {multi && !floorsOf(s, bd.id).length ? <div className="lempty sm">'층 추가'를 눌러 이 건물의 첫 층을 만들어 주세요</div> : null}
            </div>
          ))}
          {!s.floors.length && !multi ? <div className="lempty">'층 추가'를 눌러 첫 층을 만들어 주세요</div> : null}
          {bulk ? (
            <div className="bulkbar" role="toolbar" aria-label="여러 개 선택">
              <b className="num">{bsel.size}개 선택</b>
              <select className="bsel-t" aria-label="바꿀 타입" value={btype} onChange={(e) => setBtype(e.target.value)}>
                <option value="">타입 선택</option>
                {usableTypes(s.types).map((t) => (
                  <option key={t.id} value={t.id}>
                    {typeLabel(t)}
                  </option>
                ))}
                <option value={NO_TYPE}>타입 없음</option>
              </select>
              <button type="button" className="btn red sm" disabled={!bsel.size || !btype} onClick={applyBulk}>
                적용
              </button>
              <button type="button" className="btn line sm" disabled={!bsel.size} onClick={() => (setBsel(new Set()), setBlast(null))}>
                해제
              </button>
              <button type="button" className="ic bx" aria-label="여러 개 선택 끝내기" onClick={endBulk}>
                <X size={16} />
              </button>
            </div>
          ) : null}

          {building ? (
            <div className="editor">
              <div className="ed-h">
                <b>건물 고치기</b>
                <button className="ic" aria-label="닫기" onClick={() => setSelBuilding(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="ed-row">
                <label>이름</label>
                <input
                  className="inp sm"
                  value={building.name}
                  maxLength={12}
                  placeholder={defaultBuildingName(s.buildings.findIndex((b) => b.id === building.id))}
                  onChange={(e) => setBuilding(building.id, (b) => ({ ...b, name: e.target.value }))}
                />
                <button className="btn line sm" onClick={() => update((x) => ({ ...x, buildings: move(x.buildings, x.buildings.findIndex((b) => b.id === building.id), -1) }))}>
                  <ArrowUp size={14} />
                  위로
                </button>
                <button className="btn line sm" onClick={() => update((x) => ({ ...x, buildings: move(x.buildings, x.buildings.findIndex((b) => b.id === building.id), 1) }))}>
                  <ArrowDown size={14} />
                  아래로
                </button>
                <button
                  className="btn sm ghost"
                  disabled={s.buildings.length <= 1}
                  onClick={() => {
                    const fl = floorsOf(s, building.id);
                    const n = fl.reduce((k, f) => k + f.rooms.length, 0);
                    if (n && !confirm(`${buildingName(s, building.id)}${josa(buildingName(s, building.id), "과", "와")} 층 ${fl.length}개, 방 ${n}개를 지울까요? 그 방의 기존 예약은 '방 미배정 숙박'으로 옮겨져요.`)) return;
                    update((x) => removeBuilding(x, building.id));
                    setSelBuilding(null);
                  }}
                >
                  <Trash2 size={14} />건물 지우기
                </button>
              </div>
              <p className="fine">건물마다 같은 방 번호를 써도 돼요 (예: 본관 201 · 별관 201). 남은 객실은 건물과 상관없이 타입별로 합쳐서 계산해요.</p>
            </div>
          ) : null}

          {floor ? (
            <div className="editor">
              <div className="ed-h">
                <b>층 고치기</b>
                <button className="ic" aria-label="닫기" onClick={() => setSelFloor(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="ed-row">
                <label>이름</label>
                <input className="inp sm" value={floor.name} maxLength={12} onChange={(e) => setFloor(floor.id, (f) => ({ ...f, name: e.target.value }))} />
                <button className="btn line sm" onClick={() => update((x) => moveFloor(x, floor.id, -1))}>
                  <ArrowUp size={14} />
                  위로
                </button>
                <button className="btn line sm" onClick={() => update((x) => moveFloor(x, floor.id, 1))}>
                  <ArrowDown size={14} />
                  아래로
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    if (floor.rooms.length && !confirm(`${floor.name}${josa(floor.name, "과", "와")} 방 ${floor.rooms.length}개를 지울까요? 기존 예약은 '방 미배정 숙박'으로 옮겨져요.`)) return;
                    update((x) => ({ ...x, floors: x.floors.filter((f) => f.id !== floor.id) }));
                    setSelFloor(null);
                  }}
                >
                  <Trash2 size={14} />층 지우기
                </button>
              </div>
              {multi ? (
                <div className="ed-row">
                  <label>건물</label>
                  <select
                    className="inp sm"
                    aria-label="건물"
                    value={floor.buildingId}
                    onChange={(e) => {
                      const to = e.target.value;
                      const taken = new Set(floorsOf(s, to).flatMap((f) => f.rooms.map((r) => r.no)));
                      const clash = floor.rooms.filter((r) => taken.has(r.no)).map((r) => r.no);
                      if (clash.length) return notify(`옮길 건물에 같은 방 번호가 있어요: ${clash.slice(0, 5).join(", ")}`);
                      setFloor(floor.id, (f) => ({ ...f, buildingId: to }));
                    }}
                  >
                    {s.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {buildingName(s, b.id)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="ed-row">
                <label>번호줄 색</label>
                <Swatches value={floor.color} onChange={(c) => setFloor(floor.id, (f) => ({ ...f, color: c }))} />
              </div>
            </div>
          ) : null}

          {room ? (
            <div className="editor">
              <div className="ed-h">
                <b>{multi ? `${buildingName(s, room.f.buildingId)} ` : ""}{room.r.no}호 고치기</b>
                <button className="ic" aria-label="닫기" onClick={() => setSelRoom(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="ed-row">
                <label>방 번호</label>
                <input className="inp sm" value={room.r.no} maxLength={12} onChange={(e) => setRoom(room.r.id, (r) => ({ ...r, no: e.target.value }))} />
                <select
                  className="inp sm"
                  value={room.r.typeId ?? ""}
                  onChange={(e) => setRoom(room.r.id, (r) => ({ ...r, typeId: e.target.value || null }))}
                  aria-label="객실 타입"
                >
                  <option value="">타입 없음</option>
                  {s.types.filter((t) => typeLabel(t) || t.id === room.r.typeId).map((t) => (
                    <option key={t.id} value={t.id}>
                      {typeLabel(t) || "(이름 없음)"}
                    </option>
                  ))}
                </select>
                <button className="btn line sm" onClick={() => setFloor(room.f.id, (f) => ({ ...f, rooms: move(f.rooms, f.rooms.indexOf(room.r), -1) }))}>
                  <ArrowLeft size={14} />
                </button>
                <button className="btn line sm" onClick={() => setFloor(room.f.id, (f) => ({ ...f, rooms: move(f.rooms, f.rooms.indexOf(room.r), 1) }))}>
                  <ArrowRight size={14} />
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    setFloor(room.f.id, (f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== room.r.id) }));
                    setSelRoom(null);
                  }}
                >
                  <Trash2 size={14} />방 지우기
                </button>
              </div>
              <div className="ed-row">
                <label>방 색 (특수 객실)</label>
                <Swatches value={room.r.color} noneLabel="층 색" onChange={(c) => setRoom(room.r.id, (r) => ({ ...r, color: c }))} />
              </div>
            </div>
          ) : null}
        </section>

        <section className="card" id="set-types">
          <h3>
            객실 타입 <span className="tag">{s.types.length}개</span>
          </h3>
          <div className="sub">방 칸과 재고 현황 표에 그대로 보여요 (최대 {TYPE_NAME_MAX}글자) · 오른쪽 숫자는 그 타입으로 지정된 방 수예요</div>
          {s.types.map((t, i) => (
            <div className="trow" key={t.id}>
              <span className="ord">
                <button aria-label="위로" onClick={() => update((x) => ({ ...x, types: move(x.types, i, -1) }))}>
                  <ArrowUp size={12} />
                </button>
                <button aria-label="아래로" onClick={() => update((x) => ({ ...x, types: move(x.types, i, 1) }))}>
                  <ArrowDown size={12} />
                </button>
              </span>
              <input
                className="tb tbin"
                value={t.name}
                placeholder="객실 타입"
                maxLength={TYPE_NAME_MAX}
                size={Math.min(TYPE_NAME_MAX + 2, Math.max(7, t.name.length + 2))}
                title={t.name || "객실 타입"}
                aria-label="객실 타입"
                autoFocus={!t.name && i === s.types.length - 1}
                onChange={(e) => {
                  const v = e.target.value.slice(0, TYPE_NAME_MAX);
                  update((x) => ({ ...x, types: x.types.map((y) => (y.id === t.id ? { ...y, code: v, name: v } : y)) }));
                }}
              />
              <span className="tfill" />
              <span className="tguest" title="인원 추가금: 기본 인원을 넘으면 1명마다 일반 · 특수 객실 추가금을 더해요. 최대 인원을 넘으면 경고만 해요">
                {(() => {
                  const g = typeGuests(t);
                  const setG = (patch: { baseGuests?: number; maxGuests?: number }) =>
                    update((x) => ({ ...x, types: x.types.map((y) => (y.id === t.id ? { ...y, ...patch } : y)) }));
                  // 적는 동안은 글자 그대로 (칸을 벗어날 때만 1~99로 맞춰요). 기본 > 최대여도 값은 안 바꾸고 안내만
                  const rawMax = t.maxGuests != null && Number.isInteger(t.maxGuests) && t.maxGuests >= 1 ? Math.min(GUESTS_MAX, t.maxGuests) : g.base + 2;
                  const warn = guestRangeMsg(g.base, rawMax);
                  return (
                    <>
                      기본
                      <NumInput className={`gin num ${warn ? "bad" : ""}`} min={1} max={GUESTS_MAX} aria-label={`${t.name} 기본 인원`} value={g.base} onChange={(v) => v != null && setG({ baseGuests: v })} />
                      최대
                      <NumInput className={`gin num ${warn ? "bad" : ""}`} min={1} max={GUESTS_MAX} aria-label={`${t.name} 최대 인원`} title={warn ?? undefined} value={rawMax} onChange={(v) => v != null && setG({ maxGuests: v })} />
                      명
                      <select className="tsel" aria-label={`${t.name} 객실 종류 (일반 · 특수)`} title="일반 · 특수: 설정 › 인원 추가 요금의 1명 1박 금액" value={t.tierId ?? s.surchargeTiers[0]?.id} onChange={(e) => update((x) => ({ ...x, types: x.types.map((y) => (y.id === t.id ? { ...y, tierId: e.target.value } : y)) }))}>
                        {s.surchargeTiers.map((r) => (
                          <option key={r.id} value={r.id}>
                            {tierLabel(r) || "이름 없음"}
                          </option>
                        ))}
                      </select>
                      {warn ? (
                        <span className="gwarn" role="status">
                          {warn}
                        </span>
                      ) : null}
                    </>
                  );
                })()}
              </span>
              <button
                className="cntb"
                title="방에 지정된 개수 · 누르면 위 객실 배치에서 방을 골라 지정해요"
                disabled={!typeLabel(t)}
                onClick={() => choosePaint(t.id)}
              >
                <b>{totals.get(t.id) ?? 0}</b>실
              </button>
              <button
                className="ic"
                aria-label="타입 지우기"
                onClick={() => {
                  if (used.t.has(t.id)) return notify("예약에 쓰인 타입은 지울 수 없어요. 이름을 바꿔 주세요.");
                  update((x) => ({
                    ...x,
                    types: x.types.filter((y) => y.id !== t.id),
                    floors: x.floors.map((f) => ({ ...f, rooms: f.rooms.map((r) => (r.typeId === t.id ? { ...r, typeId: null } : r)) })),
                  }));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            className="add"
            onClick={() => update((x) => ({ ...x, types: [...x.types, { id: uid("t"), code: "", name: "" }] }))}
          >
            <Plus size={14} />
            타입 추가
          </button>
        </section>

        <section className="card" id="set-times">
          <h3>입실 · 퇴실 시간</h3>
          <div className="sub">예약 창과 정산서에 이 시간으로 보여요. 빠른 입실 · 늦은 퇴실은 이 시간에서 앞당기거나 미뤄요.</div>
          <div className="stimes">
            <label>
              <span>입실 시간</span>
              <input type="time" step={1800} value={s.stayTimes.checkIn} aria-label="입실 시간" onChange={(e) => e.target.value && update((x) => ({ ...x, stayTimes: { ...x.stayTimes, checkIn: e.target.value.slice(0, 5) } }))} />
            </label>
            <label>
              <span>퇴실 시간</span>
              <input type="time" step={1800} value={s.stayTimes.checkOut} aria-label="퇴실 시간" onChange={(e) => e.target.value && update((x) => ({ ...x, stayTimes: { ...x.stayTimes, checkOut: e.target.value.slice(0, 5) } }))} />
            </label>
            <label>
              <span>1시간 추가 요금</span>
              <span className="inp price hfee">
                <NumInput aria-label="1시간 추가 요금" min={0} max={1_000_000} allowEmpty value={s.extraHourFee} onChange={(v) => update((x) => ({ ...x, extraHourFee: v ?? 0 }))} />
                원
              </span>
            </label>
          </div>
          <div className="sub stimes-f">빠른 입실 · 늦은 퇴실 1시간마다 이 금액을 판매 가격에 더해요. 예약 창에서 금액을 바꾸거나 서비스(0원)로 할 수 있어요.</div>
        </section>

        <section className="card" id="set-parking">
          <h3>
            주차 관리
            <button
              type="button"
              role="switch"
              aria-checked={s.parking.enabled}
              aria-label="주차 관리"
              className={`tgl ${s.parking.enabled ? "on" : ""}`}
              onClick={() => update((x) => ({ ...x, parking: { ...x.parking, enabled: !x.parking.enabled } }))}
            >
              <i />
              {s.parking.enabled ? "켜짐" : "꺼짐"}
            </button>
          </h3>
          <div className="sub">켜면 예약 창에 도보 · 차량, 차량 대수 · 번호를 적고, 현황판에 주차 현황이 생겨요. 공유 화면에는 차량번호와 요금이 안 보여요.</div>
          {s.parking.enabled ? (
            <>
              <div className="stimes">
                <label>
                  <span>추가 차량 1대당 주차 요금 (1박)</span>
                  <span className="inp price hfee">
                    <NumInput aria-label="추가 차량 1대당 주차 요금" min={0} max={1_000_000} allowEmpty value={s.parking.extraCarFee} onChange={(v) => update((x) => ({ ...x, parking: { ...x.parking, extraCarFee: v ?? 0 } }))} />
                    원
                  </span>
                </label>
                <label>
                  <span>도보 할인 (예약 1건, 없으면 0)</span>
                  <span className="inp price hfee">
                    <NumInput aria-label="도보 할인" min={0} max={1_000_000} allowEmpty value={s.parking.walkDiscount} onChange={(v) => update((x) => ({ ...x, parking: { ...x.parking, walkDiscount: v ?? 0 } }))} />
                    원
                  </span>
                </label>
              </div>
              <div className="sub stimes-f">첫 차는 무료, 2번째 차부터 1대 × 박수만큼 판매 가격에 더해요. 도보면 할인만큼 빼요. 예약 창에서 금액을 바꿀 수 있어요.</div>
            </>
          ) : null}
        </section>

        <section className="card" id="set-surcharge">
          <h3>인원 추가 요금</h3>
          <div className="sub">객실 타입의 기본 인원을 넘으면 1명 1박마다 더해요. 금·토 밤과 특별일 밤은 오른쪽 요금이에요. 예약 창에서 금액을 바꿀 수 있어요.</div>
          <TierSettings s={s} update={update} notify={notify} />
          <h4 className="sp-h">특별일</h4>
          <SpecialDates s={s} today={businessDate()} update={update} />
        </section>

        <section className="card" id="set-plats">
          <h3>
            플랫폼 <span className="tag">{s.platforms.length}개</span>
          </h3>
          <div className="sub">동그라미 속 한 글자는 화이트보드 메모처럼 방 칸에 보여요. 위에서부터 단축키 1~9가 붙어요. '현장 결제'를 켠 플랫폼만 잔금을 따지고, 나머지는 플랫폼이 받은 걸로 봐요.</div>
          {s.platforms.map((p, i) => (
            <div className="trow" key={p.id}>
              <span className="ord">
                <button aria-label="위로" onClick={() => update((x) => ({ ...x, platforms: move(x.platforms, i, -1) }))}>
                  <ArrowUp size={12} />
                </button>
                <button aria-label="아래로" onClick={() => update((x) => ({ ...x, platforms: move(x.platforms, i, 1) }))}>
                  <ArrowDown size={12} />
                </button>
              </span>
              <input
                className="pb pbin"
                value={p.abbr}
                maxLength={1}
                aria-label="한 글자 표시"
                onChange={(e) => update((x) => ({ ...x, platforms: x.platforms.map((y) => (y.id === p.id ? { ...y, abbr: e.target.value } : y)) }))}
              />
              <input
                className="nin"
                value={p.name}
                maxLength={20}
                aria-label="플랫폼 이름"
                onChange={(e) => update((x) => ({ ...x, platforms: x.platforms.map((y) => (y.id === p.id ? { ...y, name: e.target.value } : y)) }))}
              />
              <button
                type="button"
                className={`chip sm onsite ${isOnsite(p) ? "on" : ""}`}
                aria-pressed={isOnsite(p)}
                title="켜면 이 플랫폼 예약은 현장에서 받는 돈(선금·잔금)을 따져요. 끄면 플랫폼이 받은 걸로 봐요"
                onClick={() => update((x) => ({ ...x, platforms: x.platforms.map((y) => (y.id === p.id ? { ...y, onsite: !isOnsite(y) } : y)) }))}
              >
                현장 결제
              </button>
              {i < 9 ? <span className="k">{i + 1}</span> : null}
              <button
                className="ic"
                aria-label="플랫폼 지우기"
                onClick={() => {
                  if (used.p.has(p.id)) return notify("예약에 쓰인 플랫폼은 지울 수 없어요. 이름을 바꿔 주세요.");
                  update((x) => ({ ...x, platforms: x.platforms.filter((y) => y.id !== p.id) }));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            className="add"
            onClick={() => update((x) => ({ ...x, platforms: [...x.platforms, { id: uid("p"), abbr: "새", name: "새 플랫폼" }] }))}
          >
            <Plus size={14} />
            플랫폼 추가
          </button>
          <div className="preview-row">
            미리 보기 {s.platforms.slice(0, 5).map((p) => <PlatBadge key={p.id} p={p} />)}
          </div>
        </section>

        <section className="card wide" id="set-fees">
          <h3>수수료 · 입금</h3>
          <div className="sub">플랫폼마다 수수료를 적으면 예약 창과 장부에 플랫폼이 넣어 줄 입금 예정가가 보여요.</div>
          <FeeSettings s={s} update={update} />
        </section>

        <section className="card" id="set-pcolor">
          <h3>플랫폼 색</h3>
          <div className="sub">객실 캘린더 막대의 옅은 바탕 색이에요. 입실 완료면 같은 색 진한 테두리가 생겨요. 공유 링크 화면도 같은 색으로 보여요.</div>
          {s.platforms.map((p) => {
            const def = defaultPlatformColor(p);
            const cur = platPaint(p);
            const opts = PLAT_PRESETS.includes(def) ? PLAT_PRESETS : [def, ...PLAT_PRESETS]; // 순서는 늘 같게, 기본 색엔 작은 점
            const set = (color: string | null) =>
              update((x) => ({
                ...x,
                platforms: x.platforms.map((y) => {
                  if (y.id !== p.id) return y;
                  const { color: _old, ...rest } = y;
                  return color && color !== defaultPlatformColor(y) ? { ...rest, color } : rest;
                }),
              }));
            return (
              <div className="pcrow" key={p.id}>
                <div className="pc-name">
                  <span className="pc-bar" style={{ background: cur.t }} title="입실 전">
                    {p.name || "이름 없음"}
                  </span>
                  <span className="pc-bar ok" style={{ background: cur.t, borderColor: cur.b }} title="입실 완료">
                    입실 완료
                  </span>
                </div>
                <div className="pc-sw" role="radiogroup" aria-label={`${p.name} 색`}>
                  {opts.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={cur.c === c}
                      aria-label={c === def ? `기본 색 ${c}` : c}
                      title={c === def ? "기본 색" : c}
                      className={`sw ${cur.c === c ? "on" : ""} ${c === def ? "def" : ""}`}
                      style={{ background: c }}
                      onClick={() => set(c === def ? null : c)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {!s.platforms.length ? <div className="muted sm">플랫폼을 먼저 추가해 주세요</div> : null}
        </section>

        <section className="card" id="set-shop">
          <h3>
            매점 물품{" "}
            <span className="tag">
              {s.shopItems.length}개{hotel.plan === "free" ? ` / ${FREE_SHOP_ITEM_LIMIT}개` : ""}
            </span>
          </h3>
          <div className="sub">매점 화면에 이 순서대로 큰 칸으로 보여요. 분류를 적으면 같은 분류끼리 묶어요. 가격을 바꿔도 지난 매출은 그대로예요.</div>
          {s.shopItems.map((it, i) => (
            <div className={`trow shrow ${it.hidden ? "off" : ""}`} key={it.id}>
              <span className="ord">
                <button aria-label="위로" onClick={() => update((x) => ({ ...x, shopItems: move(x.shopItems, i, -1) }))}>
                  <ArrowUp size={12} />
                </button>
                <button aria-label="아래로" onClick={() => update((x) => ({ ...x, shopItems: move(x.shopItems, i, 1) }))}>
                  <ArrowDown size={12} />
                </button>
              </span>
              <span className="sh-nc">
                <input
                  className="nin"
                  value={it.name}
                  placeholder="물품 이름"
                  maxLength={SHOP_NAME_MAX}
                  aria-label="물품 이름"
                  autoFocus={!it.name && i === s.shopItems.length - 1}
                  onChange={(e) => setShop(it.id, { name: e.target.value.slice(0, SHOP_NAME_MAX) })}
                />
                <input
                  className="nin cat"
                  value={it.category}
                  placeholder="분류 (선택)"
                  maxLength={SHOP_CATEGORY_MAX}
                  aria-label="분류"
                  onChange={(e) => setShop(it.id, { category: e.target.value.slice(0, SHOP_CATEGORY_MAX) })}
                />
              </span>
              <label className="sh-p">
                <NumInput className="nin num" placeholder="가격" aria-label="가격" min={0} max={10_000_000} allowEmpty value={it.price || null} onChange={(v) => setShop(it.id, { price: v ?? 0 })} />
                <span>원</span>
              </label>
              <button
                className={`ic sh-h ${it.hidden ? "on" : ""}`}
                aria-label={it.hidden ? "다시 보이기" : "품절·숨김"}
                title={it.hidden ? "숨김 · 누르면 다시 보여요" : "품절·숨김"}
                onClick={() => setShop(it.id, { hidden: !it.hidden })}
              >
                {it.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button className="ic" aria-label="물품 지우기" onClick={() => void removeShop(it.id, it.hidden)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!canAddShopItem(hotel.plan, s.shopItems.length, FREE_SHOP_ITEM_LIMIT) ? (
            <div className="share-lock">Free 요금제는 물품 {FREE_SHOP_ITEM_LIMIT}개까지예요. Pro에서는 제한 없이 등록할 수 있어요.</div>
          ) : (
            <button className="add" onClick={() => update((x) => ({ ...x, shopItems: [...x.shopItems, makeShopItem({ id: uid("i") })] }))}>
              <Plus size={14} />
              물품 추가
            </button>
          )}
        </section>

        <section className="card" id="set-exp">
          <h3>
            지출 분류 <span className="tag">{s.expenseCategories.filter((c) => c.name.trim()).length}개</span>
          </h3>
          <div className="sub">상단 「지출」·장부 › 지출에서 이 순서대로 골라요. 기본은 수리·비품구매 등이에요. 이름을 바꾸거나 지워도 지난 지출은 그때 이름 그대로 남아요.</div>
          {s.expenseCategories.map((c, i) => (
            <div className="trow exrow" key={c.id}>
              <span className="ord">
                <button aria-label="위로" onClick={() => update((x) => ({ ...x, expenseCategories: move(x.expenseCategories, i, -1) }))}>
                  <ArrowUp size={12} />
                </button>
                <button aria-label="아래로" onClick={() => update((x) => ({ ...x, expenseCategories: move(x.expenseCategories, i, 1) }))}>
                  <ArrowDown size={12} />
                </button>
              </span>
              <input
                className="nin"
                value={c.name}
                placeholder="분류 이름"
                maxLength={EXPENSE_CATEGORY_MAX}
                aria-label="분류 이름"
                autoFocus={!c.name && i === s.expenseCategories.length - 1}
                onChange={(e) => {
                  const name = e.target.value.slice(0, EXPENSE_CATEGORY_MAX);
                  update((x) => ({ ...x, expenseCategories: x.expenseCategories.map((y) => (y.id === c.id ? { ...y, name } : y)) }));
                }}
              />
              <button className="ic" aria-label="분류 지우기" onClick={() => update((x) => ({ ...x, expenseCategories: x.expenseCategories.filter((y) => y.id !== c.id) }))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {s.expenseCategories.length < 40 ? (
            <button className="add" onClick={() => update((x) => ({ ...x, expenseCategories: [...x.expenseCategories, { id: uid("ec"), name: "" }] }))}>
              <Plus size={14} />
              분류 추가
            </button>
          ) : null}
        </section>

        <ShareCard hotelId={hotel.id} plan={hotel.plan} notify={notify} />

        <section className="card" id="set-plan">
          <h3>
            요금제 <span className="tag red">결제는 준비 중</span>
          </h3>
          <div className="sub">지금은 요금제 표시만 해요. 결제 기능은 곧 추가돼요.</div>
          <div className="plan">
            <div className={hotel.plan === "free" ? "now" : ""}>
              <b>Free {hotel.plan === "free" ? <span className="tag">사용 중</span> : null}</b>
              <ul>
                <li>객실 20실까지</li>
                <li>여러 기기 동시 사용 (PC·태블릿·휴대폰)</li>
                <li>장부 최근 3개월</li>
                <li>매점 물품 {FREE_SHOP_ITEM_LIMIT}개까지 · 하루 매출</li>
                <li>지출 기록 · 남은 금액 · 현금 시재</li>
              </ul>
            </div>
            <div className={hotel.plan === "pro" ? "now" : ""}>
              <b>Pro {hotel.plan === "pro" ? <span className="tag">사용 중</span> : null}</b>
              <ul>
                <li>객실 수 제한 없음</li>
                <li>직원 여러 명 동시 사용</li>
                <li>장부 무기한 · 엑셀 내보내기</li>
                <li>월별 플랫폼 합계 · 수정 기록</li>
                <li>매점 물품 제한 없음 · 월별 매점 매출</li>
                <li>지출 월별 분류 합계 · 지출 엑셀 내보내기</li>
                <li>현황 공유 링크 (직원은 로그인 없이 보기)</li>
              </ul>
            </div>
          </div>
          <div className="opt">
            <span>
              남은 객실 '적음' 기준 <b>{s.lowThreshold}실 이하</b>
            </span>
            <div className="step mini">
              <button className="sb" aria-label="줄이기" onClick={() => update((x) => ({ ...x, lowThreshold: Math.max(0, x.lowThreshold - 1) }))}>
                <Minus size={14} />
              </button>
              <button className="sb" aria-label="늘리기" onClick={() => update((x) => ({ ...x, lowThreshold: Math.min(20, x.lowThreshold + 1) }))}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div className="opt">
            <span>호텔 이름</span>
            <input
              className="inp sm"
              value={name}
              maxLength={60}
              onChange={(e) => {
                setName(e.target.value);
                update((x) => x);
              }}
            />
          </div>
          <div className="opt">
            <span>로그인 계정</span>
            <span className="muted">{email}</span>
          </div>
          <p className="fine">같은 계정으로 PC·태블릿·휴대폰에서 동시에 쓸 수 있어요. 직원별 계정은 다음 버전에서 추가돼요.</p>
        </section>
      </div>
    </main>
  );
}

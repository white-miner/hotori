import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Building2, Copy, Link2, Minus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { Building, Floor, HotelSettings, Room } from "../shared/ledger";
import {
  TYPE_NAME_MAX,
  addRoomsToFloor,
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
import { type HotelData, type ShareState, shareCreate, shareDisable, shareStatus, shareUrl } from "./data";
import { FitText, PALETTE, PlatBadge, TypeBadge, TypeLine, uid } from "./ui";

interface Props {
  data: HotelData;
  email: string;
  notify: (m: string) => void;
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
      <div className="sub">직원이 로그인 없이 객실 현황·객실 배치·대실·방 미배정 목록을 볼 수 있어요. 보기만 되고, 판매 가격과 메모는 보이지 않아요.</div>
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
const nextBuildingName = (bs: Building[]) =>
  ["별관", "신관", "A동", "B동", "C동"].find((n) => !bs.some((b) => b.name === n)) ?? `건물 ${bs.length + 1}`;

function Swatches({ value, onChange, noneLabel = "기본" }: { value: string | null | undefined; onChange: (c: string | null) => void; noneLabel?: string }) {
  return (
    <div className="swatches">
      {PALETTE.map((c) => (
        <button
          type="button"
          key={c.name}
          className={`sw ${(value ?? null) === c.value ? "on" : ""} ${c.value ? "" : "none"}`}
          style={c.value ? { background: c.value } : undefined}
          title={c.value ? c.name : noneLabel}
          onClick={() => onChange(c.value)}
        >
          {c.value ? null : <span>{noneLabel}</span>}
        </button>
      ))}
      <label className="sw custom" title="직접 고르기">
        <input type="color" value={value ?? "#DCE9F7"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
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
  const [paint, setPaint] = useState<string | null>(null);
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
      buildings: [...x.buildings, { id, name: nextBuildingName(x.buildings) }],
      floors: [...x.floors, { id: uid("f"), name: "1층", buildingId: id, color: null, rooms: [] }],
    }));
    setSelBuilding(id);
    setSelFloor(null);
    setSelRoom(null);
    notify("건물을 추가했어요. 이름을 바꾸고 층에 방을 추가해 주세요");
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
            ["share", "현황 공유"],
            ["plan", "요금제"],
          ].map(([id, l]) => (
            <a key={id} className="chip" href={`#/settings`} onClick={(e) => (e.preventDefault(), document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth" }))}>
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
              ) : paint ? (
                <>
                  <b>{paint === NO_TYPE ? "타입 없음" : typeLabel(typeOf(paint))}</b> 선택됨 · 방을 누르면 바로 바뀌고, 층 이름을 누르면 그 층 전체가 바뀌어요
                </>
              ) : (
                "타입을 고른 뒤 방을 누르면 한꺼번에 지정돼요"
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
                    <span>{bd.name}</span>
                  </button>
                  <span className="tag">{bRooms(bd.id)}실</span>
                  <button className="btn line sm push" onClick={() => addFloor(bd.id)}>
                    <Plus size={14} />층 추가
                  </button>
                </div>
              ) : null}
              {floorsOf(s, bd.id).map((f) => (
            <div className="sfl" key={f.id}>
              <button className={`fl flbtn ${selFloor === f.id ? "on" : ""}`} title={paint ? `${f.name} 전체를 이 타입으로` : f.name} onClick={() => (paint ? paintFloor(f) : (setSelFloor(selFloor === f.id ? null : f.id), setSelRoom(null), setSelBuilding(null)))}>
                <span className="fdot" style={f.color ? { background: f.color } : undefined} />
                {f.name}
              </button>
              <div className={`rboxes ${paint ? "painting" : ""}`}>
                {f.rooms.map((r) => {
                  const strip = r.color ?? f.color;
                  return (
                    <button
                      key={r.id}
                      className={`rbox ${/^\d+$/.test(r.no) ? "" : "k"} ${selRoom === r.id && !paint ? "sel" : ""} ${paint && paintTarget === (r.typeId ?? null) ? "same" : ""}`}
                      style={strip ? { background: strip } : undefined}
                      onClick={() => {
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
                  placeholder="예: 본관, 별관, A동"
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
                    if (n && !confirm(`${building.name}${josa(building.name, "과", "와")} 층 ${fl.length}개, 방 ${n}개를 지울까요? 그 방의 기존 예약은 '방 미배정 숙박'으로 옮겨져요.`)) return;
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
                        {b.name}
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
                <b>{multi ? `${s.buildings.find((b) => b.id === room.f.buildingId)?.name ?? ""} ` : ""}{room.r.no}호 고치기</b>
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

        <section className="card">
          <h3>
            객실 타입 <span className="tag">{s.types.length}개</span>
          </h3>
          <div className="sub">방 칸과 객실 현황 표에 그대로 보여요 (최대 {TYPE_NAME_MAX}글자) · 오른쪽 숫자는 그 타입으로 지정된 방 수예요</div>
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

        <section className="card" id="set-plats">
          <h3>
            플랫폼 <span className="tag">{s.platforms.length}개</span>
          </h3>
          <div className="sub">동그라미 속 한 글자는 화이트보드 메모처럼 방 칸에 보여요. 위에서부터 단축키 1~9가 붙어요.</div>
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
              </ul>
            </div>
            <div className={hotel.plan === "pro" ? "now" : ""}>
              <b>Pro {hotel.plan === "pro" ? <span className="tag">사용 중</span> : null}</b>
              <ul>
                <li>객실 수 제한 없음</li>
                <li>직원 여러 명 동시 사용</li>
                <li>장부 무기한 · 엑셀 내보내기</li>
                <li>월별 플랫폼 합계 · 수정 기록</li>
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

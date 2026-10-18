import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus, Trash2, X } from "lucide-react";
import type { Floor, HotelSettings, Room } from "../shared/ledger";
import { typeTotals } from "../shared/ledger";
import type { HotelData } from "./data";
import { PALETTE, PlatBadge, TypeBadge, uid } from "./ui";

interface Props {
  data: HotelData;
  email: string;
  notify: (m: string) => void;
}
const move = <T,>(a: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  const b = a.slice();
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};
/** "601~610, 방갈로" → ["601", ..., "610", "방갈로"] */
export function parseRoomInput(v: string): string[] {
  const out: string[] = [];
  for (const part of v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d{1,5})\s*[~-]\s*(\d{1,5})$/.exec(part);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b >= a && b - a < 60) for (let n = a; n <= b; n++) out.push(String(n));
    } else out.push(part.slice(0, 12));
  }
  return out;
}

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

  const addRooms = (fid: string) => {
    const existing = new Set(s.floors.flatMap((f) => f.rooms.map((r) => r.no)));
    const nos = parseRoomInput(addVal).filter((n) => !existing.has(n));
    if (!nos.length) return setAdding(null);
    setFloor(fid, (f) => ({ ...f, rooms: [...f.rooms, ...nos.map((no) => ({ id: uid("r"), no, typeId: paint ?? s.types[0]?.id ?? null, color: null }))] }));
    setAddVal("");
    setAdding(null);
    notify(`${nos.length}개 방을 추가했어요`);
  };
  const room = selRoom ? s.floors.flatMap((f) => f.rooms.map((r) => ({ r, f }))).find((x) => x.r.id === selRoom) : undefined;
  const floor = selFloor ? s.floors.find((f) => f.id === selFloor) : undefined;

  return (
    <main className="page settings">
      <div className="ph">
        <div>
          <h1>설정 · 우리 호텔 객실</h1>
          <div className="sub">처음 한 번만 등록하면 돼요. 화이트보드처럼 층과 방 번호를 적고, 방마다 타입을 정해요.</div>
        </div>
        <div className="chips">
          <span className={`save-st ${saving}`}>
            {saving === "saving" ? "저장 중…" : saving === "saved" ? "저장됨" : saving === "error" ? "저장 안 됨" : ""}
          </span>
          {[
            ["rooms", "객실·타입"],
            ["plats", "플랫폼"],
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
            층 줄에 방을 추가하고(예: <b>601~610</b>), 위에서 타입을 고른 뒤 방을 누르면 그 타입으로 바뀌어요. 층 이름을 누르면 번호줄 색을 고를 수 있어요.
          </div>
          <div className="paint">
            칠할 타입
            {s.types.map((t) => (
              <button key={t.id} className={`chip sm ${paint === t.id ? "on" : ""}`} onClick={() => setPaint(paint === t.id ? null : t.id)}>
                <TypeBadge t={t} />
                {t.name}
              </button>
            ))}
            {!s.types.length ? <span className="muted">아래 '객실 타입'에서 타입을 먼저 추가해 주세요</span> : null}
            <button
              className="btn line sm push"
              onClick={() => {
                const id = uid("f");
                update((x) => ({ ...x, floors: [...x.floors, { id, name: `${x.floors.length + 1}층`, color: null, rooms: [] }] }));
                setSelFloor(id);
                setSelRoom(null);
              }}
            >
              <Plus size={14} />층 추가
            </button>
          </div>
          {s.floors.map((f) => (
            <div className="sfl" key={f.id}>
              <button className={`fl flbtn ${selFloor === f.id ? "on" : ""}`} onClick={() => (setSelFloor(selFloor === f.id ? null : f.id), setSelRoom(null))}>
                <span className="fdot" style={f.color ? { background: f.color } : undefined} />
                {f.name}
              </button>
              <div className="rboxes">
                {f.rooms.map((r) => {
                  const strip = r.color ?? f.color;
                  return (
                    <button
                      key={r.id}
                      className={`rbox ${/^\d+$/.test(r.no) ? "" : "k"} ${selRoom === r.id ? "sel" : ""}`}
                      style={strip ? { background: strip } : undefined}
                      onClick={() => {
                        if (paint) setRoom(r.id, (x) => ({ ...x, typeId: paint }));
                        else {
                          setSelRoom(selRoom === r.id ? null : r.id);
                          setSelFloor(null);
                        }
                      }}
                    >
                      {r.no}
                      <TypeBadge t={typeOf(r.typeId)} />
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
                    <input autoFocus className="inp" placeholder="601~610 또는 방갈로" value={addVal} onChange={(e) => setAddVal(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} />
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
          {!s.floors.length ? <div className="lempty">'층 추가'를 눌러 첫 층을 만들어 주세요</div> : null}

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
                <button className="btn line sm" onClick={() => update((x) => ({ ...x, floors: move(x.floors, x.floors.indexOf(floor), -1) }))}>
                  <ArrowUp size={14} />
                  위로
                </button>
                <button className="btn line sm" onClick={() => update((x) => ({ ...x, floors: move(x.floors, x.floors.indexOf(floor), 1) }))}>
                  <ArrowDown size={14} />
                  아래로
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    if (floor.rooms.length && !confirm(`${floor.name}과 방 ${floor.rooms.length}개를 지울까요? 기존 예약은 '방을 아직 안 정한 숙박'으로 옮겨져요.`)) return;
                    update((x) => ({ ...x, floors: x.floors.filter((f) => f.id !== floor.id) }));
                    setSelFloor(null);
                  }}
                >
                  <Trash2 size={14} />층 지우기
                </button>
              </div>
              <div className="ed-row">
                <label>번호줄 색</label>
                <Swatches value={floor.color} onChange={(c) => setFloor(floor.id, (f) => ({ ...f, color: c }))} />
              </div>
            </div>
          ) : null}

          {room ? (
            <div className="editor">
              <div className="ed-h">
                <b>{room.r.no}호 고치기</b>
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
                  {s.types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} {t.name}
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
                <label>방 색 (특수객실)</label>
                <Swatches value={room.r.color} noneLabel="층 색" onChange={(c) => setRoom(room.r.id, (r) => ({ ...r, color: c }))} />
              </div>
            </div>
          ) : null}
        </section>

        <section className="card">
          <h3>
            객실 타입 <span className="tag">{s.types.length}개</span>
          </h3>
          <div className="sub">코드는 칩과 방 칸에 그대로 보여요 (최대 3글자)</div>
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
                value={t.code}
                maxLength={3}
                aria-label="타입 코드"
                onChange={(e) => update((x) => ({ ...x, types: x.types.map((y) => (y.id === t.id ? { ...y, code: e.target.value.toUpperCase() } : y)) }))}
              />
              <input
                className="nin"
                value={t.name}
                maxLength={20}
                aria-label="타입 이름"
                onChange={(e) => update((x) => ({ ...x, types: x.types.map((y) => (y.id === t.id ? { ...y, name: e.target.value } : y)) }))}
              />
              <span className="cnt">{totals.get(t.id) ?? 0}</span>
              <span className="mut">실</span>
              <button
                className="ic"
                aria-label="타입 지우기"
                onClick={() => {
                  if (used.t.has(t.id)) return notify("예약 기록에 쓰인 타입은 지울 수 없어요. 이름을 바꿔 주세요.");
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
            onClick={() => update((x) => ({ ...x, types: [...x.types, { id: uid("t"), code: "N", name: "새 타입" }] }))}
          >
            <Plus size={14} />
            타입 추가
          </button>
        </section>

        <section className="card" id="set-plats">
          <h3>
            플랫폼 <span className="tag">{s.platforms.length}개</span>
          </h3>
          <div className="sub">한 글자 약자는 화이트보드 메모처럼 방 칸에 보여요. 순서대로 단축키 1~9가 붙어요.</div>
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
                aria-label="약자"
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
                  if (used.p.has(p.id)) return notify("예약 기록에 쓰인 플랫폼은 지울 수 없어요. 이름을 바꿔 주세요.");
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

        <section className="card" id="set-plan">
          <h3>
            요금제 <span className="tag red">결제는 준비 중</span>
          </h3>
          <div className="sub">지금은 표시만 해요. 결제는 검증이 끝난 뒤에 붙여요.</div>
          <div className="plan">
            <div className={hotel.plan === "free" ? "now" : ""}>
              <b>Free {hotel.plan === "free" ? <span className="tag">사용 중</span> : null}</b>
              <ul>
                <li>객실 20실까지</li>
                <li>직원 1명 · 기기 1대</li>
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

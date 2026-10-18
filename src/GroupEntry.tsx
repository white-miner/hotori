// 단체 예약 만들기: 방 여러 개를 한 번에 (모두 되거나 모두 안 돼요)
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, Minus, Plus } from "lucide-react";
import { type HotelSettings, addDays, allRooms, dayLabel, orderedFloors, typeLabel, usableTypes, won } from "../shared/ledger";
import { autoPick, freeForStay, groupDrafts, groupStockImpact, splitTotal, validateGroup, GROUP_NAME_MAX } from "../shared/group";
import { typeGuests } from "../shared/surcharge";
import { type GroupPayMode, PAY_MODE_LABEL, rateFormula, ratePrices } from "../shared/settle";
import type { HotelData } from "./data";
import { PlatBadge, TypeBadge, lookups } from "./ui";

type PriceMode = "rate" | "room" | "total";
interface Props {
  data: HotelData;
  today: string;
  /** 처음 값 (예약 창에서 고르던 플랫폼·입실일) */
  init: { platformId: string; checkIn: string; nights: number };
  onBack: () => void;
  onClose: () => void;
  onSaved: (msg: string) => void;
}
const num = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const roomOrder = (s: HotelSettings) => new Map(allRooms(s).map((r, i) => [r.id, i]));

export default function GroupEntry({ data, today, init, onBack, onClose, onSaved }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const [name, setName] = useState("");
  const [platformId, setPlatformId] = useState(init.platformId);
  const [checkIn, setCheckIn] = useState(init.checkIn);
  const [nights, setNights] = useState(Math.max(1, init.nights));
  const [mode, setMode] = useState<PriceMode>("rate");
  const [rates, setRates] = useState<Record<string, string>>({});
  // 결제: 선결제 · 후불(퇴실 후 정산) — 후불이면 결제 예정일 · 결제자
  const [payMode, setPayMode] = useState<GroupPayMode>("prepaid");
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [payer, setPayer] = useState({ company: "", name: "", phone: "" });
  const [roomPrice, setRoomPrice] = useState("");
  const [total, setTotal] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState<"count" | "board">("count");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const free = useMemo(() => freeForStay(s, data.bookings, checkIn, nights), [s, data.bookings, checkIn, nights]);
  const order = useMemo(() => roomOrder(s), [s]);
  const rmap = useMemo(() => new Map(allRooms(s).map((r) => [r.id, r])), [s]);
  // 날짜를 바꿔서 겹치게 된 방은 빼고 알려 드려요
  useEffect(() => {
    const gone = picked.filter((id) => !free.has(id));
    if (!gone.length) return;
    setPicked((x) => x.filter((id) => free.has(id)));
    setNote(`${gone.map((id) => L.roomLabel(id)).join(", ")}호는 그 기간에 다른 예약이 있어서 뺐어요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free]);

  useEffect(() => setErr(null), [picked, nights, checkIn, mode, roomPrice, total, rates, payMode]);
  const sorted = [...picked].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const types = usableTypes(s.types);
  const countOf = (tid: string) => sorted.filter((id) => rmap.get(id)?.typeId === tid).length;
  const freeOf = (tid: string) => allRooms(s).filter((r) => r.typeId === tid && free.has(r.id)).length;
  const setCount = (tid: string, n: number) => {
    const others = picked.filter((id) => rmap.get(id)?.typeId !== tid);
    const add = autoPick(s, free, tid, Math.max(0, Math.min(n, freeOf(tid))), new Set(others));
    setPicked([...others, ...add]);
    setNote(null);
  };
  const toggle = (id: string) => {
    if (!free.has(id)) return;
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
    setNote(null);
  };
  const n = sorted.length;
  const rateNum: Record<string, number> = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v || 0)]));
  const prices =
    mode === "rate"
      ? ratePrices(sorted.map((id) => rmap.get(id)?.typeId ?? ""), rateNum, nights)
      : mode === "room"
        ? sorted.map(() => Number(roomPrice || 0))
        : splitTotal(Number(total || 0), n);
  const pickedTypes = types.filter((t) => countOf(t.id) > 0);
  const formula = rateFormula(pickedTypes.map((t) => ({ label: typeLabel(t), n: countOf(t.id), rate: rateNum[t.id] ?? 0 })), nights);
  const sum = prices.reduce((a, b) => a + b, 0);
  const impact = groupStockImpact(s, data.bookings, checkIn, nights, sorted);
  const over = impact.filter((x) => x.after < 0);
  const summary = types.map((t) => [t, countOf(t.id)] as const).filter(([, c]) => c > 0).map(([t, c]) => `${typeLabel(t)} ${c}`).join(" · ");
  const checkOut = addDays(checkIn, nights);

  const save = async () => {
    if (busy) return;
    const v = validateGroup({ name, platformId, nights, roomIds: sorted, prices, free });
    if (v) return setErr(v);
    if (over.length) return setErr(`${over.map((x) => typeLabel(L.types.get(x.typeId))).join(", ")} 남은 객실이 모자라요. 방을 다시 골라 주세요.`);
    if (mode === "rate" && pickedTypes.some((t) => !rateNum[t.id])) return setErr("타입마다 1박 요금을 적어 주세요.");
    if (!sum) return setErr(mode === "room" ? "1실 가격을 적어 주세요." : "총액을 적어 주세요.");
    if (payMode === "postpaid" && !payer.company.trim() && !payer.name.trim()) return setErr("후불이면 결제자(회사나 담당자)를 적어 주세요.");
    setBusy(true);
    setErr(null);
    try {
      const groupId = crypto.randomUUID();
      const list = groupDrafts({ groupId, groupName: name, platformId, checkIn, nights, roomIds: sorted, prices, s, guestsOf: (tid) => typeGuests(L.types.get(tid)).base });
      await data.saveGroup(list, {
        id: groupId,
        payMode,
        dueOn: payMode === "postpaid" ? (dueOn ?? checkOut) : null,
        payerCompany: payer.company || null,
        payerName: payer.name || null,
        payerPhone: payer.phone || null,
        rates: mode === "rate" ? Object.fromEntries(pickedTypes.map((t) => [t.id, rateNum[t.id]])) : null,
        extras: [],
      });
      onSaved(`단체 ${name.trim()} ${n}실 · ${nights}박 예약을 한 번에 기록했어요 · 합계 ${won(sum)}원${payMode === "postpaid" ? " · 후불" : ""}`);
    } catch (e) {
      setErr(e instanceof Error ? `하나도 저장하지 않았어요: ${e.message}` : "하나도 저장하지 않았어요. 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  };

  const dateChips = [today, addDays(today, 1), addDays(today, 2)];
  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal grp"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>단체 예약</h2>
          <div className="seg">
            <button type="button" onClick={onBack}>
              숙박
            </button>
            <button type="button" onClick={onBack}>
              대실
            </button>
            <button type="button" className="on">
              단체
            </button>
          </div>
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        <div className="fld">
          <label>
            단체명<em>*</em>
          </label>
          <input className="inp" autoFocus placeholder="예: 한빛상사 워크숍" maxLength={GROUP_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} aria-label="단체명" />
        </div>
        <div className="fld">
          <label>
            플랫폼<em>*</em>
          </label>
          <div className="chips scroll">
            {s.platforms.map((pl) => (
              <button type="button" key={pl.id} className={`chip ${pl.id === platformId ? "on" : ""}`} onClick={() => setPlatformId(pl.id)}>
                <PlatBadge p={pl} />
                {pl.name}
              </button>
            ))}
          </div>
        </div>
        <div className="fld">
          <label>
            입실 날짜<em>*</em>
          </label>
          <div className="chips scroll">
            {dateChips.map((d, i) => (
              <button type="button" key={d} className={`chip ${checkIn === d ? "on" : ""}`} onClick={() => setCheckIn(d)}>
                {["오늘", "내일", "모레"][i]} {dayLabel(d)}
              </button>
            ))}
            <label className={`chip datechip ${dateChips.includes(checkIn) ? "" : "on"}`}>
              <CalendarDays size={15} />
              <span className="dl">{dateChips.includes(checkIn) ? "날짜 고르기" : dayLabel(checkIn)}</span>
              <input type="date" min="2020-01-01" max="2099-12-31" value={checkIn} onChange={(e) => e.target.value && setCheckIn(e.target.value)} aria-label="입실 날짜" />
            </label>
          </div>
        </div>
        <div className="fld">
          <label>
            박수<em>*</em>
          </label>
          <div className="step">
            <button type="button" className="sb" aria-label="1박 줄이기" onClick={() => setNights((v) => Math.max(1, v - 1))}>
              <Minus size={16} />
            </button>
            <span className="sv">
              {nights}
              <small>박</small>
            </span>
            <button type="button" className="sb" aria-label="1박 늘리기" onClick={() => setNights((v) => Math.min(90, v + 1))}>
              <Plus size={16} />
            </button>
            <span className="rng">
              <b>{dayLabel(checkIn)} {s.stayTimes.checkIn}</b> 입실 → <b>{dayLabel(checkOut)} {s.stayTimes.checkOut}</b> 퇴실 · 이 기간 내내 빈 방만 고를 수 있어요
            </span>
          </div>
        </div>

        <div className="fld gpick">
          <label>
            방<em>*</em>
          </label>
          <div className="payb">
            <div className="gtop">
              <div className="seg sm">
                <button type="button" className={view === "count" ? "on" : ""} onClick={() => setView("count")}>
                  타입별 개수
                </button>
                <button type="button" className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
                  방 직접 고르기
                </button>
              </div>
              <span className="gsum">
                {n ? (
                  <>
                    <b>{n}실</b> · {summary}
                  </>
                ) : (
                  <span className="muted">아직 고른 방이 없어요</span>
                )}
              </span>
              {n ? (
                <button type="button" className="auto" onClick={() => setPicked([])}>
                  모두 빼기
                </button>
              ) : null}
            </div>
            {view === "count" ? (
              <div className="gcounts">
                {types.map((t) => {
                  const c = countOf(t.id);
                  const f = freeOf(t.id);
                  return (
                    <div className={`gcnt ${c ? "on" : ""}`} key={t.id}>
                      <TypeBadge t={t} />
                      <span className="muted sm">빈 방 {f}</span>
                      <span className="step sm">
                        <button type="button" className="sb" aria-label={`${typeLabel(t)} 1실 빼기`} disabled={!c} onClick={() => setCount(t.id, c - 1)}>
                          <Minus size={14} />
                        </button>
                        <input
                          className="gin num"
                          inputMode="numeric"
                          aria-label={`${typeLabel(t)} 방 수`}
                          value={c}
                          onChange={(e) => setCount(t.id, Number(num(e.target.value) || 0))}
                        />
                        <button type="button" className="sb" aria-label={`${typeLabel(t)} 1실 더하기`} disabled={c >= f} onClick={() => setCount(t.id, c + 1)}>
                          <Plus size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                <div className="muted sm gnote">개수를 적으면 같은 층의 붙은 방부터 골라 드려요. 바꾸려면 '방 직접 고르기'에서 눌러요.</div>
              </div>
            ) : null}
            <div className={`gboard ${view === "board" ? "" : "mini"}`}>
              {orderedFloors(s).map((f) => {
                const rooms = f.rooms.filter((r) => r.typeId);
                if (!rooms.length) return null;
                return (
                  <div className="gfloor" key={f.id}>
                    <span className="gfl">{L.roomLabel(rooms[0].id)?.replace(rooms[0].no, "").trim() ? `${L.rooms.get(rooms[0].id)?.building?.name ?? ""} ` : ""}{f.name}</span>
                    <div className="grooms">
                      {rooms.map((r) => {
                        const on = picked.includes(r.id);
                        const ok = free.has(r.id);
                        return (
                          <button
                            type="button"
                            key={r.id}
                            className={`groom ${on ? "on" : ""} ${ok ? "" : "busy"}`}
                            disabled={!ok || view !== "board"}
                            title={ok ? `${r.no}호 · ${typeLabel(L.types.get(r.typeId ?? ""))}` : `${r.no}호 · 그 기간에 다른 예약이 있어요`}
                            onClick={() => toggle(r.id)}
                          >
                            <b>{r.no}</b>
                            <span>{typeLabel(L.types.get(r.typeId ?? ""))}</span>
                            {on ? <Check size={11} strokeWidth={3} className="gck" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {note ? <div className="muted sm">{note}</div> : null}
          </div>
        </div>

        <div className="fld">
          <label>
            가격<em>*</em>
          </label>
          <div className="payb">
            <div className="seg sm">
              <button type="button" className={mode === "rate" ? "on" : ""} onClick={() => setMode("rate")}>
                타입별 1박 요금
              </button>
              <button type="button" className={mode === "room" ? "on" : ""} onClick={() => setMode("room")}>
                1실 가격
              </button>
              <button type="button" className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>
                총액 나누기
              </button>
            </div>
            {mode === "rate" ? (
              <div className="grates">
                {pickedTypes.length ? (
                  pickedTypes.map((t) => (
                    <label className="grate" key={t.id}>
                      <TypeBadge t={t} />
                      <span className="muted sm">{countOf(t.id)}실 · 1박</span>
                      <span className="inp price sm">
                        <input
                          className="num"
                          inputMode="numeric"
                          aria-label={`${typeLabel(t)} 1박 요금`}
                          value={rates[t.id] ? won(Number(rates[t.id])) : ""}
                          onChange={(e) => setRates({ ...rates, [t.id]: num(e.target.value) })}
                        />
                        원
                      </span>
                    </label>
                  ))
                ) : (
                  <span className="muted sm">방을 고르면 타입마다 1박 요금 칸이 생겨요</span>
                )}
              </div>
            ) : (
              <div className="paydep">
                {mode === "room" ? (
                  <label className="inp price">
                    <input className="num" inputMode="numeric" placeholder={`1실 ${nights}박 금액`} aria-label="1실 가격" value={roomPrice ? won(Number(roomPrice)) : ""} onChange={(e) => setRoomPrice(num(e.target.value))} />원
                  </label>
                ) : (
                  <label className="inp price">
                    <input className="num" inputMode="numeric" placeholder="단체 총액" aria-label="단체 총액" value={total ? won(Number(total)) : ""} onChange={(e) => setTotal(num(e.target.value))} />원
                  </label>
                )}
              </div>
            )}
            <span className="gline gtotal">
              {n && sum ? (
                mode === "rate" ? (
                  <>
                    {formula} = <b>{won(sum)}원</b>
                  </>
                ) : mode === "room" ? (
                  <>
                    {n}실 × {won(Number(roomPrice))} = <b>{won(sum)}원</b>
                  </>
                ) : (
                  <>
                    1실 {won(prices[n - 1] ?? 0)}
                    {prices[0] !== prices[n - 1] ? ` (첫 방 ${won(prices[0])})` : ""} · 합계 <b>{won(sum)}원</b>
                  </>
                )
              ) : (
                <span className="muted">방을 고르고 금액을 적으면 합계가 보여요</span>
              )}
            </span>
          </div>
        </div>

        <div className="fld gpay">
          <label>결제</label>
          <div className="payb">
            <div className="seg sm">
              {(["prepaid", "postpaid"] as const).map((m) => (
                <button type="button" key={m} className={payMode === m ? "on" : ""} onClick={() => setPayMode(m)}>
                  {PAY_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            {payMode === "postpaid" ? (
              <div className="gpayer">
                <label className="gpl">
                  <span>결제 예정일</span>
                  <input className="inp sm" type="date" aria-label="결제 예정일" value={dueOn ?? checkOut} onChange={(e) => e.target.value && setDueOn(e.target.value)} />
                </label>
                <input className="inp sm" placeholder="회사 이름" aria-label="결제자 회사" maxLength={60} value={payer.company} onChange={(e) => setPayer({ ...payer, company: e.target.value })} />
                <input className="inp sm" placeholder="담당자" aria-label="결제자 담당자" maxLength={40} value={payer.name} onChange={(e) => setPayer({ ...payer, name: e.target.value })} />
                <input className="inp sm" placeholder="연락처" aria-label="결제자 연락처" inputMode="tel" maxLength={30} value={payer.phone} onChange={(e) => setPayer({ ...payer, phone: e.target.value })} />
              </div>
            ) : (
              <span className="muted sm">방마다 잔금은 보이지 않고, 장부의 단체 줄에서 한 번에 정산해요</span>
            )}
          </div>
        </div>

        <div className="pv">
          {impact.length ? (
            <>
              <div className="pt">
                저장하면 {dayLabel(checkIn)} ~ {dayLabel(addDays(checkOut, -1))} 밤 남은 객실 (가장 적은 날)
              </div>
              {impact.map((r) => {
                const t = L.types.get(r.typeId);
                return (
                  <div className="pvr" key={r.typeId}>
                    <TypeBadge t={t} />
                    <span className="pn">
                      {typeLabel(t)} {r.n}실
                    </span>
                    <span className="v">
                      <s>{r.before}</s>
                      <ArrowRight size={16} />
                      <span className={r.after <= 0 ? "tred" : ""}>{r.after < 0 ? `−${-r.after}` : r.after}</span>
                    </span>
                    {r.after < 0 ? <span className="w tred">모자라요 · 저장할 수 없어요</span> : r.after === 0 ? <span className="w tred">만실이 돼요</span> : null}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="pt">방을 고르면 남은 객실이 어떻게 바뀌는지 보여요. 겹치는 방은 고를 수 없어요.</div>
          )}
        </div>

        {err ? <div className="ferr">{err}</div> : null}
        <div className="mf">
          <div className="keys">
            <span className="muted sm">방마다 예약이 한 줄씩 생기고 장부에서는 한 줄로 묶여요</span>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn red" disabled={busy}>
            {busy ? "저장 중…" : n ? `${n}실 한 번에 저장` : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

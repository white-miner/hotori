// 기존 단체에 객실(또는 타입만) 추가 · group_id는 그대로, booking_groups는 새로 만들지 않아요
import { useEffect, useMemo, useState } from "react";
import { saveFailMessage } from "../shared/errors";
import { askConfirm } from "./ConfirmDialog";
import { ArrowRight, CalendarDays, Check, Minus, Plus } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  addDays,
  allRooms,
  checkOutFromStayNights,
  clampStayNights,
  dayLabel,
  nightsFromStayDates,
  orderedFloors,
  stockTable,
  typeLabel,
  usableTypes,
  won,
} from "../shared/ledger";
import {
  autoPick,
  expandTypeSlots,
  freeForStay,
  groupDrafts,
  groupStockImpact,
  groupStockImpactByTypes,
  splitTotal,
  validateGroupAttach,
  GROUP_ROOMS_MAX,
} from "../shared/group";
import { typeGuests } from "../shared/surcharge";
import { rateFormula, ratePrices } from "../shared/settle";
import type { HotelData } from "./data";
import { PlatBadge, TypeBadge, lookups } from "./ui";

type AssignMode = "rooms" | "typeOnly";
type PriceMode = "rate" | "member" | "room" | "total" | "line";

interface Props {
  data: HotelData;
  today: string;
  /** 기존 단체 멤버 (groupId · groupName · platform · 날짜 기본값) */
  members: Booking[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

const num = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const roomOrder = (s: HotelSettings) => new Map(allRooms(s).map((r, i) => [r.id, i]));

export default function GroupAdd({ data, today, members, onClose, onSaved }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const first = members[0];
  const groupId = first.groupId!;
  const groupName = first.groupName ?? first.guestName;
  const info = data.groups.get(groupId);
  const [platformId, setPlatformId] = useState(first.platformId);
  const [checkIn, setCheckIn] = useState(first.checkIn);
  const [nights, setNights] = useState(clampStayNights(first.nights ?? 1));
  const checkOutDate = checkOutFromStayNights(checkIn, nights);
  const setStayCheckIn = (d: string) => setCheckIn(d);
  const setStayNights = (n: number) => setNights(clampStayNights(n));
  const setStayCheckOut = (d: string) => setNights(nightsFromStayDates(checkIn, d));
  const [assignMode, setAssignMode] = useState<AssignMode>("typeOnly");
  const [mode, setMode] = useState<PriceMode>(info?.rates && Object.keys(info.rates).length ? "rate" : "line");
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(info?.rates ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [roomPrice, setRoomPrice] = useState("");
  const [total, setTotal] = useState("");
  const [linePrices, setLinePrices] = useState<string[]>([]);
  const [memberRates, setMemberRates] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<"count" | "board">("board");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tentative, setTentative] = useState(false);
  const [noClean, setNoClean] = useState(false);

  const free = useMemo(() => freeForStay(s, data.bookings, checkIn, nights), [s, data.bookings, checkIn, nights]);
  const order = useMemo(() => roomOrder(s), [s]);
  const rmap = useMemo(() => new Map(allRooms(s).map((r) => [r.id, r])), [s]);
  useEffect(() => {
    if (assignMode !== "rooms") return;
    const gone = picked.filter((id) => !free.has(id));
    if (!gone.length) return;
    setPicked((x) => x.filter((id) => free.has(id)));
    setNote(`${gone.map((id) => L.roomLabel(id)).join(", ")}호는 그 기간에 다른 예약이 있어서 뺐어요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free, assignMode]);

  useEffect(() => setErr(null), [picked, typeCounts, nights, checkIn, mode, roomPrice, total, rates, assignMode, linePrices, memberRates]);

  const types = usableTypes(s.types);
  const sorted = [...picked].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const typeOnlySlots = types.map((t) => ({ typeId: t.id, count: typeCounts[t.id] ?? 0 })).filter((x) => x.count > 0);
  const typeIds = assignMode === "typeOnly" ? expandTypeSlots(typeOnlySlots) : sorted.map((id) => rmap.get(id)?.typeId ?? "");
  const n = typeIds.length;
  const countOf = (tid: string) => (assignMode === "typeOnly" ? typeCounts[tid] ?? 0 : sorted.filter((id) => rmap.get(id)?.typeId === tid).length);
  const freeOf = (tid: string) => allRooms(s).filter((r) => r.typeId === tid && free.has(r.id)).length;
  const stockLeft = (tid: string) => {
    const dates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
    const table = stockTable(s, data.bookings, dates);
    return Math.min(...dates.map((d) => table.get(tid)?.get(d) ?? 0));
  };
  const setCount = (tid: string, next: number) => {
    if (assignMode === "typeOnly") {
      const c = Math.max(0, Math.min(GROUP_ROOMS_MAX, next));
      setTypeCounts((m) => ({ ...m, [tid]: c }));
      setNote(null);
      return;
    }
    const others = picked.filter((id) => rmap.get(id)?.typeId !== tid);
    const add = autoPick(s, free, tid, Math.max(0, Math.min(next, freeOf(tid))), new Set(others));
    setPicked([...others, ...add]);
    setNote(null);
  };
  const toggle = (id: string) => {
    if (!free.has(id)) return;
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
    setNote(null);
  };

  const rateNum: Record<string, number> = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v || 0)]));
  const prefills = ratePrices(typeIds, rateNum, nights);
  useEffect(() => {
    setLinePrices((prev) => {
      if (prev.length === typeIds.length) return prev;
      return typeIds.map((tid, i) => {
        if (i < prev.length && prev[i] !== "") return prev[i];
        const p = prefills[i];
        return p ? String(p) : "";
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeIds.join("|"), nights]);

  useEffect(() => {
    setMemberRates((prev) =>
      typeIds.map((tid, i) => {
        const r = rateNum[tid];
        if (r) return String(r);
        if (i < prev.length && prev[i] !== "") return prev[i];
        return "";
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeIds.join("|"), Object.values(rateNum).join("|")]);

  const memberRateNums = memberRates.map((x) => Number(x || 0));
  const prices =
    mode === "rate"
      ? prefills
      : mode === "member"
        ? memberRateNums.map((r) => r * nights)
        : mode === "room"
          ? typeIds.map(() => Number(roomPrice || 0))
          : mode === "total"
            ? splitTotal(Number(total || 0), n)
            : linePrices.map((x) => Number(x || 0));
  const pickedTypes = types.filter((t) => countOf(t.id) > 0);
  const formula = rateFormula(
    pickedTypes.map((t) => ({ label: typeLabel(t), n: countOf(t.id), rate: rateNum[t.id] ?? 0 })),
    nights,
  );
  const sum = prices.reduce((a, b) => a + b, 0);
  const impact =
    assignMode === "typeOnly"
      ? groupStockImpactByTypes(s, data.bookings, checkIn, nights, Object.fromEntries(typeOnlySlots.map((x) => [x.typeId, x.count])))
      : groupStockImpact(s, data.bookings, checkIn, nights, sorted);
  const over = impact.filter((x) => x.after < 0);
  const summary = types.map((t) => [t, countOf(t.id)] as const).filter(([, c]) => c > 0).map(([t, c]) => `${typeLabel(t)} ${c}`).join(" · ");
  const checkOut = checkOutDate;

  const switchAssign = (m: AssignMode) => {
    setAssignMode(m);
    setPicked([]);
    setTypeCounts({});
    setNote(null);
    setView(m === "rooms" ? "board" : "count");
    if (m === "typeOnly") setTentative(false);
  };

  const save = async () => {
    if (busy) return;
    const v = validateGroupAttach({
      nights,
      roomIds: assignMode === "rooms" ? sorted : [],
      prices,
      free,
      typeOnly: assignMode === "typeOnly" ? typeOnlySlots : undefined,
    });
    if (v) return setErr(v);
    if (over.length) {
      const overOk = await askConfirm({
        title: "타입 재고 부족",
        body: `${over.map((x) => typeLabel(L.types.get(x.typeId))).join(", ")} 타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요?`,
        confirmLabel: "저장",
      });
      if (!overOk) return;
    }
    if (mode === "rate" && pickedTypes.some((t) => !rateNum[t.id])) return setErr("타입마다 1박 요금을 입력해 주세요.");
    if (mode === "member" && memberRateNums.some((x) => !x)) return setErr("방마다 1박 요금을 입력해 주세요.");
    if (mode === "line" && prices.some((x) => !x)) return setErr("방마다 금액을 입력해 주세요.");
    if (!sum)
      return setErr(
        mode === "room" ? "1실 가격을 입력해 주세요." : mode === "line" || mode === "member" ? "방마다 요금을 입력해 주세요." : "총액을 입력해 주세요.",
      );
    setBusy(true);
    setErr(null);
    try {
      const memberFlats =
        mode === "member"
          ? memberRateNums
          : mode === "rate"
            ? typeIds.map((tid) => rateNum[tid] ?? 0)
            : prices.map((p) => (nights > 0 ? Math.round(p / nights) : 0));
      const list = groupDrafts({
        groupId,
        groupName,
        platformId,
        checkIn,
        nights,
        roomIds: assignMode === "rooms" ? sorted : undefined,
        typeIds: assignMode === "typeOnly" ? typeIds : undefined,
        prices,
        memberRates: memberFlats.some((x) => x > 0) ? memberFlats : undefined,
        s,
        guestsOf: (tid) => typeGuests(L.types.get(tid)).base,
        tentative: assignMode === "rooms" && tentative,
        noClean,
      });
      // info 없이 → booking_groups는 그대로, 멤버 줄만 추가
      await data.saveGroup(list);
      const how = assignMode === "typeOnly" ? `${n}실(간단 예약·호실 미정)` : `${n}실`;
      const tentTag = assignMode === "rooms" && tentative ? " · 임시" : "";
      onSaved(`단체 ${groupName}에 ${how} 추가했어요 · 합계 ${won(sum)}원${tentTag}${noClean ? " · 청소X" : ""}`);
    } catch (e) {
      setErr(saveFailMessage(e, "추가하지 못했어요"));
    } finally {
      setBusy(false);
    }
  };

  const dateChips = [today, addDays(today, 1), addDays(today, 2)];
  const lineRows =
    assignMode === "typeOnly"
      ? typeIds.map((tid, i) => ({ key: `t${i}-${tid}`, label: typeLabel(L.types.get(tid)), sub: "호실 미정", typeId: tid, i }))
      : sorted.map((id, i) => ({
          key: id,
          label: `${L.roomLabel(id)}호`,
          sub: typeLabel(L.types.get(rmap.get(id)?.typeId ?? "")),
          typeId: rmap.get(id)?.typeId ?? "",
          i,
        }));

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
          <h2>단체에 객실 추가</h2>
          <span className="grptag" title={groupId}>
            {groupName}
          </span>
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        <div className="fld">
          <label>단체</label>
          <div className="muted">
            <b>{groupName}</b>
            {members.filter((b) => b.status !== "cancelled").length ? (
              <span>
                {" "}
                · 지금 {members.filter((b) => b.status !== "cancelled").length}실 · 같은 묶음에 이어 붙여요
              </span>
            ) : null}
          </div>
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
            입실<em>*</em>
          </label>
          <div className="chips scroll">
            {dateChips.map((d, i) => (
              <button type="button" key={d} className={`chip ${checkIn === d ? "on" : ""}`} onClick={() => setStayCheckIn(d)}>
                {["오늘", "내일", "모레"][i]} {dayLabel(d)}
              </button>
            ))}
            <label className={`chip datechip ${dateChips.includes(checkIn) ? "" : "on"}`}>
              <CalendarDays size={15} />
              <span className="dl">{dateChips.includes(checkIn) ? "날짜 고르기" : dayLabel(checkIn)}</span>
              <input type="date" min="2020-01-01" max="2099-12-31" value={checkIn} onChange={(e) => e.target.value && setStayCheckIn(e.target.value)} aria-label="입실" />
            </label>
          </div>
        </div>

        <div className="fld">
          <label>
            퇴실<em>*</em>
          </label>
          <div className="step stayio">
            <label className="chip datechip on">
              <CalendarDays size={15} />
              <span className="dl">{dayLabel(checkOutDate)}</span>
              <input
                type="date"
                min={addDays(checkIn, 1)}
                max={addDays(checkIn, 90)}
                value={checkOutDate}
                onChange={(e) => e.target.value && setStayCheckOut(e.target.value)}
                aria-label="퇴실"
                title="퇴실일을 고르면 박수가 맞춰져요"
              />
            </label>
            <span className="rng">
              <b>
                {dayLabel(checkOutDate)} {s.stayTimes.checkOut}
              </b>{" "}
              퇴실
              {assignMode === "rooms" ? " · 이 기간 내내 빈 방만" : " · 호실은 나중에"}
            </span>
          </div>
        </div>

        <div className="fld">
          <label>
            박수<em>*</em>
          </label>
          <div className="step">
            <button type="button" className="sb" aria-label="1박 줄이기" onClick={() => setStayNights(nights - 1)}>
              <Minus size={16} />
            </button>
            <span className="sv">
              {nights}
              <small>박</small>
            </span>
            <button type="button" className="sb" aria-label="1박 늘리기" onClick={() => setStayNights(nights + 1)}>
              <Plus size={16} />
            </button>
            <span className="rng stayglance" aria-label={`입실 ${dayLabel(checkIn)} 퇴실 ${dayLabel(checkOutDate)} ${nights}박`}>
              <b>{dayLabel(checkIn)}</b> 입실 → <b>{dayLabel(checkOutDate)}</b> 퇴실 · <b>{nights}박</b>
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
                <button type="button" className={assignMode === "typeOnly" ? "on" : ""} onClick={() => switchAssign("typeOnly")} title="호실 미정 · 타입 재고만">
                  간단 예약
                </button>
                <button type="button" className={assignMode === "rooms" ? "on" : ""} onClick={() => switchAssign("rooms")}>
                  호실까지
                </button>
              </div>
              <span className="gsum">
                {n ? (
                  <>
                    <b>{n}실</b> · {summary}
                    {assignMode === "typeOnly" ? <span className="muted"> · 호실 미정</span> : null}
                  </>
                ) : (
                  <span className="muted">{assignMode === "typeOnly" ? "타입별 실 수를 입력해 주세요" : "추가할 방을 골라 주세요"}</span>
                )}
              </span>
              {n ? (
                <button
                  type="button"
                  className="auto"
                  onClick={() => {
                    setPicked([]);
                    setTypeCounts({});
                  }}
                >
                  모두 빼기
                </button>
              ) : null}
            </div>
            {assignMode === "rooms" ? (
              <div className="seg sm" style={{ marginBottom: 8 }}>
                <button type="button" className={view === "count" ? "on" : ""} onClick={() => setView("count")}>
                  타입별 개수
                </button>
                <button type="button" className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
                  방 직접 고르기
                </button>
              </div>
            ) : null}
            {assignMode === "typeOnly" || view === "count" ? (
              <div className="gcounts">
                {types.map((t) => {
                  const c = countOf(t.id);
                  const f = freeOf(t.id);
                  const left = stockLeft(t.id);
                  const max = assignMode === "typeOnly" ? Math.max(left, c) : f;
                  return (
                    <div className={`gcnt ${c ? "on" : ""}`} key={t.id}>
                      <TypeBadge t={t} />
                      <span className="muted sm">{assignMode === "typeOnly" ? `잔여 재고 ${left}` : `빈 방 ${f}`}</span>
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
                        <button type="button" className="sb" aria-label={`${typeLabel(t)} 1실 더하기`} disabled={c >= max && assignMode === "rooms"} onClick={() => setCount(t.id, c + 1)}>
                          <Plus size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {assignMode === "rooms" ? (
              <div className={`gboard ${view === "board" ? "" : "mini"}`}>
                {orderedFloors(s).map((f) => {
                  const rooms = f.rooms.filter((r) => r.typeId);
                  if (!rooms.length) return null;
                  return (
                    <div className="gfloor" key={f.id}>
                      <span className="gfl">{f.name}</span>
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
                              title={ok ? `${r.no}호` : `${r.no}호 · 다른 예약이 있어요`}
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
            ) : null}
            {note ? <div className="muted sm">{note}</div> : null}
          </div>
        </div>

        <div className="fld">
          <label>
            가격<em>*</em>
          </label>
          <div className="payb">
            <div className="seg sm wrap">
              <button type="button" className={mode === "rate" ? "on" : ""} onClick={() => setMode("rate")}>
                타입별 1박 요금
              </button>
              <button type="button" className={mode === "member" ? "on" : ""} onClick={() => setMode("member")}>
                방별 1박 요금
              </button>
              <button type="button" className={mode === "line" ? "on" : ""} onClick={() => setMode("line")}>
                방별 총액
              </button>
              <button type="button" className={mode === "room" ? "on" : ""} onClick={() => setMode("room")}>
                1실 가격
              </button>
              <button type="button" className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>
                총액 나누기
              </button>
            </div>
            {mode === "rate" || mode === "line" || mode === "member" ? (
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
                  <span className="muted sm">방을 고르면 요금 칸이 생겨요</span>
                )}
              </div>
            ) : null}
            {mode === "member" ? (
              <div className="glines">
                {lineRows.map((row) => (
                  <label className="gline-row" key={row.key}>
                    <span className="gl-lab">
                      <b>{row.label}</b>
                      <span className="muted sm">
                        {row.sub} · {nights}박 = {won((Number(memberRates[row.i] || 0) || 0) * nights)}원
                      </span>
                    </span>
                    <span className="inp price sm">
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label={`${row.label} 1박 요금`}
                        value={memberRates[row.i] ? won(Number(memberRates[row.i])) : ""}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          setMemberRates((prev) => {
                            const next = typeIds.map((_, i) => prev[i] ?? "");
                            next[row.i] = v;
                            return next;
                          });
                        }}
                      />
                      원/박
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {mode === "line" ? (
              <div className="glines">
                {lineRows.map((row) => (
                  <label className="gline-row" key={row.key}>
                    <span className="gl-lab">
                      <b>{row.label}</b>
                      <span className="muted sm">{row.sub}</span>
                    </span>
                    <span className="inp price sm">
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label={`${row.label} 금액`}
                        value={linePrices[row.i] ? won(Number(linePrices[row.i])) : ""}
                        onChange={(e) => {
                          const v = num(e.target.value);
                          setLinePrices((prev) => {
                            const next = typeIds.map((_, i) => prev[i] ?? "");
                            next[row.i] = v;
                            return next;
                          });
                        }}
                      />
                      원
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {mode === "room" || mode === "total" ? (
              <div className="paydep">
                {mode === "room" ? (
                  <label className="inp price">
                    <input className="num" inputMode="numeric" placeholder={`1실 ${nights}박 금액`} aria-label="1실 가격" value={roomPrice ? won(Number(roomPrice)) : ""} onChange={(e) => setRoomPrice(num(e.target.value))} />원
                  </label>
                ) : (
                  <label className="inp price">
                    <input className="num" inputMode="numeric" placeholder="추가분 총액" aria-label="추가분 총액" value={total ? won(Number(total)) : ""} onChange={(e) => setTotal(num(e.target.value))} />원
                  </label>
                )}
              </div>
            ) : null}
            <span className="gline gtotal">
              {n && sum ? (
                mode === "rate" ? (
                  <>
                    {formula} = <b>{won(sum)}원</b>
                  </>
                ) : (
                  <>
                    합계 <b>{won(sum)}원</b>
                  </>
                )
              ) : (
                <span className="muted">방을 고르고 금액을 입력하면 합계가 보여요</span>
              )}
            </span>
          </div>
        </div>

        <div className="fld">
          <label>표시</label>
          <div className="payb" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {assignMode === "rooms" ? (
              <button
                type="button"
                className={`chip ${tentative ? "on" : ""}`}
                aria-pressed={tentative}
                onClick={() => setTentative((t) => !t)}
                title="방 점유 · 확정 전 (간단 예약과 다름)"
              >
                {tentative ? <Check size={14} strokeWidth={2.6} /> : null}임시 배치
              </button>
            ) : (
              <span className="muted sm">간단 예약 · 임시 배치 아님</span>
            )}
            <button type="button" className={`chip ncx ${noClean ? "on" : ""}`} aria-pressed={noClean} onClick={() => setNoClean((t) => !t)} title="청소하지 않음">
              {noClean ? <Check size={14} strokeWidth={2.6} /> : null}청소X
            </button>
          </div>
        </div>

        <div className="pv">
          {impact.length ? (
            <>
              <div className="pt">
                추가하면 {dayLabel(checkIn)} ~ {dayLabel(addDays(checkOut, -1))} 밤 잔여 객실
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
                    {r.after < 0 ? <span className="w tred">오버부킹 · 저장은 경고 후 가능</span> : null}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="pt">방을 고르면 재고가 어떻게 바뀌는지 보여요. 겹치는 방은 고를 수 없어요.</div>
          )}
        </div>

        {err ? <div className="ferr">{err}</div> : null}
        <div className="mf">
          <div className="keys">
            <span className="muted sm">기존 단체에 이어 붙어요 · 정산은 단체 정산에서 같이 봐요</span>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn red" disabled={busy}>
            {busy ? "추가 중…" : n ? `${n}실 추가` : "추가"}
          </button>
        </div>
      </form>
    </div>
  );
}

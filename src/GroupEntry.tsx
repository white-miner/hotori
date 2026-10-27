// 단체 예약 만들기: 방 여러 개를 한 번에 (모두 되거나 모두 안 돼요)
// · 호실 지정 / 타입만(호실 나중에) · 방별 1박 · 방별 총액(타입 요금 프리필)
import { useEffect, useMemo, useState } from "react";
import { saveFailMessage } from "../shared/errors";
import { askConfirm } from "./ConfirmDialog";
import { ArrowRight, CalendarDays, Check, Minus, Plus } from "lucide-react";
import {
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
  STAY_NIGHTS_MAX,
} from "../shared/ledger";
import {
  autoPick,
  expandTypeSlots,
  freeForStay,
  groupDrafts,
  hashGroupBadgeColor,
  groupStockImpact,
  groupStockImpactByTypes,
  splitTotal,
  validateGroup,
  GROUP_NAME_MAX,
  GROUP_ROOMS_MAX,
} from "../shared/group";
import { typeGuests } from "../shared/surcharge";
import { type GroupPayMode, PAY_MODE_LABEL, rateFormula, ratePrices } from "../shared/settle";
import type { HotelData } from "./data";
import { PlatBadge, TypeBadge, lookups } from "./ui";
import RoomClashNote from "./RoomClashNote";

type AssignMode = "rooms" | "typeOnly";
type PriceMode = "rate" | "member" | "room" | "total" | "line";
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
  const [nights, setNights] = useState(clampStayNights(init.nights));
  const checkOutDate = checkOutFromStayNights(checkIn, nights);
  const setStayCheckIn = (d: string) => setCheckIn(d);
  const setStayNights = (n: number) => setNights(clampStayNights(n));
  const setStayCheckOut = (d: string) => setNights(nightsFromStayDates(checkIn, d));
  const [assignMode, setAssignMode] = useState<AssignMode>("typeOnly");
  const [mode, setMode] = useState<PriceMode>("rate");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [payMode, setPayMode] = useState<GroupPayMode>("prepaid");
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [payer, setPayer] = useState({ company: "", name: "", phone: "" });
  const [roomPrice, setRoomPrice] = useState("");
  const [total, setTotal] = useState("");
  const [linePrices, setLinePrices] = useState<string[]>([]);
  /** 방별 1박 요금 (member 모드) */
  const [memberRates, setMemberRates] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<"count" | "board">("count");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tentative, setTentative] = useState(false);

  const free = useMemo(() => freeForStay(s, data.bookings, checkIn, nights), [s, data.bookings, checkIn, nights]);
  const order = useMemo(() => roomOrder(s), [s]);
  const rmap = useMemo(() => new Map(allRooms(s).map((r) => [r.id, r])), [s]);
  useEffect(() => setErr(null), [picked, typeCounts, nights, checkIn, mode, roomPrice, total, rates, payMode, assignMode, linePrices, memberRates]);

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
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
    setNote(null);
  };

  const rateNum: Record<string, number> = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v || 0)]));
  const prefills = ratePrices(typeIds, rateNum, nights);
  // 방별 금액: 방 수·박수 바뀌면 타입 1박×박수로 다시 채움 (직접 고친 뒤에도 박수↓면 맞춤)
  useEffect(() => {
    setLinePrices((prev) =>
      typeIds.map((tid, i) => {
        const p = prefills[i];
        if (p) return String(p);
        if (i < prev.length && prev[i] !== "") return prev[i];
        return "";
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeIds.join("|"), nights, Object.values(rateNum).join("|")]);

  // 방별 1박: 타입 요금으로 프리필 · 방마다 다르게 수정할 수 있어요
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
      ? groupStockImpactByTypes(
          s,
          data.bookings,
          checkIn,
          nights,
          Object.fromEntries(typeOnlySlots.map((x) => [x.typeId, x.count])),
        )
      : groupStockImpact(s, data.bookings, checkIn, nights, sorted);
  const over = impact.filter((x) => x.after < 0);
  const summary = types.map((t) => [t, countOf(t.id)] as const).filter(([, c]) => c > 0).map(([t, c]) => `${typeLabel(t)} ${c}`).join(" · ");
  const checkOut = checkOutDate;

  const switchAssign = (m: AssignMode) => {
    setAssignMode(m);
    setPicked([]);
    setTypeCounts({});
    setNote(null);
    setView("count");
    if (m === "typeOnly") setTentative(false); // 미배정 = 타입 홀드 · 임시 아님
  };

  const save = async () => {
    if (busy) return;
    const v = validateGroup({
      name,
      platformId,
      nights,
      roomIds: assignMode === "rooms" ? sorted : [],
      prices,
      free,
      typeOnly: assignMode === "typeOnly" ? typeOnlySlots : undefined,
    });
    if (v) return setErr(v);
    // 타입 오버부킹: 경고만 · 저장 허용 (호실 모드의 물리 방 겹침은 free/validate에서 차단)
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
    if (payMode === "postpaid" && !payer.company.trim() && !payer.name.trim()) return setErr("후불이면 결제자(회사 또는 담당자)를 입력해 주세요.");
    setBusy(true);
    setErr(null);
    try {
      const groupId = crypto.randomUUID();
      const memberFlats =
        mode === "member"
          ? memberRateNums
          : mode === "rate"
            ? typeIds.map((tid) => rateNum[tid] ?? 0)
            : mode === "line"
              ? prices.map((p) => (nights > 0 ? Math.round(p / nights) : 0))
              : prices.map((p) => (nights > 0 ? Math.round(p / nights) : 0));
      const list = groupDrafts({
        groupId,
        groupName: name,
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
      });
      const typeRatesPersist =
        mode === "rate" || mode === "line" || mode === "member"
          ? Object.fromEntries(pickedTypes.map((t) => [t.id, rateNum[t.id]]).filter(([, r]) => r))
          : null;
      await data.saveGroup(list, {
        id: groupId,
        payMode,
        dueOn: payMode === "postpaid" ? (dueOn ?? checkOut) : null,
        payerCompany: payer.company || null,
        payerName: payer.name || null,
        payerPhone: payer.phone || null,
        rates: typeRatesPersist && Object.keys(typeRatesPersist).length ? typeRatesPersist : null,
        extras: [],
        badgeColor: hashGroupBadgeColor(groupId),
      });
      const how = assignMode === "typeOnly" ? `${n}실(간단 예약·호실 미정)` : `${n}실`;
      const tentTag = assignMode === "rooms" && tentative ? " · 임시" : "";
      onSaved(
        `단체 ${name.trim()} ${how} · ${nights}박 예약을 한 번에 기록했어요 · 합계 ${won(sum)}원${payMode === "postpaid" ? " · 후불" : ""}${tentTag}`,
      );
    } catch (e) {
      setErr(saveFailMessage(e, "하나도 저장하지 않았어요"));
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
                max={addDays(checkIn, STAY_NIGHTS_MAX)}
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
              {assignMode === "rooms" ? " · 이 기간 내내 빈 방만 고를 수 있어요" : " · 호실은 나중에 배정해요 (타입 재고만 차감)"}
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
                  <span className="muted">{assignMode === "typeOnly" ? "타입별 실 수를 입력해 주세요" : "아직 고른 방이 없어요"}</span>
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
                <div className="muted sm gnote">
                  {assignMode === "typeOnly"
                    ? "타입×실 수만 잡으면 호실 없이 저장돼요. 재고는 타입에서 차감되고, 나중에 방을 배정해요."
                    : "개수를 입력하면 같은 층의 붙은 방부터 골라 드려요. 바꾸려면 '방 직접 고르기'에서 눌러요."}
                </div>
              </div>
            ) : null}
            {assignMode === "rooms" ? (
              <div className={`gboard ${view === "board" ? "" : "mini"}`}>
                {orderedFloors(s).map((f) => {
                  const rooms = f.rooms.filter((r) => r.typeId);
                  if (!rooms.length) return null;
                  return (
                    <div className="gfloor" key={f.id}>
                      <span className="gfl">
                        {L.roomLabel(rooms[0].id)?.replace(rooms[0].no, "").trim() ? `${L.rooms.get(rooms[0].id)?.building?.name ?? ""} ` : ""}
                        {f.name}
                      </span>
                      <div className="grooms">
                        {rooms.map((r) => {
                          const on = picked.includes(r.id);
                          const ok = free.has(r.id);
                          return (
                            <button
                              type="button"
                              key={r.id}
                              className={`groom ${on ? "on" : ""} ${ok ? "" : "clash"}`}
                              disabled={view !== "board"}
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
            ) : null}
            {assignMode === "rooms" ? (
              <RoomClashNote
                data={data}
                today={today}
                picked={picked}
                checkIn={checkIn}
                nights={nights}
                onSwap={(from, to) => setPicked((x) => x.map((y) => (y === from ? to : y)))}
              />
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
                  <span className="muted sm">방을 고르면 타입마다 1박 요금 칸이 생겨요</span>
                )}
              </div>
            ) : null}
            {mode === "member" ? (
              <div className="glines">
                {lineRows.length ? (
                  lineRows.map((row) => (
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
                          onFocus={() => {
                            if (!memberRates[row.i] && rateNum[row.typeId]) {
                              setMemberRates((prev) => {
                                const next = typeIds.map((_, i) => prev[i] ?? "");
                                if (!next[row.i]) next[row.i] = String(rateNum[row.typeId]);
                                return next;
                              });
                            }
                          }}
                        />
                        원/박
                      </span>
                    </label>
                  ))
                ) : (
                  <span className="muted sm">방을 고르면 방마다 1박 요금을 입력할 수 있어요 (예: 602=7만, 다른 방=8만).</span>
                )}
                <div className="muted sm gnote">방마다 다른 1박 · 총액 = 1박 × 박수 · 합계 = 방 합</div>
              </div>
            ) : null}
            {mode === "line" ? (
              <div className="glines">
                {lineRows.length ? (
                  lineRows.map((row) => (
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
                          onFocus={() => {
                            // 비어 있으면 타입 요금×박수로 채워 두어요
                            if (!linePrices[row.i] && prefills[row.i]) {
                              setLinePrices((prev) => {
                                const next = typeIds.map((_, i) => prev[i] ?? "");
                                if (!next[row.i]) next[row.i] = String(prefills[row.i]);
                                return next;
                              });
                            }
                          }}
                        />
                        원
                      </span>
                    </label>
                  ))
                ) : (
                  <span className="muted sm">방을 고르면 방마다 금액을 입력할 수 있어요. 위 타입 요금이 자동으로 채워져요.</span>
                )}
                <div className="muted sm gnote">타입 1박 요금을 입력하면 방마다 자동 입력하고, 방마다 다르게 수정할 수 있어요.</div>
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
                    <input className="num" inputMode="numeric" placeholder="단체 총액" aria-label="단체 총액" value={total ? won(Number(total)) : ""} onChange={(e) => setTotal(num(e.target.value))} />원
                  </label>
                )}
              </div>
            ) : null}
            <span className="gline gtotal">
              {n && sum ? (
                <>
                  <span className="gtotal-lab">총액</span>{" "}
                  <b className="num">{won(sum)}원</b>
                  <span className="muted sm">
                    {" · "}
                    {mode === "rate"
                      ? formula
                      : mode === "member"
                        ? "방별 1박 × 박수 합"
                        : mode === "line"
                          ? "방별 합"
                          : mode === "room"
                            ? `${n}실 × ${won(Number(roomPrice))}`
                            : `1실 ${won(prices[n - 1] ?? 0)}${prices[0] !== prices[n - 1] ? ` (첫 방 ${won(prices[0])})` : ""}`}
                  </span>
                </>
              ) : (
                <span className="muted">방을 고르고 금액을 입력하면 총액이 보여요</span>
              )}
            </span>
          </div>
        </div>

        {assignMode === "rooms" ? (
          <div className="fld">
            <label>배치</label>
            <div className="payb">
              <button
                type="button"
                className={`chip ${tentative ? "on" : ""}`}
                aria-pressed={tentative}
                onClick={() => setTentative((t) => !t)}
                title="방 점유 · 확정 전 (간단 예약/미배정과 다름)"
              >
                {tentative ? <Check size={14} strokeWidth={2.6} /> : null}임시 배치
              </button>
              <span className="muted sm">
                {tentative ? "임시라도 재고는 막혀요. 「현황」에서 나중에 확정할 수 있어요." : "호실까지 잡은 뒤 · 확정 배치로 저장해요"}
              </span>
            </div>
          </div>
        ) : (
          <div className="fld">
            <label>배치</label>
            <div className="payb">
              <span className="muted sm">간단 예약(타입 홀드) · 호실 미정 · 타입 재고만 차감 · 임시 배치 아님</span>
            </div>
          </div>
        )}

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
              <span className="muted sm">방마다 잔금은 보이지 않고, 장부의 단체 정산에서 한 번에 정산해요</span>
            )}
          </div>
        </div>

        <div className="pv">
          {impact.length ? (
            <>
              <div className="pt">
                저장하면 {dayLabel(checkIn)} ~ {dayLabel(addDays(checkOut, -1))} 밤 잔여 객실 (가장 적은 날 · 호텔 전체)
                {assignMode === "rooms" && tentative ? " · 임시라도 만실이 될 수 있어요" : ""}
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
                    {r.after < 0 ? (
                      <span className="w tred">오버부킹 · 저장은 경고 후 가능</span>
                    ) : r.after === 0 ? (
                      <span className="w tred">만실이 돼요</span>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="pt">{assignMode === "typeOnly" ? "타입 실 수를 입력하면 잔여 객실이 어떻게 바뀌는지 보여요." : "방을 고르면 잔여 객실이 어떻게 바뀌는지 보여요. 겹치는 방은 고를 수 없어요."}</div>
          )}
        </div>

        {err ? <div className="ferr">{err}</div> : null}
        <div className="mf">
          <div className="keys">
            <span className="muted sm">
              {assignMode === "typeOnly" ? "타입마다 예약이 한 줄씩 생기고, 호실은 나중에 배정해요" : "방마다 예약이 한 줄씩 생기고 장부에서는 한 줄로 묶여요"}
            </span>
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

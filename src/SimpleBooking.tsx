/**
 * 간단 예약 — Entry 축약 폼 (Path A: roomId=null · Path B: 지금 방 배정 · 확정 기본)
 * 객실 수 N>1 → 같은 손님·타입·요금으로 N줄(단체 묶음 · GroupEntry typeOnly/rooms 패턴)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Booking,
  addDays,
  allRooms as placedRooms,
  freeRooms,
  legConflicts,
  md,
  previewChange,
  stockTable,
  typeLabel,
  usableTypes,
  validateBooking,
  won,
} from "../shared/ledger";
import { autoPick, GROUP_ROOMS_MAX, groupDrafts, groupStockImpactByTypes } from "../shared/group";
import { syncStayNightRates } from "../shared/nightrates";
import { baseRateFor, stopSellDatesForStay } from "../shared/salesCalendar";
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type BookPayMethod,
  defaultBookingPlatformId,
  isOnsite,
  validateGuestPhone,
  validatePayment,
} from "../shared/payment";
import { GUESTS_MAX } from "../shared/surcharge";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { lookups } from "./ui";
import { BookingModeSeg, Chip, ChipGroup, GuestNamePhone, PriceInp, PriceRow, Stepper } from "./primitives";
import NightPickCalendar from "./NightPickCalendar";

type PayMode = "prepaid" | "postpaid" | "deposit";

interface Props {
  data: HotelData;
  today: string;
  req: EntryRequest;
  onClose: () => void;
  onSaved: (msg: string) => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 풀 Entry로 열기 (상세·결제 보완) */
  onOpenFull?: (preset: Partial<Booking>) => void;
}

export default function SimpleBooking({ data, today, req, onClose, onSaved, notify, onOpenFull }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const p = req.preset ?? {};
  const pickTypes = s.types.filter((t) => typeLabel(t));
  const [platformId, setPlatformId] = useState(() => defaultBookingPlatformId(s.platforms, p.platformId));
  const [typeId, setTypeId] = useState(p.typeId ?? usableTypes(s.types)[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(p.checkIn ?? today);
  const [nights, setNights] = useState(Math.max(1, p.nights ?? 1));
  const [guestName, setName] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [guests, setGuests] = useState(1);
  const [roomCount, setRoomCount] = useState(1);
  const [rateStr, setRateStr] = useState(() => {
    const fromPreset = p.nightRates?.flat ?? p.nightRates?.weekday ?? null;
    if (fromPreset != null && fromPreset > 0) return String(fromPreset);
    const tid = p.typeId ?? usableTypes(s.types)[0]?.id ?? "";
    const ci = p.checkIn ?? today;
    const br = tid ? baseRateFor(s, tid, ci) : 0;
    return br > 0 ? String(br) : "";
  });
  const [priceStr, setPriceStr] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceUnset, setPriceUnset] = useState(!!p.priceUnset);
  const [assignNow, setAssignNow] = useState(false); // Path B
  /** Path B: 고른 호실 (1실=단건 · N실=복수) */
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [otherRooms, setOtherRooms] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("postpaid");
  const [depAmt, setDepAmt] = useState("");
  const [depMethod, setDepMethod] = useState<BookPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const plat = s.platforms.find((x) => x.id === platformId);
  const onsite = isOnsite(plat);
  const rate = Number(rateStr || 0);
  const suggested = !priceUnset && rate > 0 && nights > 0 ? rate * nights : 0;
  useEffect(() => {
    if (priceUnset || priceTouched) return;
    if (suggested > 0) setPriceStr(String(suggested));
    else setPriceStr("");
  }, [suggested, priceUnset, priceTouched]);

  const price = priceUnset ? 0 : Number(priceStr || 0);
  const roomId = roomIds[0] ?? null;
  const draft: Booking = {
    id: "__simple__",
    kind: "stay",
    status: "active",
    platformId,
    price,
    priceUnset,
    guestName,
    guestPhone: guestPhone.trim() || null,
    typeId,
    roomId: assignNow ? roomId : null,
    segments: null,
    checkIn,
    nights,
    startTime: null,
    endTime: null,
    arrived: false,
    tentative: false,
    memo: null,
    guests,
    nightRates: !priceUnset && rate > 0 ? syncStayNightRates(checkIn, nights, { flat: rate }) : null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const free = useMemo(() => freeRooms(s, data.bookings, draft), [s, data.bookings, draft]);
  const allRooms = placedRooms(s);
  const typeCap = Math.max(1, allRooms.filter((r) => r.typeId === typeId).length || GROUP_ROOMS_MAX);
  const roomMax = Math.min(GROUP_ROOMS_MAX, typeCap);
  const sameType = allRooms.filter((r) => r.typeId === typeId && free.has(r.id));
  const otherType = allRooms.filter((r) => r.typeId !== typeId && free.has(r.id));
  const busyLegs =
    assignNow && roomCount === 1 && roomId
      ? legConflicts(data.bookings, draft)
      : assignNow && roomCount > 1
        ? roomIds.flatMap((rid) => legConflicts(data.bookings, { ...draft, roomId: rid }))
        : [];
  const preview = previewChange(s, data.bookings, draft);
  const stockLeft = useMemo(() => {
    const dates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
    const table = stockTable(s, data.bookings, dates);
    return Math.min(...dates.map((d) => table.get(typeId)?.get(d) ?? 0));
  }, [s, data.bookings, typeId, checkIn, nights]);
  const multiImpact =
    roomCount > 1
      ? groupStockImpactByTypes(s, data.bookings, checkIn, nights, { [typeId]: roomCount })
      : [];
  const typeOver =
    roomCount > 1 ? multiImpact.some((r) => r.after < 0) : preview.some((r) => r.after < 0) || roomCount > stockLeft;

  function pickRoom(id: string) {
    if (roomCount <= 1) {
      setRoomIds([id]);
      return;
    }
    setRoomIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= roomCount) return [...prev.slice(1), id];
      return [...prev, id];
    });
  }

  function fillRooms() {
    const picked = autoPick(s, free, typeId, roomCount);
    if (picked.length < roomCount) {
      notify(`이 타입 빈 방이 ${picked.length}실뿐이에요 · ${roomCount}실이 필요해요`);
      setRoomIds(picked);
      return;
    }
    setRoomIds(picked);
  }

  async function save() {
    if (!guestName.trim()) return setErr("이름을 적어 주세요.");
    // 현장·전화만 연락처 필수 · OTA 등은 선택 (HTML required · multi-room decorate 동일 규칙)
    const phoneErr = validateGuestPhone(plat, guestPhone);
    if (phoneErr) return setErr(phoneErr);
    if (!priceUnset && (!Number.isFinite(price) || price < 0 || (price === 0 && !rateStr && !priceStr)))
      return setErr("1박 요금·판매금을 적거나 금액미정을 켜 주세요.");
    if (assignNow && roomIds.length !== roomCount)
      return setErr(
        roomCount === 1
          ? "지금 배정하려면 호실을 골라 주세요."
          : `지금 배정하려면 호실 ${roomCount}실을 골라 주세요 (지금 ${roomIds.length}실).`,
      );
    if (assignNow && roomCount > sameType.length && roomIds.every((id) => L.rooms.get(id)?.typeId === typeId))
      return setErr(`이 타입 빈 방이 ${sameType.length}실뿐이에요 · ${roomCount}실을 배정할 수 없어요.`);
    if (onsite && payMode === "deposit" && !priceUnset) {
      const amt = Number(depAmt || 0);
      const pv = validatePayment(amt, depMethod, today);
      if (pv) return setErr(pv);
      const cap = roomCount > 1 ? price * roomCount : price;
      if (amt > cap) return setErr("선금이 판매금보다 커요.");
    }
    const v = validateBooking(draft, s);
    if (v) return setErr(v);
    if (busyLegs.length)
      return setErr(`${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호`).join(", ")}는 그 기간에 다른 예약이 있어요.`);
    const stopped = stopSellDatesForStay(s, typeId, checkIn, nights);
    if (stopped.length) {
      return setErr(`판매중지된 숙박일이 있어요 (${stopped.map(md).join(", ")}). 판매 캘린더에서 중지를 풀어 주세요.`);
    }
    if (
      (typeOver || roomCount > stockLeft) &&
      !window.confirm(
        roomCount > stockLeft
          ? `타입 재고가 모자랍니다(남은 ${stockLeft}실 · ${roomCount}실 요청). 그래도 저장할까요? · 물리 방 겹침은 막혀 있어요.`
          : "타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요? · 물리 방 겹침은 막혀 있어요.",
      )
    )
      return;

    setBusy(true);
    setErr(null);
    try {
      const phone = guestPhone.trim() || null;
      const nightRates = !priceUnset && rate > 0 ? syncStayNightRates(checkIn, nights, { flat: rate }) : null;
      const decorate = (b: Booking): Booking => ({
        ...b,
        guestPhone: phone,
        priceUnset,
        price: priceUnset ? 0 : b.price,
        nightRates: nightRates ?? b.nightRates,
        guests,
      });

      if (roomCount === 1) {
        const saved = await data.saveBooking(decorate({ ...draft, roomId: assignNow ? roomId : null }), true);
        let payTail = "";
        if (onsite && !priceUnset && isOnsite(s.platforms.find((x) => x.id === saved.platformId))) {
          try {
            if (payMode === "prepaid" && saved.price > 0) {
              await data.addPayment(saved.id, { kind: "balance", method: depMethod, amount: saved.price, bizDate: today });
              payTail = ` · 선불(완납) ${won(saved.price)}원`;
            } else if (payMode === "deposit") {
              const amt = Number(depAmt || 0);
              if (amt > 0) {
                await data.addPayment(saved.id, { kind: "deposit", method: depMethod, amount: amt, bizDate: today });
                payTail = ` · 선금 ${won(amt)}원(${BOOK_PAY_LABEL[depMethod]})`;
              }
            }
          } catch (e) {
            payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
          }
        }
        const path = saved.roomId ? ` · ${L.roomLabel(saved.roomId)}호` : " · 미배정(타입 재고)";
        const unset = saved.priceUnset ? " · 금액미정" : "";
        onSaved(`${saved.guestName} 님 간단 예약했어요${path}${unset}${payTail}`);
        return;
      }

      // N실: GroupEntry와 같이 groupDrafts → saveGroup (타입만 or 호실)
      const groupId = crypto.randomUUID();
      const prices = Array.from({ length: roomCount }, () => (priceUnset ? 0 : price));
      const memberRates = !priceUnset && rate > 0 ? Array.from({ length: roomCount }, () => rate) : undefined;
      const drafts = groupDrafts({
        groupId,
        groupName: guestName.trim(),
        platformId,
        checkIn,
        nights,
        roomIds: assignNow ? roomIds : undefined,
        typeIds: assignNow ? undefined : Array.from({ length: roomCount }, () => typeId),
        prices,
        memberRates,
        s,
        guestsOf: () => guests,
      }).map(decorate);

      const savedList = await data.saveGroup(drafts, {
        id: groupId,
        payMode: onsite && payMode === "postpaid" ? "postpaid" : "prepaid",
        dueOn: null,
        payerCompany: null,
        payerName: null,
        payerPhone: phone,
        rates: !priceUnset && rate > 0 ? { [typeId]: rate } : null,
        extras: [],
      });

      let payTail = "";
      if (onsite && !priceUnset && savedList[0]) {
        try {
          if (payMode === "prepaid" && price > 0) {
            for (const b of savedList) {
              if (b.price > 0) await data.addPayment(b.id, { kind: "balance", method: depMethod, amount: b.price, bizDate: today });
            }
            payTail = ` · 선불(완납) ${won(price * roomCount)}원`;
          } else if (payMode === "deposit") {
            const amt = Number(depAmt || 0);
            if (amt > 0) {
              await data.addPayment(savedList[0].id, { kind: "deposit", method: depMethod, amount: amt, bizDate: today });
              payTail = ` · 선금 ${won(amt)}원(${BOOK_PAY_LABEL[depMethod]})`;
            }
          }
        } catch (e) {
          payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
        }
      }
      const path = assignNow
        ? ` · ${savedList.map((b) => (b.roomId ? `${L.roomLabel(b.roomId)}호` : "?")).join(", ")}`
        : ` · 미배정 ${roomCount}실(타입 재고)`;
      const unset = priceUnset ? " · 금액미정" : "";
      onSaved(`${guestName.trim()} 님 간단 예약 ${roomCount}실했어요${path}${unset}${payTail}`);
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const bpre = (bid: string) => (L.multi ? <em className="bpre">{L.buildings.get(bid)?.name}</em> : null);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal book-shell simple-book"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>간단 예약</h2>
          <BookingModeSeg
            mode="simple"
            onDetail={
              onOpenFull
                ? () =>
                    onOpenFull({
                      kind: "stay",
                      checkIn,
                      nights,
                      platformId,
                      typeId,
                      roomId: assignNow ? roomId : null,
                      guestName: guestName || undefined,
                      guestPhone: guestPhone || undefined,
                      guests,
                      price: priceUnset ? undefined : price || undefined,
                    })
                : undefined
            }
          />
          <span className="muted sm">전화·현장·OTA · 호실은 지금 또는 나중에</span>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="fld simple-nights">
          <label>이용 날짜</label>
          <div>
            <NightPickCalendar
              checkIn={checkIn}
              nights={nights}
              bookings={data.bookings}
              roomId={assignNow ? roomId : null}
              today={today}
              onPick={(ci, n) => {
                setCheckIn(ci);
                setNights(n);
                setPriceTouched(false);
              }}
              onBlocked={() => notify("그 숙박일은 이미 다른 예약이 있어요")}
            />
            <div className="muted sm" style={{ marginTop: "var(--space-3)" }}>
              {md(checkIn)} 입실 · {nights}박 · {md(addDays(checkIn, nights))} 퇴실
            </div>
          </div>
        </div>

        <div className="fld">
          <label>채널</label>
          <ChipGroup>
            {s.platforms.map((pl) => (
              <Chip key={pl.id} active={pl.id === platformId} onClick={() => setPlatformId(pl.id)} title={isOnsite(pl) ? "현장/전화" : "플랫폼"}>
                {pl.name}
              </Chip>
            ))}
          </ChipGroup>
        </div>

        <div className="fld">
          <label>
            이름<em>*</em> · 연락처{onsite ? <em>*</em> : null}
          </label>
          <GuestNamePhone
            nameRef={nameRef}
            name={guestName}
            phone={guestPhone}
            onName={setName}
            onPhone={setPhone}
            phoneRequired={onsite}
          />
        </div>

        <div className="fld">
          <label>객실타입</label>
          <ChipGroup>
            {pickTypes.map((t) => (
              <Chip
                key={t.id}
                active={t.id === typeId}
                onClick={() => {
                  setTypeId(t.id);
                  setRoomIds((ids) => ids.filter((id) => L.rooms.get(id)?.typeId === t.id));
                }}
              >
                {typeLabel(t)}
              </Chip>
            ))}
          </ChipGroup>
        </div>

        <div className="fld">
          <label>객실 수</label>
          <div>
            <Stepper
              value={roomCount}
              unit="실"
              min={1}
              max={roomMax}
              onChange={(n) => {
                setRoomCount(n);
                setRoomIds((ids) => (n === 1 ? ids.slice(0, 1) : ids.slice(0, n)));
              }}
            />
            <div className={`muted sm${roomCount > stockLeft ? " tred" : ""}`} style={{ marginTop: "var(--space-chip)" }}>
              {roomCount > stockLeft
                ? `재고 부족 · 남은 ${stockLeft}실 (오버부킹 경고)`
                : `이 타입 남은 재고 ${stockLeft}실`}
            </div>
          </div>
        </div>

        <div className="fld">
          <label>인원</label>
          <Stepper value={guests} min={1} max={GUESTS_MAX} onChange={setGuests} />
        </div>

        <div className="fld">
          <label>{onsite ? "요금" : "판매금"}</label>
          <div className="simple-price">
            <label className="ck">
              <input
                type="checkbox"
                checked={priceUnset}
                onChange={(e) => {
                  setPriceUnset(e.target.checked);
                  if (e.target.checked) {
                    setRateStr("");
                    setPriceStr("");
                    setPriceTouched(false);
                  }
                }}
              />
              금액미정
            </label>
            {!priceUnset ? (
              <PriceRow>
                <PriceInp sm suffix="원/박">
                  <input
                    className="num"
                    inputMode="numeric"
                    aria-label="1박 요금"
                    value={rateStr !== "" ? won(Number(rateStr)) : ""}
                    placeholder="1박"
                    onChange={(e) => {
                      setRateStr(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setPriceTouched(false);
                    }}
                  />
                </PriceInp>
                <span className="muted sm">× {nights}박 =</span>
                <PriceInp total>
                  <input
                    className="num"
                    inputMode="numeric"
                    aria-label={onsite ? "총액" : "판매금"}
                    value={priceStr !== "" ? won(Number(priceStr)) : ""}
                    placeholder={suggested > 0 ? won(suggested) : onsite ? "총액" : "판매금"}
                    onChange={(e) => {
                      setPriceStr(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setPriceTouched(true);
                    }}
                  />
                </PriceInp>
                {priceTouched && suggested > 0 && Number(priceStr || 0) !== suggested ? (
                  <Chip sm onClick={() => { setPriceStr(String(suggested)); setPriceTouched(false); }}>
                    다시 맞추기
                  </Chip>
                ) : null}
              </PriceRow>
            ) : (
              <span className="muted sm">협상 후 Entry에서 확정</span>
            )}
            {!priceUnset && roomCount > 1 && price > 0 ? (
              <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                실당 {won(price)}원 · {roomCount}실 합 {won(price * roomCount)}원
              </div>
            ) : null}
          </div>
        </div>

        {onsite ? (
          <div className="fld">
            <label>결제</label>
            <div>
              <ChipGroup>
                {(
                  [
                    ["prepaid", "선불"],
                    ["postpaid", "후불"],
                    ["deposit", "선금"],
                  ] as const
                ).map(([k, lab]) => (
                  <Chip key={k} active={payMode === k} onClick={() => setPayMode(k)}>
                    {lab}
                  </Chip>
                ))}
              </ChipGroup>
              {payMode === "prepaid" && !priceUnset ? (
                <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                  저장 시 판매금만큼 받기(완납)로 적어요 · 방법
                  <ChipGroup style={{ display: "inline-flex", marginLeft: "var(--space-3)" }}>
                    {BOOK_PAY_METHODS.map((m) => (
                      <Chip key={m} sm active={depMethod === m} onClick={() => setDepMethod(m)}>
                        {BOOK_PAY_LABEL[m]}
                      </Chip>
                    ))}
                  </ChipGroup>
                </div>
              ) : null}
              {payMode === "deposit" && !priceUnset ? (
                <PriceRow style={{ marginTop: "var(--space-3)" }}>
                  <PriceInp sm>
                    <input
                      className="num"
                      inputMode="numeric"
                      aria-label="선금"
                      placeholder="선금"
                      value={depAmt !== "" ? won(Number(depAmt)) : ""}
                      onChange={(e) => setDepAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    />
                  </PriceInp>
                  <ChipGroup>
                    {BOOK_PAY_METHODS.map((m) => (
                      <Chip key={m} sm active={depMethod === m} onClick={() => setDepMethod(m)}>
                        {BOOK_PAY_LABEL[m]}
                      </Chip>
                    ))}
                  </ChipGroup>
                </PriceRow>
              ) : null}
              {payMode === "postpaid" ? <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>퇴실(또는 나중에) 정산 · 결제 줄 없음</div> : null}
              {priceUnset ? <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>금액미정 · 수납은 확정 후 Entry에서</div> : null}
            </div>
          </div>
        ) : null}

        <div className="fld">
          <label>호실</label>
          <div>
            <label className="ck">
              <input
                type="checkbox"
                checked={assignNow}
                onChange={(e) => {
                  setAssignNow(e.target.checked);
                  if (!e.target.checked) setRoomIds([]);
                  else if (roomCount > 1) fillRooms();
                }}
              />
              지금 방 배정
              {assignNow && roomCount > 1 ? (
                <span className="muted sm"> · {roomIds.length}/{roomCount}실</span>
              ) : null}
            </label>
            {assignNow ? (
              <ChipGroup style={{ marginTop: "var(--space-3)" }}>
                {roomCount > 1 ? (
                  <Chip sm onClick={fillRooms}>
                    빈 방 자동
                  </Chip>
                ) : null}
                {sameType.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`rchip ${roomIds.includes(r.id) ? "on" : ""}`}
                    onClick={() => pickRoom(r.id)}
                  >
                    {bpre(r.buildingId)}
                    {r.no}
                  </button>
                ))}
                {otherRooms || roomIds.some((id) => L.rooms.get(id)?.typeId !== typeId)
                  ? otherType.map((r) => (
                      <button
                        type="button"
                        key={r.id}
                        className={`rchip other ${roomIds.includes(r.id) ? "on" : ""}`}
                        onClick={() => pickRoom(r.id)}
                      >
                        {bpre(r.buildingId)}
                        {r.no}
                        <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i>
                      </button>
                    ))
                  : otherType.length ? (
                      <button type="button" className="rchip lt" onClick={() => setOtherRooms(true)}>
                        다른 타입 방 +{otherType.length}
                      </button>
                    ) : null}
                {!sameType.length && !otherRooms ? <span className="muted sm">이 타입은 그 기간에 빈 방이 없어요</span> : null}
                {roomCount > sameType.length ? (
                  <span className="muted sm tred">이 타입 빈 방 {sameType.length}실 · {roomCount}실 배정 불가</span>
                ) : null}
              </ChipGroup>
            ) : null}
          </div>
        </div>

        {err ? <div className="err">{err}</div> : null}

        <div className="mf">
          <span className="grow" />
          <button type="button" className="btn line" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn dark" disabled={busy}>
            {busy
              ? "저장 중…"
              : assignNow
                ? roomCount > 1
                  ? `${roomCount}실 방까지 저장`
                  : "방까지 저장"
                : roomCount > 1
                  ? `${roomCount}실 간단 예약`
                  : "간단 예약 저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

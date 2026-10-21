/**
 * 간단 예약 — Entry 축약 폼
 * Path A: roomId=null · Path B: 지금 방 배정 · 확정 기본
 * 다타입: GroupEntry식 type×qty + Path B에서 타입 다른 호실(예: 601+603) → groupDrafts / saveGroup
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  type Booking,
  addDays,
  allRooms as placedRooms,
  freeRooms,
  legConflicts,
  md,
  stockTable,
  typeLabel,
  usableTypes,
  validateBooking,
  won,
} from "../shared/ledger";
import {
  autoPick,
  GROUP_ROOMS_MAX,
  expandTypeSlots,
  groupDrafts,
  groupStockImpact,
  groupStockImpactByTypes,
} from "../shared/group";
import { syncStayNightRates } from "../shared/nightrates";
import { baseRateFor, stopSellDatesForStay } from "../shared/salesCalendar";
import { saveFailMessage } from "../shared/errors";
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type BookPayMethod,
  defaultBookingPlatformId,
  isOnsite,
  validateGuestPhone,
  validatePayment,
  walkInDisplayName,
} from "../shared/payment";
import { rateFormula, ratePrices } from "../shared/settle";
import { GUESTS_MAX } from "../shared/surcharge";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { TypeBadge, lookups } from "./ui";
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
  const types = usableTypes(s.types).filter((t) => typeLabel(t));
  const allPlacedInit = placedRooms(s);
  /** 「현황」복수선택 / 단실 preset → Path B 호실 */
  const presetRoomIds = (() => {
    if (req.roomIds?.length) return [...req.roomIds];
    if (p.roomId) return [p.roomId];
    return [] as string[];
  })();
  const countsFromRooms = (ids: string[]) => {
    const counts: Record<string, number> = {};
    for (const rid of ids) {
      const tid = allPlacedInit.find((r) => r.id === rid)?.typeId;
      if (tid) counts[tid] = (counts[tid] ?? 0) + 1;
    }
    return counts;
  };
  const defaultTypeId =
    p.typeId ??
    (presetRoomIds[0] ? allPlacedInit.find((r) => r.id === presetRoomIds[0])?.typeId : undefined) ??
    types[0]?.id ??
    "";

  const [platformId, setPlatformId] = useState(() => defaultBookingPlatformId(s.platforms, p.platformId));
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>(() => {
    if (presetRoomIds.length) {
      const c = countsFromRooms(presetRoomIds);
      if (Object.values(c).some((n) => n > 0)) return c;
    }
    return defaultTypeId ? { [defaultTypeId]: 1 } : {};
  });
  const [checkIn, setCheckIn] = useState(p.checkIn ?? today);
  const [nights, setNights] = useState(Math.max(1, p.nights ?? 1));
  const [guestName, setName] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [guests, setGuests] = useState(1);
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const ci = p.checkIn ?? today;
    const fromPreset = p.nightRates?.flat ?? p.nightRates?.weekday ?? null;
    const seedIds = presetRoomIds.length
      ? [...new Set(presetRoomIds.map((id) => allPlacedInit.find((r) => r.id === id)?.typeId).filter(Boolean) as string[])]
      : defaultTypeId
        ? [defaultTypeId]
        : [];
    const out: Record<string, string> = {};
    for (const tid of seedIds) {
      if (fromPreset != null && fromPreset > 0 && tid === (p.typeId ?? seedIds[0])) out[tid] = String(fromPreset);
      else {
        const br = baseRateFor(s, tid, ci);
        if (br > 0) out[tid] = String(br);
      }
    }
    return out;
  });
  const [priceUnset, setPriceUnset] = useState(!!p.priceUnset);
  const [assignNow, setAssignNow] = useState(presetRoomIds.length > 0); // Path B · 현황 선택 시 ON
  const [roomIds, setRoomIds] = useState<string[]>(presetRoomIds);
  const [otherRooms, setOtherRooms] = useState(
    presetRoomIds.length > 1 &&
      new Set(presetRoomIds.map((id) => allPlacedInit.find((r) => r.id === id)?.typeId)).size > 1,
  );
  const [payMode, setPayMode] = useState<PayMode>("postpaid");
  const [depAmt, setDepAmt] = useState("");
  const [depMethod, setDepMethod] = useState<BookPayMethod>("card");
  /** 「바로 입실」: 이름·연락처 생략 · 호실 필수 · arrived */
  const [walkInImmediate, setWalkInImmediate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const plat = s.platforms.find((x) => x.id === platformId);
  const onsite = isOnsite(plat);
  const pathB = assignNow || walkInImmediate;
  const allPlaced = placedRooms(s);
  const rmap = useMemo(() => new Map(allPlaced.map((r) => [r.id, r])), [allPlaced]);

  const typeSlots = types.map((t) => ({ typeId: t.id, count: typeCounts[t.id] ?? 0 })).filter((x) => x.count > 0);
  const typeIdsFromCounts = expandTypeSlots(typeSlots);
  const roomCount = pathB && roomIds.length > 0 ? roomIds.length : typeIdsFromCounts.length;
  const primaryTypeId = typeSlots[0]?.typeId ?? defaultTypeId;

  // Path B: 고른 호실의 타입이 진실 · Path A: typeCounts
  const effectiveTypeIds = pathB && roomIds.length
    ? roomIds.map((id) => rmap.get(id)?.typeId ?? "")
    : typeIdsFromCounts;
  const countOf = (tid: string) =>
    pathB && roomIds.length
      ? roomIds.filter((id) => rmap.get(id)?.typeId === tid).length
      : typeCounts[tid] ?? 0;
  const pickedTypes = types.filter((t) => countOf(t.id) > 0);

  const rateNum: Record<string, number> = Object.fromEntries(
    Object.entries(rates).map(([k, v]) => [k, Number(v || 0)]),
  );
  const linePrices = priceUnset ? effectiveTypeIds.map(() => 0) : ratePrices(effectiveTypeIds, rateNum, nights);
  const sumPrice = linePrices.reduce((a, b) => a + b, 0);
  const formula = rateFormula(
    pickedTypes.map((t) => ({ label: typeLabel(t), n: countOf(t.id), rate: rateNum[t.id] ?? 0 })),
    nights,
  );

  // free set: probe booking with primary type (room-free check is per-room in freeRooms)
  const probe: Booking = {
    id: "__simple__",
    kind: "stay",
    status: "active",
    platformId,
    price: sumPrice,
    priceUnset,
    guestName,
    guestPhone: guestPhone.trim() || null,
    typeId: primaryTypeId,
    roomId: null,
    segments: null,
    checkIn,
    nights,
    startTime: null,
    endTime: null,
    arrived: walkInImmediate,
    tentative: false,
    memo: null,
    guests,
    nightRates: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const free = useMemo(() => freeRooms(s, data.bookings, probe), [s, data.bookings, probe]);

  const stockByType = useMemo(() => {
    const dates = Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
    const table = stockTable(s, data.bookings, dates);
    const out: Record<string, number> = {};
    for (const t of types) {
      out[t.id] = Math.min(...dates.map((d) => table.get(t.id)?.get(d) ?? 0));
    }
    return out;
  }, [s, data.bookings, checkIn, nights, types]);

  const freeOf = (tid: string) => allPlaced.filter((r) => r.typeId === tid && free.has(r.id)).length;

  const impact = pathB && roomIds.length
    ? groupStockImpact(s, data.bookings, checkIn, nights, roomIds)
    : groupStockImpactByTypes(
        s,
        data.bookings,
        checkIn,
        nights,
        Object.fromEntries(typeSlots.map((x) => [x.typeId, x.count])),
      );
  const typeOver = impact.some((r) => r.after < 0);

  const busyLegs = pathB
    ? roomIds.flatMap((rid) =>
        legConflicts(data.bookings, {
          ...probe,
          id: `__simple_${rid}`,
          roomId: rid,
          typeId: rmap.get(rid)?.typeId ?? primaryTypeId,
        }),
      )
    : [];

  const roomsForPick = useMemo(() => {
    const wanted = new Set(typeSlots.map((x) => x.typeId));
    // Path B: show selected-type rooms first; 「다른 타입」으로 믹스(601+603) 가능
    // 바로 입실·다타입이면 다른 타입도 기본 노출(칩에 타입명)
    const same = allPlaced.filter(
      (r) => free.has(r.id) && (wanted.size === 0 || wanted.has(r.typeId ?? "")),
    );
    const other = allPlaced.filter(
      (r) => free.has(r.id) && wanted.size > 0 && !wanted.has(r.typeId ?? ""),
    );
    return { same, other, showOther: walkInImmediate || typeSlots.length !== 1 || otherRooms };
  }, [allPlaced, free, typeSlots, walkInImmediate, otherRooms]);

  function setCount(tid: string, next: number) {
    const c = Math.max(0, Math.min(GROUP_ROOMS_MAX, next));
    const totalOthers = Object.entries(typeCounts)
      .filter(([id]) => id !== tid)
      .reduce((a, [, n]) => a + (n || 0), 0);
    const capped = Math.min(c, GROUP_ROOMS_MAX - totalOthers);
    setTypeCounts((m) => ({ ...m, [tid]: capped }));
    if (pathB) {
      const others = roomIds.filter((id) => rmap.get(id)?.typeId !== tid);
      const add = autoPick(s, free, tid, capped, new Set(others));
      setRoomIds([...others, ...add]);
    } else {
      setRoomIds([]);
    }
    // seed rate from calendar if empty
    if (capped > 0 && !rates[tid]) {
      const br = baseRateFor(s, tid, checkIn);
      if (br > 0) setRates((m) => ({ ...m, [tid]: String(br) }));
    }
  }

  function syncCountsFromRooms(ids: string[]) {
    const counts: Record<string, number> = {};
    for (const rid of ids) {
      const t = rmap.get(rid)?.typeId;
      if (t) counts[t] = (counts[t] ?? 0) + 1;
    }
    setTypeCounts(() => {
      const merged: Record<string, number> = {};
      for (const t of types) merged[t.id] = counts[t.id] ?? 0;
      return merged;
    });
    for (const tid of Object.keys(counts)) {
      if (!rates[tid]) {
        const br = baseRateFor(s, tid, checkIn);
        if (br > 0) setRates((m) => (m[tid] ? m : { ...m, [tid]: String(br) }));
      }
    }
  }

  function pickRoom(id: string) {
    // Path B: toggle freely across types (601 Family + 603 Ondol); counts sync from rooms
    setRoomIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= GROUP_ROOMS_MAX
          ? [...prev.slice(1), id]
          : [...prev, id];
      syncCountsFromRooms(next);
      return next;
    });
  }

  function fillRooms() {
    const taken = new Set<string>();
    const picked: string[] = [];
    for (const slot of typeSlots) {
      const add = autoPick(s, free, slot.typeId, slot.count, taken);
      for (const id of add) taken.add(id);
      picked.push(...add);
      if (add.length < slot.count) {
        notify(
          `${typeLabel(L.types.get(slot.typeId))} 빈 방이 ${add.length}실뿐이에요 · ${slot.count}실이 필요해요`,
        );
      }
    }
    setRoomIds(picked);
  }

  useEffect(() => setErr(null), [typeCounts, roomIds, nights, checkIn, rates, payMode, priceUnset, walkInImmediate]);

  // 「바로 입실」ON → Path B · 타입 실 수가 있으면 빈 방 자동 채움 (이후 601+603처럼 수동 교체 OK)
  useEffect(() => {
    if (!walkInImmediate) return;
    if (!typeIdsFromCounts.length) return;
    if (roomIds.length === typeIdsFromCounts.length) return;
    fillRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkInImmediate]);

  async function save() {
    const name = guestName.trim() || (walkInImmediate ? walkInDisplayName(checkIn) : "");
    if (!name) return setErr("이름을 적어 주세요.");
    const phoneErr = validateGuestPhone(plat, guestPhone, { walkInImmediate });
    if (phoneErr) return setErr(phoneErr);

    const slots = types.map((t) => ({ typeId: t.id, count: countOf(t.id) })).filter((x) => x.count > 0);
    const n = pathB ? roomIds.length : expandTypeSlots(slots).length;
    if (n < 1) return setErr("객실타입·실 수를 골라 주세요.");
    if (n > GROUP_ROOMS_MAX) return setErr(`한 번에 ${GROUP_ROOMS_MAX}실까지예요.`);

    if (!priceUnset) {
      const missing = slots.filter((x) => !(rateNum[x.typeId] > 0));
      if (missing.length) return setErr("타입마다 1박 요금을 적거나 금액미정을 켜 주세요.");
    }

    if (pathB && roomIds.length !== n)
      return setErr(
        walkInImmediate
          ? n === 1
            ? "바로 입실은 호실을 골라 주세요."
            : `바로 입실은 호실 ${n}실을 골라 주세요.`
          : n === 1
            ? "지금 배정하려면 호실을 골라 주세요."
            : `지금 배정하려면 호실 ${n}실을 골라 주세요 (지금 ${roomIds.length}실).`,
      );

    // Path B: room count must match type slots when slots were set first
    if (pathB && typeIdsFromCounts.length > 0 && roomIds.length !== typeIdsFromCounts.length) {
      // if user picked rooms that redefine counts, n already from roomIds — OK when slots synced
      if (expandTypeSlots(slots).length !== roomIds.length)
        return setErr(`호실 ${roomIds.length}실 · 타입 합 ${expandTypeSlots(slots).length}실이 맞아야 해요.`);
    }

    const saveTypeIds = pathB ? roomIds.map((id) => rmap.get(id)?.typeId ?? "") : expandTypeSlots(slots);
    const prices = priceUnset ? saveTypeIds.map(() => 0) : ratePrices(saveTypeIds, rateNum, nights);
    const totalSale = prices.reduce((a, b) => a + b, 0);

    if (onsite && payMode === "deposit" && !priceUnset) {
      const amt = Number(depAmt || 0);
      const pv = validatePayment(amt, depMethod, today);
      if (pv) return setErr(pv);
      if (amt > totalSale) return setErr("선금이 판매금보다 커요.");
    }

    // validate one representative booking (name/dates/platform)
    const ready: Booking = {
      ...probe,
      guestName: name,
      typeId: saveTypeIds[0] ?? primaryTypeId,
      roomId: pathB ? roomIds[0] ?? null : null,
      price: prices[0] ?? 0,
      arrived: walkInImmediate,
    };
    const v = validateBooking(ready, s);
    if (v) return setErr(v);
    if (busyLegs.length)
      return setErr(`${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호`).join(", ")}는 그 기간에 다른 예약이 있어요.`);

    for (const tid of [...new Set(saveTypeIds)]) {
      const stopped = stopSellDatesForStay(s, tid, checkIn, nights);
      if (stopped.length) {
        return setErr(
          `${typeLabel(L.types.get(tid))} 판매중지된 숙박일이 있어요 (${stopped.map(md).join(", ")}). 판매 캘린더에서 중지를 풀어 주세요.`,
        );
      }
    }

    if (
      typeOver &&
      !window.confirm(
        `${impact
          .filter((x) => x.after < 0)
          .map((x) => typeLabel(L.types.get(x.typeId)))
          .join(", ")} 타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요? · 물리 방 겹침은 막혀 있어요.`,
      )
    )
      return;

    setBusy(true);
    setErr(null);
    try {
      const phone = guestPhone.trim() || null;
      const memberRates = !priceUnset ? saveTypeIds.map((tid) => rateNum[tid] ?? 0) : undefined;
      const ratesPersist =
        !priceUnset
          ? Object.fromEntries(
              slots
                .map((x) => [x.typeId, rateNum[x.typeId] ?? 0] as const)
                .filter((row): row is readonly [string, number] => row[1] > 0),
            )
          : null;

      const decorate = (b: Booking): Booking => ({
        ...b,
        guestName: name,
        guestPhone: phone,
        priceUnset,
        price: priceUnset ? 0 : b.price,
        nightRates:
          !priceUnset && (memberRates?.[0] ?? 0) > 0
            ? syncStayNightRates(checkIn, nights, { flat: rateNum[b.typeId] ?? 0 })
            : b.nightRates,
        guests,
        arrived: walkInImmediate,
      });

      // 1타입 1실 → saveBooking (그룹 강제 금지)
      if (n === 1 && slots.length <= 1) {
        const one: Booking = decorate({
          ...ready,
          roomId: pathB ? roomIds[0] ?? null : null,
          typeId: saveTypeIds[0] ?? primaryTypeId,
          price: prices[0] ?? 0,
          nightRates:
            !priceUnset && (rateNum[saveTypeIds[0]] ?? 0) > 0
              ? syncStayNightRates(checkIn, nights, { flat: rateNum[saveTypeIds[0]] })
              : null,
        });
        const saved = await data.saveBooking(one, true);
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

      const groupId = crypto.randomUUID();
      const drafts = groupDrafts({
        groupId,
        groupName: name,
        platformId,
        checkIn,
        nights,
        roomIds: pathB ? roomIds : undefined,
        typeIds: pathB ? undefined : saveTypeIds,
        prices,
        memberRates,
        s,
        guestsOf: () => guests,
        arrived: walkInImmediate,
      }).map(decorate);

      const savedList = await data.saveGroup(drafts, {
        id: groupId,
        payMode: onsite && payMode === "postpaid" ? "postpaid" : "prepaid",
        dueOn: null,
        payerCompany: null,
        payerName: null,
        payerPhone: phone,
        rates: ratesPersist,
        extras: [],
      });

      let payTail = "";
      if (onsite && !priceUnset && savedList[0]) {
        try {
          if (payMode === "prepaid" && totalSale > 0) {
            for (const b of savedList) {
              if (b.price > 0) await data.addPayment(b.id, { kind: "balance", method: depMethod, amount: b.price, bizDate: today });
            }
            payTail = ` · 선불(완납) ${won(totalSale)}원`;
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
      const path = pathB
        ? ` · ${savedList.map((b) => (b.roomId ? `${L.roomLabel(b.roomId)}호` : "?")).join(", ")}`
        : ` · 미배정 ${n}실(타입 재고)`;
      const unset = priceUnset ? " · 금액미정" : "";
      const mix = pickedTypes.map((t) => `${typeLabel(t)} ${countOf(t.id)}`).join(" · ");
      onSaved(`${name} 님 간단 예약 ${n}실했어요${mix ? ` (${mix})` : ""}${path}${unset}${payTail}`);
    } catch (e) {
      setErr(saveFailMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const bpre = (bid: string) => (L.multi ? <em className="bpre">{L.buildings.get(bid)?.name}</em> : null);
  const totalRooms = pathB && roomIds.length ? roomIds.length : typeIdsFromCounts.length || 0;

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
                      typeId: primaryTypeId,
                      roomId: pathB ? roomIds[0] ?? null : null,
                      guestName: guestName || undefined,
                      guestPhone: guestPhone || undefined,
                      guests,
                      price: priceUnset ? undefined : sumPrice || undefined,
                    })
                : undefined
            }
          />
          <span className="muted sm">전화·현장·OTA · 다타입·호실 · 지금 또는 나중에</span>
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
              roomId={pathB ? roomIds[0] ?? null : null}
              today={today}
              onPick={(ci, n) => {
                setCheckIn(ci);
                setNights(n);
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
            <Chip
              active={walkInImmediate}
              tone="info"
              onClick={() => {
                setWalkInImmediate((v) => {
                  const next = !v;
                  if (next) setAssignNow(true);
                  return next;
                });
              }}
              title="이름·연락처 없이 즉시 숙박"
            >
              바로 입실
            </Chip>
          </ChipGroup>
        </div>

        <div className="fld">
          <label>
            이름{walkInImmediate ? null : <em>*</em>} · 연락처{onsite && !walkInImmediate ? <em>*</em> : null}
          </label>
          <GuestNamePhone
            nameRef={nameRef}
            name={guestName}
            phone={guestPhone}
            onName={setName}
            onPhone={setPhone}
            phoneRequired={onsite && !walkInImmediate}
          />
          {walkInImmediate ? <div className="muted sm">비우면 「{walkInDisplayName(checkIn)}」로 저장 · 나중에 Entry에서 수정</div> : null}
        </div>

        <div className="fld">
          <label>객실타입 · 실 수</label>
          <div className="gcounts">
            {types.map((t) => {
              const c = countOf(t.id);
              const left = stockByType[t.id] ?? 0;
              const f = freeOf(t.id);
              const max = pathB ? Math.max(f, c) : Math.max(left, c, GROUP_ROOMS_MAX);
              return (
                <div className={`gcnt ${c ? "on" : ""}`} key={t.id}>
                  <TypeBadge t={t} />
                  <span className="muted sm">{pathB ? `빈 방 ${f}` : `남은 ${left}`}</span>
                  <span className="step sm">
                    <button
                      type="button"
                      className="sb"
                      aria-label={`${typeLabel(t)} 1실 빼기`}
                      disabled={!c}
                      onClick={() => setCount(t.id, c - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      className="gin num"
                      inputMode="numeric"
                      aria-label={`${typeLabel(t)} 방 수`}
                      value={c}
                      onChange={(e) => setCount(t.id, Number(e.target.value.replace(/\D/g, "") || 0))}
                    />
                    <button
                      type="button"
                      className="sb"
                      aria-label={`${typeLabel(t)} 1실 더하기`}
                      disabled={pathB ? c >= f && f >= 0 : c >= max && totalRooms >= GROUP_ROOMS_MAX}
                      onClick={() => setCount(t.id, c + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
            <div className={`muted sm gnote${typeOver ? " tred" : ""}`}>
              합계 {totalRooms}실
              {pickedTypes.length > 1 ? ` · ${pickedTypes.map((t) => `${typeLabel(t)} ${countOf(t.id)}`).join(" · ")}` : null}
              {typeOver ? " · 재고 부족(오버부킹 경고)" : null}
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
                  if (e.target.checked) setRates({});
                }}
              />
              금액미정
            </label>
            {!priceUnset ? (
              <>
                {pickedTypes.length ? (
                  pickedTypes.map((t) => (
                    <PriceRow key={t.id} style={{ marginTop: "var(--space-chip)" }}>
                      <span className="muted sm" style={{ minWidth: "4.5em" }}>
                        {typeLabel(t)}
                      </span>
                      <PriceInp sm suffix="원/박">
                        <input
                          className="num"
                          inputMode="numeric"
                          aria-label={`${typeLabel(t)} 1박 요금`}
                          value={rates[t.id] !== undefined && rates[t.id] !== "" ? won(Number(rates[t.id])) : ""}
                          placeholder="1박"
                          onChange={(e) =>
                            setRates((m) => ({ ...m, [t.id]: e.target.value.replace(/\D/g, "").slice(0, 9) }))
                          }
                        />
                      </PriceInp>
                      <span className="muted sm">
                        × {nights}박 × {countOf(t.id)}실
                      </span>
                    </PriceRow>
                  ))
                ) : (
                  <span className="muted sm">타입·실 수를 먼저 골라 주세요</span>
                )}
                {sumPrice > 0 ? (
                  <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                    {formula ? `${formula} = ` : null}
                    <b>{won(sumPrice)}원</b>
                  </div>
                ) : null}
              </>
            ) : (
              <span className="muted sm">협상 후 Entry에서 확정</span>
            )}
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
              {payMode === "postpaid" ? (
                <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>퇴실(또는 나중에) 정산 · 결제 줄 없음</div>
              ) : null}
              {priceUnset ? (
                <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>금액미정 · 수납은 확정 후 Entry에서</div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="fld">
          <label>호실</label>
          <div>
            <label className="ck">
              <input
                type="checkbox"
                checked={assignNow || walkInImmediate}
                disabled={walkInImmediate}
                onChange={(e) => {
                  setAssignNow(e.target.checked);
                  if (!e.target.checked) setRoomIds([]);
                  else if (typeIdsFromCounts.length > 1 || typeSlots.length > 0) fillRooms();
                }}
              />
              {walkInImmediate ? "바로 입실 · 호실 필수" : "지금 방 배정"}
              {(assignNow || walkInImmediate) && totalRooms > 1 ? (
                <span className="muted sm">
                  {" "}
                  · {roomIds.length}/{totalRooms || "?"}실
                </span>
              ) : null}
            </label>
            {assignNow || walkInImmediate ? (
              <ChipGroup style={{ marginTop: "var(--space-3)" }}>
                {totalRooms > 1 || typeSlots.length > 0 ? (
                  <Chip sm onClick={fillRooms}>
                    빈 방 자동
                  </Chip>
                ) : null}
                {roomsForPick.same.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`rchip ${roomIds.includes(r.id) ? "on" : ""}`}
                    onClick={() => pickRoom(r.id)}
                    title={typeLabel(L.types.get(r.typeId ?? ""))}
                  >
                    {bpre(r.buildingId)}
                    {r.no}
                    {walkInImmediate || typeSlots.length !== 1 ? (
                      <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i>
                    ) : null}
                  </button>
                ))}
                {roomsForPick.showOther ||
                roomIds.some((id) => {
                  const tid = rmap.get(id)?.typeId;
                  return tid && typeSlots.length > 0 && !typeSlots.some((x) => x.typeId === tid);
                })
                  ? roomsForPick.other.map((r) => (
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
                  : roomsForPick.other.length ? (
                      <button type="button" className="rchip lt" onClick={() => setOtherRooms(true)}>
                        다른 타입 방 +{roomsForPick.other.length}
                      </button>
                    ) : null}
                {!roomsForPick.same.length && !otherRooms ? (
                  <span className="muted sm">그 기간에 빈 방이 없어요 · 타입 실 수를 먼저 올려 보세요</span>
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
              : walkInImmediate
                ? totalRooms > 1
                  ? `바로 입실 ${totalRooms}실 저장`
                  : "바로 입실 저장"
                : pathB
                  ? totalRooms > 1
                    ? `${totalRooms}실 방까지 저장`
                    : "방까지 저장"
                  : totalRooms > 1
                    ? `${totalRooms}실 간단 예약`
                    : "간단 예약 저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

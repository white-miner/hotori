import { receiptBatch } from "../shared/receiptBatch";
import { useCreateReceipts } from "./useCreateReceipts";
/**
 * 간단 예약 — Entry 축약 폼
 * Path A: roomId=null · Path B: 미니 배치도에서 호실 토글 · 확정 기본
 * 다타입: Path B에서 타입 다른 호실(예: 601+603) → groupDrafts / saveGroup (#70)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  type Booking,
  addDays,
  allRooms as placedRooms,
  freeRooms,
  isMultiBuilding,
  legConflicts,
  md,
  stockTable,
  typeLabel,
  usableTypes,
  validateBooking,
  won,
} from "../shared/ledger";
import {
  GROUP_ROOMS_MAX,
  expandTypeSlots,
  groupDrafts,
  groupStockImpact,
  groupStockImpactByTypes,
  hashGroupBadgeColor,
} from "../shared/group";
import { type RateEdits, groupTotal, roomSlots, slotRows, typeSlots as unplacedSlots, unpricedMessage } from "../shared/groupRates";
import GroupRoomRates from "./GroupRoomRates";
import { occupiedNightDates } from "../shared/nightrates";
import { resolveNightRate } from "../shared/salesCalendar";
import { autoNightRates, autoStayRates } from "../shared/autoRate";
import { stopSellDatesForStay } from "../shared/salesCalendar";
import { saveFailMessage } from "../shared/errors";
import { askConfirm } from "./ConfirmDialog";
import {
  type BookPayMethod,
  type OnsitePayMode,
  defaultBookingPlatformId,
  isOnsite,
  createPaymentLines, type TenderAmounts,
  validateGuestPhone,
  validateOnsiteCreateDeposit,
  walkInDisplayName,
} from "../shared/payment";
import { GUESTS_MAX } from "../shared/surcharge";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { TypeBadge, lookups } from "./ui";
import { BookingModeSeg, Chip, ChipGroup, GuestNamePhone, PriceInp, PriceRow, Stepper } from "./primitives";
import StayDateFields from "./StayDateFields";
import OpenStayToggle from "./OpenStayToggle";
import StayPriceEditor from './StayPriceEditor';
import { type StayPriceDraft, resolveStayPrice, singleNightFromPrice } from '../shared/stayPricing';
import { OPEN_HOLD_DEFAULT, openStayNights } from "../shared/openStay";
import MiniFloorPlan, { type BuildingFilter } from "./MiniFloorPlan";
import RoomClashNote from "./RoomClashNote";
import OnsitePayModeFields from "./OnsitePayModeFields";

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
  /** Path A(미배정)만 typeId prefill · 호실 prefill(#71)은 countsFromRooms */
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>(() => {
    if (presetRoomIds.length) {
      const c = countsFromRooms(presetRoomIds);
      if (Object.values(c).some((n) => n > 0)) return c;
    }
    // 판매캘린더 등 typeId만 → Path A 1실. 그 외 빈 값(배치도에서 고르거나 Path A 펼침)
    if (p.typeId && defaultTypeId) return { [defaultTypeId]: 1 };
    return {};
  });
  const [checkIn, setCheckIn] = useState(p.checkIn ?? today);
  const [nights, setNights] = useState(Math.max(1, p.nights ?? 1));
  /** 이용 기간 미정: 켜면 박수는 오늘 밤 + 방 보호까지 자동 */
  /** 박별 요금표 (한 객실 기준 · 모든 객실에 같게). 고치면 1박 요금/총액이 따라 바뀌어요 */
  const [singleDraft, setSingleDraft] = useState<StayPriceDraft | null>(null);
  const [openOn, setOpenOn] = useState(false);
  const [openHold, setOpenHold] = useState(OPEN_HOLD_DEFAULT);
  const [guestName, setName] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [guests, setGuests] = useState(1);
  const [priceUnset, setPriceUnset] = useState(!!p.priceUnset);
  /** 2실 이상일 때 객실별 요금 수정분 (호텔 요금표 제안 위에 덮어쓴 값) */
  const [rateEdits, setRateEdits] = useState<RateEdits>({});
  // 신규 폼의 초기 제안일 뿐: 직접 입력 후에는 singleDraft만 계산의 기준이다.
  const totalStr = p.price != null && p.price > 0 ? String(p.price) : '';
  const totalTouched = p.price != null && p.price > 0;
  /** Path B · #71 roomIds / 단실 roomId prefill → 배치도에 선택 상태 */
  const [roomIds, setRoomIds] = useState<string[]>(presetRoomIds);
  const [buildingFilter, setBuildingFilter] = useState<BuildingFilter>("all");
  const [payMode, setPayMode] = useState<OnsitePayMode>("prepaid");
  const [depAmt, setDepAmt] = useState("");
  const [depMethod, setDepMethod] = useState<BookPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [tenders, setTenders] = useState<TenderAmounts | null>(null);
  const receipts = useCreateReceipts(data.addPaymentBatch, onClose);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const plat = s.platforms.find((x) => x.id === platformId);
  const onsite = isOnsite(plat);
  /** Path B = 배치도에서 호실 선택 · Path A = 호실 없이 타입만 */
  const pathB = roomIds.length > 0;
  const allPlaced = placedRooms(s);
  const rmap = useMemo(() => new Map(allPlaced.map((r) => [r.id, r])), [allPlaced]);
  const multi = isMultiBuilding(s);

  const typeSlots = types.map((t) => ({ typeId: t.id, count: typeCounts[t.id] ?? 0 })).filter((x) => x.count > 0);
  const typeIdsFromCounts = expandTypeSlots(typeSlots);
  const primaryTypeId = typeSlots[0]?.typeId ?? defaultTypeId;

  // Path B: 고른 호실의 타입이 진실 · Path A: typeCounts
  const effectiveTypeIds = pathB && roomIds.length
    ? roomIds.map((id) => rmap.get(id)?.typeId ?? "")
    : typeIdsFromCounts;
  const countOf = (tid: string) =>
    pathB && roomIds.length
      ? roomIds.filter((id) => rmap.get(id)?.typeId === tid).length
      : typeCounts[tid] ?? 0;
  /** usableTypes만 보면 배치도 선택 호실의 타입이 빠져 박당 Inp가 숨겨짐 → s.types까지 포함 */
  const pickedTypes = (() => {
    const fromUsable = types.filter((t) => countOf(t.id) > 0);
    if (fromUsable.length) return fromUsable;
    if (!(pathB && roomIds.length)) return [];
    const seen = new Set<string>();
    const out: typeof types = [];
    for (const rid of roomIds) {
      const tid = rmap.get(rid)?.typeId;
      if (!tid || seen.has(tid)) continue;
      seen.add(tid);
      const t = s.types.find((x) => x.id === tid);
      if (t) out.push(t);
    }
    return out;
  })();
  /** 2실 이상 = 객실마다 요금표 (총액 입력·나누기·같은 금액 복사 없음) */
  const multiRooms = effectiveTypeIds.length >= 2;
  const mSlots = !multiRooms
    ? []
    : pathB
      ? roomSlots(roomIds, (id) => {
          const r = rmap.get(id);
          const tid = r?.typeId ?? "";
          const bname = multi && r ? (L.buildings.get(r.buildingId)?.name ?? "") : "";
          return {
            typeId: tid,
            label: r ? `${bname ? `${bname} ` : ""}${r.no}호` : id,
            sub: typeLabel(L.types.get(tid)),
          };
        })
      : unplacedSlots(effectiveTypeIds, (tid) => ({ name: typeLabel(L.types.get(tid)) || "객실" }));
  const mRows = multiRooms ? slotRows(s, mSlots, rateEdits, checkIn, nights) : [];
  const mPrices = priceUnset ? mRows.map(() => 0) : mRows.map((r) => r.subtotal);
  const manualTotalNum = Math.max(0, Math.round(Number(totalStr || 0)));
  /**
   * 현장·전화 총액 모드: 박마다 요금(특별일 > 시즌 > 평일/주말 > 기본)을 더해 자동으로 채워요.
   * 직접 입력한 총액이 있으면 그게 먼저예요. 요금이 없는 타입이 있으면 수동 입력 그대로.
   */
  const autoStay =
    onsite && !multiRooms && !priceUnset && pickedTypes.length > 0 && effectiveTypeIds.every(Boolean)
      ? autoStayRates(s, pickedTypes.map((t) => ({ typeId: t.id, count: countOf(t.id) })), checkIn, nights)
      : null;
  const autoActive = !!autoStay?.ready && !totalTouched;
  const baselineTotal = autoActive ? autoStay!.total : manualTotalNum;
  const singleResult = singleDraft ? resolveStayPrice(checkIn, nights, singleDraft) : null;
  const totalNum = singleResult?.price ?? baselineTotal;
  const tableNow = singleResult?.rates ?? (autoActive && autoStay ? autoNightRates(autoStay, nights) : singleNightFromPrice(checkIn, nights, baselineTotal, p.nightRates));
  const sumPrice = priceUnset ? 0 : multiRooms ? groupTotal(mRows) : totalNum;

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
    company: company.trim() || null,
    typeId: primaryTypeId,
    roomId: null,
    segments: null,
    checkIn,
    nights,
    startTime: null,
    endTime: null,
    arrived: false,
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

  /** Path A 타입·실수 — 호실 선택과 배타(배치도가 Path B) */
  function setCount(tid: string, next: number) {
    const c = Math.max(0, Math.min(GROUP_ROOMS_MAX, next));
    const totalOthers = Object.entries(typeCounts)
      .filter(([id]) => id !== tid)
      .reduce((a, [, n]) => a + (n || 0), 0);
    const capped = Math.min(c, GROUP_ROOMS_MAX - totalOthers);
    setRoomIds([]);
    setTypeCounts((m) => ({ ...m, [tid]: capped }));

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

  }

  function pickRoom(id: string) {
    // 겹치는 방도 고를 수 있어요 — 막지 않고 아래 겹침 안내로 알려 줘요
    // 하늘색 칸 탭 = 그 호실만 토글 (타입 실수 자동 채움 없음)
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

  /** 배치도 하늘색 후보 = 타입 실수 ≥1 (Path B면 고른 호실 타입과 동기) */
  const candidateTypeIds = useMemo(
    () => types.filter((t) => (typeCounts[t.id] ?? 0) > 0).map((t) => t.id),
    [types, typeCounts],
  );

  useEffect(() => setErr(null), [typeCounts, roomIds, nights, checkIn, totalStr, payMode, priceUnset, rateEdits, singleDraft]);

  // 날짜 바뀌어 불가해진 선택 호실 정리
  useEffect(() => {
    if (!roomIds.length) return;
    // 고른 방은 조용히 지우지 않아요 (겹치면 RoomClashNote가 알려요)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free]);

  /** 저장하기 · 바로입실(저장+arrived · 이름·전화 완화 · 호실 필수) */
  async function save(opts?: { walkInImmediate?: boolean }) {
    if (submitLock.current || busy || receipts.pending) return;
    submitLock.current = true;
    try { await saveDraft(opts); } finally { submitLock.current = false; }
  }
  async function saveDraft(opts?: { walkInImmediate?: boolean }) {
    if (busy || receipts.pending) return;
    const walkInImmediate = !!opts?.walkInImmediate;
    const name = guestName.trim() || (walkInImmediate ? walkInDisplayName(checkIn) : "");
    if (!name) return setErr("이름을 입력해 주세요.");
    const phoneErr = validateGuestPhone(plat, guestPhone, { walkInImmediate });
    if (phoneErr) return setErr(phoneErr);

    const slots = pickedTypes.map((t) => ({ typeId: t.id, count: countOf(t.id) })).filter((x) => x.count > 0);
    const n = pathB ? roomIds.length : expandTypeSlots(slots).length;
    if (n < 1)
      return setErr(
        walkInImmediate
          ? "바로 입실은 배치도에서 호실을 골라 주세요."
          : "배치도에서 호실을 고르거나 타입을 골라 주세요.",
      );
    if (n > GROUP_ROOMS_MAX) return setErr(`한 번에 ${GROUP_ROOMS_MAX}실까지예요.`);

    if (!priceUnset && !multiRooms && singleResult?.error) return setErr(singleResult.error);
    // 완납·후불·선금 모두 판매금(총액) 필수 (금액미정 제외) — 선금 수납 칸과 별개
    if (!priceUnset) {
      if (multiRooms) {
        const unpriced = unpricedMessage(mRows);
        if (unpriced) return setErr(unpriced);
      } else if (!(totalNum > 0)) return setErr('객실 요금을 입력하거나 금액미정을 선택해 주세요.');
    }

    if (walkInImmediate && roomIds.length < 1)
      return setErr("바로 입실은 배치도에서 호실을 골라 주세요.");

    const saveTypeIds = pathB ? roomIds.map((id) => rmap.get(id)?.typeId ?? "") : expandTypeSlots(slots);
    const prices = priceUnset ? saveTypeIds.map(() => 0) : multiRooms ? mPrices : [totalNum];
    const totalSale = prices.reduce((a, b) => a + b, 0);

    if (onsite) {
      const depErr = validateOnsiteCreateDeposit(payMode, {
        priceUnset,
        saleTotal: totalSale,
        depAmt,
        depMethod, tenders,
        bizDate: today,
      });
      if (depErr) return setErr(depErr);
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
    // 겹침은 안내만 — 저장은 막지 않아요 (RoomClashNote · 확인 필요 함에서 다시 볼 수 있어요)

    for (const tid of [...new Set(saveTypeIds)]) {
      const stopped = stopSellDatesForStay(s, tid, checkIn, nights);
      if (stopped.length) {
        return setErr(
          `${typeLabel(L.types.get(tid))} 판매중지된 숙박일이 있어요 (${stopped.map(md).join(", ")}). 판매 캘린더에서 중지를 풀어 주세요.`,
        );
      }
    }

    if (typeOver) {
      const overOk = await askConfirm({
        title: "타입 재고 부족",
        body: `${impact
          .filter((x) => x.after < 0)
          .map((x) => typeLabel(L.types.get(x.typeId)))
          .join(", ")} 타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요? · 물리 방 겹침은 막혀 있어요.`,
        confirmLabel: "저장",
      });
      if (!overOk) return;
    }

    setBusy(true);
    setErr(null);
    try {
      const phone = guestPhone.trim() || null;
      // 2실 이상: 객실마다 자기 요금표 · 타입 단가·총액 복사는 없어요
      const memberNightRates = multiRooms && !priceUnset ? mRows.map((r) => r.rates) : undefined;

      const ratesForBooking = (_typeId: string, roomPrice: number) => priceUnset || !(roomPrice > 0) ? null : tableNow;

      const decorate = (b: Booking): Booking => ({
        ...b,
        ...(openOn ? { openEnded: true, holdAhead: openHold } : {}),
        guestName: name,
        guestPhone: phone,
        company: company.trim() || null,
        priceUnset,
        price: priceUnset ? 0 : b.price,
        nightRates: multiRooms ? b.nightRates : (ratesForBooking(b.typeId, priceUnset ? 0 : b.price) ?? b.nightRates),
        guests,
        arrived: walkInImmediate,
      });

      // 1타입 1실 → saveBooking (그룹 강제 금지)
      if (n === 1 && slots.length <= 1) {
        const onePrice = prices[0] ?? 0;
        const one: Booking = decorate({
          ...ready,
          roomId: pathB ? roomIds[0] ?? null : null,
          typeId: saveTypeIds[0] ?? primaryTypeId,
          price: onePrice,
          nightRates: ratesForBooking(saveTypeIds[0] ?? primaryTypeId, onePrice),
        });
        const saved = await data.saveBooking(one, true);
        const lines = onsite ? createPaymentLines(payMode, { priceUnset, saleTotal: saved.price, depAmt, depMethod, tenders }) : [];
        const path = saved.roomId ? ` · ${L.roomLabel(saved.roomId)}호` : " · 미배정(타입 재고)";
        const unset = saved.priceUnset ? " · 금액미정" : "";
        await receipts.run(receiptBatch({ bookingId: saved.id }, lines, today), () => onSaved(`${saved.guestName} 님 간단 예약했어요${path}${unset}${lines.length ? " · 수납 등록 완료" : ""}`));
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
        memberNightRates,
        s,
        guestsOf: () => guests,
        arrived: walkInImmediate,
      }).map((b) => decorate(b));

      const savedList = await data.saveGroup(drafts, {
        id: groupId,
        payMode: onsite && payMode === "postpaid" ? "postpaid" : "prepaid",
        dueOn: null,
        payerCompany: null,
        payerName: null,
        payerPhone: phone,
        rates: null,
        extras: [],
        badgeColor: hashGroupBadgeColor(groupId),
      });

      const lead = savedList[0];
      const lines = onsite ? createPaymentLines(payMode, { priceUnset, saleTotal: totalSale, depAmt, depMethod, tenders }) : [];
      const payTail = lines.length ? " · 수납 등록 완료" : "";
      const path = pathB
        ? ` · ${savedList.map((b) => (b.roomId ? `${L.roomLabel(b.roomId)}호` : "?")).join(", ")}`
        : ` · 미배정 ${n}실(타입 재고)`;
      const unset = priceUnset ? " · 금액미정" : "";
      const mix = pickedTypes.map((t) => `${typeLabel(t)} ${countOf(t.id)}`).join(" · ");
      await receipts.run(receiptBatch({ groupId: lead.groupId! }, lines, today), () => onSaved(`${name} 님 간단 예약 ${n}실했어요${mix ? ` (${mix})` : ""}${path}${unset}${payTail}`));
    } catch (e) {
      setErr(saveFailMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const roomSummary =
    roomIds.length > 0
      ? roomIds
          .map((id) => {
            const r = rmap.get(id);
            if (!r) return id;
            const bname = multi ? (L.buildings.get(r.buildingId)?.name ?? "") : "";
            return bname ? `${bname} ${r.no}호` : `${r.no}호`;
          })
          .join(", ")
      : "";

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && !busy && !receipts.pending && onClose()}>
      <form
        inert={receipts.pending}
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
                      price: priceUnset || multiRooms ? undefined : sumPrice || undefined,
                      nightRates: priceUnset || multiRooms ? null : tableNow,
                    })
                : undefined
            }
          />
          <button type="button" className="x" disabled={busy} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="simple-book-body">
        <div className="fld simple-nights">
          <label>이용 날짜</label>
          <div>
            <StayDateFields
              checkIn={checkIn}
              nights={nights}
              today={today}
              bookings={data.bookings}
              roomId={pathB ? roomIds[0] ?? null : null}
              onChange={(ci, n) => {
                setCheckIn(ci);
                setNights(openOn ? openStayNights(ci, today, openHold) : n);
              }}
              onBlocked={() => notify("그 숙박일은 이미 다른 예약이 있어요")}
              open={openOn}
            />
            <OpenStayToggle
              on={openOn}
              hold={openHold}
              onChange={(on, h) => {
                setOpenOn(on);
                setOpenHold(h);
                if (on) setNights(openStayNights(checkIn, today, h));
              }}
            />
          </div>
        </div>

        <div className="fld">
          <label>채널</label>
          <ChipGroup>
            {s.platforms.map((pl) => (
              <Chip
                key={pl.id}
                active={pl.id === platformId}
                onClick={() => setPlatformId(pl.id)}
                title={isOnsite(pl) ? "현장/전화" : "플랫폼"}
              >
                {pl.name}
              </Chip>
            ))}
          </ChipGroup>
        </div>

        <div className="fld">
          <label>
            이름<em>*</em> · 연락처{onsite ? <em>*</em> : null}
          </label>
          {/* value col only — muted helper as 3rd .fld child sat under the 86px label */}
          <div className="payb">
            <GuestNamePhone
              nameRef={nameRef}
              name={guestName}
              phone={guestPhone}
              onName={setName}
              onPhone={setPhone}
              phoneRequired={onsite}
            />
            <div className="muted sm">바로입실 시 이름·연락처 비워도 돼요 · 호실 필수</div>
          </div>
        </div>

        <div className="fld">
          <label htmlFor="simple-company">회사명</label>
          <div className="payb">
            <input
              id="simple-company"
              className="inp"
              value={company}
              maxLength={60}
              placeholder="회사명 (선택 · 객실 카드에 표시)"
              onChange={(e) => setCompany(e.target.value)}
              aria-label="회사명"
            />
          </div>
        </div>

        <div className="fld">
          <label>호실</label>
          <div className="mfp-wrap">
            {/* 타입 줄 = 배치도 위 · Path A 본체 + 하늘색 후보 필터 */}
            <div className="mfp-types">
              <div className="muted sm">타입 · 잔여 수</div>
              <div className="gcounts mfp-type-list">
                {types.map((t) => {
                  const c = typeCounts[t.id] ?? 0;
                  const left = stockByType[t.id] ?? 0;
                  const max = Math.max(left, c, GROUP_ROOMS_MAX);
                  return (
                    <div className={`gcnt ${c ? "on" : ""}`} key={t.id}>
                      <TypeBadge t={t} />
                      <span className="muted sm">잔여 {left}</span>
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
                          disabled={c >= max && typeIdsFromCounts.length >= GROUP_ROOMS_MAX}
                          onClick={() => setCount(t.id, c + 1)}
                        >
                          <Plus size={14} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {!roomIds.length && typeIdsFromCounts.length ? (
                <div className={`muted sm${typeOver ? " tred" : ""}`}>
                  합계 {typeIdsFromCounts.length}실(미배정)
                  {pickedTypes.length
                    ? ` · ${pickedTypes.map((t) => `${typeLabel(t)} ${countOf(t.id)}`).join(" · ")}`
                    : null}
                  {typeOver ? " · 재고 부족(오버부킹 경고)" : null}
                </div>
              ) : null}
            </div>
            <MiniFloorPlan
              s={s}
              L={L}
              free={free}
              selectedIds={roomIds}
              candidateTypeIds={candidateTypeIds}
              buildingFilter={buildingFilter}
              onBuildingFilter={setBuildingFilter}
              onToggle={pickRoom}
              allowBusy
            />
            <RoomClashNote
              data={data}
              today={today}
              picked={roomIds}
              checkIn={checkIn}
              nights={nights}
              onSwap={(from, to) => {
                setRoomIds((x) => {
                  const next = x.map((y) => (y === from ? to : y));
                  syncCountsFromRooms(next);
                  return next;
                });
              }}
            />
            <div className={`muted sm mfp-sum${typeOver ? " tred" : ""}`}>
              {roomIds.length
                ? `${roomSummary} · ${roomIds.length}실`
                : typeIdsFromCounts.length
                  ? "호실 없이 미배정 저장 가능 · 또는 하늘색 칸에서 지정"
                  : "타입을 고르거나 배치도에서 호실을 지정"}
              {pickedTypes.length > 1 && roomIds.length
                ? ` · ${pickedTypes.map((t) => `${typeLabel(t)} ${countOf(t.id)}`).join(" · ")}`
                : null}
              {typeOver && roomIds.length ? " · 재고 부족(오버부킹 경고)" : null}
            </div>
          </div>
        </div>

        <div className="fld">
          <label>인원</label>
          <Stepper value={guests} min={1} max={GUESTS_MAX} onChange={setGuests} />
        </div>

        {/* 현장·전화: 완납/후불/선금 → 결제수단 → 판매금 · shared OnsitePayModeFields */}
        {onsite ? (
          <OnsitePayModeFields
            tenders={tenders} onTenders={setTenders} saleTotal={sumPrice} disabled={busy}
            part="chips"
            payMode={payMode}
            onPayMode={setPayMode}
            depAmt={depAmt}
            onDepAmt={setDepAmt}
            depMethod={depMethod}
            onDepMethod={setDepMethod}
            priceUnset={priceUnset}
          />
        ) : null}
        {onsite ? (
          <OnsitePayModeFields
            tenders={tenders} onTenders={setTenders} saleTotal={sumPrice} disabled={busy}
            part="method"
            payMode={payMode}
            onPayMode={setPayMode}
            depAmt={depAmt}
            onDepAmt={setDepAmt}
            depMethod={depMethod}
            onDepMethod={setDepMethod}
            priceUnset={priceUnset}
          />
        ) : null}

        <div className="fld">
          <label>객실 요금</label>
          <div className="simple-price">
            <label className="ck"><input type="checkbox" checked={priceUnset} onChange={e => setPriceUnset(e.target.checked)} />금액미정</label>
            {!priceUnset ? multiRooms ? <GroupRoomRates s={s} slots={mSlots} edits={rateEdits} onEdits={setRateEdits} checkIn={checkIn} nights={nights} /> :
              <StayPriceEditor checkIn={checkIn} nights={nights} draft={singleDraft} rates={tableNow} price={totalNum}
                suggestions={Object.fromEntries(occupiedNightDates(checkIn, nights).map(d => [d, resolveNightRate(s, effectiveTypeIds[0] || primaryTypeId, d).amount]))}
                onChange={setSingleDraft} disabled={busy} /> : <span className="muted sm">금액은 나중에 확정합니다.</span>}
          </div>
        </div>

        {/* 선금·완납 수납만 · 후불은 숨김 · shared */}
        {onsite ? (
          <OnsitePayModeFields
            tenders={tenders} onTenders={setTenders} saleTotal={sumPrice} disabled={busy}
            part="take"
            payMode={payMode}
            onPayMode={setPayMode}
            depAmt={depAmt}
            onDepAmt={setDepAmt}
            depMethod={depMethod}
            onDepMethod={setDepMethod}
            priceUnset={priceUnset}
          />
        ) : null}

        {err ? <div className="ferr" role="alert">{err}</div> : null}

        </div>
        <div className="mf">
          <span className="grow" />
          <button type="button" className="btn line" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn stop" disabled={busy}>
            {busy
              ? "저장 중…"
              : roomIds.length >= 1
                ? `${roomIds.length}실 저장`
                : "저장하기"}
          </button>
          <button
            type="button"
            className="btn green"
            disabled={busy}
            onClick={() => void save({ walkInImmediate: true })}
            title="저장 후 바로 숙박(입실) · 호실 필수 · 이름·연락처 비워도 됨"
          >
            {busy ? "저장 중…" : "바로입실"}
          </button>
        </div>
      </form>
      {receipts.recovery}
    </div>
  );
}

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
import { nightRatesFromTotal, syncStayNightRates } from "../shared/nightrates";
import { type ManualNightRates, autoNightRates, autoStayRates } from "../shared/autoRate";
import { baseRateFor, stopSellDatesForStay } from "../shared/salesCalendar";
import { saveFailMessage } from "../shared/errors";
import { askConfirm } from "./ConfirmDialog";
import {
  type BookPayMethod,
  type OnsitePayMode,
  defaultBookingPlatformId,
  isOnsite,
  onsiteCreatePayTail,
  planOnsiteCreatePay,
  validateGuestPhone,
  validateOnsiteCreateDeposit,
  walkInDisplayName,
} from "../shared/payment";
import { rateFormula, ratePrices } from "../shared/settle";
import { GUESTS_MAX } from "../shared/surcharge";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { TypeBadge, lookups } from "./ui";
import { BookingModeSeg, Chip, ChipGroup, GuestNamePhone, PriceInp, PriceRow, Stepper } from "./primitives";
import StayDateFields from "./StayDateFields";
import OpenStayToggle from "./OpenStayToggle";
import NightRatesTable from "./NightRatesTable";
import { sumNightAmounts } from "../shared/nightrates";
import type { StayNightRates } from "../shared/nightrates";
import { OPEN_HOLD_DEFAULT, openStayNights } from "../shared/openStay";
import AutoNightRates from "./AutoNightRates";
import MiniFloorPlan, { type BuildingFilter } from "./MiniFloorPlan";
import RoomClashNote from "./RoomClashNote";
import OnsitePayModeFields from "./OnsitePayModeFields";

/** 플랫폼 판매금 입력: 박당 = rate×박 · 총액 = OTA 총액 그대로 (기본) */
type SalesMode = "perNight" | "total";

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
  const [nightTable, setNightTable] = useState<StayNightRates | null>(null);
  const [openOn, setOpenOn] = useState(false);
  const [openHold, setOpenHold] = useState(OPEN_HOLD_DEFAULT);
  const [guestName, setName] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [guests, setGuests] = useState(1);
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const ci = p.checkIn ?? today;
    const fromPreset = p.nightRates?.flat ?? p.nightRates?.weekday ?? null;
    const seedIds = presetRoomIds.length
      ? [...new Set(presetRoomIds.map((id) => allPlacedInit.find((r) => r.id === id)?.typeId).filter(Boolean) as string[])]
      : p.typeId && defaultTypeId
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
  /** 2실 이상일 때 객실별 요금 수정분 (호텔 요금표 제안 위에 덮어쓴 값) */
  const [rateEdits, setRateEdits] = useState<RateEdits>({});
  /** 플랫폼 전용 · 기본 총액(OTA 붙여넣기) */
  const [salesMode, setSalesMode] = useState<SalesMode>("total");
  const [totalStr, setTotalStr] = useState(() => (p.price != null && p.price > 0 ? String(p.price) : ""));
  /** 총액을 직접 적었으면 자동 요금 대신 그 값 (「자동 계산으로 되돌리기」로 해제) */
  const [totalTouched, setTotalTouched] = useState(() => p.price != null && p.price > 0);
  /** 박별 자동 요금에서 직접 고친 금액: 타입 → 날짜 → 원 */
  const [nightOv, setNightOv] = useState<ManualNightRates>({});
  /** Path B · #71 roomIds / 단실 roomId prefill → 배치도에 선택 상태 */
  const [roomIds, setRoomIds] = useState<string[]>(presetRoomIds);
  const [buildingFilter, setBuildingFilter] = useState<BuildingFilter>("all");
  const [payMode, setPayMode] = useState<OnsitePayMode>("prepaid");
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
  /** 호실 또는 타입 선택 여부 — 박당 Inp 게이트 (총액은 항상 표시) */
  const hasRoomOrType = roomIds.length > 0 || typeSlots.length > 0;
  /** 타입 미정 호실만 골랐을 때 박당 단가 키 */
  const fallbackRateKey = primaryTypeId || roomIds[0] || "";

  const rateNum: Record<string, number> = Object.fromEntries(
    Object.entries(rates).map(([k, v]) => [k, Number(v || 0)]),
  );
  /**
   * 총액 모드: 플랫폼(#75) + 현장·전화 완납/후불/선금 — 총액 우선, 박·호실은 자동 분배
   * (나머지 원은 마지막 호실·마지막 박). 박당 강요 금지.
   */
  const totalMode = salesMode === "total";
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
  const tableNow: StayNightRates | null = nightTable && !multiRooms && (!totalMode || effectiveTypeIds.length <= 1) ? syncStayNightRates(checkIn, nights, nightTable) : null;
  const tableSum = tableNow ? sumNightAmounts(tableNow.nights) : 0;
  /**
   * 현장·전화 총액 모드: 박마다 요금(특별일 > 시즌 > 평일/주말 > 기본)을 더해 자동으로 채워요.
   * 직접 입력한 총액이 있으면 그게 먼저예요. 요금이 없는 타입이 있으면 수동 입력 그대로.
   */
  const autoStay =
    onsite && totalMode && !multiRooms && !priceUnset && pickedTypes.length > 0 && effectiveTypeIds.every(Boolean)
      ? autoStayRates(s, pickedTypes.map((t) => ({ typeId: t.id, count: countOf(t.id) })), checkIn, nights, nightOv)
      : null;
  const autoActive = !!autoStay?.ready && !totalTouched;
  const totalNum = tableNow && totalMode ? tableSum : autoActive ? autoStay!.total : manualTotalNum;
  const rateKeysForLines =
    !totalMode && pickedTypes.length
      ? effectiveTypeIds.map((tid) => tid || fallbackRateKey)
      : !totalMode && hasRoomOrType && fallbackRateKey
        ? effectiveTypeIds.map(() => fallbackRateKey)
        : effectiveTypeIds;
  const linePrices = priceUnset
    ? effectiveTypeIds.map(() => 0)
    : multiRooms
      ? mPrices
      : totalMode
      ? effectiveTypeIds.length ? [totalNum] : []
      : tableNow
        ? effectiveTypeIds.map(() => tableSum)
        : ratePrices(rateKeysForLines, rateNum, nights);
  const sumPrice = priceUnset ? 0 : multiRooms ? groupTotal(mRows) : totalMode ? totalNum : linePrices.reduce((a, b) => a + b, 0);
  const formula = totalMode || multiRooms
    ? ""
    : rateFormula(
        pickedTypes.length
          ? pickedTypes.map((t) => ({ label: typeLabel(t) || t.name || t.id, n: countOf(t.id), rate: rateNum[t.id] ?? 0 }))
          : hasRoomOrType && fallbackRateKey
            ? [
                {
                  label: "박당",
                  n: Math.max(1, roomIds.length || typeIdsFromCounts.length),
                  rate: rateNum[fallbackRateKey] ?? 0,
                },
              ]
            : [],
        nights,
      );

  const switchSalesMode = (mode: SalesMode) => {
    if (mode === salesMode) return;
    if (mode === "total") {
      const fromRates = ratePrices(effectiveTypeIds, rateNum, nights).reduce((a, b) => a + b, 0);
      if (fromRates > 0) {
        setTotalStr(String(fromRates));
        setTotalTouched(true);
      }
    } else if (totalNum > 0 && pickedTypes.length) {
      // 총액 → 박당 (한 객실일 때만): 박수로 나눈 단가(표시용). 2실 이상은 이 화면 자체가 없어요.
      const perNight = nights >= 1 ? Math.floor(totalNum / nights) : 0;
      if (perNight > 0) {
        setRates((m) => {
          const next = { ...m };
          for (const t of pickedTypes) next[t.id] = String(perNight);
          return next;
        });
      }
    }
    setSalesMode(mode);
  };

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

  useEffect(() => setErr(null), [typeCounts, roomIds, nights, checkIn, rates, totalStr, salesMode, payMode, priceUnset, rateEdits]);

  // 날짜 바뀌어 불가해진 선택 호실 정리
  useEffect(() => {
    if (!roomIds.length) return;
    // 고른 방은 조용히 지우지 않아요 (겹치면 RoomClashNote가 알려요)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free]);

  /** 저장하기 · 바로입실(저장+arrived · 이름·전화 완화 · 호실 필수) */
  async function save(opts?: { walkInImmediate?: boolean }) {
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

    // 완납·후불·선금 모두 판매금(총액) 필수 (금액미정 제외) — 선금 수납 칸과 별개
    if (!priceUnset) {
      if (multiRooms) {
        const unpriced = unpricedMessage(mRows);
        if (unpriced) return setErr(unpriced);
      } else if (totalMode) {
        if (!(totalNum > 0)) return setErr("판매금(총액)을 적거나 금액미정을 켜 주세요.");
      } else if (!tableNow) {
        const missing = slots.filter((x) => !(rateNum[x.typeId] > 0));
        const fallbackOk = !slots.length && fallbackRateKey && rateNum[fallbackRateKey] > 0;
        if (missing.length || (!slots.length && !fallbackOk))
          return setErr("판매금(1박 요금)을 적거나 금액미정을 켜 주세요.");
      }
    }

    if (walkInImmediate && roomIds.length < 1)
      return setErr("바로 입실은 배치도에서 호실을 골라 주세요.");

    const saveTypeIds = pathB ? roomIds.map((id) => rmap.get(id)?.typeId ?? "") : expandTypeSlots(slots);
    const rateNumForSave =
      !priceUnset && !totalMode && !slots.length && fallbackRateKey && rateNum[fallbackRateKey] > 0
        ? Object.fromEntries(saveTypeIds.map((tid) => [tid || fallbackRateKey, rateNum[fallbackRateKey]]))
        : rateNum;
    const prices = priceUnset
      ? saveTypeIds.map(() => 0)
      : multiRooms
        ? mPrices
        : totalMode
        ? [totalNum]
        : tableNow
          ? saveTypeIds.map(() => tableSum)
          : ratePrices(
            saveTypeIds.map((tid) => tid || fallbackRateKey),
            rateNumForSave,
            nights,
          );
    const totalSale = priceUnset ? 0 : totalMode && !multiRooms ? totalNum : prices.reduce((a, b) => a + b, 0);

    if (onsite) {
      const depErr = validateOnsiteCreateDeposit(payMode, {
        priceUnset,
        saleTotal: totalSale,
        depAmt,
        depMethod,
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

      const ratesForBooking = (typeId: string, roomPrice: number) => {
        if (priceUnset || !(roomPrice > 0)) return null;
        if (tableNow) return tableNow;
        if (totalMode) return autoActive && autoStay ? autoNightRates(autoStay, nights) : nightRatesFromTotal(checkIn, nights, roomPrice);
        const flat = rateNum[typeId] ?? 0;
        return flat > 0 ? syncStayNightRates(checkIn, nights, { flat }) : null;
      };

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
        let payTail = "";
        if (onsite && isOnsite(s.platforms.find((x) => x.id === saved.platformId))) {
          const plan = planOnsiteCreatePay(payMode, {
            priceUnset,
            saleTotal: saved.price,
            depAmt,
            depMethod,
          });
          if (plan.kind !== "none") {
            try {
              await data.addPayment(saved.id, {
                kind: plan.kind === "balance" ? "balance" : "deposit",
                method: plan.method,
                amount: plan.amount,
                bizDate: today,
              });
              payTail = onsiteCreatePayTail(plan);
            } catch (e) {
              payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
            }
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

      // 다실 완납/선금: 대장(첫 호·savedList[0])에 총액 1줄 — 방마다 1/n 루프 금지
      const lead = savedList[0];
      let payTail = "";
      if (onsite && lead) {
        try {
          if (payMode === "prepaid" && !priceUnset && totalSale > 0) {
            await data.addPayment(lead.id, {
              kind: "balance",
              method: depMethod,
              amount: totalSale,
              bizDate: today,
            });
            payTail = onsiteCreatePayTail({ kind: "balance", amount: totalSale, method: depMethod });
          } else if (payMode === "deposit") {
            const plan = planOnsiteCreatePay(payMode, { priceUnset, saleTotal: totalSale, depAmt, depMethod });
            if (plan.kind === "deposit") {
              await data.addPayment(lead.id, {
                kind: "deposit",
                method: plan.method,
                amount: plan.amount,
                bizDate: today,
              });
              payTail = onsiteCreatePayTail(plan);
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

  /** 박별 요금표: 총액 ⇄ 박별 (한 객실일 때만 — 2실 이상은 객실별 요금표) */
  const roomsN = Math.max(1, effectiveTypeIds.length);
  const firstRate = rateNum[fallbackRateKey] ?? Number(Object.values(rates)[0] || 0);
  const nightsEditor =
    !priceUnset && !multiRooms && (!totalMode || roomsN <= 1) ? (
      <div style={{ marginTop: "var(--space-chip)" }}>
        <NightRatesTable
          checkIn={checkIn}
          nights={nights}
          rates={tableNow ?? (totalMode && totalNum > 0 ? nightRatesFromTotal(checkIn, nights, totalNum) : null)}
          fallback={firstRate}
          onChange={(r) => {
            setNightTable(r);
            if (totalMode) {
              setTotalStr(String(sumNightAmounts(r.nights)));
              setTotalTouched(true);
            }
          }}
        />
      </div>
    ) : null;

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
                      price: priceUnset || multiRooms ? undefined : sumPrice || undefined,
                    })
                : undefined
            }
          />
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

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
              placeholder="선택 · 예: 오서건설 (객실 카드에 보여요)"
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

        {/* 판매금: 완납·후불·선금·플랫폼 모두 표시 · 기본 총액(박·호실 자동 분배) */}
        <div className="fld">
          <label>판매금</label>
          <div className="simple-price">
            {!multiRooms ? (
            <div className="seg sm" role="tablist" aria-label="판매금 입력 모드" style={{ marginBottom: "var(--space-chip)" }}>
              <button
                type="button"
                role="tab"
                aria-selected={salesMode === "perNight"}
                className={salesMode === "perNight" ? "on" : ""}
                onClick={() => switchSalesMode("perNight")}
              >
                박당
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={salesMode === "total"}
                className={salesMode === "total" ? "on" : ""}
                onClick={() => switchSalesMode("total")}
              >
                총액
              </button>
            </div>
            ) : null}
            <label className="ck">
              <input
                type="checkbox"
                checked={priceUnset}
                onChange={(e) => {
                  setPriceUnset(e.target.checked);
                  if (e.target.checked) {
                    setRates({});
                    setTotalStr("");
                  }
                }}
              />
              금액미정
            </label>
            {!priceUnset ? (
              multiRooms ? (
                <div style={{ marginTop: "var(--space-chip)" }}>
                  <GroupRoomRates s={s} slots={mSlots} edits={rateEdits} onEdits={setRateEdits} checkIn={checkIn} nights={nights} />
                </div>
              ) : totalMode ? (
                <>
                  <PriceRow style={{ marginTop: "var(--space-chip)" }}>
                    <PriceInp total>
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label="판매금 총액"
                        placeholder="총액"
                        value={autoActive ? won(totalNum) : totalStr !== "" ? won(Number(totalStr)) : ""}
                        onChange={(e) => {
                          setNightTable(null);
                          setTotalStr(e.target.value.replace(/\D/g, "").slice(0, 9));
                          setTotalTouched(true);
                        }}
                      />
                    </PriceInp>
                  </PriceRow>
                  <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                    {onsite ? "총액 · 박·호실은 자동 분배" : "플랫폼 총액 그대로"}
                    {totalNum > 0 ? (
                      <>
                        {" · "}
                        <b>{won(totalNum)}원</b>
                        {effectiveTypeIds.length > 1 ? ` · ${effectiveTypeIds.length}실` : null}
                        {nights > 1 ? ` · ${nights}박` : null}
                      </>
                    ) : null}
                  </div>
                  {nightsEditor}
                  {autoStay ? (
                    <>
                      {autoStay.missingTypeIds.length ? (
                        <div className="anr-hint" role="status" style={{ marginTop: "var(--space-chip)" }}>
                          {autoStay.missingTypeIds.map((id) => typeLabel(L.types.get(id)) || id).join(" · ")} 요금이 아직 없어요. 총액을 직접 적거나,
                          박마다 눌러서 입력해 주세요. (설정 › 객실 요금에서 정해 두면 자동으로 채워져요)
                        </div>
                      ) : null}
                      <div style={{ marginTop: "var(--space-chip)" }}>
                        <AutoNightRates
                          lines={autoStay.lines}
                          typeOf={(id) => L.types.get(id)}
                          onEdit={(tid, date, amount) => {
                            setNightOv((m) => {
                              const row = { ...(m[tid] ?? {}) };
                              if (amount > 0) row[date] = amount;
                              else delete row[date];
                              return { ...m, [tid]: row };
                            });
                            setTotalTouched(false);
                          }}
                        />
                      </div>
                      {totalTouched && autoStay.ready ? (
                        <button
                          type="button"
                          className="btn sm ghost"
                          style={{ marginTop: "var(--space-chip)" }}
                          onClick={() => setTotalTouched(false)}
                        >
                          자동 계산으로 되돌리기 · {won(autoStay.total)}원
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {hasRoomOrType ? (
                    pickedTypes.length ? (
                      pickedTypes.map((t) => (
                        <PriceRow key={t.id} style={{ marginTop: "var(--space-chip)" }}>
                          <span className="muted sm" style={{ minWidth: "4.5em" }}>
                            {typeLabel(t) || t.name || t.id}
                          </span>
                          <PriceInp sm suffix="원/박">
                            <input
                              className="num"
                              inputMode="numeric"
                              aria-label={`${typeLabel(t) || t.name || t.id} 1박 요금`}
                              value={rates[t.id] !== undefined && rates[t.id] !== "" ? won(Number(rates[t.id])) : ""}
                              placeholder="1박"
                              onChange={(e) => {
                                setNightTable(null);
                                setRates((m) => ({ ...m, [t.id]: e.target.value.replace(/\D/g, "").slice(0, 9) }));
                              }}
                            />
                          </PriceInp>
                          <span className="muted sm">
                            × {nights}박 × {countOf(t.id)}실
                          </span>
                        </PriceRow>
                      ))
                    ) : (
                      <PriceRow style={{ marginTop: "var(--space-chip)" }}>
                        <PriceInp sm suffix="원/박">
                          <input
                            className="num"
                            inputMode="numeric"
                            aria-label="판매금 박당"
                            placeholder="1박"
                            value={
                              fallbackRateKey && rates[fallbackRateKey] !== undefined && rates[fallbackRateKey] !== ""
                                ? won(Number(rates[fallbackRateKey]))
                                : ""
                            }
                            onChange={(e) => {
                              if (!fallbackRateKey) return;
                              setNightTable(null);
                              setRates((m) => ({
                                ...m,
                                [fallbackRateKey]: e.target.value.replace(/\D/g, "").slice(0, 9),
                              }));
                            }}
                          />
                        </PriceInp>
                        <span className="muted sm">
                          × {nights}박 × {Math.max(1, roomIds.length || typeIdsFromCounts.length)}실
                        </span>
                      </PriceRow>
                    )
                  ) : (
                    <span className="muted sm">호실 또는 타입을 먼저 골라 주세요</span>
                  )}
                  {sumPrice > 0 ? (
                    <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                      {formula ? `${formula} = ` : null}
                      <b>{won(sumPrice)}원</b>
                    </div>
                  ) : null}
                  {hasRoomOrType ? nightsEditor : null}
                </>
              )
            ) : (
              <span className="muted sm">협상 후 Entry에서 확정</span>
            )}
          </div>
        </div>

        {/* 선금·완납 수납만 · 후불은 숨김 · shared */}
        {onsite ? (
          <OnsitePayModeFields
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

        {err ? <div className="err">{err}</div> : null}

        <div className="mf">
          <span className="grow" />
          <button type="button" className="btn line" onClick={onClose}>
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
    </div>
  );
}

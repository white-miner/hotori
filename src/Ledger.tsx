import { useEffect, useMemo, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { saveFailMessage } from "../shared/errors";
import { Check, ChevronLeft, ChevronRight, Download, FileDown, FileText, Printer, Search } from "lucide-react";
import { type GroupSummary, groupDateBlock, groupSummaries } from "../shared/group";
import { emptyGroupInfo, settle, settleBadge } from "../shared/settle";
import GroupSettle from "./GroupSettle";
import GroupAdd from "./GroupAdd";
import StayConfirmLetter from "./StayConfirmLetter";
import InvoiceLetter from "./InvoiceLetter";
import {
  type HotelData,
  queryLedger,
  queryPayments,
  queryShopSales,
  useExpenseVendors,
  useExpenses,
  useInvoiceIssues,
} from "./data";
import {
  type Booking,
  type StayPhase,
  CHECKIN_STRIP_LABEL,
  STAY_CONFIRM_COPY,
  addDays,
  dayLabel,
  isActive,
  isEarlyOut,
  isMoved,
  legsOf,
  md,
  perNight,
  roomRevenue,
  stayEnd,
  stayInOutLabel,
  stayPhase,
  stayRoomIds,
  stayStatusLabel,
  STAY_PHASE_LABEL,
  typeLabel,
  usableTypes,
  usedLabel,
  usedNights,
  weekCheckinCounts,
  weekDates,
  weekStart,
  weekday,
  won,
} from "../shared/ledger";
import {
  BOOK_PAY_LABEL,
  BOOK_PAY_METHODS,
  type BookPayMethod,
  type Payment,
  bookingCash,
  paySplit,
  payState,
  validatePayment,
} from "../shared/payment";
import { STAY_CREDIT_COPY, listOpenCredits } from "../shared/stayCredit";
import StayCreditsModal from "./StayCreditsModal";
import { EXTEND_COPY, NIGHTS_PRICE_WARN, canExtend, planGroupExtend, repriceForNights } from "../shared/extend";
import { isTimeService, timeLine, timeTags } from "../shared/extratime";
import { parkingMark, plateMatches } from "../shared/parking";
import { type PaySplit, ledgerSummary, payLine, shopTotals } from "../shared/shop";
import { type Expense, EXPENSE_PAY_LABEL, expenseTotals, moneySummary } from "../shared/expense";
import { ExpenseList, ExpenseModal } from "./Expenses";
import { askConfirm } from "./ConfirmDialog";
import { PlatBadge, TypeBadge, lookups } from "./ui";
import { cardFeeOf, payoutOf, payoutRevenue, payoutSummary, payoutValue, payoutWaiting } from "../shared/fee";
import { downloadLedgerXlsx } from "../shared/ledgerExport";
import { hasProAccess } from "../shared/proGates";
import { methodSales, platformPayMatrix, resolvePlatformForPay, typeSalesByType } from "../shared/execSummary";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  query: string;
  setQuery: (q: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  onOpen: (b: Booking, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  notify: (m: string) => void;
}
type LTab = "bookings" | "expenses" | "summary";
const LT_KEY = "hotori.ledgerTab";
type StatusF = "all" | "active" | "void";
type PhaseF = "all" | StayPhase;
type PeriodChip = "today" | "7" | "30" | "custom";
type MoneyBasis = "sale" | "payout";
const MB_KEY = "hotori.moneyBasis";

function readLedgerTab(): LTab {
  try {
    const v = localStorage.getItem(LT_KEY);
    if (v === "expenses" || v === "summary" || v === "bookings") return v;
  } catch {
    /* 개인 정보 보호 모드 */
  }
  return "bookings";
}

export default function Ledger({ data, hotelId, today, query, setQuery, searchRef, onOpen, notify }: Props) {
  // 장부 탭: 예약 · 지출 · 경영 요약 (기기마다 마지막 탭 기억)
  const [tab, setTabRaw] = useState<LTab>(readLedgerTab);
  const setTab = (x: LTab) => {
    setTabRaw(x);
    try {
      localStorage.setItem(LT_KEY, x);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  const [exEdit, setExEdit] = useState<Expense | "new" | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [creditsBusy, setCreditsBusy] = useState(false);
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 7));
  const [period, setPeriod] = useState<PeriodChip>("7");
  /** 일주일 입실현황: 달력 주(월~일) 앵커 */
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(today));
  const [plat, setPlat] = useState("");
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [st, setSt] = useState<StatusF>("all");
  const [phase, setPhase] = useState<PhaseF>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const applyPeriod = (p: Exclude<PeriodChip, "custom">) => {
    setPeriod(p);
    if (p === "today") {
      setFrom(today);
      setTo(today);
    } else if (p === "7") {
      setFrom(addDays(today, -7));
      setTo(addDays(today, 7));
    } else {
      setFrom(addDays(today, -30));
      setTo(addDays(today, 30));
    }
  };
  const stripDays = useMemo(() => weekDates(weekAnchor), [weekAnchor]);
  const stripCounts = useMemo(() => weekCheckinCounts(data.bookings, stripDays), [data.bookings, stripDays]);
  const pickStripDay = (d: string) => {
    setFrom(d);
    setTo(d);
    setPeriod("custom");
  };
  const shiftStripWeek = (dir: -1 | 1) => setWeekAnchor((a) => addDays(weekStart(a), 7 * dir));
  const setFromCustom = (v: string) => {
    setFrom(v);
    setPeriod("custom");
  };
  const setToCustom = (v: string) => {
    setTo(v);
    setPeriod("custom");
  };
  const [poWait, setPoWait] = useState(false);
  // 남은 금액 기준: 판매가 · 입금 예정 (수수료 · 숙소 부담 쿠폰 · 카드 수수료를 뺀 금액). 기기마다 기억
  const [mBasis, setMBasisRaw] = useState<MoneyBasis>(() => {
    try {
      return localStorage.getItem(MB_KEY) === "payout" ? "payout" : "sale";
    } catch {
      return "sale";
    }
  });
  const setMBasis = (x: MoneyBasis) => {
    setMBasisRaw(x);
    try {
      localStorage.setItem(MB_KEY, x);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  const [gOpen, setGOpen] = useState<Set<string>>(new Set());
  const [gEdit, setGEdit] = useState<{ id: string; name: string; checkIn: string; nights: number } | null>(null);
  const [gExt, setGExt] = useState<{ id: string; collect: boolean; method: BookPayMethod } | null>(null);
  const [gBusy, setGBusy] = useState(false);
  const [settleId, setSettleId] = useState<string | null>(null);
  const [addGroupId, setAddGroupId] = useState<string | null>(null);
  const [stayConfirm, setStayConfirm] = useState<Booking | null>(null);
  const [invoiceGroupId, setInvoiceGroupId] = useState<string | null>(null);
  const [invoiceBooking, setInvoiceBooking] = useState<Booking | null>(null);
  const invoices = useInvoiceIssues(hotelId);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [payCash, setPayCash] = useState(0);
  const [paySum, setPaySum] = useState<ReturnType<typeof paySplit> | null>(null);
  const [payList, setPayList] = useState<Payment[]>([]);
  const [sort, setSort] = useState<"in-desc" | "in-asc" | "rec">("in-desc");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shopSum, setShopSum] = useState<{ amount: number; count: number; pay: PaySplit } | null>(null);
  const ex = useExpenses(hotelId, from, to);
  const ven = useExpenseVendors(hotelId);
  const [shopTick, setShopTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && setShopTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  // 매점 매출은 예약과 따로 불러와서 합계만 보여 줘요 (장부 줄에는 섞지 않아요)
  useEffect(() => {
    let alive = true;
    queryShopSales(hotelId, from, to)
      .then((r) => alive && setShopSum(shopTotals(r)))
      .catch(() => alive && setShopSum(null));
    return () => {
      alive = false;
    };
  }, [hotelId, from, to, shopTick]);

  // 예약 현금(선금·잔금): 받은 날이 이 기간 안이면 현금 시재에 넣어요
  useEffect(() => {
    let alive = true;
    queryPayments(hotelId, from, to)
      .then((r) => {
        if (!alive) return;
        setPayCash(bookingCash(r, from, to));
        setPaySum(paySplit(r, from, to));
        setPayList(r);
      })
      .catch(() => {
        if (!alive) return;
        setPayCash(0);
        setPaySum(null);
        setPayList([]);
      });
    return () => {
      alive = false;
    };
  }, [hotelId, from, to, data.syncedAt, data.bookings]);

  useEffect(() => {
    let alive = true;
    queryLedger(hotelId, from, to)
      .then((r) => alive && (setRows(r), setErr(null)))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "불러오지 못했어요"));
    return () => {
      alive = false;
    };
  }, [hotelId, from, to, data.syncedAt, data.bookings]);

  // 단체 정산: 방들의 지금 상태로 (방마다 잔금은 안 보이고 단체 줄에 한 번에)
  const allGroups = useMemo(() => groupSummaries(rows ?? []), [rows]);
  const groupSettle = (id: string) => {
    const g = allGroups.get(id);
    if (!g) return null;
    return settle(g.members, data.groups.get(id), L.plats.get(g.members[0].platformId));
  };
  const leftOf = (b: Booking) => (b.groupId ? (groupSettle(b.groupId)?.left ?? 0) : payState(b, L.plats.get(b.platformId)).left);
  const q = query.trim().toLowerCase();
  // 조건(플랫폼·타입·종류·검색·상태)만 거른 목록: 기간 밖 입실이라도 기간 안에 중도 퇴실 환불이 있으면 매출 계산에 들어가요
  const matched = (rows ?? []).filter((b) => {
    if (plat && b.platformId !== plat) return false;
    if (type && b.typeId !== type) return false;
    if (kind && b.kind !== kind) return false;
    if (st === "active" && !isActive(b)) return false;
    if (st === "void" && isActive(b)) return false;
    if (phase !== "all" && stayPhase(b) !== phase) return false;
    if (dueOnly && leftOf(b) <= 0) return false;
    if (poWait && !payoutWaiting(b, L.plats.get(b.platformId))) return false;
    if (q) {
      const p = L.plats.get(b.platformId);
      const hay = [b.guestName, b.guestPhone, b.groupName, p?.name, p?.abbr, b.memo, L.stayRoomLabel(b), ...stayRoomIds(b).map((id) => L.rooms.get(id)?.no)]
        .join(" ")
        .toLowerCase();
      const digits = q.replace(/\D/g, "");
      const phoneDigits = (b.guestPhone ?? "").replace(/\D/g, "");
      if (!hay.includes(q) && !plateMatches(b, q) && !(digits && phoneDigits.includes(digits))) return false;
    }
    return true;
  });
  const inRange = (b: Booking) => b.checkIn >= from && b.checkIn <= to;
  const list = matched.filter(inRange);
  if (sort === "in-asc") list.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.createdAt.localeCompare(b.createdAt));
  else if (sort === "rec") list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const act = list.filter(isActive);
  // 매출: 취소 0 · 노쇼는 받은 금액 그대로 · 중도 퇴실은 결제 − 환불 (환불은 퇴실한 날 기준)
  const rev = roomRevenue(matched, from, to);
  const sum = rev.net;
  const nights = act.reduce((n, b) => n + (usedNights(b) ?? 0), 0);
  // 플랫폼·타입·종류·검색·상태로 거르면 매점은 상관없어서 빼요
  const filtered = !!(plat || type || kind || q || st === "void" || phase !== "all" || dueOnly || poWait);
  const dueTotal =
    list.filter((b) => !b.groupId).reduce((n, b) => n + payState(b, L.plats.get(b.platformId)).left, 0) +
    [...new Set(list.map((b) => b.groupId).filter((x): x is string => !!x))].reduce((n, id) => n + (groupSettle(id)?.left ?? 0), 0);
  const sumUp = ledgerSummary(sum, filtered ? null : shopSum?.amount ?? null);
  // 맨 위 요약: 매출(숙박·대실 + 매점) − 지출 = 남은 금액 · 현금 시재(매점 현금 − 현금 지출). 예약 조건과 상관없이 이 기간 전체
  const revAll = roomRevenue(rows ?? [], from, to);
  const roomsAll = revAll.net;
  const exT = expenseTotals(ex.list ?? []);
  // 수수료 · 입금: 설정에서 수수료를 하나라도 적었을 때만 보여요
  const platOf = (b: Pick<Booking, "platformId">) => L.plats.get(b.platformId);
  const feeUsed = s.platforms.some((p) => p.feeRate || p.payoutDays != null) || s.cardFeeRate != null;
  const poSum = payoutSummary(list, platOf);
  const poRooms = payoutRevenue(rows ?? [], platOf, from, to);
  const cardTotal = (paySum?.card ?? 0) + (shopSum?.pay.card ?? 0);
  const cardFee = cardFeeOf(s, cardTotal);
  const byPayout = feeUsed && mBasis === "payout";
  const renderRow = (b: Booking, gm = false) => {
            const p = L.plats.get(b.platformId);
            const per = perNight(b);
            const eo = isActive(b) && isEarlyOut(b);
            // 단체 방은 결제자가 하나라 방마다 잔금을 안 보여요 (단체 줄에서)
            const ps = b.groupId ? { left: 0, full: false } : payState(b, p);
            const po = payoutOf(b, p);
            const poV = payoutValue(po);
            const stLabel = stayStatusLabel(b);
            const ph = stayPhase(b);
            return (
              <div key={b.id} role="button" tabIndex={0} className={`lrow ${gm ? "gmem" : ""} ${b.status === "cancelled" ? "cx" : ""} ${b.status === "noshow" ? "ns" : ""} ${eo ? "eo" : ""}`} onClick={() => onOpen(b)}>
                <span className="c-date">{dayLabel(b.checkIn)}</span>
                <span className="c-kind">{b.kind === "stay" ? "숙박" : "대실"}</span>
                <span className="c-plat">
                  <PlatBadge p={p} />
                  <span className="pn">{p?.name ?? "?"}</span>
                </span>
                <span className="c-name">
                  <span className="gn">{b.guestName}</span>
                  {b.groupId && !gm ? <span className="grptag" title="단체 예약">단체 {b.groupName}</span> : null}
                  {b.noClean && b.status === "active" ? <span className="ncxtag" title="청소하지 않음">청소X</span> : null}
                  {b.memo ? <span className="memo">{b.memo}</span> : null}
                  {b.kind === "stay" ? (
                    <button
                      type="button"
                      className="btn sm line l-stay-confirm noprint"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStayConfirm(b);
                      }}
                      aria-label={STAY_CONFIRM_COPY}
                      title={`${STAY_CONFIRM_COPY} 인쇄·PDF`}
                    >
                      <FileText size={13} strokeWidth={2.2} aria-hidden />
                      {STAY_CONFIRM_COPY}
                    </button>
                  ) : null}
                  {b.kind === "stay" && b.status !== "cancelled" ? (
                    <button
                      type="button"
                      className="btn sm line l-stay-confirm noprint"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (b.groupId) setInvoiceGroupId(b.groupId);
                        else setInvoiceBooking(b);
                      }}
                      aria-label="청구서"
                      title="청구서 발급·인쇄"
                    >
                      청구서
                    </button>
                  ) : null}
                </span>
                <span className="c-phone" title={b.guestPhone ?? undefined}>
                  {b.guestPhone?.trim() || "—"}
                </span>
                <span className="c-status">
                  {stLabel ? (
                    <span
                      className={`stag ${b.status === "cancelled" ? "cx" : b.status === "noshow" ? "ns" : ph === "pre" ? "pre" : ph === "in" ? "in" : "done"}`}
                      title={eo ? `${dayLabel(b.earlyOut!)} 중도 퇴실` : undefined}
                    >
                      {stLabel}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="c-inout" title={eo ? `${usedLabel(b)} · 중도 퇴실` : b.kind === "stay" ? `${b.nights}박` : undefined}>
                  {stayInOutLabel(b)}
                  {s.parking.enabled && parkingMark(b) ? <small className="gcount" title={b.plates?.length ? `차량번호 ${b.plates.join(", ")}` : undefined}> · {parkingMark(b)}</small> : null}
                  {timeTags(s, b).length ? <small className="gcount" title={`${timeLine(b)}${isTimeService(b) ? " · 서비스" : b.timeFee ? ` · ${won(b.timeFee)}원 포함` : ""}`}> · {timeTags(s, b).join(" · ")}</small> : null}
                </span>
                <span className="c-guests">{b.guests ? `${b.guests}명` : "—"}</span>
                <span className="c-type">
                  <TypeBadge t={L.types.get(b.typeId)} />
                </span>
                <span className={`c-room ${isMoved(b) ? "mv" : ""}`} title={isMoved(b) ? `객실 이동 ${legsOf(b).map((l) => `${L.roomLabel(l.roomId)}호 ${l.nights}박`).join(" → ")}` : (L.roomLabel(b.roomId) ?? undefined)}>
                  {!b.roomId ? "—" : isMoved(b) ? legsOf(b).map((l) => L.rooms.get(l.roomId ?? "")?.no ?? "?").join("→") : (L.roomLabel(b.roomId) ?? "?")}
                </span>
                <span className="c-price r">
                  {won(b.price)}
                  {eo && b.refund ? <small className="rf">환불 −{won(b.refund)}</small> : per ? <small>1박 {won(per)}</small> : null}
                  {po.tracked && poV !== b.price ? (
                    <small className={`poamt ${po.ok ? "ok" : ""}`} title={po.ok ? `입금 확인${po.diff ? ` · 예정 ${won(po.expected)}원` : ""}` : `입금 예정${po.dueOn ? ` ${dayLabel(po.dueOn)}` : ""} · 아직 확인 안 함`}>
                      {po.ok ? <Check size={11} strokeWidth={3} /> : null}입금 {won(poV)}
                    </small>
                  ) : null}
                  {ps.left > 0 ? <small className="dueamt">잔금 {won(ps.left)}</small> : ps.full ? <small className="paidtag">완납</small> : null}
                </span>
              </div>
            );
  };

  // 단체 예약: 장부에서는 한 줄로 묶고, 누르면 방마다 펼쳐요
  const groups = groupSummaries(list);
  const ledgerItems: { b?: Booking; g?: GroupSummary }[] = [];
  {
    const seen = new Set<string>();
    for (const b of list) {
      if (!b.groupId || (groups.get(b.groupId)?.members.length ?? 0) < 2) ledgerItems.push({ b });
      else if (!seen.has(b.groupId)) {
        seen.add(b.groupId);
        ledgerItems.push({ g: groups.get(b.groupId)! });
      }
    }
  }
  const groupAct = async (g: GroupSummary, what: "in" | "cancel") => {
    if (gBusy) return;
    if (what === "cancel") {
      const ok = await askConfirm({
        title: "단체 취소",
        body: `단체 ${g.name} ${g.rooms}실을 모두 취소할까요?\n전액 환불로 보고 매출에서 빠지고, 방과 남은 객실이 다시 비어요.`,
        confirmLabel: "취소 확정",
        danger: true,
      });
      if (!ok) return;
    }
    setGBusy(true);
    try {
      const r = await data.patchGroup(g.groupId, what === "in" ? { arrived: true } : { status: "cancelled" });
      notify(what === "in" ? `단체 ${g.name} ${r.length}실 모두 입실 완료` : `단체 ${g.name} ${r.length}실을 취소했어요`);
    } catch (e) {
      notify(saveFailMessage(e));
    } finally {
      setGBusy(false);
    }
  };
  const saveGroupEdit = async (g: GroupSummary) => {
    if (!gEdit || gBusy) return;
    const nm = gEdit.name.trim();
    if (!nm) return notify("단체명을 적어 주세요");
    const dateChanged = gEdit.checkIn !== g.checkIn || gEdit.nights !== g.nights;
    const nightsUp = gEdit.nights > g.nights;
    const nightsDown = gEdit.nights < g.nights;
    if (dateChanged) {
      const block = groupDateBlock(data.hotel!.settings, data.bookings, g.members, gEdit.checkIn, gEdit.nights);
      if (block) return notify(block);
      // 박수↑만 경고(연장 유도). 박수↓는 단가×박수로 자동 맞춤.
      if (nightsUp) {
        const nightsOk = await askConfirm({
          title: "박수 변경",
          body: NIGHTS_PRICE_WARN,
          confirmLabel: "저장",
        });
        if (!nightsOk) return;
      }
    }
    setGBusy(true);
    try {
      await data.patchGroup(g.groupId, { groupName: nm, oldName: g.name, ...(dateChanged ? { checkIn: gEdit.checkIn, nights: gEdit.nights } : {}) });
      let repriceNote = "";
      if (nightsDown) {
        const rates = data.groups.get(g.groupId)?.rates ?? null;
        let sum = 0;
        for (const m of g.members.filter((x) => isActive(x))) {
          const next = repriceForNights({ ...m, checkIn: gEdit.checkIn }, gEdit.nights, rates?.[m.typeId]);
          sum += next.price;
          const cur = data.bookings.find((x) => x.id === m.id) ?? m;
          await data.saveBooking(
            {
              ...cur,
              checkIn: gEdit.checkIn,
              nights: gEdit.nights,
              price: next.price,
              nightRates: next.nightRates ?? cur.nightRates,
            },
            false,
          );
        }
        repriceNote = ` · 판매가 맞춤 합 ${won(sum)}원`;
      }
      notify(`단체 ${nm} 바꿨어요${dateChanged ? ` · ${dayLabel(gEdit.checkIn)} 입실 ${gEdit.nights}박` : ""}${repriceNote}`);
      setGEdit(null);
    } catch (e) {
      notify(saveFailMessage(e));
    } finally {
      setGBusy(false);
    }
  };
  const saveGroupExtend = async (g: GroupSummary) => {
    if (!gExt || gBusy || gExt.id !== g.groupId) return;
    const rates = data.groups.get(g.groupId)?.rates ?? null;
    const planned = planGroupExtend(data.hotel!.settings, data.bookings, g.members, rates);
    if ("err" in planned) return notify(planned.err);
    if (gExt.collect && planned.ok.totalRate > 0) {
      const pv = validatePayment(planned.ok.totalRate, gExt.method, today);
      if (pv) return notify(pv);
    }
    setGBusy(true);
    try {
      for (const m of planned.ok.members) {
        const cur = data.bookings.find((x) => x.id === m.id);
        if (!cur) continue;
        await data.saveBooking(
          {
            ...cur,
            nights: m.draft.nights,
            price: m.draft.price,
            segments: m.draft.segments,
            nightRates: m.draft.nightRates ?? cur.nightRates,
          },
          false,
        );
      }
      let payNote = "";
      if (gExt.collect && planned.ok.totalRate > 0) {
        try {
          await data.addGroupPayment(g.groupId, { method: gExt.method, amount: planned.ok.totalRate, bizDate: today });
          payNote = ` · 오늘 요금 ${won(planned.ok.totalRate)}원 받음 (${BOOK_PAY_LABEL[gExt.method]})`;
        } catch (e) {
          payNote = ` · 수납은 못 했어요: ${e instanceof Error ? e.message : "다시 받아 주세요"}`;
        }
      } else if (planned.ok.totalRate > 0) {
        payNote = ` · 잔금 +${won(planned.ok.totalRate)}원`;
      }
      notify(`단체 ${g.name} 전 방 ${EXTEND_COPY} · ${planned.ok.members.length}실${payNote}`);
      setGExt(null);
    } catch (e) {
      notify(saveFailMessage(e));
    } finally {
      setGBusy(false);
    }
  };
  const renderGroup = (g: GroupSummary) => {
    const open = gOpen.has(g.groupId);
    const first = g.members[0];
    const p = L.plats.get(first.platformId);
    const tcount = new Map<string, number>();
    for (const b of g.active) tcount.set(b.typeId, (tcount.get(b.typeId) ?? 0) + 1);
    const tord = new Map(data.hotel!.settings.types.map((t, i) => [t.id, i]));
    const tsum = [...tcount.entries()].sort((a, b) => (tord.get(a[0]) ?? 0) - (tord.get(b[0]) ?? 0)).map(([t, n]) => `${typeLabel(L.types.get(t))} ${n}`).join(" · ");
    const cancelled = g.rooms === 0;
    const gst = groupSettle(g.groupId);
    const badge = gst ? settleBadge(gst, data.groups.get(g.groupId)) : null;
    const toggleOpen = () => setGOpen((x) => { const y = new Set(x); if (y.has(g.groupId)) y.delete(g.groupId); else y.add(g.groupId); return y; });
    return (
      <div key={`g-${g.groupId}`} className="lgroup">
        <div role="button" tabIndex={0} aria-expanded={open} className={`lrow grow ${open ? "open" : ""} ${cancelled ? "cx" : ""}`} onClick={toggleOpen} onKeyDown={(e) => e.key === "Enter" && toggleOpen()}>
          <span className="c-date">{dayLabel(g.checkIn)}</span>
          <span className="c-kind">단체</span>
          <span className="c-plat">
            <PlatBadge p={p} />
            <span className="pn">{p?.name ?? "?"}</span>
          </span>
          <span className="c-name">
            <span className="gname">
              <ChevronRight size={15} className="gchev" />
              {g.name}
            </span>
            <span className="grptag">{g.rooms}실</span>
            {g.members.length > g.rooms ? <span className="cxt">취소 {g.members.length - g.rooms}</span> : null}
          </span>
          <span className="c-phone">—</span>
          <span className="c-status">
            {cancelled ? (
              <span className="stag cx">취소</span>
            ) : g.arrived && g.rooms ? (
              <span className={`stag ${g.arrived === g.rooms ? "done" : "in"}`}>{g.arrived === g.rooms ? "완료" : `이용중 ${g.arrived}/${g.rooms}`}</span>
            ) : (
              <span className="stag pre">입실전</span>
            )}
          </span>
          <span className="c-inout">
            {md(g.checkIn)}–{md(stayEnd({ kind: "stay", checkIn: g.checkIn, nights: g.nights, earlyOut: null }))}
          </span>
          <span className="c-guests">—</span>
          <span className="c-type gts">{tsum}</span>
          <span className="c-room">{g.members.length}개 방</span>
          <span className="c-price r">
            {won(gst?.total ?? g.total)}
            {badge ? <small className={badge.due ? "dueamt" : "paidtag"}>{badge.text}</small> : <small>단체 합계</small>}
          </span>
        </div>
        {open ? (
          <>
            {g.rooms ? (
              <div className="gacts noprint">
                <button type="button" className="btn sm dark" disabled={gBusy || g.arrived === g.rooms} onClick={() => void groupAct(g, "in")}>
                  <Check size={14} strokeWidth={2.6} /> 모두 입실
                </button>
                <button type="button" className="btn sm line" disabled={gBusy} onClick={() => setGEdit(gEdit?.id === g.groupId ? null : { id: g.groupId, name: g.name, checkIn: g.checkIn, nights: g.nights })}>
                  이름·날짜 바꾸기
                </button>
                {g.active.some((b) => canExtend(b)) ? (
                  <button
                    type="button"
                    className="btn sm line"
                    disabled={gBusy}
                    onClick={() => setGExt(gExt?.id === g.groupId ? null : { id: g.groupId, collect: true, method: "card" })}
                  >
                    전 방 {EXTEND_COPY}
                  </button>
                ) : null}
                <button type="button" className="btn sm line" onClick={() => setAddGroupId(g.groupId)}>
                  객실 추가
                </button>
                <button type="button" className="btn sm line" onClick={() => setSettleId(g.groupId)}>
                  정산하기
                </button>
                <button type="button" className="btn sm line" onClick={() => setInvoiceGroupId(g.groupId)}>
                  청구서
                </button>
                <button type="button" className="btn sm line red-t" disabled={gBusy} onClick={() => void groupAct(g, "cancel")}>
                  단체 취소
                </button>
              </div>
            ) : (
              <div className="gacts noprint">
                <button type="button" className="btn sm line" onClick={() => setSettleId(g.groupId)}>
                  정산서 보기
                </button>
              </div>
            )}
            {gEdit?.id === g.groupId ? (
              <div className="gedit noprint">
                <input className="inp" aria-label="단체명" maxLength={40} value={gEdit.name} onChange={(e) => setGEdit({ ...gEdit, name: e.target.value })} />
                <input className="inp" type="date" aria-label="단체 입실일" value={gEdit.checkIn} onChange={(e) => e.target.value && setGEdit({ ...gEdit, checkIn: e.target.value })} />
                <span className="step sm">
                  <button type="button" className="sb" aria-label="1박 줄이기" onClick={() => setGEdit({ ...gEdit, nights: Math.max(1, gEdit.nights - 1) })}>
                    −
                  </button>
                  <b className="num">{gEdit.nights}박</b>
                  <button type="button" className="sb" aria-label="1박 늘리기" onClick={() => setGEdit({ ...gEdit, nights: Math.min(90, gEdit.nights + 1) })}>
                    +
                  </button>
                </span>
                <span className="muted sm">
                  모든 방에 같이 적용돼요 · 가격은 그대로
                  {gEdit.nights !== g.nights ? ` · 박수만 바꾸면 잔금이 안 맞을 수 있어요 → 「전 방 ${EXTEND_COPY}」 권장` : ""}
                </span>
                <button type="button" className="btn sm dark" disabled={gBusy} onClick={() => void saveGroupEdit(g)}>
                  저장
                </button>
              </div>
            ) : null}
            {gExt?.id === g.groupId ? (
              <div className="gedit gext noprint">
                {(() => {
                  const planned = planGroupExtend(data.hotel!.settings, data.bookings, g.members, data.groups.get(g.groupId)?.rates ?? null);
                  if ("err" in planned) return <span className="muted sm">{planned.err}</span>;
                  return (
                    <>
                      <span className="muted sm">
                        활성 {planned.ok.members.length}실 +1박 · 요금 합 {won(planned.ok.totalRate)}원 (타입/방 단가)
                      </span>
                      <span className="chips">
                        <button type="button" className={`chip ${gExt.collect ? "on" : ""}`} onClick={() => setGExt({ ...gExt, collect: true })}>
                          지금 받기
                        </button>
                        <button type="button" className={`chip ${!gExt.collect ? "on" : ""}`} onClick={() => setGExt({ ...gExt, collect: false })}>
                          후불
                        </button>
                      </span>
                      {gExt.collect ? (
                        <span className="chips">
                          {BOOK_PAY_METHODS.map((m) => (
                            <button type="button" key={m} className={`chip ${gExt.method === m ? "on" : ""}`} onClick={() => setGExt({ ...gExt, method: m })}>
                              {BOOK_PAY_LABEL[m]}
                            </button>
                          ))}
                        </span>
                      ) : null}
                      <button type="button" className="btn sm" disabled={gBusy} onClick={() => setGExt(null)}>
                        닫기
                      </button>
                      <button type="button" className="btn sm dark" disabled={gBusy} onClick={() => void saveGroupExtend(g)}>
                        {gBusy ? "저장 중…" : `전 방 ${EXTEND_COPY}`}
                      </button>
                    </>
                  );
                })()}
              </div>
            ) : null}
            {[...g.members].sort((a, b) => (L.roomLabel(a.roomId) ?? "").localeCompare(L.roomLabel(b.roomId) ?? "", "ko", { numeric: true })).map((b) => renderRow(b, true))}
          </>
        ) : null}
      </div>
    );
  };

  const money = moneySummary(byPayout ? poRooms.amount - cardFee : roomsAll, shopSum?.amount ?? 0, shopSum?.pay.cash ?? 0, exT, payCash);
  const categories = s.expenseCategories.map((c) => c.name.trim()).filter(Boolean);
  const listTotal = act.reduce((n, b) => n + b.price, 0);
  const typeSales = typeSalesByType(rows ?? [], from, to, usableTypes(s.types));
  const payMethods = methodSales(paySum ?? { card: 0, cash: 0, transfer: 0, credit: 0, total: 0 }, shopSum?.pay);
  const platPay = useMemo(() => {
    const byBooking = new Map<string, Pick<Booking, "platformId" | "groupId">>();
    for (const b of data.bookings) byBooking.set(b.id, b);
    for (const b of rows ?? []) byBooking.set(b.id, b);
    const byGroup = new Map<string, string>();
    for (const b of byBooking.values()) {
      if (b.groupId && !byGroup.has(b.groupId)) byGroup.set(b.groupId, b.platformId);
    }
    const plats = new Map(s.platforms.map((p) => [p.id, p]));
    return platformPayMatrix(
      payList,
      from,
      to,
      (p) => resolvePlatformForPay(p, byBooking, plats, byGroup),
      s.platforms,
      shopSum?.pay,
    );
  }, [payList, from, to, data.bookings, rows, s.platforms, shopSum?.pay]);
  const exCats = [...exT.byCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  const printFilters = (() => {
    const bits: string[] = [];
    if (plat) bits.push(L.plats.get(plat)?.name ?? "플랫폼");
    if (type) {
      const t = L.types.get(type);
      bits.push(t ? typeLabel(t) : "타입");
    }
    if (kind === "stay") bits.push("숙박");
    if (kind === "dayuse") bits.push("대실");
    if (st === "active") bits.push("정상");
    if (st === "void") bits.push("취소·노쇼");
    if (phase !== "all") bits.push(STAY_PHASE_LABEL[phase]);
    if (dueOnly) bits.push("잔금 남음");
    if (poWait) bits.push("입금 미확인");
    if (q) bits.push(`검색「${query.trim()}」`);
    return bits;
  })();
  const runPrint = (mode: "print-ledger" | "print-exec", title: string, before?: () => void) => {
    const prevTitle = document.title;
    document.title = title;
    before?.();
    document.body.classList.add(mode);
    let cleaned = false;
    const done = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove(mode);
      document.title = prevTitle;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    window.setTimeout(done, 1500);
  };
  const printLedger = () => {
    runPrint("print-ledger", `${data.hotel!.name || "호텔"}_장부_${from}_${to}`, () => {
      flushSync(() => setGOpen(new Set(groups.keys())));
    });
  };
  const printExec = () => {
    runPrint("print-exec", `${data.hotel!.name || "호텔"}_경영요약_${from}_${to}`);
  };
  const printedAt = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  return (
    <main className="page ledger">
      <div className="ph noprint">
        <div>
          <h1>
            장부 <span className="h1-sub">통합 이용내역</span>
          </h1>
          <div className="sub">
            {tab === "bookings" ? (
              <>
                {list.length}건 · 숙박 {nights}박 <span className="muted">· 입실일 {dayLabel(from)} ~ {dayLabel(to)} · 박수는 취소·노쇼 제외 · 매출은 노쇼 포함, 환불은 퇴실한 날</span>
              </>
            ) : tab === "summary" ? (
              <>
                경영 요약 <span className="muted">· {from} ~ {to} · 타입별 판매 · 플랫폼×카드/현금/이체 · 매점 · 지출</span>
              </>
            ) : (
              <>
                지출 {exT.count}건 <span className="muted">· {dayLabel(from)} ~ {dayLabel(to)}</span>
              </>
            )}
          </div>
          <div className="lsum money">
            {feeUsed ? (
              <div className="seg sm mbasis" role="group" aria-label="남은 금액 기준">
                <button type="button" className={!byPayout ? "on" : ""} aria-pressed={!byPayout} onClick={() => setMBasis("sale")}>
                  판매가
                </button>
                <button type="button" className={byPayout ? "on" : ""} aria-pressed={byPayout} onClick={() => setMBasis("payout")}>
                  입금 예정
                </button>
              </div>
            ) : null}
            {byPayout ? (
              <span title="숙박·대실은 플랫폼 수수료 · 숙소 부담 쿠폰을 뺀 입금 예정가(입금 확인한 건 실제 입금액), 카드 수수료는 현장 카드 결제(예약 · 단체 · 매점)에만">
                매출 (입금 예정)<b>{won(money.sales)}원</b>
                <i className="muted">
                  {" "}
                  · 숙박·대실 {won(poRooms.amount)}
                  {poRooms.fee ? ` (수수료 −${won(poRooms.fee)})` : ""}
                  {poRooms.hotelCoupons ? ` (숙소 부담 쿠폰 −${won(poRooms.hotelCoupons)})` : ""} · 매점 {won(shopSum?.amount ?? 0)}
                  {cardFee ? ` · 카드 수수료 −${won(cardFee)}` : ""}
                </i>
              </span>
            ) : (
              <span title={`숙박·대실 ${won(money.sales - (shopSum?.amount ?? 0))}원 + 매점 ${won(shopSum?.amount ?? 0)}원`}>
                매출<b>{won(money.sales)}원</b>
                <i className="muted">
                  {" "}
                  · 숙박·대실 {won(roomsAll)}{revAll.refunds ? ` (환불 −${won(revAll.refunds)})` : ""} · 매점 {won(shopSum?.amount ?? 0)}
                </i>
              </span>
            )}
            <span className="op">−</span>
            <span>
              지출<b>{won(money.expense)}원</b>
            </span>
            <span className="op">=</span>
            <span className={`tot ${money.left < 0 ? "neg" : ""}`}>
              남은 금액<b>{won(money.left)}원</b>
            </span>
            <span
              className={`cash ${money.cash < 0 ? "neg" : ""}`}
              title="현금으로 받은 돈(매점 현금 + 예약 선금·잔금 현금, 받은 날 기준) − 현금 지출. 플랫폼이 받은 예약 금액과 카드·이체는 빠져요"
            >
              현금 시재<b>{won(money.cash)}원</b>
              <i className="muted">
                {" "}
                · 매점 현금 {won(money.shopCash)} + 예약 현금 {won(money.bookingCash)} − 현금 지출 {won(money.cashOut)}
              </i>
            </span>
          </div>
          {tab === "bookings" && paySum && paySum.total > 0 ? (
            <div className="lsum-f muted paysum" title="받은 날 기준 예약 선금·잔금 (단체 정산 포함). 이체·잔액 사용은 현금 시재에 안 들어가요">
              예약 받은 돈 {won(paySum.total)}원 · 카드 {won(paySum.card)} · 현금 {won(paySum.cash)} · 이체 {won(paySum.transfer)}
              {paySum.credit > 0 ? ` · ${STAY_CREDIT_COPY.use} ${won(paySum.credit)}` : ""}
            </div>
          ) : null}
          {tab === "bookings" && listOpenCredits(data.stayCredits).length > 0 ? (
            <div className="lsum-f">
              <button type="button" className="btn sm line" onClick={() => setCreditsOpen(true)}>
                {STAY_CREDIT_COPY.list} {listOpenCredits(data.stayCredits).length}건
              </button>
            </div>
          ) : tab === "bookings" ? (
            <div className="lsum-f muted">
              <button type="button" className="btn sm line" onClick={() => setCreditsOpen(true)}>
                {STAY_CREDIT_COPY.list}
              </button>
            </div>
          ) : null}
          {tab === "bookings" && poSum.count > 0 ? (
            <div className="lsum-f posum" title="수수료율 · 정산 주기 · 숙소 부담 쿠폰이 있는 예약만 (입실일 기준 · 취소 제외)">
              <span className="muted">플랫폼 입금 {poSum.count}건 ·</span> 판매가 <b>{won(poSum.sale)}</b> − 수수료 <b>{won(poSum.fee)}</b> − 쿠폰(숙소 부담) <b>{won(poSum.hotelCoupons)}</b>
              {poSum.refund ? (
                <>
                  {" "}
                  − 환불 <b>{won(poSum.refund)}</b>
                </>
              ) : null}{" "}
              = 입금 예정 <b>{won(poSum.expected)}원</b>
              <span className="poc">
                입금 확인 {poSum.okCount}건 {won(poSum.okAmount)}원
              </span>
              <span className={`poc ${poSum.waitCount ? "wait" : ""}`}>
                미확인 {poSum.waitCount}건 {won(poSum.waitAmount)}원
              </span>
            </div>
          ) : null}
          {tab === "bookings" && dueTotal > 0 ? (
            <div className="lsum-f">
              <span className="dueamt">잔금 남음 {won(dueTotal)}원</span> <span className="muted">· 이 목록에서 아직 못 받은 돈</span>
            </div>
          ) : null}
          {tab === "bookings" && sumUp.shop === null ? (
            <div className="lsum-f muted">
              조건에 맞는 예약 합계 <b>{won(sumUp.rooms)}원</b>
            </div>
          ) : tab === "bookings" && shopSum ? (
            <div className="lsum-f muted">매점 {shopSum.count}개 · {payLine(shopSum.pay, won)}</div>
          ) : null}
        </div>
        <div className="ltabs seg" role="tablist" aria-label="장부">
          <button role="tab" aria-selected={tab === "bookings"} className={tab === "bookings" ? "on" : ""} onClick={() => setTab("bookings")}>
            예약
          </button>
          <button role="tab" aria-selected={tab === "expenses"} className={tab === "expenses" ? "on" : ""} onClick={() => setTab("expenses")}>
            지출
          </button>
          <button role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>
            경영 요약
          </button>
        </div>
      </div>
      {creditsOpen ? (
        <StayCreditsModal
          credits={data.stayCredits}
          busy={creditsBusy}
          onCancel={() => !creditsBusy && setCreditsOpen(false)}
          onVoid={(c) => {
            void (async () => {
              setCreditsBusy(true);
              try {
                await data.voidStayCredit(c);
                notify(`${c.guestName} 님 ${STAY_CREDIT_COPY.balance}을 무효로 했어요`);
              } catch (e) {
                notify(saveFailMessage(e, "무효 처리하지 못했어요"));
              } finally {
                setCreditsBusy(false);
              }
            })();
          }}
        />
      ) : null}
      {exEdit ? (
        <ExpenseModal
          base={exEdit === "new" ? null : exEdit}
          today={today}
          categories={categories}
          vendors={ven.list ?? []}
          history={ex.list ?? []}
          onSaveVendor={ven.save}
          onClose={() => setExEdit(null)}
          onSave={async (d) => {
            const saved = await ex.save(d, exEdit === "new" ? undefined : exEdit.id);
            setExEdit(null);
            const amt = saved.amount > 0 ? `${won(saved.amount)}원` : "금액 미정";
            const pay = saved.paid ? (saved.method ? ` · ${EXPENSE_PAY_LABEL[saved.method]}` : "") : " · 미수금";
            notify(`${saved.vendorName ? `${saved.vendorName} · ` : ""}${saved.category} ${amt} 지출을 ${exEdit === "new" ? "적었어요" : "고쳤어요"}${pay}`);
          }}
          onDelete={async () => {
            if (exEdit === "new") return;
            try {
              await ex.remove(exEdit.id);
              setExEdit(null);
              notify("지출을 지웠어요");
            } catch (e) {
              notify(e instanceof Error ? `지우지 못했어요: ${e.message}` : "지우지 못했어요");
            }
          }}
        />
      ) : null}
      {tab === "expenses" ? (
        <ExpenseList
          list={ex.list}
          error={ex.error}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          plan={data.hotel!.plan}
          hotelName={data.hotel!.name}
          onOpen={(e) => setExEdit(e)}
          onAdd={() => setExEdit("new")}
        />
      ) : tab === "summary" ? (
        <>
          <div className="filters noprint">
            <div className="chips period-chips" role="group" aria-label="조회 기간">
              {(
                [
                  ["today", "오늘"],
                  ["7", "7일"],
                  ["30", "30일"],
                  ["custom", "사용자"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={`chip sm ${period === k ? "on" : ""}`}
                  aria-pressed={period === k}
                  onClick={() => (k === "custom" ? setPeriod("custom") : applyPeriod(k))}
                >
                  {l}
                </button>
              ))}
            </div>
            <label className="fdate">
              기간
              <input type="date" value={from} onChange={(e) => e.target.value && setFromCustom(e.target.value)} />~
              <input type="date" value={to} onChange={(e) => e.target.value && setToCustom(e.target.value)} />
            </label>
            <button type="button" className="btn line sm" onClick={printExec} aria-label="경영 요약 인쇄">
              <Printer size={14} /> 인쇄
            </button>
            <button
              type="button"
              className="btn line sm"
              onClick={printExec}
              title="인쇄 창에서「PDF로 저장」을 고르세요"
              aria-label="경영 요약 PDF로 저장"
            >
              <FileDown size={14} /> PDF
            </button>
          </div>
          <div className="exec-print">
            <header className="exec-head">
              <div className="lph-k">{data.hotel!.name || "호텔"}</div>
              <h1>경영 요약</h1>
              <div className="lph-meta">
                기간 {from} ~ {to}
                <span className="muted noprint"> · 출력 시 시각 포함</span>
                <span className="print-only"> · 출력 {printedAt}</span>
              </div>
              <div className="exec-tot">
                매출 <b>{won(money.sales)}</b> − 지출 <b>{won(money.expense)}</b> = 남은 금액{" "}
                <b className={money.left < 0 ? "neg" : ""}>{won(money.left)}</b>
                <span className="muted"> · 현금 시재 {won(money.cash)}</span>
              </div>
            </header>

            <section className="exec-sec" aria-label="타입별 객실 판매">
              <h2>타입별 객실 판매</h2>
              <table className="exec-tbl">
                <thead>
                  <tr>
                    <th>타입</th>
                    <th className="r">판매</th>
                    <th className="r">숙박</th>
                    <th className="r">대실</th>
                    <th className="r">박수</th>
                    <th className="r">순매출</th>
                  </tr>
                </thead>
                <tbody>
                  {typeSales.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        등록된 타입이 없어요
                      </td>
                    </tr>
                  ) : (
                    typeSales.rows.map((r) => (
                      <tr key={r.typeId}>
                        <td>{r.label}</td>
                        <td className="r num">{r.count}</td>
                        <td className="r num">{r.stay}</td>
                        <td className="r num">{r.dayuse}</td>
                        <td className="r num">{r.nights}</td>
                        <td className="r num">{won(r.net)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th>합계</th>
                    <th className="r num">{typeSales.total.count}</th>
                    <th className="r num">{typeSales.total.stay}</th>
                    <th className="r num">{typeSales.total.dayuse}</th>
                    <th className="r num">{typeSales.total.nights}</th>
                    <th className="r num">{won(typeSales.total.net)}</th>
                  </tr>
                </tfoot>
              </table>
              <p className="exec-note muted">입실일 기준 · 취소 제외 · 노쇼 포함 · 환불은 중도퇴실 날</p>
            </section>

            <section className="exec-sec" aria-label="플랫폼별 결제 매출">
              <h2>플랫폼 · 카드 · 현금 · 이체</h2>
              <table className="exec-tbl">
                <thead>
                  <tr>
                    <th>플랫폼</th>
                    <th className="r">카드</th>
                    <th className="r">현금</th>
                    <th className="r">이체</th>
                    <th className="r">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {platPay.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        이 기간 받은 돈이 없어요
                      </td>
                    </tr>
                  ) : (
                    platPay.rows.map((r) => (
                      <tr key={r.platformId} className={r.shop ? "exec-shop-row" : undefined}>
                        <td>{r.label}</td>
                        <td className="r num">{won(r.card)}</td>
                        <td className="r num">{won(r.cash)}</td>
                        <td className="r num">{won(r.transfer)}</td>
                        <td className="r num">{won(r.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th>합계</th>
                    <th className="r num">{won(platPay.total.card)}</th>
                    <th className="r num">{won(platPay.total.cash)}</th>
                    <th className="r num">{won(platPay.total.transfer)}</th>
                    <th className="r num">{won(platPay.total.total)}</th>
                  </tr>
                </tfoot>
              </table>
              <p className="exec-note muted">
                받은 날 기준 · 행=플랫폼 · 열=결제수단 · 매점은 별도 행
                {platPay.total.credit > 0 ? ` · 잔액 사용 ${won(platPay.total.credit)}원(합계 제외)` : ""}
                {payMethods.shop.none > 0 ? ` · 매점 미지정 ${won(payMethods.shop.none)}원(합계 제외)` : ""}
              </p>
            </section>

            <section className="exec-sec" aria-label="매점 매출">
              <h2>매점 매출</h2>
              {shopSum ? (
                <>
                  <div className="exec-grid3">
                    <div className="exec-metric">
                      <span>매출</span>
                      <b className="num">{won(shopSum.amount)}</b>
                    </div>
                    <div className="exec-metric">
                      <span>판매 개수</span>
                      <b className="num">{shopSum.count}</b>
                    </div>
                    <div className="exec-metric">
                      <span>결제</span>
                      <b className="num">{payLine(shopSum.pay, won)}</b>
                    </div>
                  </div>
                </>
              ) : (
                <p className="muted">매점 매출을 불러오는 중…</p>
              )}
            </section>

            <section className="exec-sec" aria-label="지출">
              <h2>지출</h2>
              <div className="exec-grid3">
                <div className="exec-metric">
                  <span>지출 합계</span>
                  <b className="num">{won(exT.amount)}</b>
                </div>
                <div className="exec-metric">
                  <span>건수</span>
                  <b className="num">{exT.count}</b>
                </div>
                <div className="exec-metric">
                  <span>수단</span>
                  <b className="num">
                    카드 {won(exT.card)} · 현금 {won(exT.cash)} · 이체 {won(exT.transfer)}
                  </b>
                </div>
              </div>
              {exT.unpaidCount > 0 ? (
                <p className="exec-note">
                  미수금 {exT.unpaidCount}건 · {won(exT.unpaid)}원
                </p>
              ) : null}
              {exCats.length ? (
                <table className="exec-tbl compact">
                  <thead>
                    <tr>
                      <th>분류</th>
                      <th className="r">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exCats.map(([cat, amt]) => (
                      <tr key={cat}>
                        <td>{cat || "기타"}</td>
                        <td className="r num">{won(amt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">이 기간 지출이 없어요</p>
              )}
            </section>

            <footer className="exec-foot">
              매출 {won(money.sales)}원 − 지출 {won(money.expense)}원 = 남은 금액 {won(money.left)}원 · 현금 시재 {won(money.cash)}원
            </footer>
          </div>
        </>
      ) : (
        <>
      <section className="lweek noprint" aria-label="일주일 입실현황">
        <div className="lweek-h">
          <div className="lweek-title">
            <b>일주일 입실현황</b>
            <span className="muted">
              {dayLabel(stripDays[0])} ~ {dayLabel(stripDays[6])} · 취소·노쇼 제외 · 날짜 탭 = 그날 입실
            </span>
          </div>
          <div className="lweek-nav" role="group" aria-label="주 이동">
            <button type="button" className="btn sm line" aria-label="이전 주" onClick={() => shiftStripWeek(-1)}>
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              className="btn sm line"
              disabled={weekStart(weekAnchor) === weekStart(today)}
              onClick={() => setWeekAnchor(weekStart(today))}
            >
              이번 주
            </button>
            <button type="button" className="btn sm line" aria-label="다음 주" onClick={() => shiftStripWeek(1)}>
              <ChevronRight size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="lweek-grid" role="list">
          {stripDays.map((d) => {
            const c = stripCounts.get(d) ?? { dayuse: 0, stay: 0, multi: 0 };
            const selected = from === d && to === d;
            const isToday = d === today;
            const wd = weekday(d);
            const we = wd === "토" || wd === "일";
            return (
              <button
                key={d}
                type="button"
                role="listitem"
                className={`lweek-day${selected ? " on" : ""}${isToday ? " td" : ""}${we ? " we" : ""}${wd === "토" ? " sa" : ""}${wd === "일" ? " su" : ""}`}
                aria-pressed={selected}
                aria-label={`${dayLabel(d)} 입실 · 대실 ${c.dayuse} · 숙박 ${c.stay} · 연박 ${c.multi}`}
                onClick={() => pickStripDay(d)}
              >
                <span className="lweek-date">
                  <b>{md(d)}</b>
                  <span>{wd}</span>
                  {isToday ? <i className="lweek-today">오늘</i> : null}
                </span>
                <span className="lweek-counts">
                  <span className="lweek-row">
                    <em>{CHECKIN_STRIP_LABEL.dayuse}</em>
                    <strong>{c.dayuse}</strong>
                  </span>
                  <span className="lweek-row">
                    <em>{CHECKIN_STRIP_LABEL.stay}</em>
                    <strong>{c.stay}</strong>
                  </span>
                  <span className="lweek-row">
                    <em>{CHECKIN_STRIP_LABEL.multi}</em>
                    <strong>{c.multi}</strong>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="filters noprint">
        <label className="search ls">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            placeholder={s.parking.enabled ? "이름·연락처·플랫폼·메모·방·차량번호" : "이름·연락처·플랫폼·메모·방 번호"}
            aria-label="통합 이용내역 검색"
            aria-keyshortcuts="/"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setQuery(""))}
          />
          <kbd>/</kbd>
        </label>
        <div className="chips period-chips" role="group" aria-label="조회 기간">
          {(
            [
              ["today", "오늘"],
              ["7", "7일"],
              ["30", "30일"],
              ["custom", "사용자"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`chip sm ${period === k ? "on" : ""}`}
              aria-pressed={period === k}
              onClick={() => (k === "custom" ? setPeriod("custom") : applyPeriod(k))}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="fdate">
          입실일
          <input type="date" value={from} onChange={(e) => e.target.value && setFromCustom(e.target.value)} />~
          <input type="date" value={to} onChange={(e) => e.target.value && setToCustom(e.target.value)} />
        </label>
        <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="플랫폼">
          <option value="">플랫폼 전체</option>
          {s.platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="객실 타입">
          <option value="">타입 전체</option>
          {usableTypes(s.types).map((t) => (
            <option key={t.id} value={t.id}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류">
          <option value="">숙박·대실 전체</option>
          <option value="stay">숙박</option>
          <option value="dayuse">대실</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬">
          <option value="in-desc">입실 날짜 늦은 순</option>
          <option value="in-asc">입실 날짜 이른 순</option>
          <option value="rec">최근 기록·수정 순</option>
        </select>
        <button type="button" className={`chip sm duechip ${dueOnly ? "on" : ""}`} aria-pressed={dueOnly} onClick={() => setDueOnly((x) => !x)}>
          잔금 남음
        </button>
        {feeUsed ? (
          <button type="button" className={`chip sm duechip ${poWait ? "on" : ""}`} aria-pressed={poWait} onClick={() => setPoWait((x) => !x)}>
            입금 미확인
          </button>
        ) : null}
        <div className="seg" role="group" aria-label="예약 상태">
          {(
            [
              ["all", "전체"],
              ["active", "정상"],
              ["void", "취소·노쇼"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={st === k ? "on" : ""} onClick={() => setSt(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="ledger-filter-bot">
          <div className="seg" role="group" aria-label="이용 상태">
            {(
              [
                ["all", "이용 전체"],
                ["pre", STAY_PHASE_LABEL.pre],
                ["in", STAY_PHASE_LABEL.in],
                ["done", STAY_PHASE_LABEL.done],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={phase === k ? "on" : ""} onClick={() => setPhase(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="ledger-export" role="group" aria-label="내보내기">
            <button type="button" className="btn line sm" disabled={!list.length} onClick={printLedger} aria-label="장부 인쇄">
              <Printer size={14} /> 인쇄
            </button>
            <button
              type="button"
              className="btn line sm"
              disabled={!list.length}
              onClick={printLedger}
              title="인쇄 창에서「PDF로 저장」을 고르세요"
              aria-label="장부 PDF로 저장"
            >
              <FileDown size={14} /> PDF
            </button>
            {hasProAccess(data.hotel!.plan) ? (
              <button
                type="button"
                className="btn line sm"
                disabled={!list.length}
                onClick={() =>
                  downloadLedgerXlsx(
                    list,
                    {
                      platformName: (id) => L.plats.get(id)?.name ?? "?",
                      typeLabel: (id) => {
                        const t = L.types.get(id);
                        return t ? typeLabel(t) : "?";
                      },
                      roomLabel: (b) =>
                        !b.roomId
                          ? "—"
                          : isMoved(b)
                            ? legsOf(b)
                                .map((l) => L.rooms.get(l.roomId ?? "")?.no ?? "?")
                                .join("→")
                            : (L.roomLabel(b.roomId) ?? "?"),
                    },
                    `${data.hotel!.name || "호텔"}_장부_${from}_${to}.xlsx`,
                  )
                }
              >
                <Download size={14} /> 엑셀로 내보내기
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {err ? <div className="ferr noprint">{err}</div> : null}
      <div className="ledger-print">
        <header className="ledger-print-head print-only">
          <div className="lph-k">{data.hotel!.name || "호텔"}</div>
          <h1>장부 · 통합 이용내역</h1>
          <div className="lph-meta">
            입실일 {from} ~ {to} · {list.length}건 · 숙박 {nights}박
            {byPayout ? " · 입금 예정 기준" : ""}
          </div>
          {printFilters.length ? <div className="lph-filters">필터: {printFilters.join(" · ")}</div> : null}
          <div className="lph-sum">
            매출 {won(money.sales)}원 − 지출 {won(money.expense)}원 = 남은 금액 {won(money.left)}원 · 현금 시재 {won(money.cash)}원
            {paySum && paySum.total > 0
              ? ` · 받은 돈 카드 ${won(paySum.card)} · 현금 ${won(paySum.cash)} · 이체 ${won(paySum.transfer)}`
              : ""}
          </div>
        </header>
        <div className="ltable">
          <div className="lrow lhead">
            <span>입실일</span>
            <span>종류</span>
            <span>플랫폼</span>
            <span>이름</span>
            <span>연락처</span>
            <span>상태</span>
            <span>입–퇴</span>
            <span>인원</span>
            <span>타입</span>
            <span>방</span>
            <span className="r">가격</span>
          </div>
          {rows === null ? (
            <div className="lempty">불러오는 중…</div>
          ) : list.length === 0 ? (
            <div className="lempty">조건에 맞는 예약이 없어요</div>
          ) : (
            ledgerItems.map((it) => (it.g ? renderGroup(it.g) : renderRow(it.b!, false)))
          )}
        </div>
        {list.length ? (
          <div className="ledger-print-foot print-only">
            합계 {list.length}건 · 정상 판매가 {won(listTotal)}원
            {dueTotal > 0 ? ` · 잔금 남음 ${won(dueTotal)}원` : ""}
          </div>
        ) : null}
      </div>
      {!hasProAccess(data.hotel!.plan) ? <p className="fine pad noprint">엑셀 내보내기는 Pro에서 쓸 수 있어요.</p> : null}
        </>
      )}
      {settleId && allGroups.get(settleId) ? (
        <GroupSettle
          data={data}
          today={today}
          groupId={settleId}
          members={allGroups.get(settleId)!.members}
          onClose={() => setSettleId(null)}
          notify={notify}
          onAddRooms={() => {
            setAddGroupId(settleId);
            setSettleId(null);
          }}
        />
      ) : null}
      {addGroupId && allGroups.get(addGroupId) ? (
        <GroupAdd
          data={data}
          today={today}
          members={allGroups.get(addGroupId)!.members}
          onClose={() => setAddGroupId(null)}
          onSaved={(m) => {
            notify(m);
            setAddGroupId(null);
          }}
        />
      ) : null}
      {stayConfirm && stayConfirm.kind === "stay" ? (
        <StayConfirmLetter
          booking={stayConfirm}
          hotelName={data.hotel!.name}
          s={s}
          today={today}
          onClose={() => setStayConfirm(null)}
        />
      ) : null}
      {invoiceGroupId && allGroups.get(invoiceGroupId) ? (
        <InvoiceLetter
          hotelName={data.hotel!.name}
          s={s}
          today={today}
          members={allGroups.get(invoiceGroupId)!.members}
          groupId={invoiceGroupId}
          groupInfo={data.groups.get(invoiceGroupId) ?? emptyGroupInfo(invoiceGroupId)}
          busy={invoiceBusy}
          notify={notify}
          onIssue={async (args) => {
            setInvoiceBusy(true);
            try {
              return await invoices.issue(args);
            } finally {
              setInvoiceBusy(false);
            }
          }}
          onClose={() => setInvoiceGroupId(null)}
        />
      ) : null}
      {invoiceBooking && !invoiceGroupId ? (
        <InvoiceLetter
          hotelName={data.hotel!.name}
          s={s}
          today={today}
          members={[invoiceBooking]}
          groupId={null}
          groupInfo={null}
          busy={invoiceBusy}
          notify={notify}
          onIssue={async (args) => {
            setInvoiceBusy(true);
            try {
              return await invoices.issue(args);
            } finally {
              setInvoiceBusy(false);
            }
          }}
          onClose={() => setInvoiceBooking(null)}
        />
      ) : null}
    </main>
  );
}

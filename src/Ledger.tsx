import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { type GroupSummary, groupDateBlock, groupSummaries } from "../shared/group";
import { settle, settleBadge } from "../shared/settle";
import GroupSettle from "./GroupSettle";
import GroupAdd from "./GroupAdd";
import { type Booking, addDays, dayLabel, isActive, isEarlyOut, isMoved, legsOf, perNight, roomRevenue, stayRoomIds, typeLabel, usableTypes, usedLabel, usedNights, won } from "../shared/ledger";
import { type HotelData, queryLedger, queryPayments, queryShopSales, useExpenses } from "./data";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, type BookPayMethod, bookingCash, paySplit, payState, validatePayment } from "../shared/payment";
import { EXTEND_COPY, NIGHTS_PRICE_WARN, canExtend, planGroupExtend } from "../shared/extend";
import { isTimeService, timeLine, timeTags } from "../shared/extratime";
import { parkingMark, plateMatches } from "../shared/parking";
import { type PaySplit, ledgerSummary, payLine, shopTotals } from "../shared/shop";
import { type Expense, expenseTotals, moneySummary } from "../shared/expense";
import { ExpenseList, ExpenseModal } from "./Expenses";
import { PlatBadge, TypeBadge, lookups } from "./ui";
import { cardFeeOf, payoutOf, payoutRevenue, payoutSummary, payoutValue, payoutWaiting } from "../shared/fee";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  query: string;
  setQuery: (q: string) => void;
  onOpen: (b: Booking, opts?: { openExtend?: boolean; openSurcharge?: boolean }) => void;
  notify: (m: string) => void;
}
type LTab = "bookings" | "expenses";
const LT_KEY = "hotori.ledgerTab";
type StatusF = "all" | "active" | "void";
type MoneyBasis = "sale" | "payout";
const MB_KEY = "hotori.moneyBasis";
const STATUS: Record<string, string> = { active: "", cancelled: "취소", noshow: "노쇼" };

export default function Ledger({ data, hotelId, today, query, setQuery, onOpen, notify }: Props) {
  // 장부 탭: 예약 · 지출 (기기마다 마지막 탭 기억)
  const [tab, setTabRaw] = useState<LTab>(() => {
    try {
      return localStorage.getItem(LT_KEY) === "expenses" ? "expenses" : "bookings";
    } catch {
      return "bookings";
    }
  });
  const setTab = (x: LTab) => {
    setTabRaw(x);
    try {
      localStorage.setItem(LT_KEY, x);
    } catch {
      /* 개인 정보 보호 모드 */
    }
  };
  const [exEdit, setExEdit] = useState<Expense | "new" | null>(null);
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 60));
  const [plat, setPlat] = useState("");
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [st, setSt] = useState<StatusF>("all");
  const [dueOnly, setDueOnly] = useState(false);
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
  const [payCash, setPayCash] = useState(0);
  const [paySum, setPaySum] = useState<ReturnType<typeof paySplit> | null>(null);
  const [sort, setSort] = useState<"in-desc" | "in-asc" | "rec">("in-desc");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shopSum, setShopSum] = useState<{ amount: number; count: number; pay: PaySplit } | null>(null);
  const ex = useExpenses(hotelId, from, to);
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
      })
      .catch(() => {
        if (!alive) return;
        setPayCash(0);
        setPaySum(null);
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
    if (dueOnly && leftOf(b) <= 0) return false;
    if (poWait && !payoutWaiting(b, L.plats.get(b.platformId))) return false;
    if (q) {
      const p = L.plats.get(b.platformId);
      const hay = [b.guestName, b.groupName, p?.name, p?.abbr, b.memo, L.stayRoomLabel(b), ...stayRoomIds(b).map((id) => L.rooms.get(id)?.no)].join(" ").toLowerCase();
      if (!hay.includes(q) && !plateMatches(b, q)) return false;
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
  // 플랫폼·타입·종류·검색으로 거르면 매점은 상관없어서 빼요
  const filtered = !!(plat || type || kind || q || st === "void" || dueOnly || poWait);
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
                  {STATUS[b.status] ? <span className={b.status === "noshow" ? "nst" : "cxt"} title={b.status === "noshow" ? "결제한 금액은 매출에 남아요" : "전액 환불 · 매출에서 빠져요"}>{STATUS[b.status]}</span> : null}
                  {b.memo ? <span className="memo">{b.memo}</span> : null}
                </span>
                <span className="c-type">
                  <TypeBadge t={L.types.get(b.typeId)} />
                </span>
                <span className="c-len" title={eo ? `${dayLabel(b.earlyOut!)} 중도 퇴실` : undefined}>
                  {b.kind !== "stay" ? `${b.startTime}~${b.endTime}` : eo ? `${usedLabel(b)} · 중도 퇴실` : `${b.nights}박`}
                  {b.guests ? <small className="gcount"> · {b.guests}명</small> : null}
                  {s.parking.enabled && parkingMark(b) ? <small className="gcount" title={b.plates?.length ? `차량번호 ${b.plates.join(", ")}` : undefined}> · {parkingMark(b)}</small> : null}
                  {timeTags(s, b).length ? <small className="gcount" title={`${timeLine(b)}${isTimeService(b) ? " · 서비스" : b.timeFee ? ` · ${won(b.timeFee)}원 포함` : ""}`}> · {timeTags(s, b).join(" · ")}</small> : null}
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
                <span className="c-ring">{isActive(b) && b.arrived ? <span className="intag">완료</span> : null}</span>
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
    if (what === "cancel" && !window.confirm(`단체 ${g.name} ${g.rooms}실을 모두 취소할까요?\n전액 환불로 보고 매출에서 빠지고, 방과 남은 객실이 다시 비어요.`)) return;
    setGBusy(true);
    try {
      const r = await data.patchGroup(g.groupId, what === "in" ? { arrived: true } : { status: "cancelled" });
      notify(what === "in" ? `단체 ${g.name} ${r.length}실 모두 입실 완료` : `단체 ${g.name} ${r.length}실을 취소했어요`);
    } catch (e) {
      notify(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setGBusy(false);
    }
  };
  const saveGroupEdit = async (g: GroupSummary) => {
    if (!gEdit || gBusy) return;
    const nm = gEdit.name.trim();
    if (!nm) return notify("단체명을 적어 주세요");
    const dateChanged = gEdit.checkIn !== g.checkIn || gEdit.nights !== g.nights;
    if (dateChanged) {
      const block = groupDateBlock(data.hotel!.settings, data.bookings, g.members, gEdit.checkIn, gEdit.nights);
      if (block) return notify(block);
      if (gEdit.nights !== g.nights && !window.confirm(NIGHTS_PRICE_WARN)) return;
    }
    setGBusy(true);
    try {
      await data.patchGroup(g.groupId, { groupName: nm, oldName: g.name, ...(dateChanged ? { checkIn: gEdit.checkIn, nights: gEdit.nights } : {}) });
      notify(`단체 ${nm} 바꿨어요${dateChanged ? ` · ${dayLabel(gEdit.checkIn)} 입실 ${gEdit.nights}박` : ""}`);
      setGEdit(null);
    } catch (e) {
      notify(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
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
        await data.saveBooking({ ...cur, nights: m.draft.nights, price: m.draft.price, segments: m.draft.segments }, false);
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
      notify(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
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
          <span className="c-type gts">{tsum}</span>
          <span className="c-len">{g.nights}박</span>
          <span className="c-room">{g.members.length}개 방</span>
          <span className="c-price r">
            {won(gst?.total ?? g.total)}
            {badge ? <small className={badge.due ? "dueamt" : "paidtag"}>{badge.text}</small> : <small>단체 합계</small>}
          </span>
          <span className="c-ring">{g.arrived && g.rooms ? <span className="intag">{g.arrived === g.rooms ? "완료" : `${g.arrived}/${g.rooms}`}</span> : null}</span>
        </div>
        {open ? (
          <>
            {g.rooms ? (
              <div className="gacts">
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
                <button type="button" className="btn sm line red-t" disabled={gBusy} onClick={() => void groupAct(g, "cancel")}>
                  단체 취소
                </button>
              </div>
            ) : (
              <div className="gacts">
                <button type="button" className="btn sm line" onClick={() => setSettleId(g.groupId)}>
                  정산서 보기
                </button>
              </div>
            )}
            {gEdit?.id === g.groupId ? (
              <div className="gedit">
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
              <div className="gedit gext">
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
                          잔금으로 남기기
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

  return (
    <main className="page ledger">
      <div className="ph">
        <div>
          <h1>장부</h1>
          <div className="sub">
            {tab === "bookings" ? (
              <>
                {list.length}건 · 숙박 {nights}박 <span className="muted">· 입실일 {dayLabel(from)} ~ {dayLabel(to)} · 박수는 취소·노쇼 제외 · 매출은 노쇼 포함, 환불은 퇴실한 날</span>
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
            <div className="lsum-f muted paysum" title="받은 날 기준 예약 선금·잔금 (단체 정산 포함). 이체는 현금 시재에 안 들어가요">
              예약 받은 돈 {won(paySum.total)}원 · 카드 {won(paySum.card)} · 현금 {won(paySum.cash)} · 이체 {won(paySum.transfer)}
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
        </div>
      </div>
      {exEdit ? (
        <ExpenseModal
          base={exEdit === "new" ? null : exEdit}
          today={today}
          categories={categories}
          onClose={() => setExEdit(null)}
          onSave={async (d) => {
            const saved = await ex.save(d, exEdit === "new" ? undefined : exEdit.id);
            setExEdit(null);
            notify(`${saved.category} ${won(saved.amount)}원 지출을 ${exEdit === "new" ? "적었어요" : "고쳤어요"} · ${saved.method === "cash" ? "현금" : "카드"}`);
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
      ) : (
        <>
      <div className="filters">
        <label className="search ls">
          <Search size={16} />
          <input value={query} placeholder={s.parking.enabled ? "이름·플랫폼·메모·방·차량번호" : "이름·플랫폼·메모·방 번호"} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="fdate">
          입실일
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />~
          <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
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
        <div className="seg">
          {(
            [
              ["all", "전체"],
              ["active", "정상"],
              ["void", "취소·노쇼"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={st === k ? "on" : ""} onClick={() => setSt(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {err ? <div className="ferr">{err}</div> : null}
      <div className="ltable">
        <div className="lrow lhead">
          <span>입실일</span>
          <span>종류</span>
          <span>플랫폼</span>
          <span>이름</span>
          <span>타입</span>
          <span>박수·시간</span>
          <span>방</span>
          <span className="r">가격</span>
          <span>입실</span>
        </div>
        {rows === null ? (
          <div className="lempty">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="lempty">조건에 맞는 예약이 없어요</div>
        ) : (
          ledgerItems.map((it) => (it.g ? renderGroup(it.g) : renderRow(it.b!, false)))
        )}
      </div>
      <p className="fine pad">엑셀 내보내기는 Pro에서 제공할 예정이에요.</p>
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
    </main>
  );
}

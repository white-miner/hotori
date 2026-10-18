import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { type GroupSummary, groupDateBlock, groupSummaries } from "../shared/group";
import { type Booking, addDays, dayLabel, isActive, isEarlyOut, isMoved, legsOf, perNight, roomRevenue, stayRoomIds, typeLabel, usableTypes, usedLabel, usedNights, won } from "../shared/ledger";
import { type HotelData, queryLedger, queryPayments, queryShopSales, useExpenses } from "./data";
import { bookingCash, payState } from "../shared/payment";
import { type PaySplit, ledgerSummary, payLine, shopTotals } from "../shared/shop";
import { type Expense, expenseTotals, moneySummary } from "../shared/expense";
import { ExpenseList, ExpenseModal } from "./Expenses";
import { PlatBadge, TypeBadge, lookups } from "./ui";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  query: string;
  setQuery: (q: string) => void;
  onOpen: (b: Booking) => void;
  notify: (m: string) => void;
}
type LTab = "bookings" | "expenses";
const LT_KEY = "hotori.ledgerTab";
type StatusF = "all" | "active" | "void";
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
  const [gOpen, setGOpen] = useState<Set<string>>(new Set());
  const [gEdit, setGEdit] = useState<{ id: string; name: string; checkIn: string; nights: number } | null>(null);
  const [gBusy, setGBusy] = useState(false);
  const [payCash, setPayCash] = useState(0);
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
      .then((r) => alive && setPayCash(bookingCash(r, from, to)))
      .catch(() => alive && setPayCash(0));
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

  const q = query.trim().toLowerCase();
  // 조건(플랫폼·타입·종류·검색·상태)만 거른 목록: 기간 밖 입실이라도 기간 안에 중도 퇴실 환불이 있으면 매출 계산에 들어가요
  const matched = (rows ?? []).filter((b) => {
    if (plat && b.platformId !== plat) return false;
    if (type && b.typeId !== type) return false;
    if (kind && b.kind !== kind) return false;
    if (st === "active" && !isActive(b)) return false;
    if (st === "void" && isActive(b)) return false;
    if (dueOnly && payState(b, L.plats.get(b.platformId)).left <= 0) return false;
    if (q) {
      const p = L.plats.get(b.platformId);
      const hay = [b.guestName, b.groupName, p?.name, p?.abbr, b.memo, L.stayRoomLabel(b), ...stayRoomIds(b).map((id) => L.rooms.get(id)?.no)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
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
  const filtered = !!(plat || type || kind || q || st === "void" || dueOnly);
  const dueTotal = list.reduce((n, b) => n + payState(b, L.plats.get(b.platformId)).left, 0);
  const sumUp = ledgerSummary(sum, filtered ? null : shopSum?.amount ?? null);
  // 맨 위 요약: 매출(숙박·대실 + 매점) − 지출 = 남은 금액 · 현금 시재(매점 현금 − 현금 지출). 예약 조건과 상관없이 이 기간 전체
  const revAll = roomRevenue(rows ?? [], from, to);
  const roomsAll = revAll.net;
  const exT = expenseTotals(ex.list ?? []);
  const renderRow = (b: Booking, gm = false) => {
            const p = L.plats.get(b.platformId);
            const per = perNight(b);
            const eo = isActive(b) && isEarlyOut(b);
            const ps = payState(b, p);
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
                  {STATUS[b.status] ? <span className={b.status === "noshow" ? "nst" : "cxt"} title={b.status === "noshow" ? "결제한 금액은 매출에 남아요" : "전액 환불 · 매출에서 빠져요"}>{STATUS[b.status]}</span> : null}
                  {b.memo ? <span className="memo">{b.memo}</span> : null}
                </span>
                <span className="c-type">
                  <TypeBadge t={L.types.get(b.typeId)} />
                </span>
                <span className="c-len" title={eo ? `${dayLabel(b.earlyOut!)} 중도 퇴실` : undefined}>
                  {b.kind !== "stay" ? `${b.startTime}~${b.endTime}` : eo ? `${usedLabel(b)} · 중도 퇴실` : `${b.nights}박`}
                  {b.guests ? <small className="gcount"> · {b.guests}명</small> : null}
                </span>
                <span className={`c-room ${isMoved(b) ? "mv" : ""}`} title={isMoved(b) ? `객실 이동 ${legsOf(b).map((l) => `${L.roomLabel(l.roomId)}호 ${l.nights}박`).join(" → ")}` : (L.roomLabel(b.roomId) ?? undefined)}>
                  {!b.roomId ? "—" : isMoved(b) ? legsOf(b).map((l) => L.rooms.get(l.roomId ?? "")?.no ?? "?").join("→") : (L.roomLabel(b.roomId) ?? "?")}
                </span>
                <span className="c-price r">
                  {won(b.price)}
                  {eo && b.refund ? <small className="rf">환불 −{won(b.refund)}</small> : per ? <small>1박 {won(per)}</small> : null}
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
  const renderGroup = (g: GroupSummary) => {
    const open = gOpen.has(g.groupId);
    const first = g.members[0];
    const p = L.plats.get(first.platformId);
    const tcount = new Map<string, number>();
    for (const b of g.active) tcount.set(b.typeId, (tcount.get(b.typeId) ?? 0) + 1);
    const tord = new Map(data.hotel!.settings.types.map((t, i) => [t.id, i]));
    const tsum = [...tcount.entries()].sort((a, b) => (tord.get(a[0]) ?? 0) - (tord.get(b[0]) ?? 0)).map(([t, n]) => `${typeLabel(L.types.get(t))} ${n}`).join(" · ");
    const cancelled = g.rooms === 0;
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
            {won(g.total)}
            <small>단체 합계</small>
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
                <button type="button" className="btn sm line red-t" disabled={gBusy} onClick={() => void groupAct(g, "cancel")}>
                  단체 취소
                </button>
              </div>
            ) : null}
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
                <span className="muted sm">모든 방에 같이 적용돼요 · 가격은 그대로</span>
                <button type="button" className="btn sm dark" disabled={gBusy} onClick={() => void saveGroupEdit(g)}>
                  저장
                </button>
              </div>
            ) : null}
            {[...g.members].sort((a, b) => (L.roomLabel(a.roomId) ?? "").localeCompare(L.roomLabel(b.roomId) ?? "", "ko", { numeric: true })).map((b) => renderRow(b, true))}
          </>
        ) : null}
      </div>
    );
  };

  const money = moneySummary(roomsAll, shopSum?.amount ?? 0, shopSum?.pay.cash ?? 0, exT, payCash);
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
            <span title={`숙박·대실 ${won(money.sales - (shopSum?.amount ?? 0))}원 + 매점 ${won(shopSum?.amount ?? 0)}원`}>
              매출<b>{won(money.sales)}원</b>
              <i className="muted">
                {" "}
                · 숙박·대실 {won(roomsAll)}{revAll.refunds ? ` (환불 −${won(revAll.refunds)})` : ""} · 매점 {won(shopSum?.amount ?? 0)}
              </i>
            </span>
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
              title="현금으로 받은 돈(매점 현금 + 예약 선금·잔금 현금, 받은 날 기준) − 현금 지출. 플랫폼이 받은 예약 금액과 카드는 빠져요"
            >
              현금 시재<b>{won(money.cash)}원</b>
              <i className="muted">
                {" "}
                · 매점 현금 {won(money.shopCash)} + 예약 현금 {won(money.bookingCash)} − 현금 지출 {won(money.cashOut)}
              </i>
            </span>
          </div>
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
          <input value={query} placeholder="이름·플랫폼·메모·방 번호" onChange={(e) => setQuery(e.target.value)} />
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
    </main>
  );
}

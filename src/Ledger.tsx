import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { type Booking, addDays, dayLabel, isActive, isMoved, legsOf, perNight, stayRoomIds, typeLabel, usableTypes, won } from "../shared/ledger";
import { type HotelData, queryLedger, queryShopSales } from "./data";
import { type PaySplit, ledgerSummary, payLine, shopTotals } from "../shared/shop";
import { PlatBadge, Ring, TypeBadge, lookups } from "./ui";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  query: string;
  setQuery: (q: string) => void;
  onOpen: (b: Booking) => void;
}
type StatusF = "all" | "active" | "void";
const STATUS: Record<string, string> = { active: "", cancelled: "취소", noshow: "노쇼" };

export default function Ledger({ data, hotelId, today, query, setQuery, onOpen }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 60));
  const [plat, setPlat] = useState("");
  const [type, setType] = useState("");
  const [kind, setKind] = useState("");
  const [st, setSt] = useState<StatusF>("all");
  const [sort, setSort] = useState<"in-desc" | "in-asc" | "rec">("in-desc");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shopSum, setShopSum] = useState<{ amount: number; count: number; pay: PaySplit } | null>(null);
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
  const list = (rows ?? []).filter((b) => {
    if (plat && b.platformId !== plat) return false;
    if (type && b.typeId !== type) return false;
    if (kind && b.kind !== kind) return false;
    if (st === "active" && !isActive(b)) return false;
    if (st === "void" && isActive(b)) return false;
    if (q) {
      const p = L.plats.get(b.platformId);
      const hay = [b.guestName, p?.name, p?.abbr, b.memo, L.stayRoomLabel(b), ...stayRoomIds(b).map((id) => L.rooms.get(id)?.no)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (sort === "in-asc") list.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.createdAt.localeCompare(b.createdAt));
  else if (sort === "rec") list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const act = list.filter(isActive);
  const sum = act.reduce((n, b) => n + b.price, 0);
  const nights = act.reduce((n, b) => n + (b.nights ?? 0), 0);
  // 플랫폼·타입·종류·검색으로 거르면 매점은 상관없어서 빼요
  const filtered = !!(plat || type || kind || q || st === "void");
  const sumUp = ledgerSummary(sum, filtered ? null : shopSum?.amount ?? null);

  return (
    <main className="page ledger">
      <div className="ph">
        <div>
          <h1>장부</h1>
          <div className="sub">
            {list.length}건 · 숙박 {nights}박 <span className="muted">· 입실일 {dayLabel(from)} ~ {dayLabel(to)} · 취소·노쇼 제외</span>
          </div>
          <div className="lsum">
            <span>
              숙박·대실<b>{won(sumUp.rooms)}원</b>
            </span>
            {sumUp.shop === null ? null : (
              <span>
                매점<b>{won(sumUp.shop)}원</b>
                {shopSum ? <i className="muted"> · {shopSum.count}개 · {payLine(shopSum.pay, won)}</i> : null}
              </span>
            )}
            <span className="tot">
              {sumUp.shop === null ? "합계" : "총 합계"}
              <b>{won(sumUp.total)}원</b>
            </span>
          </div>
        </div>
      </div>
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
          list.map((b) => {
            const p = L.plats.get(b.platformId);
            const per = perNight(b);
            return (
              <div key={b.id} role="button" tabIndex={0} className={`lrow ${isActive(b) ? "" : "cx"}`} onClick={() => onOpen(b)}>
                <span className="c-date">{dayLabel(b.checkIn)}</span>
                <span className="c-kind">{b.kind === "stay" ? "숙박" : "대실"}</span>
                <span className="c-plat">
                  <PlatBadge p={p} />
                  <span className="pn">{p?.name ?? "?"}</span>
                </span>
                <span className="c-name">
                  <span className="gn">{b.guestName}</span>
                  {STATUS[b.status] ? <span className="cxt">{STATUS[b.status]}</span> : null}
                  {b.memo ? <span className="memo">{b.memo}</span> : null}
                </span>
                <span className="c-type">
                  <TypeBadge t={L.types.get(b.typeId)} />
                </span>
                <span className="c-len">{b.kind === "stay" ? `${b.nights}박` : `${b.startTime}~${b.endTime}`}</span>
                <span className={`c-room ${isMoved(b) ? "mv" : ""}`} title={isMoved(b) ? `객실 이동 ${legsOf(b).map((l) => `${L.roomLabel(l.roomId)}호 ${l.nights}박`).join(" → ")}` : (L.roomLabel(b.roomId) ?? undefined)}>
                  {!b.roomId ? "—" : isMoved(b) ? legsOf(b).map((l) => L.rooms.get(l.roomId ?? "")?.no ?? "?").join("→") : (L.roomLabel(b.roomId) ?? "?")}
                </span>
                <span className="c-price r">
                  {won(b.price)}
                  {per ? <small>1박 {won(per)}</small> : null}
                </span>
                <span className="c-ring">{isActive(b) ? <Ring on={b.arrived} size={16} /> : null}</span>
              </div>
            );
          })
        )}
      </div>
      <p className="fine pad">엑셀 내보내기는 Pro에서 제공할 예정이에요.</p>
    </main>
  );
}

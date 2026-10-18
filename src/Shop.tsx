import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Minus } from "lucide-react";
import { type ShopItem, addDays, dayLabel, won } from "../shared/ledger";
import { addMonths, lastSaleOf, monthRange, onDay, shopGroups, shopTotals } from "../shared/shop";
import { type HotelData, useShopSales } from "./data";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  notify: (m: string) => void;
}

export default function Shop({ data, hotelId, today, notify }: Props) {
  const hotel = data.hotel!;
  const pro = hotel.plan === "pro";
  const items = hotel.settings.shopItems;
  const [mode, setMode] = useState<"day" | "month">("day");
  const [day, setDay] = useState(today);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [from, to] = mode === "day" ? [day, day] : monthRange(ym);
  const shop = useShopSales(hotelId, from, to);
  const sales = shop.sales ?? [];

  const groups = useMemo(() => shopGroups(items), [items]);
  const dayT = useMemo(() => shopTotals(sales, onDay(day)), [sales, day]);
  const isToday = day === today;
  // 숨기거나 지운 물품이라도 이날 판 게 있으면 되돌릴 수 있게 보여 줘요
  const shown = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  const extra = [...dayT.byItem.entries()].filter(([id]) => !shown.has(id));

  const sell = (it: ShopItem) => {
    notify(`${it.name} 1개 +${won(it.price)}원`);
    shop.sell(it, day).catch((e) => notify(`저장하지 못했어요: ${e instanceof Error ? e.message : "연결을 확인해 주세요"}`));
  };
  const undo = (id: string, name: string) => {
    const last = lastSaleOf(sales, id, day);
    if (!last) return;
    notify(`${name} 1개 취소 −${won(last.unitPrice)}원`);
    shop.undo(last).catch(() => notify("취소하지 못했어요. 다시 눌러 주세요"));
  };
  const setDaySafe = (d: string) => setDay(d > today ? today : d);

  const head = (
    <div className="ph shop-ph">
      <div>
        <h1>매점</h1>
        {mode === "day" ? (
          <div className="sub shop-sum">
            {isToday ? "오늘" : dayLabel(day)} 매점 매출 <b className="num">{won(dayT.amount)}원</b> · {dayT.count}개
          </div>
        ) : (
          <div className="sub shop-sum">
            {Number(ym.slice(5))}월 매점 매출 <b className="num">{won(shopTotals(sales).amount)}원</b> · {shopTotals(sales).count}개
          </div>
        )}
      </div>
      <div className="shop-ctl">
        {mode === "day" ? (
          <div className="daynav">
            <button aria-label="전날" onClick={() => setDaySafe(addDays(day, -1))}>
              <ChevronLeft size={18} />
            </button>
            <label className="dn-d">
              <span>{isToday ? `오늘 ${dayLabel(day)}` : dayLabel(day)}</span>
              <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDaySafe(e.target.value)} aria-label="날짜" />
            </label>
            <button aria-label="다음날" disabled={isToday} onClick={() => setDaySafe(addDays(day, 1))}>
              <ChevronRight size={18} />
            </button>
            {isToday ? null : (
              <button className="btn sm line" onClick={() => setDay(today)}>
                오늘
              </button>
            )}
          </div>
        ) : (
          <div className="daynav">
            <button aria-label="전달" onClick={() => setYm(addMonths(ym, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="dn-d">
              <span>
                {ym.slice(0, 4)}년 {Number(ym.slice(5))}월
              </span>
            </span>
            <button aria-label="다음달" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(addMonths(ym, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <div className="seg">
          <button className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>
            하루
          </button>
          <button
            className={mode === "month" ? "on" : ""}
            onClick={() => (pro ? (setYm(day.slice(0, 7)), setMode("month")) : notify("월별 보기는 Pro 요금제에서 쓸 수 있어요"))}
          >
            월별{pro ? null : <span className="tag pro-t">Pro</span>}
          </button>
        </div>
      </div>
    </div>
  );

  if (!items.some((i) => i.name.trim()))
    return (
      <main className="page shop">
        {head}
        <div className="empty-setup">
          <h1>매점 물품을 먼저 등록해 주세요</h1>
          <p>설정의 매점 물품에서 컵라면, 음료처럼 파는 물건과 가격을 적으면, 여기서 한 번 눌러 바로 기록할 수 있어요.</p>
          <a className="btn red" href="#/settings">
            설정으로 가기
          </a>
        </div>
      </main>
    );

  if (mode === "month") {
    const all = shopTotals(sales);
    const byDay = new Map<string, number>();
    for (const s of sales) byDay.set(s.bizDate, (byDay.get(s.bizDate) ?? 0) + s.unitPrice * s.qty);
    const rows = [...all.byItem.entries()].sort((a, b) => b[1].amount - a[1].amount);
    return (
      <main className="page shop">
        {head}
        {shop.error ? <div className="ferr">{shop.error}</div> : null}
        <div className="shop-month">
          <section className="card">
            <h3>물품별</h3>
            {shop.sales === null ? (
              <div className="lempty">불러오는 중…</div>
            ) : rows.length === 0 ? (
              <div className="lempty">이 달에는 판 물품이 없어요</div>
            ) : (
              <div className="smt">
                {rows.map(([id, r]) => (
                  <div key={id} className="smr">
                    <span className="n">{r.name}</span>
                    <span className="num c">{r.count}개</span>
                    <span className="num a">{won(r.amount)}원</span>
                  </div>
                ))}
                <div className="smr tot">
                  <span className="n">합계</span>
                  <span className="num c">{all.count}개</span>
                  <span className="num a">{won(all.amount)}원</span>
                </div>
              </div>
            )}
          </section>
          <section className="card">
            <h3>날짜별</h3>
            {byDay.size === 0 ? (
              <div className="lempty">—</div>
            ) : (
              <div className="smt">
                {[...byDay.entries()]
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([d, v]) => (
                    <button key={d} className="smr link" onClick={() => (setDay(d), setMode("day"))}>
                      <span className="n">{dayLabel(d)}</span>
                      <span className="num a">{won(v)}원</span>
                    </button>
                  ))}
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  const tile = (it: ShopItem) => {
    const n = dayT.byItem.get(it.id)?.count ?? 0;
    return (
      <div key={it.id} className={`stile ${n ? "has" : ""}`}>
        <button className="st-main" onClick={() => sell(it)}>
          <span className="st-n">{it.name}</span>
          <span className="st-p num">{won(it.price)}</span>
          <span className="st-c num">{n ? `${n}개` : ""}</span>
        </button>
        {n ? (
          <button className="st-x" aria-label={`${it.name} 1개 취소`} onClick={() => undo(it.id, it.name)}>
            <Minus size={16} strokeWidth={2.6} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <main className="page shop">
      {head}
      {shop.error ? <div className="ferr">{shop.error}</div> : null}
      {isToday ? null : <div className="shop-past">지난 날짜를 보고 있어요 · 누르면 {dayLabel(day)} 매출로 기록돼요</div>}
      {groups.map((g) => (
        <section key={g.category} className="sgroup">
          {groups.length > 1 ? <h3>{g.category}</h3> : null}
          <div className="stiles">{g.items.map(tile)}</div>
        </section>
      ))}
      {extra.length ? (
        <section className="sgroup">
          <h3>목록에 없는 물품</h3>
          <div className="stiles">
            {extra.map(([id, r]) => (
              <div key={id} className="stile has off">
                <div className="st-main">
                  <span className="st-n">{r.name}</span>
                  <span className="st-p num">숨김</span>
                  <span className="st-c num">{r.count}개</span>
                </div>
                <button className="st-x" aria-label={`${r.name} 1개 취소`} onClick={() => undo(id, r.name)}>
                  <Minus size={16} strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p className="shop-hint muted">물품을 누르면 1개 팔린 걸로 바로 기록돼요. 잘못 눌렀으면 − 를 눌러 주세요.</p>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { FREE_SHOP_ITEM_LIMIT, SHOP_CATEGORY_MAX, SHOP_NAME_MAX, type ShopItem, addDays, dayLabel, won } from "../shared/ledger";
import { hasProAccess } from "../shared/proGates";
import {
  type PayMethod,
  PAY_LABEL,
  addMonths,
  canAddShopItem,
  lastSaleOf,
  makeShopItem,
  monthRange,
  onDay,
  payLine,
  shopGroups,
  shopTotals,
  validateShopDraft,
} from "../shared/shop";
import { type HotelData, useShopSales } from "./data";
import NumInput from "./NumInput";
import { uid } from "./ui";

interface Props {
  data: HotelData;
  hotelId: string;
  today: string;
  notify: (m: string) => void;
}

/** 매점에서 바로 물품 등록 · 설정과 같은 shopItems 저장 */
function ShopAddModal({
  categories,
  onSave,
  onClose,
}: {
  categories: string[];
  onSave: (d: { name: string; price: number; category: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [category, setCat] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const d = { name: name.trim(), price: price ?? 0, category: category.trim() };
    const v = validateShopDraft(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSave(d);
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
      setBusy(false);
    }
  }

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal shop-add"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>물품 추가</h2>
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>
        <div className="fld">
          <label>
            이름<em>*</em>
          </label>
          <input
            ref={nameRef}
            className="inp"
            value={name}
            placeholder="예: 컵라면"
            maxLength={SHOP_NAME_MAX}
            aria-label="물품 이름"
            onChange={(e) => setName(e.target.value.slice(0, SHOP_NAME_MAX))}
          />
        </div>
        <div className="fld">
          <label>
            가격<em>*</em>
          </label>
          <label className="inp price">
            <NumInput className="num" placeholder="가격" aria-label="가격" min={0} max={10_000_000} allowEmpty value={price} onChange={setPrice} />
            원
          </label>
        </div>
        <div className="fld">
          <label>분류</label>
          <div className="cat-pick">
            {categories.length ? (
              <div className="chips">
                {categories.map((c) => (
                  <button type="button" key={c} className={`chip sm ${category === c ? "on" : ""}`} onClick={() => setCat(category === c ? "" : c)}>
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              className="inp"
              value={category}
              placeholder="분류 (선택 · 예: 음료)"
              maxLength={SHOP_CATEGORY_MAX}
              aria-label="분류"
              onChange={(e) => setCat(e.target.value.slice(0, SHOP_CATEGORY_MAX))}
            />
          </div>
        </div>
        {err ? <div className="ferr">{err}</div> : null}
        <div className="mf">
          <button type="button" className="btn line" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn red" disabled={busy}>
            {busy ? "저장 중…" : "추가"}
          </button>
        </div>
        <p className="fine">추가하면 매점에 바로 보여요. 순서·숨김은 설정 › 매점에서 바꿀 수 있어요.</p>
      </form>
    </div>
  );
}

export default function Shop({ data, hotelId, today, notify }: Props) {
  const hotel = data.hotel!;
  const pro = hasProAccess(hotel.plan);
  const items = hotel.settings.shopItems;
  const [mode, setMode] = useState<"day" | "month">("day");
  const [day, setDay] = useState(today);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [from, to] = mode === "day" ? [day, day] : monthRange(ym);
  const shop = useShopSales(hotelId, from, to);
  const sales = shop.sales ?? [];

  const groups = useMemo(() => shopGroups(items), [items]);
  const cats = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of items) {
      const c = it.category.trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  }, [items]);
  const dayT = useMemo(() => shopTotals(sales, onDay(day)), [sales, day]);
  const isToday = day === today;
  // 숨기거나 지운 물품이라도 이날 판 게 있으면 되돌릴 수 있게 보여 줘요
  const shown = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  const extra = [...dayT.byItem.entries()].filter(([id]) => !shown.has(id));
  const canAdd = canAddShopItem(hotel.plan, items.length, FREE_SHOP_ITEM_LIMIT);

  const openAdd = () => {
    if (!canAdd) return notify(`Free 요금제는 물품 ${FREE_SHOP_ITEM_LIMIT}개까지예요. Pro에서는 제한 없이 등록할 수 있어요.`);
    setAdding(true);
  };
  const saveItem = async (d: { name: string; price: number; category: string }) => {
    if (!canAddShopItem(hotel.plan, hotel.settings.shopItems.length, FREE_SHOP_ITEM_LIMIT)) {
      notify(`Free 요금제는 물품 ${FREE_SHOP_ITEM_LIMIT}개까지예요`);
      setAdding(false);
      return;
    }
    const next = makeShopItem({ id: uid("i"), name: d.name, price: d.price, category: d.category });
    await data.saveHotel({ settings: { ...hotel.settings, shopItems: [...hotel.settings.shopItems, next] } });
    notify(`${next.name} ${won(next.price)}원 · 매점에 추가했어요`);
    setAdding(false);
  };

  const sell = (it: ShopItem, m: PayMethod) => {
    notify(`${it.name} 1개 +${won(it.price)}원 · ${PAY_LABEL[m]}`);
    shop.sell(it, day, m).catch((e) => notify(`저장하지 못했어요: ${e instanceof Error ? e.message : "연결을 확인해 주세요"}`));
  };
  // − 는 그 결제 방법으로 판 것 중 가장 최근 1건만 삭제해요
  const undo = (id: string, name: string, m: PayMethod) => {
    const last = lastSaleOf(sales, id, day, m);
    if (!last) return;
    notify(`${name} 1개 취소 −${won(last.unitPrice)}원 · ${PAY_LABEL[m]}`);
    shop.undo(last).catch(() => notify("취소하지 못했어요. 다시 눌러 주세요"));
  };
  const setDaySafe = (d: string) => setDay(d > today ? today : d);

  const addBtn = (
    <button type="button" className="btn sm line" onClick={openAdd} aria-label="물품 추가">
      <Plus size={14} strokeWidth={2.4} />
      물품 추가
    </button>
  );

  const head = (
    <div className="ph shop-ph">
      <div>
        <h1>매점</h1>
        {mode === "day" ? (
          <div className="sub shop-sum">
            {isToday ? "오늘" : dayLabel(day)} 매점 매출 <b className="num">{won(dayT.amount)}원</b> · {dayT.count}개
            <span className="paysplit num">{payLine(dayT.pay, won)}</span>
          </div>
        ) : (
          <div className="sub shop-sum">
            {Number(ym.slice(5))}월 매점 매출 <b className="num">{won(shopTotals(sales).amount)}원</b> · {shopTotals(sales).count}개
            <span className="paysplit num">{payLine(shopTotals(sales).pay, won)}</span>
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
        {addBtn}
      </div>
    </div>
  );

  const modal = adding ? <ShopAddModal categories={cats} onSave={saveItem} onClose={() => setAdding(false)} /> : null;

  if (!items.some((i) => i.name.trim()))
    return (
      <main className="page shop">
        {head}
        <div className="empty-setup">
          <h1>매점 물품을 먼저 등록해 주세요</h1>
          <p>컵라면, 음료처럼 파는 물건과 가격을 입력하면, 여기서 한 번 눌러 바로 기록할 수 있어요.</p>
          <button type="button" className="btn red" onClick={openAdd}>
            <Plus size={16} strokeWidth={2.4} />
            물품 추가
          </button>
          <a className="btn line sm" href="#/settings/shop">
            설정에서 관리
          </a>
        </div>
        {modal}
      </main>
    );

  if (mode === "month") {
    const all = shopTotals(sales);
    const days = [...new Set(sales.map((s) => s.bizDate))].sort((a, b) => b.localeCompare(a));
    const byDay = new Map(days.map((d) => [d, shopTotals(sales, onDay(d))]));
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
                    <span className="n">
                      {r.name}
                      <small className="num">
                        카드 {r.card} · 현금 {r.cash}
                        {r.count - r.card - r.cash ? ` · 미지정 ${r.count - r.card - r.cash}` : ""}
                      </small>
                    </span>
                    <span className="num c">{r.count}개</span>
                    <span className="num a">{won(r.amount)}원</span>
                  </div>
                ))}
                <div className="smr tot">
                  <span className="n">
                    합계<small className="num">{payLine(all.pay, won)}</small>
                  </span>
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
                {[...byDay.entries()].map(([d, v]) => (
                  <button key={d} className="smr link" onClick={() => (setDay(d), setMode("day"))}>
                    <span className="n">
                      {dayLabel(d)}
                      <small className="num">{payLine(v.pay, won)}</small>
                    </span>
                    <span className="num a">{won(v.amount)}원</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
        {modal}
      </main>
    );
  }

  /** 물품 칸: 이름·가격, 그리고 현금·카드 줄마다 − 개수 + */
  const payRows = (id: string, name: string, it: ShopItem | null, r?: { card: number; cash: number }) =>
    (["cash", "card"] as const).map((m) => {
      const n = r?.[m] ?? 0;
      return (
        <div key={m} className={`st-row ${n ? "has" : ""}`}>
          <span className="st-m">{PAY_LABEL[m]}</span>
          <button className="st-b" disabled={!n} aria-label={`${name} ${PAY_LABEL[m]} 1개 취소`} onClick={() => undo(id, name, m)}>
            <Minus size={18} strokeWidth={2.6} />
          </button>
          <span className="st-q num">{n}</span>
          <button
            className="st-b st-add"
            disabled={!it}
            aria-label={`${name} ${PAY_LABEL[m]} 1개 팔기`}
            onClick={() => it && sell(it, m)}
          >
            <Plus size={18} strokeWidth={2.6} />
          </button>
        </div>
      );
    });
  const tile = (it: ShopItem) => {
    const r = dayT.byItem.get(it.id);
    return (
      <div key={it.id} className={`stile ${r?.count ? "has" : ""}`}>
        <div className="st-h">
          <span className="st-n">{it.name}</span>
          <span className="st-p num">{won(it.price)}</span>
        </div>
        <div className="st-t num">{r?.count ? `${r.count}개 · ${won(r.amount)}원` : "\u00a0"}</div>
        {payRows(it.id, it.name, it, r)}
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
                <div className="st-h">
                  <span className="st-n">{r.name}</span>
                  <span className="st-p">숨김</span>
                </div>
                <div className="st-t num">
                  {r.count}개 · {won(r.amount)}원
                </div>
                {payRows(id, r.name, null, r)}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p className="shop-hint muted">
        현금·카드 항목의 + 를 누르면 해당 결제수단으로 1개 판매가 바로 등록돼요. 잘못 눌렀으면 같은 항목의 − 를 눌러 주세요.{" "}
        <a href="#/settings/shop">설정에서 물품 관리</a>
      </p>
      {modal}
    </main>
  );
}

// 지출: 상단 탭 · 장부 하위 탭 공용 — 거래처 · 입고일 · 미수/입금 · 금액 선택 · 구매 주기 힌트
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search, Wallet } from "lucide-react";
import { addDays, dayLabel, won } from "../shared/ledger";
import {
  type Expense,
  type ExpensePayMethod,
  type ExpenseVendor,
  type VendorType,
  EXPENSE_AMOUNT_MAX,
  EXPENSE_MEMO_MAX,
  EXPENSE_PAY_LABEL,
  EXPENSE_PAY_METHODS,
  EXPENSE_VENDOR_NAME_MAX,
  VENDOR_TYPE_LABEL,
  VENDOR_TYPES,
  expenseTotals,
  isExpensePayMethod,
  itemCadenceFor,
  monthlyByCategory,
  purchaseCadence,
  validateExpense,
  validateVendor,
  vendorCadenceMap,
} from "../shared/expense";
import { xlsx } from "../shared/xlsx";
import type { ExpenseDraft, HotelData, VendorDraft } from "./data";
import { useExpenseVendors, useExpenses } from "./data";
import { Inp } from "./primitives/Inp";
import { DateChip } from "./ui";

const M_KEY = "hotori.expenseMethod";
const lastMethod = (): ExpensePayMethod => {
  try {
    const v = localStorage.getItem(M_KEY);
    return isExpensePayMethod(v) ? v : "cash";
  } catch {
    return "cash";
  }
};

function methodLabel(m: ExpensePayMethod | null): string {
  return m ? EXPENSE_PAY_LABEL[m] : "—";
}

function notifyLine(e: Expense, isNew: boolean): string {
  const who = e.vendorName ? `${e.vendorName} · ` : "";
  const amt = e.amount > 0 ? `${won(e.amount)}원` : "금액 미정";
  const pay = e.paid ? (e.method ? ` · ${methodLabel(e.method)}` : "") : " · 미수금";
  return `${who}${e.category} ${amt} 지출을 ${isNew ? "적었어요" : "고쳤어요"}${pay}`;
}

export function ExpenseModal({
  base,
  today,
  categories,
  vendors,
  history,
  onSaveVendor,
  onSave,
  onDelete,
  onClose,
}: {
  base: Expense | null;
  today: string;
  categories: string[];
  vendors: ExpenseVendor[];
  /** 구매 주기 추정용 (현재 목록 + 가능하면 더 넓게) */
  history: Expense[];
  onSaveVendor: (d: VendorDraft) => Promise<ExpenseVendor>;
  onSave: (d: ExpenseDraft) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [bizDate, setDate] = useState(base?.bizDate ?? today);
  const [stockIn, setStockIn] = useState(base?.stockInDate ?? "");
  const cats = base && !categories.includes(base.category) ? [...categories, base.category] : categories;
  const [category, setCat] = useState(base?.category ?? "");
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : "");
  const [paid, setPaid] = useState(base ? base.paid : true);
  const [method, setMethod] = useState<ExpensePayMethod | null>(base?.method ?? (base && !base.paid ? null : lastMethod()));
  const [memo, setMemo] = useState(base?.memo ?? "");
  const [vendorId, setVendorId] = useState(base?.vendorId ?? "");
  const [newVenName, setNewVenName] = useState("");
  const [newVenType, setNewVenType] = useState<VendorType>("mart");
  const [showNewVen, setShowNewVen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const memoRef = useRef<HTMLInputElement>(null);
  const newVenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    memoRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!showNewVen) return;
    newVenRef.current?.focus();
  }, [showNewVen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vendorCadence = useMemo(() => {
    if (!vendorId) return null;
    const rows = history.filter((e) => e.vendorId === vendorId);
    const c = purchaseCadence(rows);
    return c.label ? c : null;
  }, [history, vendorId]);
  const itemCadence = useMemo(() => itemCadenceFor(history, vendorId || null, memo), [history, vendorId, memo]);

  async function createVendor() {
    const v = validateVendor({ name: newVenName, vendorType: newVenType });
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      const saved = await onSaveVendor({ name: newVenName.trim(), vendorType: newVenType });
      setVendorId(saved.id);
      setNewVenName("");
      setShowNewVen(false);
    } catch (e) {
      setErr(e instanceof Error ? `거래처를 저장하지 못했어요: ${e.message}` : "거래처를 저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const amt = Number(amount || 0);
    const d: ExpenseDraft = {
      bizDate,
      stockInDate: stockIn || null,
      category,
      amount: amt,
      method: paid ? method : method,
      paid,
      memo: memo.trim() || null,
      vendorId: vendorId || null,
    };
    const v = validateExpense(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSave(d);
      if (paid && method) {
        try {
          localStorage.setItem(M_KEY, method);
        } catch {
          /* 개인 정보 보호 모드 */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
      setBusy(false);
    }
  }
  const dateChips = [
    { d: today, l: `오늘 ${dayLabel(today)}` },
    { d: addDays(today, -1), l: `어제 ${dayLabel(addDays(today, -1))}` },
  ];
  const selectedVendor = vendors.find((v) => v.id === vendorId);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal exmodal"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>{base ? "지출 수정" : "지출 기록"}</h2>
          <button type="button" className="x" onClick={onClose}>
            <kbd>Esc</kbd>닫기
          </button>
        </div>
        <div className="fld">
          <label>
            영업일<em>*</em>
          </label>
          <div className="chips">
            {dateChips.map((c) => (
              <button type="button" key={c.d} className={`chip sm ${bizDate === c.d ? "on" : ""}`} onClick={() => setDate(c.d)}>
                {c.l}
              </button>
            ))}
            <DateChip value={bizDate} label="영업일" onChange={setDate} />
          </div>
        </div>
        <div className="fld">
          <label>입고날짜</label>
          <div className="chips">
            <button type="button" className={`chip sm ${!stockIn ? "on" : ""}`} onClick={() => setStockIn("")}>
              없음
            </button>
            <button type="button" className={`chip sm ${stockIn === today ? "on" : ""}`} onClick={() => setStockIn(today)}>
              오늘
            </button>
            <button type="button" className={`chip sm ${stockIn === bizDate && stockIn ? "on" : ""}`} onClick={() => setStockIn(bizDate)}>
              영업일과 같음
            </button>
            <DateChip value={stockIn || bizDate} label="입고날짜" onChange={setStockIn} />
          </div>
          <p className="fine">물건 받은 날이에요. 영업일(결제일)과 달라도 돼요.</p>
        </div>
        <div className="fld">
          <label>
            분류<em>*</em>
          </label>
          <div className="chips">
            {cats.map((c) => (
              <button type="button" key={c} className={`chip sm ${category === c ? "on" : ""}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
            {!cats.length ? <span className="muted sm">설정 › 지출 분류에서 분류를 먼저 만들어 주세요</span> : null}
          </div>
        </div>
        <div className="fld">
          <label>거래처</label>
          <div className="exven-row">
            <select className="inp" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="거래처">
              <option value="">거래처 없음</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {VENDOR_TYPE_LABEL[v.vendorType]}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm line" onClick={() => setShowNewVen((x) => !x)}>
              {showNewVen ? "닫기" : "+ 새 거래처"}
            </button>
          </div>
          {selectedVendor ? (
            <p className="fine">
              {VENDOR_TYPE_LABEL[selectedVendor.vendorType]}
              {vendorCadence?.label ? ` · 구매 주기 ${vendorCadence.label}` : history.filter((e) => e.vendorId === vendorId).length ? " · 주기 추정엔 날짜가 더 필요해요" : ""}
            </p>
          ) : null}
          {showNewVen ? (
            <div className="exven-new">
              <Inp
                ref={newVenRef}
                placeholder="예: ○○마트"
                maxLength={EXPENSE_VENDOR_NAME_MAX}
                value={newVenName}
                onChange={(e) => setNewVenName(e.target.value)}
                aria-label="새 거래처 이름"
                autoComplete="off"
              />
              <div className="chips" role="group" aria-label="거래처 종류">
                {VENDOR_TYPES.map((t) => (
                  <button type="button" key={t} className={`chip sm ${newVenType === t ? "on" : ""}`} onClick={() => setNewVenType(t)}>
                    {VENDOR_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              <button type="button" className="btn sm red" disabled={busy || !newVenName.trim()} onClick={() => void createVendor()}>
                거래처 저장
              </button>
            </div>
          ) : null}
        </div>
        <div className="fld">
          <label>
            사용처·품목<em>*</em>
          </label>
          <input
            ref={memoRef}
            className="inp"
            placeholder="예: 라면, 종이컵, 샴푸, 수도꼭지 수리…"
            maxLength={EXPENSE_MEMO_MAX}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            aria-label="사용처·품목"
          />
          <p className="fine">
            산 것·쓴 것을 그대로 적어 주세요.
            {itemCadence?.label ? ` · 이 품목 구매 주기 ${itemCadence.label}` : ""}
          </p>
        </div>
        <div className="fld">
          <label>정산</label>
          <div className="seg paym" role="radiogroup" aria-label="정산">
            <button
              type="button"
              role="radio"
              aria-checked={!paid}
              className={!paid ? "on" : ""}
              onClick={() => {
                setPaid(false);
              }}
            >
              미수금
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={paid}
              className={paid ? "on" : ""}
              onClick={() => {
                setPaid(true);
                if (!method) setMethod(lastMethod());
              }}
            >
              입금 완료
            </button>
          </div>
        </div>
        <div className="fld">
          <label>
            금액{paid ? <em>*</em> : <span className="muted"> (선택)</span>}
          </label>
          <div className="two">
            <label className="inp price">
              <input
                className="num"
                inputMode="numeric"
                placeholder={paid ? "금액" : "아직 모르면 비워 두세요"}
                aria-label="금액"
                value={amount ? won(Number(amount)) : ""}
                onChange={(e) => setAmount(String(Math.min(EXPENSE_AMOUNT_MAX, Number(e.target.value.replace(/\D/g, "").slice(0, 9)) || 0) || ""))}
              />
              원
            </label>
            <div className={`seg paym ${!paid ? "dimmed" : ""}`} role="radiogroup" aria-label="결제 방법">
              {EXPENSE_PAY_METHODS.map((m) => (
                <button
                  type="button"
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  className={method === m ? "on" : ""}
                  onClick={() => setMethod(m)}
                >
                  {EXPENSE_PAY_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          {!paid ? <p className="fine">미수금이면 금액·결제는 나중에 채워도 돼요. 입금 완료로 바꾸면 금액·카드/현금/이체가 필요해요.</p> : null}
        </div>
        {err ? <div className="ferr">{err}</div> : null}
        <div className="mf">
          {base ? (
            confirmDel ? (
              <button type="button" className="btn sm danger" onClick={() => void onDelete()}>
                정말 지울까요?
              </button>
            ) : (
              <button type="button" className="btn sm ghost" onClick={() => setConfirmDel(true)}>
                지출 지우기
              </button>
            )
          ) : null}
          <span className="sp" />
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button className="btn red" disabled={busy}>
            {busy ? "저장 중…" : "저장"} <span className="num kbdh">Enter</span>
          </button>
        </div>
      </form>
    </div>
  );
}

type MethodF = "all" | ExpensePayMethod;
type PaidF = "all" | "unpaid" | "paid";
export function ExpenseList({
  list,
  error,
  from,
  to,
  setFrom,
  setTo,
  plan,
  hotelName,
  onOpen,
  onAdd,
}: {
  list: Expense[] | null;
  error: string | null;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  plan: string;
  hotelName: string;
  onOpen: (e: Expense) => void;
  onAdd: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [mf, setMf] = useState<MethodF>("all");
  const [pf, setPf] = useState<PaidF>("all");
  const [vendorF, setVendorF] = useState("");
  const allCats = useMemo(() => [...new Set((list ?? []).map((e) => e.category))].sort(), [list]);
  const allVendors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of list ?? []) if (e.vendorId && e.vendorName) m.set(e.vendorId, e.vendorName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  }, [list]);
  const cadenceByVendor = useMemo(() => vendorCadenceMap(list ?? []), [list]);
  const qq = q.trim().toLowerCase();
  const rows = (list ?? []).filter(
    (e) =>
      (!cat || e.category === cat) &&
      (mf === "all" || e.method === mf) &&
      (pf === "all" || (pf === "unpaid" ? !e.paid : e.paid)) &&
      (!vendorF || e.vendorId === vendorF) &&
      (!qq || `${e.category} ${e.memo ?? ""} ${e.vendorName ?? ""}`.toLowerCase().includes(qq)),
  );
  const t = expenseTotals(rows);
  const pro = plan === "pro";
  const months = useMemo(() => (pro ? monthlyByCategory(rows) : []), [pro, rows]);
  const monthCats = useMemo(() => [...new Set(months.flatMap((m) => [...m.byCategory.keys()]))], [months]);

  const exportXlsx = () => {
    const data: (string | number | null)[][] = [["영업일", "입고일", "분류", "거래처", "정산", "결제", "금액", "사용처·품목"]];
    for (const e of [...rows].sort((a, b) => a.bizDate.localeCompare(b.bizDate) || a.createdAt.localeCompare(b.createdAt)))
      data.push([
        e.bizDate,
        e.stockInDate ?? "",
        e.category,
        e.vendorName ?? "",
        e.paid ? "입금 완료" : "미수금",
        methodLabel(e.method),
        e.amount,
        e.memo ?? "",
      ]);
    data.push([], ["합계", "", "", "", "", "", t.amount, `카드 ${won(t.card)} · 현금 ${won(t.cash)} · 이체 ${won(t.transfer)} · 미수 ${won(t.unpaid)}`]);
    for (const [c, v] of t.byCategory) data.push(["", "", c, "", "", "", v, ""]);
    const bytes = xlsx("지출", data, [12, 12, 10, 14, 10, 8, 14, 40]);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${hotelName || "호텔"}_지출_${from}_${to}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <>
      <div className="filters">
        <label className="search ls">
          <Search size={16} />
          <input value={q} placeholder="분류·품목·거래처" onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="fdate">
          날짜
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />~
          <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="분류">
          <option value="">분류 전체</option>
          {allCats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={vendorF} onChange={(e) => setVendorF(e.target.value)} aria-label="거래처">
          <option value="">거래처 전체</option>
          {allVendors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
              {cadenceByVendor.get(id)?.label ? ` (${cadenceByVendor.get(id)!.label})` : ""}
            </option>
          ))}
        </select>
        <div className="seg">
          {(
            [
              ["all", "전체"],
              ["unpaid", "미수금"],
              ["paid", "입금"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={pf === k ? "on" : ""} onClick={() => setPf(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          {(
            [
              ["all", "전체"],
              ["card", "카드"],
              ["cash", "현금"],
              ["transfer", "이체"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={mf === k ? "on" : ""} onClick={() => setMf(k)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn red sm exadd" onClick={onAdd}>
          <Plus size={14} strokeWidth={2.6} /> 지출
        </button>
      </div>
      {error ? <div className="ferr">{error}</div> : null}
      {t.unpaidCount ? (
        <p className="exap">
          미수금 {t.unpaidCount}건 · {won(t.unpaid)}원
          {pf !== "unpaid" ? (
            <>
              {" "}
              ·{" "}
              <button type="button" className="linkish" onClick={() => setPf("unpaid")}>
                미수만 보기
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="ltable">
        <div className="erow lhead excols">
          <span>날짜</span>
          <span>거래처</span>
          <span>분류</span>
          <span>정산</span>
          <span>사용처·품목</span>
          <span className="r">금액</span>
        </div>
        {list === null ? (
          <div className="lempty">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="lempty">{list.length ? "조건에 맞는 지출이 없어요" : "이 기간에 적은 지출이 없어요 · '+ 지출'로 적어 보세요"}</div>
        ) : (
          rows.map((e) => (
            <div key={e.id} role="button" tabIndex={0} className="erow excols" onClick={() => onOpen(e)} onKeyDown={(k) => k.key === "Enter" && onOpen(e)}>
              <span className="c-date">
                {dayLabel(e.bizDate)}
                {e.stockInDate && e.stockInDate !== e.bizDate ? <small className="exstock">입고 {dayLabel(e.stockInDate)}</small> : null}
              </span>
              <span className="c-ven">
                {e.vendorName ?? "—"}
                {e.vendorId && cadenceByVendor.get(e.vendorId)?.label ? (
                  <small className="excad">{cadenceByVendor.get(e.vendorId)!.label}</small>
                ) : null}
              </span>
              <span className="c-cat">{e.category}</span>
              <span className={`c-pay ${e.paid ? e.method ?? "paid" : "unpaid"}`}>{e.paid ? methodLabel(e.method) : "미수"}</span>
              <span className="c-memo">{e.memo ?? ""}</span>
              <span className="c-amt r">{e.amount > 0 ? won(e.amount) : "—"}</span>
            </div>
          ))
        )}
        {rows.length ? (
          <div className="erow efoot excols">
            <span>{rows.length}건</span>
            <span />
            <span />
            <span />
            <span className="muted">
              카드 {won(t.card)} · 현금 {won(t.cash)} · 이체 {won(t.transfer)}
              {t.unpaid ? ` · 미수 ${won(t.unpaid)}` : ""}
            </span>
            <span className="c-amt r">{won(t.amount)}</span>
          </div>
        ) : null}
      </div>

      {pro ? (
        <section className="exmonth">
          <div className="exm-h">
            <h3>월별 분류 합계</h3>
            <button className="btn line sm" onClick={exportXlsx} disabled={!rows.length}>
              <Download size={14} /> 엑셀로 내보내기
            </button>
          </div>
          {months.length ? (
            <div className="exm-wrap">
              <table className="exm">
                <thead>
                  <tr>
                    <th>달</th>
                    {monthCats.map((c) => (
                      <th key={c} className="r">
                        {c}
                      </th>
                    ))}
                    <th className="r">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td>{`${Number(m.month.slice(0, 4))}년 ${Number(m.month.slice(5))}월`}</td>
                      {monthCats.map((c) => (
                        <td key={c} className="r num">
                          {m.byCategory.get(c) ? won(m.byCategory.get(c)!) : "—"}
                        </td>
                      ))}
                      <td className="r num tot">{won(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted sm">이 기간에 지출이 없어요</p>
          )}
          <p className="fine">위 날짜·분류·결제 조건 그대로 합쳐요. 엑셀에는 한 건씩과 분류별 합계가 들어가요.</p>
        </section>
      ) : (
        <div className="share-lock exlock">월별 분류 합계와 엑셀 내보내기는 Pro에서 쓸 수 있어요. 지출 기록은 Free에서도 모두 돼요.</div>
      )}
    </>
  );
}

/** 상단 「지출」 전용 화면 */
export function ExpensesPage({
  data,
  hotelId,
  today,
  notify,
}: {
  data: HotelData;
  hotelId: string;
  today: string;
  notify: (m: string) => void;
}) {
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [exEdit, setExEdit] = useState<Expense | "new" | null>(null);
  const ex = useExpenses(hotelId, from, to);
  const ven = useExpenseVendors(hotelId);
  const categories = data.hotel!.settings.expenseCategories.map((c) => c.name.trim()).filter(Boolean);

  return (
    <main className="page expage">
      <div className="ph">
        <div>
          <h1>
            <Wallet size={22} strokeWidth={2.2} /> 지출
          </h1>
          <p className="muted">거래처·입고일·미수금을 적어요. 카드 · 현금 · 이체로 나눠요.</p>
        </div>
      </div>
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
            notify(notifyLine(saved, exEdit === "new"));
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
    </main>
  );
}

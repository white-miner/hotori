// 장부 › 지출: 목록 · 지출 창(+ 지출 / 고치기·지우기) · 월별 분류 합계와 엑셀 내보내기(Pro)
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { addDays, dayLabel, won } from "../shared/ledger";
import { type Expense, EXPENSE_AMOUNT_MAX, EXPENSE_MEMO_MAX, expenseTotals, monthlyByCategory, validateExpense } from "../shared/expense";
import { PAY_LABEL, type PayMethod } from "../shared/shop";
import { xlsx } from "../shared/xlsx";
import type { ExpenseDraft } from "./data";
import { DateChip } from "./ui";

const M_KEY = "hotori.expenseMethod";
const lastMethod = (): PayMethod => {
  try {
    return localStorage.getItem(M_KEY) === "card" ? "card" : "cash";
  } catch {
    return "cash";
  }
};

export function ExpenseModal({
  base,
  today,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  base: Expense | null;
  today: string;
  categories: string[];
  onSave: (d: ExpenseDraft) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [bizDate, setDate] = useState(base?.bizDate ?? today);
  // 분류: 지금 설정에 있는 것 + (고치는 기록의 예전 분류가 설정에서 사라졌으면 그것도)
  const cats = base && !categories.includes(base.category) ? [...categories, base.category] : categories;
  const [category, setCat] = useState(base?.category ?? "");
  const [amount, setAmount] = useState(base ? String(base.amount) : "");
  const [method, setMethod] = useState<PayMethod>(base?.method ?? lastMethod());
  const [memo, setMemo] = useState(base?.memo ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    amtRef.current?.focus();
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
    const d = { bizDate, category, amount: Number(amount || 0), method, memo: memo.trim() || null };
    const v = validateExpense(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSave(d);
      try {
        localStorage.setItem(M_KEY, method);
      } catch {
        /* 개인 정보 보호 모드 */
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
            날짜<em>*</em>
          </label>
          <div className="chips">
            {dateChips.map((c) => (
              <button type="button" key={c.d} className={`chip sm ${bizDate === c.d ? "on" : ""}`} onClick={() => setDate(c.d)}>
                {c.l}
              </button>
            ))}
            <DateChip value={bizDate} label="지출 날짜" onChange={setDate} />
          </div>
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
          <label>
            금액<em>*</em>
          </label>
          <div className="two">
            <label className="inp price">
              <input
                ref={amtRef}
                className="num"
                inputMode="numeric"
                placeholder="금액"
                aria-label="금액"
                value={amount ? won(Number(amount)) : ""}
                onChange={(e) => setAmount(String(Math.min(EXPENSE_AMOUNT_MAX, Number(e.target.value.replace(/\D/g, "").slice(0, 9)) || 0) || ""))}
              />
              원
            </label>
            <div className="seg paym" role="radiogroup" aria-label="결제 방법">
              {(["card", "cash"] as const).map((m) => (
                <button type="button" key={m} role="radio" aria-checked={method === m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>
                  {PAY_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="fld">
          <label>메모</label>
          <input className="inp" placeholder="메모 (선택)" maxLength={EXPENSE_MEMO_MAX} value={memo} onChange={(e) => setMemo(e.target.value)} />
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

type MethodF = "all" | PayMethod;
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
  const allCats = useMemo(() => [...new Set((list ?? []).map((e) => e.category))].sort(), [list]);
  const qq = q.trim().toLowerCase();
  const rows = (list ?? []).filter(
    (e) => (!cat || e.category === cat) && (mf === "all" || e.method === mf) && (!qq || `${e.category} ${e.memo ?? ""}`.toLowerCase().includes(qq)),
  );
  const t = expenseTotals(rows);
  const pro = plan === "pro";
  const months = useMemo(() => (pro ? monthlyByCategory(rows) : []), [pro, rows]);
  const monthCats = useMemo(() => [...new Set(months.flatMap((m) => [...m.byCategory.keys()]))], [months]);

  const exportXlsx = () => {
    const data: (string | number | null)[][] = [["날짜", "분류", "결제", "금액", "메모"]];
    for (const e of [...rows].sort((a, b) => a.bizDate.localeCompare(b.bizDate) || a.createdAt.localeCompare(b.createdAt)))
      data.push([e.bizDate, e.category, PAY_LABEL[e.method], e.amount, e.memo ?? ""]);
    data.push([], ["합계", "", "", t.amount, `카드 ${won(t.card)} · 현금 ${won(t.cash)}`]);
    for (const [c, v] of t.byCategory) data.push(["", c, "", v, ""]);
    const bytes = xlsx("지출", data, [12, 10, 8, 14, 40]);
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
          <input value={q} placeholder="분류·메모" onChange={(e) => setQ(e.target.value)} />
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
        <div className="seg">
          {(
            [
              ["all", "전체"],
              ["card", "카드"],
              ["cash", "현금"],
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
      <div className="ltable">
        <div className="erow lhead">
          <span>날짜</span>
          <span>분류</span>
          <span>결제</span>
          <span>메모</span>
          <span className="r">금액</span>
        </div>
        {list === null ? (
          <div className="lempty">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="lempty">{list.length ? "조건에 맞는 지출이 없어요" : "이 기간에 적은 지출이 없어요 · '+ 지출'로 적어 보세요"}</div>
        ) : (
          rows.map((e) => (
            <div key={e.id} role="button" tabIndex={0} className="erow" onClick={() => onOpen(e)} onKeyDown={(k) => k.key === "Enter" && onOpen(e)}>
              <span className="c-date">{dayLabel(e.bizDate)}</span>
              <span className="c-cat">{e.category}</span>
              <span className={`c-pay ${e.method}`}>{PAY_LABEL[e.method]}</span>
              <span className="c-memo">{e.memo ?? ""}</span>
              <span className="c-amt r">{won(e.amount)}</span>
            </div>
          ))
        )}
        {rows.length ? (
          <div className="erow efoot">
            <span>{rows.length}건</span>
            <span />
            <span />
            <span className="muted">
              카드 {won(t.card)} · 현금 {won(t.cash)}
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

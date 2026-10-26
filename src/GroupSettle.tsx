// 단체 정산서: 타입별 소계 → 추가 인원 · 추가 항목 · 환불/취소 → 받은 돈 → 최종 결제액. 인쇄(이미지/PDF)용 모양도 같이.
import { hasExtraTime, isTimeService, timeTags } from "../shared/extratime";
import { useState } from "react";
import { Check, Plus, Printer, Receipt, X } from "lucide-react";
import { type Booking, addDays, dayLabel, typeLabel, won } from "../shared/ledger";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, PAYMENT_METHOD_LABEL, type BookPayMethod, paySplit, splitLine, validatePayment } from "../shared/payment";
import { type GroupInfo, type GroupPayMode, EXTRA_MAX, PAY_MODE_LABEL, emptyGroupInfo, settle, validateExtra } from "../shared/settle";
import { INVOICE_COPY } from "../shared/invoiceDoc";
import { findLinkedQuote } from "../shared/quoteVariance";
import type { HotelData } from "./data";
import { useInvoiceIssues, useQuoteIssues } from "./data";
import { askConfirm } from "./ConfirmDialog";
import InvoiceLetter from "./InvoiceLetter";
import { PlatBadge, TypeBadge, lookups } from "./ui";

interface Props {
  data: HotelData;
  today: string;
  groupId: string;
  members: Booking[];
  onClose: () => void;
  notify: (m: string) => void;
  /** 같은 단체에 객실 추가 창 열기 */
  onAddRooms?: () => void;
}
const num = (v: string) => v.replace(/\D/g, "").slice(0, 9);

export default function GroupSettle({ data, today, groupId, members, onClose, notify, onAddRooms }: Props) {
  const s = data.hotel!.settings;
  const L = lookups(s);
  const info: GroupInfo = data.groups.get(groupId) ?? emptyGroupInfo(groupId);
  const first = members[0];
  const plat = first ? L.plats.get(first.platformId) : undefined;
  const st = settle(members, info, plat);
  const invoices = useInvoiceIssues(data.hotel!.id);
  const quotes = useQuoteIssues(data.hotel!.id);
  const linkedQuote = (() => {
    const q = findLinkedQuote(quotes.list, {
      groupId,
      bookingIds: members.map((m) => m.id),
    });
    return q ? { id: q.id, title: q.title || q.clientName, total: q.total } : null;
  })();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  // 빠른 입실 · 늦은 퇴실한 방: '601 빠른 14:00 · 602 늦은 15:00 서비스'
  const timeRooms = members
    .filter((b) => b.status !== "cancelled" && hasExtraTime(b))
    .map((b) => `${L.rooms.get(b.roomId ?? "")?.no ?? "?"} ${timeTags(s, b).join(" ")}${isTimeService(b) ? " 서비스" : ""}`)
    .join(" · ");
  const tord = new Map(s.types.map((t, i) => [t.id, i]));
  st.lines.sort((a, b) => (tord.get(a.typeId) ?? 0) - (tord.get(b.typeId) ?? 0));
  const name = first?.groupName ?? first?.guestName ?? "단체";
  const checkIn = members.reduce((a, b) => (b.checkIn < a ? b.checkIn : a), first?.checkIn ?? today);
  const nights = members.reduce((a, b) => Math.max(a, b.nights ?? 0), 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extra, setExtra] = useState({ name: "", amount: "" });
  const [take, setTake] = useState<{ method: BookPayMethod; amount: string } | null>(null);
  const [editPayer, setEditPayer] = useState(false);
  const [pf, setPf] = useState({ payMode: info.payMode, dueOn: info.dueOn ?? addDays(checkIn, nights), company: info.payerCompany ?? "", name: info.payerName ?? "", phone: info.payerPhone ?? "" });

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (ok) notify(ok);
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  };
  const base = {
    payMode: info.payMode,
    dueOn: info.dueOn,
    payerCompany: info.payerCompany,
    payerName: info.payerName,
    payerPhone: info.payerPhone,
    rates: info.rates,
    extras: info.extras,
    badgeColor: info.badgeColor,
  };
  const addExtra = () => {
    const x = { name: extra.name.trim(), amount: Number(extra.amount || 0) };
    const v = validateExtra(x);
    if (v) return setErr(v);
    if (info.extras.length >= EXTRA_MAX) return setErr(`추가 항목은 ${EXTRA_MAX}개까지예요.`);
    void run(async () => {
      await data.saveGroupInfo(groupId, { ...base, extras: [...info.extras, x] });
      setExtra({ name: "", amount: "" });
    });
  };
  const delExtra = (i: number) => void run(() => data.saveGroupInfo(groupId, { ...base, extras: info.extras.filter((_, k) => k !== i) }));
  const savePayer = () =>
    void run(async () => {
      await data.saveGroupInfo(groupId, {
        ...base,
        payMode: pf.payMode,
        dueOn: pf.payMode === "postpaid" ? pf.dueOn : null,
        payerCompany: pf.company || null,
        payerName: pf.name || null,
        payerPhone: pf.phone || null,
      });
      setEditPayer(false);
    }, "결제 정보를 저장했어요");
  const record = () => {
    if (!take) return;
    const amount = Number(take.amount || 0);
    const v = validatePayment(amount, take.method, today);
    if (v) return setErr(v);
    void run(async () => {
      await data.addGroupPayment(groupId, { method: take.method, amount, bizDate: today });
      const left = Math.max(0, st.left - amount);
      setTake(null);
      notify(`단체 ${name} ${won(amount)}원 받음 (${BOOK_PAY_LABEL[take.method]})${left ? ` · 남은 금액 ${won(left)}원` : " · 정산 완료"}`);
    });
  };
  const delPay = (id: string) => {
    void (async () => {
      const ok = await askConfirm({
        title: "받은 돈 삭제",
        body: "이 받은 돈 줄을 지울까요? 남은 금액이 다시 늘어나요.",
        confirmLabel: "지우기",
        danger: true,
      });
      if (!ok) return;
      void run(() => data.deleteGroupPayment(groupId, id));
    })();
  };
  const memberPays = members.filter((b) => b.status !== "cancelled").flatMap((b) => (b.payments ?? []).map((p) => ({ ...p, room: L.roomLabel(b.roomId) })));

  return (
    <div className="dim settle-dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settle" role="dialog" aria-label="단체 정산">
        <div className="grab noprint" />
        <div className="settle-print">
          <div className="sh-top">
            <div>
              <div className="sh-k">단체 정산서 · {data.hotel!.name}</div>
              <h2>{name}</h2>
              <div className="sh-sub">
                {dayLabel(checkIn)} {s.stayTimes.checkIn} 입실 ~ {dayLabel(addDays(checkIn, nights))} {s.stayTimes.checkOut} 퇴실 · {nights}박 · {members.filter((b) => b.status !== "cancelled").length}실
                {plat ? (
                  <>
                    {" · "}
                    <PlatBadge p={plat} /> {plat.name}
                  </>
                ) : null}
              </div>
            </div>
            {st.settled ? (
              <span className="sh-done">
                <Check size={15} strokeWidth={3} /> 정산 완료
              </span>
            ) : (
              <span className="sh-mode">{PAY_MODE_LABEL[info.payMode]}</span>
            )}
          </div>

          <div className="sh-payer">
            {editPayer ? (
              <div className="gpayer noprint">
                <div className="seg sm">
                  {(["prepaid", "postpaid"] as GroupPayMode[]).map((m) => (
                    <button type="button" key={m} className={pf.payMode === m ? "on" : ""} onClick={() => setPf({ ...pf, payMode: m })}>
                      {PAY_MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
                {pf.payMode === "postpaid" ? (
                  <label className="gpl">
                    <span>결제 예정일</span>
                    <input className="inp sm" type="date" value={pf.dueOn} onChange={(e) => e.target.value && setPf({ ...pf, dueOn: e.target.value })} />
                  </label>
                ) : null}
                <input className="inp sm" placeholder="회사 이름" aria-label="결제자 회사" maxLength={60} value={pf.company} onChange={(e) => setPf({ ...pf, company: e.target.value })} />
                <input className="inp sm" placeholder="담당자" aria-label="결제자 담당자" maxLength={40} value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} />
                <input className="inp sm" placeholder="연락처" aria-label="결제자 연락처" maxLength={30} value={pf.phone} onChange={(e) => setPf({ ...pf, phone: e.target.value })} />
                <button type="button" className="btn sm dark" disabled={busy} onClick={savePayer}>
                  저장
                </button>
              </div>
            ) : (
              <>
                <span>
                  결제자 <b>{[info.payerCompany, info.payerName].filter(Boolean).join(" · ") || "적지 않음"}</b>
                  {info.payerPhone ? <span className="num"> · {info.payerPhone}</span> : null}
                </span>
                {info.payMode === "postpaid" && info.dueOn ? (
                  <span>
                    결제 예정일 <b>{dayLabel(info.dueOn)}</b>
                  </span>
                ) : null}
                <button type="button" className="auto noprint" onClick={() => setEditPayer(true)}>
                  결제 정보 바꾸기
                </button>
              </>
            )}
          </div>

          <table className="sh-tbl">
            <thead>
              <tr>
                <th>객실 타입</th>
                <th className="r">방</th>
                <th className="r">박</th>
                <th className="r">1박 요금</th>
                <th className="r">소계</th>
              </tr>
            </thead>
            <tbody>
              {st.lines.map((l) => (
                <tr key={l.typeId}>
                  <td>
                    <TypeBadge t={L.types.get(l.typeId)} /> {typeLabel(L.types.get(l.typeId))}
                    {l.noshow ? <span className="nst sm">노쇼 {l.noshow} 포함</span> : null}
                  </td>
                  <td className="r num">{l.rooms}실</td>
                  <td className="r num">{!l.rooms ? "—" : Number.isInteger(l.nights / l.rooms) ? `${l.nights / l.rooms}박` : `${l.nights}박 합`}</td>
                  <td className="r num">{won(l.rate)}</td>
                  <td className="r num">{won(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sub">
                <td colSpan={4}>객실 합계</td>
                <td className="r num">{won(st.roomSum)}</td>
              </tr>
              {st.extraGuests ? (
                <tr>
                  <td colSpan={4}>추가 인원</td>
                  <td className="r num">+{won(st.extraGuests)}</td>
                </tr>
              ) : null}
              {timeRooms ? (
                <tr>
                  <td colSpan={4}>
                    빠른 입실 · 늦은 퇴실 <span className="muted">· {timeRooms}</span>
                  </td>
                  <td className="r num">{st.extraTime ? `+${won(st.extraTime)}` : "서비스 0"}</td>
                </tr>
              ) : null}
              {st.parking ? (
                <tr>
                  <td colSpan={4}>주차 (추가 차량 − 도보 할인)</td>
                  <td className="r num">{st.parking > 0 ? `+${won(st.parking)}` : `−${won(-st.parking)}`}</td>
                </tr>
              ) : null}
              {info.extras.map((x, i) => (
                <tr key={`x${i}`}>
                  <td colSpan={4}>
                    추가 항목 · {x.name}
                    <button type="button" className="ic noprint" aria-label="추가 항목 지우기" disabled={busy} onClick={() => delExtra(i)}>
                      <X size={13} />
                    </button>
                  </td>
                  <td className="r num">+{won(x.amount)}</td>
                </tr>
              ))}
              <tr className="noprint">
                <td colSpan={5}>
                  <div className="sh-add">
                    <input className="inp sm" placeholder="추가 항목 (예: 매점 외상, 세미나실)" aria-label="추가 항목 이름" maxLength={30} value={extra.name} onChange={(e) => setExtra({ ...extra, name: e.target.value })} />
                    <span className="inp price sm">
                      <input className="num" inputMode="numeric" aria-label="추가 항목 금액" placeholder="금액" value={extra.amount ? won(Number(extra.amount)) : ""} onChange={(e) => setExtra({ ...extra, amount: num(e.target.value) })} />원
                    </span>
                    <button type="button" className="btn sm line" disabled={busy} onClick={addExtra}>
                      <Plus size={13} /> 추가
                    </button>
                  </div>
                </td>
              </tr>
              {st.refunds ? (
                <tr>
                  <td colSpan={4}>중도 퇴실 환불</td>
                  <td className="r num">−{won(st.refunds)}</td>
                </tr>
              ) : null}
              {st.cancelled.rooms ? (
                <tr className="muted">
                  <td colSpan={4}>취소 {st.cancelled.rooms}실 (청구 안 함)</td>
                  <td className="r num">
                    <s>{won(st.cancelled.amount)}</s>
                  </td>
                </tr>
              ) : null}
              <tr className="total">
                <td colSpan={4}>최종 결제액</td>
                <td className="r num">{won(st.total)}원</td>
              </tr>
              {info.payments.map((p) => (
                <tr key={p.id} className="paid">
                  <td colSpan={4}>
                    받은 돈 · {dayLabel(p.bizDate)} · {PAYMENT_METHOD_LABEL[p.method]}
                    <button type="button" className="ic noprint" aria-label="받은 돈 지우기" disabled={busy} onClick={() => delPay(p.id)}>
                      <X size={13} />
                    </button>
                  </td>
                  <td className="r num">−{won(p.amount)}</td>
                </tr>
              ))}
              {memberPays.map((p) => (
                <tr key={p.id} className="paid">
                  <td colSpan={4}>
                    {p.kind === "deposit" ? "선금" : "받은 돈"} · {p.room ? `${p.room}호 · ` : ""}
                    {dayLabel(p.bizDate)} · {PAYMENT_METHOD_LABEL[p.method]}
                  </td>
                  <td className="r num">−{won(p.amount)}</td>
                </tr>
              ))}
              {info.payments.length + memberPays.length > 1 ? (
                <tr className="paid psum">
                  <td colSpan={4}>
                    받은 돈 합계 <span className="muted">· {splitLine(paySplit([...info.payments, ...memberPays]))}</span>
                  </td>
                  <td className="r num">−{won(st.paid)}</td>
                </tr>
              ) : null}
              <tr className={`left ${st.total - st.paid > 0 ? "due" : ""}`}>
                <td colSpan={4}>{st.settled ? "남은 금액 · 정산 완료" : "남은 금액"}</td>
                <td className="r num">{won(Math.max(0, st.total - st.paid))}원</td>
              </tr>
            </tfoot>
          </table>
          <div className="sh-foot">매출은 입실일 기준 그대로, 현금으로 받은 돈만 받은 날 현금 시재에 들어가요 (카드·이체는 빠져요) · {dayLabel(today)} 기준</div>
        </div>

        {take ? (
          <div className="paybal noprint">
            <div className="seg sm">
              {BOOK_PAY_METHODS.map((m) => (
                <button type="button" key={m} className={take.method === m ? "on" : ""} onClick={() => setTake({ ...take, method: m })}>
                  {BOOK_PAY_LABEL[m]}
                </button>
              ))}
            </div>
            <label className="inp price sm">
              <input className="num" inputMode="numeric" aria-label="받은 금액" value={take.amount ? won(Number(take.amount)) : ""} onChange={(e) => setTake({ ...take, amount: num(e.target.value) })} />원
            </label>
            <button type="button" className="btn sm" onClick={() => setTake(null)}>
              닫기
            </button>
            <button type="button" className="btn sm red" disabled={busy} onClick={record}>
              {busy ? "저장 중…" : "받음 기록"}
            </button>
          </div>
        ) : null}
        {err ? <div className="ferr noprint">{err}</div> : null}
        <div className="mf noprint">
          <div className="keys acts">
            {onAddRooms ? (
              <button type="button" className="btn line sm" onClick={onAddRooms}>
                <Plus size={14} /> 단체에 객실 추가
              </button>
            ) : null}
            <button
              type="button"
              className="btn line sm"
              onClick={() => {
                document.body.classList.add("print-settle");
                let cleaned = false;
                const done = () => {
                  if (cleaned) return;
                  cleaned = true;
                  document.body.classList.remove("print-settle");
                  window.removeEventListener("afterprint", done);
                };
                window.addEventListener("afterprint", done);
                window.print();
                window.setTimeout(done, 1500);
              }}
            >
              <Printer size={14} /> 저장(이미지/PDF)
            </button>
            <button type="button" className="btn line sm" onClick={() => setInvoiceOpen(true)}>
              <Receipt size={14} /> {INVOICE_COPY.title}
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {!st.settled && st.total > 0 ? (
            <button type="button" className="btn red" disabled={busy || !!take} onClick={() => setTake({ method: "card", amount: String(Math.max(0, st.total - st.paid)) })}>
              금액 받음
            </button>
          ) : null}
        </div>
      </div>
      {invoiceOpen ? (
        <InvoiceLetter
          hotelName={data.hotel!.name}
          s={s}
          today={today}
          members={members}
          groupId={groupId}
          groupInfo={info}
          linkedQuote={linkedQuote}
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
          onClose={() => setInvoiceOpen(false)}
        />
      ) : null}
    </div>
  );
}

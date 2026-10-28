import { useState } from "react";
import { Infinity as InfinityIcon, CalendarDays, Pencil } from "lucide-react";
import { addDays, md, won } from "../shared/ledger";
import { type GroupLedger, type RoomLedger, rateLabel, stayRangeLabel } from "../shared/groupLedger";

/**
 * 객실별 요금 — 결제와 따로, 객실마다 기간 · 박당 요금(요일별) · 소계, 맨 아래 청구 합계.
 * 이용 기간 미정은 「10/25 ~ 퇴실 미정」으로 보이고, 머리글에서 한 번에(단체 전체) 또는 객실마다 바꿀 수 있어요.
 */
export default function GroupCharges({
  ledger,
  today,
  roomLabel,
  readOnly,
  onSetEnd,
  onEditRoom,
}: {
  ledger: GroupLedger;
  today: string;
  roomLabel: (bookingId: string) => string;
  readOnly?: boolean;
  /** ids의 객실을 퇴실 미정(out=null)으로, 또는 그 날짜 퇴실로 바꿔요 */
  onSetEnd?: (ids: string[], out: string | null) => Promise<void> | void;
  /** 객실 하나의 입퇴실 · 박별 요금 고치기 */
  onEditRoom?: (bookingId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [groupDate, setGroupDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = ledger.rooms.filter((r) => r.live || r.openEnded);
  const allOpen = live.length > 0 && live.every((r) => r.openEnded);
  const maxOut = live.map((r) => r.checkOut).sort().pop() ?? today;
  const [gDate, setGDate] = useState(maxOut);
  const run = async (ids: string[], out: string | null) => {
    if (!onSetEnd || busy) return;
    setBusy(true);
    try {
      await onSetEnd(ids, out);
      setOpenId(null);
      setGroupDate(false);
    } finally {
      setBusy(false);
    }
  };
  if (!ledger.rooms.length) return null;
  const can = !readOnly && !!onSetEnd;
  return (
    <section className="gch" aria-label="객실별 요금">
      <div className="gch-h">
        <b>객실별 요금</b>
        <span className="muted sm">청구 합계 {won(ledger.due)}원</span>
      </div>
      {can && live.length ? (
        <div className="gch-grp" role="group" aria-label="단체 전체 퇴실">
          <button type="button" className={`gch-tog${allOpen ? " on" : ""}`} aria-pressed={allOpen} disabled={busy} onClick={() => void run(live.map((r) => r.bookingId), allOpen ? maxOut : null)}>
            <InfinityIcon size={15} aria-hidden /> {allOpen ? "모두 퇴실 미정 · 누르면 퇴실일로" : "전체 퇴실 미정으로"}
          </button>
          <button type="button" className={`gch-tog${groupDate ? " on" : ""}`} aria-expanded={groupDate} disabled={busy} onClick={() => setGroupDate((v) => !v)}>
            <CalendarDays size={15} aria-hidden /> 전체 퇴실일 정하기
          </button>
          {groupDate ? (
            <div className="gch-date">
              <input type="date" aria-label="전체 퇴실일" value={gDate} min={addDays(today, 0)} onChange={(e) => e.target.value && setGDate(e.target.value)} />
              <button type="button" className="btn dark" disabled={busy} onClick={() => void run(live.map((r) => r.bookingId), gDate)}>
                {live.length}실 퇴실 {md(gDate)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="gch-tbl" role="table" aria-label="객실별 요금표">
        <div className="gch-row gch-hd" role="row" aria-hidden>
          <span>객실</span>
          <span>기간</span>
          <span className="r">박당 요금</span>
          <span className="r">소계</span>
        </div>
        {ledger.rooms.map((r) => (
          <RoomRow key={r.bookingId} r={r} name={roomLabel(r.bookingId)} today={today} open={openId === r.bookingId} can={can && (r.live || r.openEnded)} busy={busy}
            onToggle={() => setOpenId(openId === r.bookingId ? null : r.bookingId)}
            onSetEnd={(out) => void run([r.bookingId], out)}
            onEdit={onEditRoom && !readOnly ? () => onEditRoom(r.bookingId) : undefined} />
        ))}
        {ledger.extras > 0 ? (
          <div className="gch-row gch-ex" role="row">
            <span className="gch-no">추가 항목</span>
            <span className="muted sm">식사 등</span>
            <span />
            <span className="r gch-sub">{won(ledger.extras)}원</span>
          </div>
        ) : null}
        <div className="gch-row gch-tot" role="row">
          <span className="gch-no">청구 합계</span>
          <span />
          <span />
          <span className="r gch-sub">{won(ledger.due)}원</span>
        </div>
      </div>
    </section>
  );
}

function RoomRow({ r, name, today, open, can, busy, onToggle, onSetEnd, onEdit }: { r: RoomLedger; name: string; today: string; open: boolean; can: boolean; busy: boolean; onToggle: () => void; onSetEnd: (out: string | null) => void; onEdit?: () => void }) {
  const [date, setDate] = useState(r.checkOut);
  return (
    <div className={`gch-item${open ? " on" : ""}`} role="rowgroup">
      <div className="gch-row" role="row">
        <span className="gch-no">{name}</span>
        <span className="gch-range">
          {r.openEnded ? (
            <button type="button" className="gch-open" disabled={!can} onClick={onToggle} aria-expanded={open} title="끝 날짜 없이 계속 묵어요">
              {md(r.checkIn)} ~ 퇴실 미정 <i>∞ 미정</i>
            </button>
          ) : can ? (
            <button type="button" className="gch-edit" onClick={onToggle} aria-expanded={open}>
              {stayRangeLabel(r)} <Pencil size={11} aria-hidden />
            </button>
          ) : (
            stayRangeLabel(r)
          )}
        </span>
        <span className="r gch-rate">{rateLabel(r)}</span>
        <span className="r gch-sub">{won(r.subtotal)}원</span>
      </div>
      {open ? (
        <div className="gch-ed" role="group" aria-label={`${name} 퇴실`}>
          <button type="button" className={`gch-tog${r.openEnded ? " on" : ""}`} aria-pressed={r.openEnded} disabled={busy} onClick={() => onSetEnd(r.openEnded ? r.checkOut : null)}>
            <InfinityIcon size={15} aria-hidden /> {r.openEnded ? "퇴실 미정 중 · 누르면 퇴실일로" : "퇴실 미정으로"}
          </button>
          <div className="gch-date">
            <input type="date" aria-label={`${name} 퇴실일`} value={date} min={addDays(r.checkIn, 1)} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button type="button" className="btn line" disabled={busy} onClick={() => onSetEnd(date)}>
              퇴실 {md(date)}
            </button>
          </div>
          {onEdit ? (
            <button type="button" className="gch-link" onClick={onEdit}>
              박별 요금 고치기
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
